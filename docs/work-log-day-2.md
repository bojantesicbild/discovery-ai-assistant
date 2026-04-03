# Work Log — Day 2 (2026-04-02)

## Focus: Architecture Review, Final Decisions, Agent Engine

---

### 1. Architecture Pressure Test

- Conducted a critical review of the entire architecture across 13 dimensions
- Graded each area: overall B+, dependencies B-, MVP scope C+, cost model C
- **3 critical findings that changed the architecture:**
  1. Mem0 is the weakest link — we bypass its core value with `infer=False`, fight its data model
  2. Chat and Skills are two UIs doing overlapping things — confusing for POs
  3. MVP scope too large — WebSocket, circuit breakers, streaming, cross-project learning all premature
- Deliverable: `research/22-architecture-review.md`

### 2. Final Architecture Decisions

**Decision 1: Drop Mem0**
- Re-examined RAGFlow deep dive (research/18) — realized RAGFlow's search is far more sophisticated than Qdrant (dual-layer tokenization, synonym expansion, PageRank)
- New model: two RAGFlow datasets per project (documents + facts) + PostgreSQL for fact lifecycle
- Built fact dedup as ~100 lines using RAGFlow search + Instructor LLM judgment
- Entity graph via RAGFlow GraphRAG (no separate Neo4j for MVP)
- Result: -2 containers (dropped Qdrant + Mem0 app), full control over data model

**Decision 2: Chat IS the interface, Skills are the engine**
- Unified model: PO types anything in chat, system routes naturally
- No separate skills page, no `/command` vs "asking in chat" confusion
- Intent classification happens naturally (later replaced by Agent SDK reasoning)

**Decision 3: Cut MVP scope**
- Deferred: /simulate, cross-project learning, WebSocket, SSE streaming, circuit breakers, optimistic locking
- MVP ships: pipeline + 4 skills + chat + dashboard + polling refresh

**Decision 4: Tiered control point evaluation**
- Fast keyword pass first, LLM only for affected CPs
- Reduces ~40 LLM calls to 3-8 per document upload (~80% cost reduction)

**Decision 5: Honest cost model**
- Revised from $2-5 to $5-12 per project (later $8-20 with agent capabilities)

- Deliverable: `research/23-architecture-final-decisions.md`

### 3. Remaining Decisions Gap Analysis

- Analyzed 15 areas not yet addressed in the architecture
- **Must decide before code (11 items):** Auth (OAuth2 + 3 roles), RAGFlow template selection (classify BEFORE upload — pipeline bug found), long document handling (30-page threshold), Neo4j schema, structured logging + LLM call tracking, file format support, testing strategy (5 layers), prompt management
- **During development (8 items):** Intent classifier accuracy, embedding model, backup scripts, production deployment, cost dashboard, PO onboarding, data export
- **Defer to v2 (6 items):** GDPR, MSG support, Prometheus, prompt A/B testing
- Deliverable: `research/24-remaining-decisions.md`

### 4. Consolidated Architecture Document

- Created `ARCHITECTURE.md` — single source of truth, 17 sections
- Covers: product definition, system diagram, 3 knowledge layers, tech stack, pipeline, chat+skills, control points, PostgreSQL schema (13 tables), Neo4j schema, auth, file formats, extraction schemas, project structure, MVP scope, design patterns, open questions, research index
- Replaces 27 research documents as the go-to reference for developers

### 5. RAGFlow GraphRAG vs Neo4j Decision

- Compared capabilities: RAGFlow GraphRAG has PageRank, Leiden community detection, entity resolution built-in
- Neo4j gives precise Cypher traversal, manual entity CRUD, incremental updates
- **Decision: RAGFlow GraphRAG for MVP, Neo4j for v2 if needed**
- Drops infrastructure from 9 to 8 containers
- Updated ARCHITECTURE.md accordingly

### 6. Agent Capabilities Research

- Researched how to give the Discovery Assistant "superpowers" beyond document processing
- **Technologies studied:**
  - Claude Agent SDK — official SDK with built-in tools, subagents, MCP, hooks, sessions
  - gstack browser daemon — persistent Chromium for live system exploration
  - Superpowers subagent dispatch — isolated-context pattern
  - Claurst/claw-code — Claude Code architecture (Coordinator Mode, autoDream)
  - MCP ecosystem — 400+ servers, Tavily, Playwright, Brave Search
  - Browser-Use, Firecrawl, Tavily — web research tools

