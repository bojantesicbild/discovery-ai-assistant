# 22 — Architecture Review: Pressure Test

> **Date:** 2026-03-31
> **Author:** Senior Architect Review (Critical Assessment)
> **Scope:** Revised architecture (research/20) + stability design (research/21)
> **Status:** REVIEW — findings for team discussion before build

---

## Summary Verdict

The revised architecture (doc 20) is a significant improvement over the original 7-agent design (doc 12). The move from persistent agents to pipeline + skills was the right call. The stability/concurrency design (doc 21) is thorough for an MVP. However, there are real risks hiding in the dependency stack, the Mem0 value proposition is thin once you use `infer=False`, and the cost model is optimistic. Below are the findings.

---

## KEEP: Solid Decisions That Should Not Change

### K1. Pipeline + Skills over Persistent Agents

The shift from 7 orchestrated agents to a linear pipeline + 5 on-demand skills is the single best decision in this architecture. It eliminated the need for LangGraph/CrewAI, removed agent-to-agent coordination complexity, and made the system testable at clear stage boundaries. The research in doc 17 (multi-agent orchestration) proved you would have spent weeks on orchestration plumbing that adds no product value. Keep this.

### K2. Instructor for Structured Extraction

Using Instructor with Pydantic validation + retry is the right approach. The citation validation pattern (ensuring extracted source quotes actually exist in the document) is critical for a discovery tool where POs need to trust the output. The 40+ provider modes give you an escape hatch if Claude pricing or availability changes. This is a low-risk, high-value dependency.

### K3. RAGFlow's DeepDoc for Document Parsing

DeepDoc's PDF parsing pipeline (layout recognition, table structure, XGBoost-based text concatenation, dual-path OCR) would genuinely take months to replicate. The position tracking (`@@page-list\tx0\tx1\ttop\tbottom##`) enabling page-level source citations is a feature you will not get from simpler parsing libraries. The parsing quality directly impacts everything downstream. Keep RAGFlow for parsing.

### K4. Per-Project Sequential Pipeline Queue

The decision in doc 21 to process documents sequentially per project while allowing parallel processing across projects is correct. It eliminates race conditions in control point evaluation without sacrificing throughput for the expected scale (5-10 active projects). The checkpoint/resume design for partial failures is production-grade thinking at MVP stage, which is rare and good.

### K5. The Preamble System

Injecting structured context (readiness score, control points summary, contradictions) into every skill invocation is elegant. It avoids the problem where skills "forget" the current project state. The approach borrowed from gstack's SKILL.md pattern is sound. It turns stateless LLM calls into context-aware ones without building a stateful agent runtime.

### K6. Model Tiering

Using Haiku for classification and Sonnet for extraction/reasoning is the right call. Most teams default to one model for everything. The tiering gives you a 10x cost reduction on classification (the most frequent call) while preserving quality where it matters.

---

## CHANGE: Things That Need Rethinking Before You Build

### C1. The Mem0 Question — You Are Paying for Infrastructure You Are Bypassing

This is the biggest architectural concern. Let me lay it out:

**What Mem0 does:** Two-LLM-call pipeline per `add()` — (1) extract facts, (2) decide ADD/UPDATE/DELETE against existing facts. Plus 3 more LLM calls for graph operations. Total: 5 LLM calls per document.

**What you are doing:** Using Instructor for all extraction (6 stages), then storing in Mem0 with `infer=False` to skip Mem0's extraction. You are explicitly bypassing Mem0's core value proposition (the extraction + dedup pipeline).

**What you actually get from Mem0 after bypassing extraction:**
- A Qdrant vector store with metadata filtering
- A Neo4j graph with embedding-based entity matching
- Change history via SQLite

**What you are paying for that:**
- Qdrant container (you could run this directly)
- Neo4j container (you could run this directly)
- Mem0 application container (doing nothing if you use `infer=False`)
- Mem0's opinionated data model (no formal states, personal-preference categories, `user_id`/`agent_id` scoping instead of `project_id`)
- Custom metadata workarounds for everything: fact status, confidence, control point links, project isolation

**The real question:** Is the Mem0 dedup logic on subsequent adds valuable enough to justify the indirection? When you `infer=False` on initial add but a subsequent document upload triggers the pipeline again, Mem0's LLM call 2 (ADD/UPDATE/DELETE) runs against the new facts. But you are ALSO running contradiction detection in Instructor (Stage 5). This means you have two separate systems both trying to detect when facts conflict — and they will not always agree.

**Recommendation:** Seriously evaluate dropping Mem0 and using Qdrant + Neo4j directly. You would need to build:
1. A vector store wrapper (store facts with metadata) — ~200 lines
2. A graph store wrapper (store entities + relationships) — ~200 lines
3. A dedup function that runs on ingest (compare new facts against existing via embedding similarity + LLM judgment) — ~300 lines
4. A change history table in PostgreSQL — you already have this schema

