# Session Heartbeat + Relationships Table — Architecture Plan

**Date:** 2026-04-23
**Author:** Bojan + Claude (architecture review)
**Status:** Planned — Phase 1 starts next

---

## The core insight

Three parallel representations exist today and lose information at each arrow:

```
DB (typed, transactional)
  ↓ markdown_writer
Markdown vault (wikilinks, hand-edit-preserving)
  ↓ graph_parser (regex + yaml)
Knowledge Graph (edges are text labels, field semantics lost)
```

Beyond that decay, there's a **missing middle layer**. Today we track
project STATE well (requirements, gaps, contradictions, readiness) but
not the project's **story** — the flow of sessions, decisions, rejections,
and learnings that produced that state. `.memory-bank/learnings.jsonl`
was the placeholder for this. It's been dead since inception because
no agent knows when to write to it and no retrieval logic knows when to
read from it.

Obsidian integration closed the DISPLAY gap — graph view, wikilinks,
dataview queries. It did not close the CONTINUITY gap. Every session
still starts cold, re-deriving context from flat files.

## The move — three concentric layers

```
┌─ DERIVED VIEWS ──────────────────────────────────────┐
│  Obsidian vault · Web UI · RAGFlow index             │
│  (rendered / re-indexed from the layer below)        │
├─ TRUTH GRAPH ────────────────────────────────────────┤
│  Findings + Relationships + Documents                │
│  (typed, transactional, agent reads/writes)          │
├─ PROJECT HEARTBEAT ← THE MISSING LAYER ──────────────┤
│  Sessions + SessionEvents + Learnings                │
│  (append-only log, the project's story)              │
└──────────────────────────────────────────────────────┘
```

Each layer's job is precise:

- **Heartbeat** — immutable log, answers "what happened and why"
- **Truth graph** — materialized state, answers "what do we know right now"
- **Derived views** — render the first two for humans and agents

Information flow is unidirectional (heartbeat → truth → views). Read
paths fan out. No bidirectional sync, no drift.

## Relationships as first-class entities (Phase 1)

Instead of per-kind columns (`blocked_reqs`, `blocked_by`, `affects_reqs`,
etc.), a single typed table:

```sql
CREATE TYPE rel_confidence AS ENUM ('explicit', 'derived', 'proposed');
CREATE TYPE rel_source     AS ENUM ('extraction', 'propose_update',
                                    'human', 'graph_parser', 'review_portal');

CREATE TABLE relationships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id),

  -- UUID endpoints so renaming BR-004 never shatters edges
  from_type        VARCHAR(32) NOT NULL,
  from_uuid        UUID        NOT NULL,
  to_type          VARCHAR(32) NOT NULL,
  to_uuid          UUID        NOT NULL,

  rel_type         VARCHAR(32) NOT NULL,
  confidence       rel_confidence NOT NULL,

  -- provenance ON the row — no join required to answer "why"
  source_doc_id    UUID REFERENCES documents(id),
  source_quote     TEXT,
  created_by       rel_source NOT NULL,
  created_by_user  UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ DEFAULT NOW(),

  -- retract, don't destroy — keeps the lesson
  status           VARCHAR(16) NOT NULL DEFAULT 'active',
  retracted_at     TIMESTAMPTZ,
  retracted_by     UUID REFERENCES users(id),
  retraction_reason TEXT,

  UNIQUE (project_id, from_uuid, to_uuid, rel_type, created_by)
);

CREATE INDEX idx_rel_from_active ON relationships (project_id, from_uuid)
  WHERE status = 'active';
CREATE INDEX idx_rel_to_active   ON relationships (project_id, to_uuid)
  WHERE status = 'active';
```

### Design decisions worth naming

1. **UUID endpoints** — display IDs (`BR-004`) resolved at query time;
   renaming never breaks edges.
2. **`status='retracted'`**, not DELETE — history survives; rejection
   reasons feed the learning loop we already built.
