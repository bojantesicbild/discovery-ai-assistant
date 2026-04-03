# 23 — Architecture: Final Decisions After Review

> **Date:** 2026-03-31
> **Purpose:** Resolve the 3 critical issues from the architecture review (doc 22)
> **Builds on:** research/20, 21, 22 + reconsidering research/18 (RAGFlow deep dive)
> **Status:** DECISION DOCUMENT

---

## The Big Realization

After re-examining RAGFlow's capabilities (research/18), we realized we were underusing RAGFlow and overcomplicating with Mem0.

**RAGFlow is not just a parser.** It's a full document intelligence platform with:
- Sophisticated hybrid search (vector 95% + BM25 5%, reranked to 70/30)
- Dual-layer tokenization (standard + fine-grained sub-token)
- Synonym expansion, bigram phrase boosting
- PageRank-based ranking features
- 15+ reranker providers
- Position tracking for page-level citations
- Auto metadata extraction with zero-hallucination prompts
- GraphRAG with Leiden community detection + entity resolution
- Per-dataset isolation (maps perfectly to per-project)

**Mem0 with `infer=False` is a dumb wrapper.** We bypass its extraction, we fight its data model, and we pay for infrastructure we don't use. Everything Mem0 gives us (vector store, graph, change history) we can get from RAGFlow + Neo4j + PostgreSQL.

---

## Decision 1: Drop Mem0. Use RAGFlow + Neo4j + PostgreSQL.

### The New Knowledge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   KNOWLEDGE LAYERS                            │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Layer 1: DOCUMENT SEARCH (RAGFlow)                      │ │
│  │                                                          │ │
│  │  Dataset per project: "project-{id}-documents"           │ │
│  │  → Raw document chunks (meeting notes, specs, emails)    │ │
│  │  → Full DeepDoc parsing, 14 chunking templates           │ │
│  │  → Hybrid search, reranking, position tracking           │ │
│  │  → Used for: "What did the client say about X?"          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Layer 2: FACT STORE (RAGFlow + PostgreSQL)              │ │
│  │                                                          │ │
│  │  Dataset per project: "project-{id}-facts"               │ │
│  │  → Extracted facts stored as chunks in RAGFlow           │ │
│  │  → Same hybrid search, same reranking                    │ │
│  │  → Fact metadata in PostgreSQL (status, confidence,      │ │
│  │    source_doc, source_quote, control_points, history)    │ │
│  │  → Used for: "Is hosting confirmed?" "What changed?"     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Layer 3: ENTITY GRAPH (Neo4j)                           │ │
│  │                                                          │ │
│  │  Direct Neo4j (no Mem0 wrapper)                          │ │
│  │  → Entities: people, orgs, features, decisions, tech     │ │
│  │  → Relationships: decided, depends_on, owns, requires    │ │
│  │  → Embedding-based entity matching for dedup             │ │
│  │  → Used for: "Who decided on SSO?" "What depends on X?"  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Why Two RAGFlow Datasets Per Project?

**Dataset 1: `project-{id}-documents`** — Raw document chunks
- PO uploads Meeting-3-notes.pdf → RAGFlow parses → 15 chunks
- Preserves original text, position tracking, paragraph context
- Used when you need actual paragraphs (document generation, "what did client say")

**Dataset 2: `project-{id}-facts`** — Extracted structured facts
- Instructor extracts: "Hosting: Azure, single region" (with source quote)
- Stored as a "document" in RAGFlow (using `naive` template, one fact per chunk)
- Gets the SAME hybrid search, reranking, and retrieval as raw documents
- Metadata in PostgreSQL links fact to control points, tracks status + history