Total: ~700 lines of code that you fully control, vs. an opaque dependency that you are fighting against (custom prompts, metadata workarounds, no project_id, no fact lifecycle states).

If you keep Mem0, at minimum stop running contradiction detection in both Instructor AND Mem0. Pick one system of record for fact lifecycle.

### C2. The RAGFlow Infrastructure Tax

RAGFlow requires Elasticsearch + MySQL + MinIO + Redis. You also need PostgreSQL for your app, Redis for your queue, and Qdrant + Neo4j for Mem0. That is 8 infrastructure services before you count your own backend + frontend + worker.

For a team building an MVP, this is a lot of containers to keep healthy. Every service is a potential failure point, a memory consumer, and a thing to upgrade.

**The parsing is worth it. The rest might not be.**

RAGFlow bundles parsing (DeepDoc), chunking, search, and a full application layer. You only need parsing + chunking + search. Consider whether you could:
1. Use RAGFlow's DeepDoc as a parsing step (extract text + structure)
2. Store chunks in your own Qdrant instance (shared with fact storage)
3. Run hybrid search via Qdrant (it supports dense + sparse vectors since v1.7)

This would eliminate: Elasticsearch, MySQL, MinIO (3 fewer services). You would lose RAGFlow's reranking pipeline and 14 chunking templates, but you would gain a unified vector store and simpler operations.

**Counter-argument:** RAGFlow's chunking templates are genuinely good (email, book, manual, table, presentation), and rebuilding them is real work. If you keep RAGFlow, accept the infrastructure tax and invest in good Docker Compose health checks and monitoring from day one.

**Recommendation:** Keep RAGFlow for MVP but treat it as a black box you might replace. Make sure your `RAGFlowClient` abstraction is clean enough to swap later. Do NOT use RAGFlow's chat, agent, or GraphRAG features — only parsing, chunking, and search.

### C3. Chat vs Skills — Pick One Mental Model

You currently have:
- 5 skills invoked explicitly (`/gaps`, `/prep`, `/generate`, `/simulate`, `/analyze`)
- A chat interface where users ask free-form questions
- Chat that classifies intent and routes to knowledge layers

This is confusing for the PO. When should they use `/gaps` vs. asking "what are the gaps?" in chat? What happens if they ask the chat "prepare my meeting" — does it invoke `/prep` behind the scenes? If not, why not?

**Recommendation:** Chat should be a natural language interface that invokes skills behind the scenes. The PO types "what gaps do we have?" and the system recognizes this as a `/gaps` invocation, runs the full skill, and streams the structured result. The PO types "what did the client say about hosting?" and the system recognizes this as a search query, hits RAGFlow, and returns passages.

The explicit `/command` syntax can remain as a power-user shortcut, but the chat should be the primary interface that routes to the right operation. This means your chat intent classifier needs to map to: (a) a skill invocation, (b) a knowledge layer query, or (c) a clarification question back to the PO.

Do NOT build two separate UIs with different capabilities. That is a maintenance burden and a UX problem.

### C4. The Contradiction Detection Duplication

You have three systems that can detect contradictions:
1. **Instructor Stage 5** — explicit contradiction detection comparing new facts against existing
2. **Mem0 LLM Call 2** — DELETE event when new fact conflicts with existing (which you want to convert to a FLAG instead)
3. **Mem0 Graph LLM Call 5** — deletion assessment for graph relationships

This triple-detection means: (a) you might flag the same contradiction three times, (b) the three systems might disagree, and (c) you are paying LLM costs for redundant work.

**Recommendation:** Make Instructor Stage 5 the single source of truth for contradiction detection. If you keep Mem0, use `infer=False` consistently to avoid Mem0's own contradiction logic. If you drop Mem0 (per C1), this problem disappears.

### C5. Control Point Evaluation — LLM Cost on Every Document

The pipeline runs control point evaluation (Stage 4) after every document upload. If a project has 40 control points and 30 documents, that is 1,200 control point evaluations over the project lifecycle. Each evaluation involves querying Mem0 facts and potentially an LLM call to assess coverage.

**The cost compounds:** If evaluation requires an LLM call per control point per document, you are looking at 40 LLM calls in Stage 4 alone. That blows your $0.10-0.15 per document budget.

**Recommendation:** Use a tiered evaluation approach:
1. **Fast pass (no LLM):** Check if new facts from the current document match any control point keywords/categories. Only re-evaluate control points that MIGHT have changed.
2. **LLM pass (only when needed):** For control points with potential changes, run the full LLM evaluation.
3. **Batch on demand:** Let the PO trigger a full re-evaluation manually (or via `/gaps`), rather than running it on every upload.

This could reduce Stage 4 LLM calls from 40 to 3-5 per document.