3. **UNIQUE includes `created_by`** — agent and graph_parser can hold
   independent opinions; disagreement becomes visible data.
4. **`last_seen_at` bumped on re-proposal** (UPSERT) — spam collapses
   to one row with freshness, not N duplicates.
5. **Partial indexes `WHERE status = 'active'`** — active queries stay
   fast; retracted history exists but doesn't pollute hot reads.
6. **Provenance on the row itself** — no joins to answer "why is this
   edge here".
7. **Don't store derivable edges.** `co_extracted` (same source_doc_id)
   and `mentioned_in` (source_person) are computed at query time —
   storing them explodes on 50-BR documents and pollutes the table.

### One primitive for the agent

```
get_connections(finding_id, depth=1, rel_types?, include_derived=true)
  → {
      center,
      outgoing[], incoming[],           # from 'relationships'
      derived_groups: [
        {kind: "shared_source_doc", doc, items: [...]},
        {kind: "shared_stakeholder", person, items: [...]},
      ]
    }
```

Replaces `get_related` (graph) and any hypothetical `get_explicit_relations`
(DB). One mental model, cited by source + confidence.

### Propose through infrastructure we already have

`propose_relationship(from, to, rel_type, source_quote, rationale)` writes
a row with `confidence='proposed'`. PM Accept flips to `'explicit'`,
Reject flips to `status='retracted'` with reason. **Same flow as
`propose_update`** — no new UX pattern.

### Strangler-fig migration

- Week 1: create table, dual-write (old columns + new rows), read from
  table with fallback to columns; log fallback hits.
- Week 2: backfill existing `blocked_reqs`/`blocked_by`/`affects_reqs`
  into rows. Audit drift.
- Week 3: new table becomes primary.
- Week 4: drop redundant columns.

Zero downtime; reversible at every step.

## Session Heartbeat (Phase 2)

### Schema

```sql
CREATE TABLE sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id),
  user_id           UUID REFERENCES users(id),
  domain            VARCHAR(32),                        -- discovery | tech-stories | qa
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  status            VARCHAR(16) DEFAULT 'active',       -- active | archived | abandoned
  summary           TEXT,                               -- auto-generated at archive
  artifacts_produced JSONB DEFAULT '{}'                 -- {files: [...], proposals: [...],
                                                        --  reminders: [...], commits: [...]}
);

CREATE TABLE session_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id),
  ts            TIMESTAMPTZ DEFAULT NOW(),
  event_type    VARCHAR(48) NOT NULL,
                -- extraction_done | proposal_created | proposal_accepted |
                -- proposal_rejected | reminder_scheduled | br_confirmed |
                -- gap_resolved | contradiction_resolved | file_written |
                -- ac_accepted | ac_rejected | rejection_reason_logged
  payload       JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_session_events_by_session ON session_events (session_id, ts);
CREATE INDEX idx_session_events_by_type    ON session_events (event_type, ts);
```

### Session boundaries

- **Explicit `/archive` command** ends a session immediately.
- **N-minute inactivity** (default 30 min, configurable) auto-archives.
- **Manual override** — agent can keep-alive a session during long runs.

### What gets emitted

Every existing MCP tool call that mutates state emits ONE event:
- `store_finding` → `extraction_done`
- `propose_update` → `proposal_created`
- Accept endpoint → `proposal_accepted`
- Reject endpoint → `proposal_rejected`
- `update_requirement_status` → `br_confirmed` / `br_dropped` / ...
- `schedule_reminder` → `reminder_scheduled`
- File write in vault → `file_written`

Events are fire-and-forget INSERTs, <1ms each. No hot-path cost.

### Archive trigger

On `sessions.status = 'archived'`:

1. Generate `summary` from events (agent-driven, 2-3 sentences).
2. Collect `artifacts_produced` from event payloads.
3. Promote high-reference learnings (below).
4. Render `docs/completed-tasks/YYYY-MM-DD_session_{id}.md` for Obsidian
   (read-only render from DB; not hand-editable).
