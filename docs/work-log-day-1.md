# Work Log — Day 1 (2026-03-31)

## Focus: Open-Source Research + Technical Deep Dives

---

### 1. Open-Source Framework Research

**Superpowers (obra/superpowers)** — Agentic skills framework for AI coding agents
- Deep dive into all 14 skill files, exact prompt structures, anti-rationalization tables
- Key patterns extracted: Iron Laws, verification-before-completion, TDD for prompts, CSO (Claude Search Optimization), subagent-driven development with isolated context
- Deliverable: `research/14-superpowers-research.md`

**gstack (garrytan/gstack)** — Garry Tan's virtual engineering team (YC president)
- Deep dive into ETHOS.md philosophy, 31 skills, exact prompt structures
- Key patterns extracted: Fix-First review (AUTO-FIX/ASK), universal preamble system (T1-T4 tiers), persistent cross-session learning (JSONL), "Boil the Lake" philosophy, scope modes (EXPANSION/SELECTIVE/HOLD/REDUCTION), AskUserQuestion format, anti-sycophancy directives, sprint-as-DAG
- Two research rounds: architecture overview + exact source file content
- Deliverable: `research/15-gstack-research.md`

### 2. Technical Deep Dives (4 parallel research agents)

**Mem0 (mem0ai/mem0)** — Fact store + entity graph
- Discovered: 2+3 LLM call pipeline (extract → dedup + 3 graph calls)
- Key findings: UUID hallucination prevention (map to integers before LLM), graph soft-delete pattern, no formal state machine (events only), `infer=False` flag for raw storage
- Custom prompts needed: fact extraction, graph extraction, contradiction handling
- Deliverable: `research/17-mem0-technical-deep-dive.md`

**RAGFlow (infiniflow/ragflow)** — Document parsing + search
- Discovered: XGBoost model with 31-feature vector for text concatenation (the "secret sauce"), K-Means column detection, dual-path OCR, position tracking for page-level citations
- 14 chunking templates mapped to our document types
- Hybrid search: 95% vector / 5% BM25 initial, reranked to 70/30 with PageRank
- GraphRAG: Leiden community detection + LLM entity resolution
- Deliverable: `research/18-ragflow-technical-deep-dive.md`

**LangGraph + CrewAI** — Multi-agent orchestration
- LangGraph: Pregel/BSP model, typed channels, checkpointing, parallel execution
- CrewAI: Role-based agents, delegation tools, Flow system, memory with LanceDB
- 5 orchestration patterns compared: Supervisor, Pipeline, DAG, Swarm, Hierarchical
- Recommendation: Hybrid DAG + Supervisor (later simplified to pipeline + skills)
- Deliverable: `research/17-multi-agent-orchestration-research.md`

**Instructor + Marvin + Outlines** — Structured LLM output extraction
- Instructor: Pydantic validation + retry, citation validation pattern, 40+ provider modes
- 6-stage extraction pipeline designed: classify → facts → entities → relationships → contradictions → coverage
- `infer=False` integration with Mem0 to avoid redundant extraction
- Deliverable: `research/19-structured-extraction-deep-dive.md`

### 3. Technical Blueprint

- Synthesized Superpowers + gstack patterns into concrete agent specifications
- Defined all 7 agents with: SKILL.md format, Iron Laws, anti-rationalization tables, output formats
- Designed: tiered preamble system (T1-T4), decision classification (MECHANICAL/TASTE/USER CHALLENGE), status protocol, persistent learning schema, query router, Pydantic extraction schemas, guardrails system
- Deliverable: `research/16-technical-blueprint.md`

### 4. Architecture Simplification

- **Critical decision: 7 agents → pipeline + 5 skills**
  - Realized Mem0 + Instructor + RAGFlow already do what 3 agents were supposed to do
  - Pipeline handles deterministic processing, skills handle on-demand PO interaction
  - Eliminated need for LangGraph/CrewAI orchestration frameworks
- Revised architecture: FastAPI + Instructor + RAGFlow + Mem0 + PostgreSQL
- Deliverable: `research/20-revised-architecture.md`

### 5. Stability & Concurrency Design

- Identified 3 concurrency zones: Pipeline (async queue), Skills (user-facing), Collaboration (multi-user)
- Designed: per-project sequential queue, pipeline checkpoints + retry, circuit breakers, WebSocket event bus, optimistic locking, activity feed
- Deliverable: `research/21-stability-and-concurrency.md`

---

## Deliverables Created

| # | Document | Content |
|---|----------|---------|
| 14 | `research/14-superpowers-research.md` | Superpowers framework patterns + exact source content |
| 15 | `research/15-gstack-research.md` | gstack patterns + exact source content |
| 16 | `research/16-technical-blueprint.md` | Full technical specs for all agents |
| 17 | `research/17-mem0-technical-deep-dive.md` | Mem0 internals: pipeline, dedup, graph |
| 17 | `research/17-multi-agent-orchestration-research.md` | LangGraph vs CrewAI + 5 patterns |
| 18 | `research/18-ragflow-technical-deep-dive.md` | RAGFlow: DeepDoc, 14 templates, search |
| 19 | `research/19-structured-extraction-deep-dive.md` | Instructor + extraction pipeline |
| 20 | `research/20-revised-architecture.md` | Pipeline + 5 skills architecture |
| 21 | `research/21-stability-and-concurrency.md` | Multi-user concurrency design |

## Key Decisions Made

1. Pipeline + on-demand skills replaces 7 persistent agents
2. Instructor for structured extraction with citation validation
3. RAGFlow for document parsing (DeepDoc) + search
4. Mem0 for fact store + entity graph (later reconsidered Day 2)
5. No agent orchestration framework needed (no LangGraph/CrewAI)
6. Model tiering: haiku for classification, sonnet for extraction/skills
7. Per-project sequential queue for pipeline stability

## Hours: ~10-12 hours (research + architecture + documentation)