---

## DEFER: Over-Engineering for MVP

### D1. Cross-Project Learning System

The learning store (per-matter + cross-matter JSONL/PostgreSQL) is a great idea for a mature product. For MVP with 5-10 projects, there is not enough data for cross-project patterns to be meaningful. A PO running project 3 will not benefit from "similar project had these problems" when there are only 2 prior projects.

**Defer until:** 20+ completed projects. Build the PostgreSQL schema now (it is cheap), but do not build the search/injection logic for cross-project learnings. Per-project learnings are fine for MVP.

### D2. Role Simulation Skill (`/simulate`)

The multi-perspective analysis (end user, developer, business owner, admin, UX designer) is intellectually appealing but is the least essential skill for MVP. A PO in the first 3 months of using this tool needs `/gaps`, `/prep`, and `/generate`. They do not need 5-perspective adversarial analysis until they have built trust in the simpler features.

**Defer until:** Version 2. The skill architecture makes it easy to add later — just a new SKILL.md prompt + output model.

### D3. WebSocket Real-Time Collaboration

Doc 21 designs a full real-time collaboration system: WebSocket event bus, optimistic locking, conflict resolution UI, activity feed. For MVP scale (2-3 POs per project, async work), this is over-engineered.

**What you actually need for MVP:**
- Polling-based dashboard refresh (every 30s)
- Simple "last modified by" indicator on control points
- Pipeline status visible on document list page

WebSocket + event bus can come when you have 5+ concurrent users on the same project.

**Defer until:** You see actual concurrent usage patterns in production.

### D4. Circuit Breaker Pattern

The health check + circuit breaker pattern in doc 21 is production-grade infrastructure. For an MVP with a single Docker Compose deployment where you can just restart containers, this is premature.

**What you actually need for MVP:** Try/except with sensible error messages. "RAGFlow is currently unavailable, please try again in a minute." Log the error. Alert on Slack if you want.

**Defer until:** You have multiple users and uptime SLAs.

### D5. Streaming SSE for Skill Output

The streaming implementation for skills via Server-Sent Events is nice UX but adds complexity. For MVP, a simple loading spinner + complete result is fine. Skills take 10-60 seconds — show a progress indicator ("Analyzing gaps... Querying facts... Generating report...") based on stage, not token-level streaming.

**Defer until:** Users complain about the wait. Then add streaming for `/generate-docs` first (it is the longest).

### D6. RAGFlow GraphRAG

Doc 18 notes RAGFlow has GraphRAG with Leiden communities, PageRank, and community reports. Doc 20 says you will use "BOTH" RAGFlow GraphRAG and Mem0 graph. Two graph systems is one too many for MVP (arguably one too many, period).

**Defer until:** Never, unless you find a specific use case that Mem0's graph (or direct Neo4j) cannot handle. Community detection on 20-30 discovery documents is unlikely to produce meaningful clusters.

---

## WATCH: Fine Now but Could Become Problems

### W1. Cost Model Is Optimistic

The estimate of $0.10-0.15 per document assumes:
- Documents are short (fits in one LLM context window)
- Extraction stages each need 1-3 calls
- No retries beyond 2-3

Reality check:
- A 20-page technical spec might need 8,000+ input tokens per extraction stage. At Sonnet pricing (~$3/M input, ~$15/M output), a single extraction call on a long document could cost $0.05-0.10 alone.
- 6 extraction stages + 3 Mem0 graph calls = 9 LLM calls minimum. With retries: 12-18.
- Long documents may need chunked extraction (process in sections, then merge), which multiplies calls.

**More realistic estimate:** $0.15-0.40 per document for typical docs, $0.50-1.00 for long specs. Per project: $5-15 (not $2-5).

This is still cheap for the value delivered, but set expectations correctly.

**Watch for:** Anthropic price changes, token-heavy documents, retry loops from validation failures (each retry re-sends the full context).

### W2. Mem0's `infer=False` Dedup Behavior Is Unclear

The research (doc 17) documents Mem0's dedup logic: embed the fact, find top 5 similar existing memories, LLM decides ADD/UPDATE/DELETE. But when you use `infer=False`, the fact is stored as-is.

**Untested question:** When you later `add()` a NEW fact (from a subsequent document, also with `infer=False`), does Mem0 still run the dedup comparison against existing facts? Or does `infer=False` skip ALL processing, making Mem0 a dumb vector store?

If `infer=False` skips dedup, you are getting zero value from Mem0 beyond what Qdrant gives you directly. This needs to be tested before committing to the architecture.

### W3. RAGFlow API Stability

RAGFlow is a fast-moving open-source project (commit history shows major API changes between versions). You are depending on their REST API for parsing, chunking, and search. An upgrade could break your integration.