5. Reset `active-task.md` for the affected domain.

## Learnings as a first-class inbox (Phase 3)

### Replace `learnings.jsonl` with a DB table

```sql
CREATE TABLE learnings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID REFERENCES projects(id),       -- NULL = global
  origin_session   UUID REFERENCES sessions(id),

  category         VARCHAR(32) NOT NULL,
                   -- pm_preference | domain_fact | workflow_pattern | anti_pattern
  content          TEXT NOT NULL,
  evidence_quote   TEXT,
  evidence_doc_id  UUID REFERENCES documents(id),

  status           VARCHAR(16) DEFAULT 'transient',    -- transient | promoted | dismissed
  reference_count  INTEGER DEFAULT 1,                  -- how many sessions have cited this
  last_relevant_at TIMESTAMPTZ DEFAULT NOW(),

  promoted_at      TIMESTAMPTZ,
  promoted_by      UUID REFERENCES users(id),
  dismissed_at    TIMESTAMPTZ,
  dismissed_by    UUID REFERENCES users(id),

  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learnings_active ON learnings (project_id, status, last_relevant_at DESC);
```

### Emission rules (in the agent prompt)

The agent writes a transient learning when:
- A PM rejects the same proposal TYPE twice with similar reasons.
- A PM asks the same clarification question across sessions.
- An extraction produces an item that matches a past `anti_pattern`.

### Promotion rules (automatic)

- `reference_count >= 3` → surface to PM as a promotion candidate at
  session-end. PM clicks once → `status='promoted'`.
- Promoted learnings become Tier 1 context (loaded every session for
  this project).
- Transient learnings with `last_relevant_at < NOW() - 90 days` and
  `reference_count < 2` → auto-dismiss.

### Retrieval at session start

New MCP tool `get_active_learnings(project_id, category?, top_n=10)`
returns promoted + high-reference transient learnings. Orchestrator
calls this on session start (replaces the `learnings.jsonl` Tier 2 load
that never worked).

## Obsidian harmony — vault as DERIVED view

The vault stops being a write surface we parse later. It becomes a
projection of the truth graph + heartbeat log, refreshed each session.

### What changes in the vault

- `dashboard.md` gains a Session Timeline dataview block — shows the
  last 5 sessions and the BRs/gaps each touched.
- Per-BR files gain an `## Activity` section listing the session_events
  that touched this BR ("2026-04-23 — rationale proposed and accepted
  from `taxonomy-smoke-test.md`").
- `docs/completed-tasks/` becomes fully auto-populated by the archival
  trigger, with consistent naming and embedded wikilinks.
- Obsidian graph view shows session nodes (purple) connected to the
  BRs they touched — you can see the PROJECT STORY as a graph.

### What doesn't change

- Hand-edits below `END-GENERATED` markers still survive.
- Templater templates stay.
- Dataview queries stay — they just query more data.
- CSS classes stay.

The vault's UX metaphor is preserved; it just becomes time-aware.

## RAG alignment (Phase 5, after Phase 3 lands)

RAG stays the recall engine. Add a second RAG collection beyond raw
docs:

- `project-{id}-findings` — indexes each BR / Gap / Constraint /
  Contradiction's synthesis (title + description + rationale +
  source_quote), embedded at write time.
- `project-{id}-sessions` — indexes session summaries.
- `project-{id}-learnings` — indexes promoted + transient learnings.

New MCP tool `search_findings(query, top_n)` returns finding IDs;
agent follows up with structured DB lookups.

Mental model: **DB = exact id. RAG = concept.** Agent uses one or
both depending on question shape.

## Roadblocks and mitigations