- **7 capabilities analyzed:** web research, code repo analysis, rich HTML reports, API exploration, meeting transcription, autonomous research loops, interactive system exploration
- Deliverable: `research/25-agent-capabilities-research.md`

### 7. Agent-Powered Architecture Proposal

- Proposed hybrid: deterministic pipeline (FastAPI + Instructor) + intelligent chat (Claude Agent SDK)
- Designed: coordinator agent, 7 custom tools, 6 subagents, MCP integration
- New MVP capabilities: web research (Tavily), code analysis (built-in tools), HTML reports (Chart.js + Mermaid.js)
- Deliverable: `research/26-agent-powered-architecture.md`

### 8. Agent Engine Decision

- Evaluated: Claude Agent SDK vs raw Anthropic API vs LangGraph vs CrewAI
- Also researched: claw-code (Rust reimplementation of Claude Code) — confirmed same patterns
- **Decision: Claude Agent SDK as the agent engine**
  - Same engine that powers Claude Code, battle-tested
  - Built-in tools (WebSearch, WebFetch, Read, Write, Bash, Glob, Grep)
  - Subagent support with AgentDefinition
  - MCP server integration
  - Hooks for logging and guardrails
  - Session management
- Updated ARCHITECTURE.md with Agent SDK throughout

### 9. Final ARCHITECTURE.md Updates

- Added Intelligence Layer (Agent SDK) to architecture diagram
- Defined 7 custom tools, 6 subagents with SKILL.md prompts
- Updated project structure: `skills/` → `agent/` with tools/, subagents/, hooks.py
- Updated MVP scope with new capabilities (web research, code analysis, HTML reports)
- Updated cost model: $8-20 per project
- Updated design patterns with Agent SDK patterns
- Added research docs 25-26 to index

---

## Deliverables Created

| # | Document | Content |
|---|----------|---------|
| 22 | `research/22-architecture-review.md` | Pressure test: KEEP/CHANGE/DEFER/WATCH |
| 23 | `research/23-architecture-final-decisions.md` | Drop Mem0, unified chat, honest costs |
| 24 | `research/24-remaining-decisions.md` | 15 gap areas with decisions + timeline |
| 25 | `research/25-agent-capabilities-research.md` | Agent SDK, web research, code analysis, MCP |
| 26 | `research/26-agent-powered-architecture.md` | Hybrid pipeline + Agent SDK proposal |
| — | `ARCHITECTURE.md` | **Single source of truth** — consolidated, final |

## Key Decisions Made

1. **Drop Mem0** — use RAGFlow (2 datasets/project) + PostgreSQL for fact lifecycle
2. **RAGFlow GraphRAG for entity graph** (MVP) — defer Neo4j to v2
3. **Chat = interface, Agent = engine** — no separate skills UI, no intent classifier
4. **Claude Agent SDK** as the agent engine — same tools as Claude Code
5. **6 subagents** with focused tool sets: gap-analyzer, meeting-prep, doc-generator, deep-analyzer, company-researcher, code-analyst
6. **New MVP capabilities:** web research (Tavily), code analysis (built-in tools), HTML reports
7. **Pipeline stays deterministic** — FastAPI + Instructor, no agent reasoning overhead
8. **8 containers total** — RAGFlow stack (5) + our app (3) + PostgreSQL + Redis
9. **$8-20 per project** — honest cost with agent capabilities included
10. **Classify BEFORE upload** — pipeline bug fix: template selection happens before RAGFlow parsing

## Architecture Evolution Summary

```
Day 0:  7 persistent agents + Rowboat + custom orchestration
Day 1:  Pipeline + 5 skills + Instructor + RAGFlow + Mem0 (no agent framework)
Day 2:  Pipeline + Agent SDK chat (6 subagents) + RAGFlow only (no Mem0, no Neo4j)
        + web research + code analysis + rich reports
```

## Hours: ~10-12 hours (review + decisions + research + architecture updates)

## Total Research Output: 27 documents across 2 days