**Mitigation:** Pin the RAGFlow Docker image version. Write integration tests against their API. Keep your `RAGFlowClient` abstraction thin. Do not use advanced features (agents, GraphRAG, metadata extraction) that are more likely to change.

### W4. Document Size Limits

The architecture does not discuss what happens with large documents (100+ page specs, email threads with 50+ messages). Issues:
- LLM context windows may not fit the full document for extraction
- RAGFlow parsing time scales linearly with pages
- Extraction quality degrades on very long documents

**Watch for:** The first time a PO uploads a 100-page RFP. You will need a chunked extraction strategy (process in sections, then merge/dedup).

### W5. PostgreSQL as the Central Nervous System

Projects, users, templates, control points, documents, readiness history, learnings, activity log, conversations, pipeline checkpoints — all in PostgreSQL. This is fine for MVP scale, but PostgreSQL is the ONE service whose failure kills everything. The architecture acknowledges this ("This is a hard dependency. Standard HA setup.") but does not specify the HA setup.

**Watch for:** The first time PostgreSQL goes down and the entire system is dead. Plan for pg_dump backups from day one. Consider managed PostgreSQL (RDS, Cloud SQL) rather than a Docker container for production.

### W6. Prompt Drift Over Time

Skills and pipeline stages rely heavily on carefully crafted prompts (fact extraction, contradiction detection, control point evaluation, skill prompts). These prompts will need tuning as you encounter real-world documents.

**Watch for:** The prompts that work great on your test documents may fail on real client documents (different writing styles, languages, document formats). Build a test suite of 10-15 representative documents early and run regression tests on prompt changes.

### W7. The "5 Skills" Number

Five skills is a reasonable starting number, but watch the boundaries:
- `/gaps` and `/analyze` overlap significantly — both query knowledge layers and identify missing information. The difference is `/gaps` is structured (control points) while `/analyze` is free-form. A PO might not understand when to use which.
- `/prep` depends on `/gaps` output (must be < 24 hours old). This is a hidden coupling. If `/gaps` is stale, `/prep` silently re-runs it, doubling the cost and time.
- `/generate` is the only skill that produces final deliverables. It may need to be 3 separate skills (Discovery Brief, MVP Scope, Functional Requirements) once you find that generating all three in one shot exceeds context limits or quality thresholds.

**Watch for:** User confusion about which skill to use, and `/generate` becoming too large for a single LLM call.

### W8. No Rollback on Pipeline Failures

The checkpoint system lets you resume from the last successful stage. But what about rollback? If Stage 3 (Store) partially completes — 4 out of 6 facts stored in Mem0 before it crashes — you have an inconsistent state. Retrying from Stage 3 might double-store those 4 facts.

**Watch for:** Idempotency. Every pipeline stage needs to be safe to retry. For Mem0 storage, this means facts need deterministic IDs so re-adding is an upsert, not a duplicate.

### W9. Token Limits on Preamble + Skill Context

The preamble injects project context (readiness score, all control points, all contradictions) into every skill call. For a mature project with 40 control points and 10 contradictions, this preamble could be 2,000-3,000 tokens. Add the skill prompt (1,000-2,000 tokens), knowledge layer results (2,000-5,000 tokens), and user input. You could easily hit 10,000+ input tokens before the LLM even starts reasoning.

**Watch for:** Preamble size growth over the project lifecycle. Consider summarizing control points (only include non-covered ones) and limiting contradiction context to the most recent/relevant.

---

## Final Assessment

| Area | Grade | Notes |
|------|-------|-------|
| Overall architecture | B+ | Pipeline + skills is the right pattern. Clean separation of concerns. |
| Dependency choices | B- | RAGFlow justified for parsing, Mem0 questionable with `infer=False`, Instructor solid. |
| MVP scope | C+ | Too much infrastructure (WebSocket, circuit breakers, streaming, cross-project learning) for first release. |
| Cost model | C | Optimistic by 2-3x. Still affordable, but set expectations correctly. |
| Concurrency design | B+ | Good thinking, but over-engineered for MVP scale. |
| Migration path | B | Clean client abstractions enable swapping, but dual knowledge systems (RAGFlow search + Mem0 facts) create coupling at the pipeline level. |
| Testability | B+ | Linear pipeline + independent skills = clear test boundaries. LLM output quality testing remains an open problem industry-wide. |

**The three things to resolve before writing code:**
1. **Decide on Mem0** — run a spike: store 50 facts via `infer=False`, add 20 more from a "second document," and verify dedup actually works. If it does not, drop Mem0 and use Qdrant + Neo4j directly.
2. **Unify chat and skills** — make chat the entry point, skills the execution engine. One interface, not two.
3. **Cut the MVP scope** — defer WebSocket collaboration, streaming, circuit breakers, cross-project learning, and `/simulate`. Ship the pipeline + 4 skills + polling dashboard. Add sophistication after you have real users.