| Roadblock | Mitigation |
|---|---|
| ID instability on BR rename | UUID-anchored endpoints; display IDs resolved at render |
| Edge combinatorial explosion (co-extraction on 50-BR docs) | Don't store derivable edges; compute at query time |
| Dual-write drift between old columns and new table | Strangler fig with verify step; log every fallback hit |
| Graph parser rerun duplicating rows | Idempotent UNIQUE keyed on (endpoints, rel_type, created_by) |
| PM rejects an explicit edge | `status='retracted'`, reason logged, feeds rejection-learning |
| Session boundaries unclear | Explicit `/archive` OR N-minute inactivity (configurable) |
| session_events volume | JSONB + partial indexes; partition by month at 6 months old |
| Learnings promotion cold-start | Start with reference-count trigger; tune thresholds as data accumulates |
| RAG indexing lag for finding synthesis | Delta re-embed on finding write hook (~100ms) |
| Ghost hits (deleted BR still in RAG) | Filter RAG hits by DB existence at result time |
| Cross-project learnings leak | `project_id NULL` means global; PM opts in explicitly |
| Obsidian hand-edit drift | Parse hand-edits on next pipeline run; write back as `derived` relationships surfaced for review |

## Phased delivery

### Phase 1 — Relationships table (ships first)

1. Migration 032: create `relationships` table + indexes + enums.
2. MCP tool `get_connections` + `propose_relationship`.
3. `store_finding` dual-writes explicit relationships on BR / Gap /
   Constraint writes.
4. Update `Connections` UI component to consume `get_connections`.
5. Graph parser becomes a pipeline-time writer (confidence='derived',
   idempotent).

**Estimated: ~5h.**

### Phase 2 — Session Heartbeat

6. Migration 033: `sessions` + `session_events` tables.
7. Session lifecycle hooks: start on first user message, end on
   `/archive` or inactivity.
8. Event emission hooks on every existing MCP write tool.
9. Archive trigger: summary generation + artifact collection + vault
   render.

**Estimated: ~4h.**

### Phase 3 — Learnings inbox

10. Migration 034: `learnings` table.
11. MCP tool `get_active_learnings` replaces `learnings.jsonl` load.
12. Agent prompt additions for insight emission rules.
13. Promotion UX at session-end (PM reviews promotion candidates).

**Estimated: ~6h.**

### Phase 4 — Obsidian integration

14. Vault render extensions: Session Timeline, per-BR Activity section.
15. Session node rendering in graph view (new `type='session'`).

**Estimated: ~2h.**

### Phase 5 — RAG alignment

16. Finding synthesis indexing hook.
17. Session summary indexing hook.
18. MCP tool `search_findings` for concept → id translation.
19. Agent prompt: DB-for-ids, RAG-for-concepts decision rule.

**Estimated: ~2h.**

### Phase 6 — Cleanup (deferred)

20. Drop redundant columns (`blocked_reqs`, `blocked_by`,
    `affects_reqs`) after 2-week verify.

**Estimated: ~1h.**

**Total: ~20 hours of focused work** to land the complete architecture.

## Success criteria

The shift is complete when:

1. `SELECT * FROM relationships WHERE project_id = X` answers every
   relational question in the product.
2. `SELECT * FROM session_events WHERE session_id = X` tells the
   complete story of a session.
3. `learnings.jsonl` can be deleted without losing anything.
4. Every agent response citing a relationship also cites its source
   (doc, person, confidence).
5. A new session's Tier 1/2 context loads from three SQL queries, not
   from file reads of disparate markdown files.
6. Opening the Knowledge Base graph shows both findings AND sessions
   as nodes, revealing the project's evolution.

## What this is NOT

- Not a rewrite of Obsidian integration — the vault keeps its UX.
- Not a replacement for RAG — RAG stays the corpus recall layer.
- Not a new frontend — reuses DataPanel + Connections component.
- Not an abandonment of the existing tables — they stay; the new
  tables are additive.

## The emergent property

Once these three tables exist, every relational and temporal question
in the product becomes one query. Debugging becomes one query. The
Knowledge Base, the agent chat, the DataPanel detail views, the
Obsidian graph — all four surfaces consume the same underlying truth.

That's the property we don't have today. That's the fingerprint worth
leaving.