**Why this works:**
- One search API (RAGFlow) queries both raw documents and facts
- Facts get RAGFlow's sophisticated search for free (synonym expansion, bigram boosting, etc.)
- No Qdrant needed (RAGFlow's ES handles vector+keyword)
- Per-dataset isolation maps to per-project perfectly

### What About Fact Dedup?

Without Mem0, we build our own dedup in the pipeline:

```python
# pipeline/stages/dedup.py

async def dedup_facts(project_id: str, new_facts: list[Fact],
                      ragflow: RAGFlowClient, instructor: InstructorClient) -> DeduResult:
    """Compare new facts against existing, decide ADD/UPDATE/FLAG."""

    results = []
    for fact in new_facts:
        # Search existing facts in RAGFlow
        similar = await ragflow.search(
            dataset_id=f"project-{project_id}-facts",
            query=fact.statement,
            top_n=5,
            similarity_threshold=0.6,
        )

        if not similar.chunks:
            # No similar facts exist → ADD
            results.append(DeduAction(fact=fact, action="ADD"))
            continue

        # LLM decides: is this new, an update, or a contradiction?
        decision = await instructor.client.chat.completions.create(
            response_model=DeduDecision,
            messages=[
                {"role": "system", "content": DEDUP_PROMPT},
                {"role": "user", "content": f"New fact: {fact.statement}\n\n"
                 f"Existing similar facts:\n" +
                 "\n".join(f"- [{s.id}] {s.content}" for s in similar.chunks)},
            ],
            max_retries=2,
        )

        results.append(DeduAction(fact=fact, action=decision.action,
                                   existing_id=decision.existing_id,
                                   explanation=decision.explanation))

    return DeduResult(actions=results)


class DeduDecision(BaseModel):
    action: Literal["ADD", "UPDATE", "CONTRADICTION", "DUPLICATE"]
    existing_id: Optional[str] = None  # ID of the fact being updated/contradicted
    explanation: str
```

**This is ~100 lines of real logic** (not 700 as the review estimated — because RAGFlow handles the search part).

### What About Graph?

Direct Neo4j. ~200 lines of wrapper code:

```python
# services/graph.py

class GraphService:
    """Direct Neo4j integration for entity relationships."""

    def __init__(self, driver: neo4j.AsyncDriver):
        self.driver = driver

    async def add_entity(self, project_id: str, entity: Entity):
        # Check for existing entity (by name similarity)
        existing = await self._find_similar(project_id, entity.name)
        if existing:
            await self._merge_entity(existing.id, entity)
        else:
            await self._create_entity(project_id, entity)

    async def add_relationship(self, project_id: str, rel: Relationship):
        await self._session.run(
            "MATCH (a {name: $src, project_id: $pid}), (b {name: $tgt, project_id: $pid}) "
            "MERGE (a)-[r:$type]->(b) "
            "SET r.evidence = $evidence, r.updated_at = datetime()",
            src=rel.source, tgt=rel.target, type=rel.relation,
            evidence=rel.evidence, pid=project_id,
        )

    async def query(self, project_id: str, entity_name: str) -> list[dict]:
        result = await self._session.run(
            "MATCH (a {project_id: $pid})-[r]-(b) WHERE a.name CONTAINS $name "
            "RETURN a.name, type(r), b.name, r.evidence",
            pid=project_id, name=entity_name,
        )
        return [dict(r) for r in result]
```

### Infrastructure Savings

**Before (with Mem0):**
```
Our app: backend + frontend + worker
RAGFlow: ES + MySQL + MinIO + RAGFlow app + embedding service
Mem0:    Qdrant + Neo4j + Mem0 app
Ours:    PostgreSQL + Redis
Total:   12 containers
```

**After (without Mem0):**
```
Our app: backend + frontend + worker
RAGFlow: ES + MySQL + MinIO + RAGFlow app + embedding service
Ours:    PostgreSQL + Redis + Neo4j
Total:   10 containers
```

Dropped: Qdrant, Mem0 app. Added: nothing (Neo4j was already needed).
Net: **2 fewer containers**, zero Mem0 dependency, full control over fact lifecycle.

---

## Decision 2: Chat IS the Interface. Skills Are the Engine.

### The Unified Model

```
┌─────────────────────────────────────────────┐
│              CHAT (primary interface)         │
│                                              │
│  PO types anything:                          │
│  ┌──────────────────────────────────────┐   │
│  │  Intent Classifier (haiku, fast)      │   │
│  │                                       │   │
│  │  "What gaps do we have?"              │   │
│  │    → intent: SKILL, skill: gaps       │   │
│  │                                       │   │
│  │  "What did client say about hosting?" │   │
│  │    → intent: SEARCH, layer: documents │   │
│  │                                       │   │
│  │  "Who decided on SSO?"               │   │
│  │    → intent: GRAPH_QUERY             │   │
│  │                                       │   │
│  │  "Prepare meeting agenda"            │   │
│  │    → intent: SKILL, skill: prep      │   │
│  │                                       │   │
│  │  "Generate the discovery docs"       │   │
│  │    → intent: SKILL, skill: generate  │   │
│  │                                       │   │
│  │  "/gaps" (power user shortcut)       │   │
│  │    → intent: SKILL, skill: gaps      │   │
│  └──────────────────────────────────────┘   │
│                    │                         │
│       ┌────────────┼──────────┐              │
│       ▼            ▼          ▼              │
│   ┌───────┐  ┌─────────┐ ┌───────┐         │
│   │ Skill │  │ Search  │ │ Graph │         │
│   │Runner │  │ Query   │ │ Query │         │
│   └───┬───┘  └────┬────┘ └───┬───┘         │
│       │            │          │              │
│       ▼            ▼          ▼              │
│   Structured    Passages   Relationships    │
│   result        + citations + connections    │
│   (formatted    (formatted  (formatted      │
│    in chat)      in chat)    in chat)       │
└─────────────────────────────────────────────┘
```

### Intent Classification Schema

```python
class ChatIntent(BaseModel):
    type: Literal["skill", "search", "graph_query", "clarification", "greeting"]
    skill: Optional[Literal["gaps", "prep", "generate", "analyze"]] = None
    search_layer: Optional[Literal["documents", "facts", "both"]] = None
    graph_query_type: Optional[Literal["who", "what_depends", "stakeholders"]] = None
    search_query: Optional[str] = None  # Reformulated query for search
```

Classified by haiku (~$0.001 per classification). Instant. Then routes to the right handler.

### No Separate Skills UI

Skills don't need their own page. They're invoked through chat:

```
PO: What are the gaps in our discovery?

🔍 Running gap analysis...

Gap Analysis — Project NacXwan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Readiness: 72% (was 65% after last document)

✅ AUTO-RESOLVED from existing data:
• Hosting requirements — Azure, single region (Meeting 3, confirmed)
• Auth method — Microsoft SSO (email thread, Mar 18)

❓ NEEDS CLIENT INPUT:
• Budget constraints — No mention in any document
  → Suggested question: "What is the monthly infrastructure budget?"
  → Priority: HIGH (blocks architecture decisions)

• Data retention policy — Vague mention in Meeting 2
  → Suggested question: "What is the required data retention period?"
  → Priority: MEDIUM

🔶 NEEDS YOUR DECISION:
• Competitive landscape — Is this relevant for a feature extension?
  → Recommendation: Mark as N/A

[View full report] [Export as PDF] [Prepare meeting from these gaps]
```

The `[Prepare meeting from these gaps]` button triggers `/prep` skill with the gaps context.

---

## Decision 3: Cut MVP Scope

### What Ships in v1

| Component | In v1 | Deferred |
|-----------|-------|---------|
| Pipeline (parse → extract → dedup → store → evaluate) | ✅ | — |
| Chat interface (unified, routes to skills/search/graph) | ✅ | — |
| 4 skills (/gaps, /prep, /generate, /analyze) | ✅ | /simulate (v2) |
| Dashboard (readiness, control points, document list) | ✅ | — |
| Control point templates (5 project types) | ✅ | — |
| Per-project learnings | ✅ | Cross-project (v2) |
| Document upload + pipeline status | ✅ | — |
| Polling-based refresh (30s) | ✅ | WebSocket (v2) |
| Simple error handling (try/except, friendly messages) | ✅ | Circuit breakers (v2) |
| Loading indicator for skills | ✅ | SSE streaming (v2) |
| "Last modified by" on control points | ✅ | Optimistic locking (v2) |
| Activity log (PostgreSQL, shown on dashboard) | ✅ | — |
| Per-project sequential pipeline queue | ✅ | — |
| Pipeline checkpoints + retry | ✅ | — |
| Model tiering (haiku/sonnet) | ✅ | — |

### What Does NOT Ship in v1

| Feature | Why Defer | When |
|---------|-----------|------|
| /simulate skill | POs need trust in basics first | v2 |
| Cross-project learning | Need 20+ projects for patterns | v2 |
| WebSocket real-time | 2-3 POs, async work, polling is fine | v2 (if needed) |
| SSE streaming | Loading spinner is fine for 10-60s | v2 (for /generate) |
| Circuit breaker | Single Docker Compose, just restart | v2 (prod hardening) |
| Optimistic locking | "Last modified by" is enough | v2 (if conflicts arise) |
| RAGFlow GraphRAG | Direct Neo4j is simpler and sufficient | v2 (if needed) |
| Conflict resolution UI | Show last value, not merge UI | v2 |

---

## Decision 4: Tiered Control Point Evaluation (Cost Fix)

The review (doc 22) flagged that evaluating 40 control points after every upload blows the budget. Here's the fix:

### Fast Pass + LLM Pass

```python
# services/control_points.py

async def evaluate_after_upload(project_id: str, new_facts: list[Fact]) -> ReadinessScore:
    """Two-tier evaluation: fast keyword pass, then LLM only when needed."""

    control_points = await db.get_project_control_points(project_id)
    changed_cps = []

    # FAST PASS: Which control points MIGHT have changed?
    for cp in control_points:
        if cp.status == "not_applicable":
            continue

        # Check if any new fact mentions this control point's keywords
        relevant_facts = [f for f in new_facts
                         if any(kw in f.statement.lower()
                                for kw in cp.keywords)]

        # Check if any new fact was explicitly linked to this control point
        linked_facts = [f for f in new_facts
                       if cp.id in (f.control_points or [])]

        if relevant_facts or linked_facts:
            changed_cps.append((cp, relevant_facts + linked_facts))

    # LLM PASS: Only evaluate control points that might have changed
    for cp, relevant_facts in changed_cps:
        assessment = await instructor.client.chat.completions.create(
            response_model=ControlPointAssessment,
            messages=[
                {"role": "system", "content": CP_EVALUATION_PROMPT},
                {"role": "user", "content":
                    f"Control point: {cp.description}\n"
                    f"Current status: {cp.status} (confidence: {cp.confidence}/10)\n"
                    f"New relevant facts:\n" +
                    "\n".join(f"- {f.statement} (source: {f.source_quote})"
                             for f in relevant_facts)},
            ],
            max_retries=1,
        )

        if assessment.coverage != cp.status or assessment.confidence != cp.confidence:
            await db.update_control_point(cp.id, assessment)

    # Recalculate readiness
    return calculate_readiness(project_id)
```

**Result:** Instead of 40 LLM calls per upload, we do 3-8 (only the affected control points). Saves ~80% of evaluation cost.

---

## Decision 5: Fact Lifecycle in PostgreSQL

Since we dropped Mem0, we own the fact lifecycle:

```sql
CREATE TABLE facts (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    statement TEXT NOT NULL,
    category VARCHAR NOT NULL,       -- infrastructure, security, compliance, etc.
    value VARCHAR,                    -- extracted value if applicable
    confidence VARCHAR NOT NULL,      -- high, medium, low
    source_doc_id UUID REFERENCES documents(id),
    source_quote TEXT NOT NULL,       -- exact quote from source
    ragflow_chunk_id VARCHAR,         -- ID in RAGFlow facts dataset

    -- Lifecycle
    status VARCHAR DEFAULT 'new',    -- new, discussed, confirmed, changed, retracted
    status_changed_by UUID REFERENCES users(id),
    status_changed_at TIMESTAMP,

    -- Control point links
    control_point_ids UUID[],

    -- Dedup
    supersedes_fact_id UUID REFERENCES facts(id),  -- if this UPDATE'd an older fact
    contradicts_fact_id UUID REFERENCES facts(id),  -- if this contradicts another fact
    contradiction_resolved BOOLEAN DEFAULT FALSE,
    resolution_note TEXT,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Fact history (append-only audit log)
CREATE TABLE fact_history (
    id UUID PRIMARY KEY,
    fact_id UUID REFERENCES facts(id),
    action VARCHAR NOT NULL,          -- ADD, UPDATE, CONTRADICTION, RETRACT
    old_value TEXT,
    new_value TEXT,
    triggered_by VARCHAR,             -- pipeline, po-manual, skill
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);
```

**This gives us everything Mem0 was supposed to provide:**
- Full lifecycle: new → discussed → confirmed → changed → retracted
- Change history with audit trail
- Contradiction tracking with resolution notes
- Source attribution (document + quote)
- Control point linkage
- User who changed status

**Plus things Mem0 couldn't do:**
- `project_id` as a first-class field (not a metadata hack)
- SQL queries: "all unresolved contradictions," "facts changed this week," "facts per control point"
- Joins with documents, users, control points
- Full ACID transactions

---

## Decision 6: Revised Cost Model (Honest)

| Stage | Calls | Model | Cost/doc (short) | Cost/doc (long spec) |
|-------|-------|-------|-------------------|---------------------|
| Classification | 1 | haiku | $0.001 | $0.002 |
| Fact extraction | 1-3 | sonnet | $0.02 | $0.08 |
| Entity extraction | 1-2 | sonnet | $0.01 | $0.04 |
| Relationship extraction | 1-2 | sonnet | $0.01 | $0.04 |
| Contradiction detection | 0-3 | sonnet | $0.01 | $0.06 |
| Control point coverage | 1-2 | sonnet | $0.02 | $0.06 |
| Fact dedup (new) | 0-5 | sonnet | $0.01 | $0.05 |
| CP evaluation (fast+LLM) | 3-8 | sonnet | $0.02 | $0.06 |
| **Total pipeline** | **8-26** | — | **$0.09-0.15** | **$0.30-0.50** |

| Skill invocations (on demand) | Calls | Model | Cost |
|-------------------------------|-------|-------|------|
| /gaps | 1-2 | sonnet | $0.03-0.08 |
| /prep | 1-2 | sonnet | $0.03-0.08 |
| /generate (3 documents) | 3-6 | sonnet | $0.10-0.25 |
| /analyze | 1-3 | sonnet | $0.03-0.10 |
| Chat (per message) | 1 | haiku/sonnet | $0.005-0.03 |

**Per project estimate (20-30 docs, 5-10 skill invocations, 30 chat messages):**
- Pipeline: $3-8
- Skills: $1-3
- Chat: $0.50-1
- **Total: $5-12 per project**

This is honest. And still cheap for the value delivered.

---

## Final Revised Stack

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                      │
│  Chat (primary) + Dashboard + Document viewer              │
└──────────────────┬───────────────────────────────────────┘
                   │ REST + polling
┌──────────────────▼───────────────────────────────────────┐
│                  BACKEND (FastAPI)                         │
│                                                           │
│  Chat API → Intent Classifier → Skill Runner / Search     │
│  Pipeline Service → Redis Queue → Worker                  │
│  Dashboard API + Control Points API + Documents API       │
│                                                           │
│  Services:                                                │
│    InstructorClient (Claude API, structured output)       │
│    RAGFlowClient (parse, chunk, search — TWO datasets)   │
│    GraphService (direct Neo4j)                            │
│    FactStore (PostgreSQL + RAGFlow search)                │
│    PreambleBuilder (context assembly)                     │
│    LearningStore (PostgreSQL)                             │
│    ControlPointEvaluator (fast pass + LLM pass)           │
└──────────────────────────────────────────────────────────┘
         │              │              │
  ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
  │   RAGFlow   │ │PostgreSQL│ │   Neo4j    │
  │   (Docker)  │ │          │ │   (Docker) │
  │             │ │ projects │ │            │
  │ ES + MySQL  │ │ facts    │ │ entities   │
  │ + MinIO     │ │ history  │ │ relations  │
  │             │ │ users    │ │            │
  │ 2 datasets  │ │ CPs     │ │            │
  │ per project │ │ learn    │ │            │
  └─────────────┘ │ activity │ └────────────┘
                  └──────────┘
      + Redis (queue + cache)
```

**Total containers: 9** (was 12 with Mem0)
- RAGFlow: ES + MySQL + MinIO + app + embedding (5)
- Ours: backend + frontend + worker (3, same image)
- Infrastructure: PostgreSQL + Redis + Neo4j (3)

---

## Summary of All Decisions

| # | Decision | Impact |
|---|----------|--------|
| 1 | **Drop Mem0** — use RAGFlow for search, PostgreSQL for fact lifecycle, Neo4j directly for graph | -2 containers, -1 dependency, full control over data model |
| 2 | **Chat = interface, Skills = engine** — one entry point, not two | Simpler UX, no "/gaps vs asking about gaps" confusion |
| 3 | **Cut MVP scope** — 4 skills, polling, simple errors, no WebSocket/streaming/circuit breakers | Ship faster, add sophistication after real users |
| 4 | **Tiered CP evaluation** — fast keyword pass, LLM only for affected CPs | ~80% cost reduction on evaluation stage |
| 5 | **Fact lifecycle in PostgreSQL** — full states, audit trail, SQL queries | Better than Mem0's event-only model |
| 6 | **Honest cost model** — $5-12/project, not $2-5 | Still cheap, expectations correct |
| 7 | **Two RAGFlow datasets per project** — documents + facts | Unified search across raw text and structured facts |
