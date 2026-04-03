# 33 — Final Clarity: The Definitive Architecture

> **Date:** 2026-04-03
> **Purpose:** Cut through 32 research documents and make definitive decisions
> **Method:** First principles thinking. What ACTUALLY matters for this product?

---

## Start from the User, Not the Technology

**Who is the user?** A Product Owner at Bild Studio.
- Non-technical. Business-focused.
- Talks to clients. Gets emails, meeting notes, documents.
- Needs to figure out what to build.
- Spends 2-4 weeks per discovery, 2-3 projects at a time.
- Hands off to developers who use the Unified AI Assistant (Claude Code).

**What does the PO actually DO every day during discovery?**

```
Day 1: Had a client call. Took notes. Got some emails with attachments.
       → Wants to know: "What did I learn? What's still missing?"

Day 3: Got a spec document from the client. Got answers to questions via email.
       → Wants to know: "Are we making progress? Any contradictions?"

Day 7: Has another meeting tomorrow.
       → Wants to know: "What should I ask? What's most important?"

Day 14: Discovery is wrapping up.
       → Wants to produce: 3 structured documents for the dev team.

Occasional: "Research this client's company." "What tech stack do competitors use?"
            "The dev team says auth isn't clear — what do we actually know?"
```

**The product is successful when:** The PO uploads documents, sees progress,
gets smart questions for meetings, and produces high-quality handoff docs
that Phase 2 developers can work from without asking basic questions.

---

## The Three Things That Actually Matter

After 32 research documents, agent framework comparisons, and architecture debates,
only THREE things actually determine if this product succeeds or fails:

### 1. Extraction Quality

If the system can't accurately extract WHAT the client said, nothing else matters.
- Requirements with correct priority
- Decisions with who/when/why
- Contradictions caught
- Assumptions identified

This is the **extraction prompts** + **Instructor validation** + **Pydantic schemas**.
Not the framework. Not the infrastructure. The PROMPTS.

### 2. Gap Intelligence

If the system can't tell the PO what's MISSING, it's just a search engine.
- "You have 12 requirements but no auth method decided"
- "Budget is assumed, not confirmed"
- "3 stakeholders identified but none with final decision authority"
- "Meeting 3 contradicts Meeting 1 on hosting"

This is **typed extraction models** + **SQL queries on structured data**.

### 3. Document Generation Quality

If the generated handoff docs are wrong, incomplete, or untrustworthy,
the PO won't use them.
- Every claim attributed to a source document
- CONFIRMED vs ASSUMED clearly marked
- Phase 2 team can work from them without asking the PO

This is **source attribution** + **confidence marking** + **template quality**.

**Everything else — the agent framework, the infrastructure, the number of
subagents, web research, code analysis — is nice-to-have built on top of
these three foundations.**

---

## The Definitive Decisions

### Decision 1: Extract TYPED Business Data, Not Generic "Facts"

**This is the most important decision in the entire architecture.**

```python
class DiscoveryExtraction(BaseModel):
    """What we extract from every client document."""
    requirements: list[Requirement]     # FR-001, NFR-001... with MoSCoW priority
    constraints: list[Constraint]       # Budget, timeline, tech mandates
    decisions: list[Decision]           # Who decided what, when, why
    stakeholders: list[Stakeholder]     # People, roles, authority
    assumptions: list[Assumption]       # What we believe but haven't confirmed
    scope_items: list[ScopeItem]        # Explicitly in/out of MVP
    contradictions: list[Contradiction] # Conflicts between documents
```

**Why:** Phase 2's tech-agent needs requirements with priority, user perspective,
and business rules — not flat `"Hosting: Azure"` facts. If we extract the right
structure, document generation becomes template-filling, not creative writing.

### Decision 2: Three Subagents + Tool-Powered Coordinator

```
Coordinator Agent (Pydantic AI)
├── Tools: search, web research, code analysis, project status
├── Subagent: gap-analyzer → GapAnalysisResult
├── Subagent: doc-generator → DiscoveryDocuments
└── Subagent: meeting-prep → MeetingAgenda
```

**Why 3, not 6:** Web research, code analysis, and deep search are TOOLS,
not personas. They don't need their own system prompts or output types.
The coordinator uses them directly.

**Why subagents at all:** Gap analysis, document generation, and meeting prep
need DIFFERENT personas (skeptic, technical writer, consultant), DIFFERENT
anti-rationalization tables, and STRUCTURED output types. These justify
separate Agent instances with their own prompts.

### Decision 3: Readiness from SQL, Not LLM

Control point evaluation becomes SQL queries on typed tables:

```sql
-- Business Understanding
SELECT
  CASE WHEN COUNT(*) FILTER (WHERE s.decision_authority = 'final') > 0
       THEN 'covered' ELSE 'missing' END AS stakeholder_authority,
  CASE WHEN COUNT(*) FILTER (WHERE c.type = 'budget' AND c.status = 'confirmed') > 0
       THEN 'covered' ELSE 'missing' END AS budget_confirmed
FROM stakeholders s, constraints c
WHERE s.project_id = $1 AND c.project_id = $1;
```

**70% of control points** are existence checks (do we HAVE this data?).
These are free SQL queries.

**30% of control points** need quality assessment (is this data GOOD ENOUGH?).
These get LLM evaluation, but only when the PO asks `/gaps` — not on every upload.

**Cost impact:** Control point evaluation drops from ~40 LLM calls to ~3-5 (only quality checks).

### Decision 4: Pydantic AI as Agent Engine

**Final.** Researched 17 frameworks, compared production evidence, tool capabilities.

| Factor | Decision |
|--------|----------|
| Stack fit | Pydantic AI = same team as FastAPI/Pydantic. Our stack IS Pydantic. |
| Type safety | Typed tools with RunContext. Typed outputs with Pydantic models. |
| Model flexibility | Claude primary, can use cheaper models for extraction. Not locked in. |
| Testing | Built-in TestModel — unit test agents without API calls. |
| Web UI | SSE streaming, built for web apps (not CLIs). |
| Fallback | If it fails, migrate to Claude Agent SDK or raw API — prompts/tools transfer. |

### Decision 5: RAGFlow for Parsing + Semantic Search

Two datasets per project (not three — pipeline sync is v1.5):

| Dataset | What | Why |
|---------|------|-----|
| `project-{id}-documents` | Raw document chunks | Semantic search: "what did client say about X?" |
| `project-{id}-items` | Extracted requirements, constraints, decisions as text chunks | Semantic search: "find requirements related to auth" |

**PostgreSQL** holds the structured metadata (priority, status, confidence, relationships).
**RAGFlow** provides semantic search across both raw text and extracted items.

Both are needed:
- RAGFlow: "find me stuff about authentication" (semantic similarity)
- PostgreSQL: "show me all MUST requirements that are unconfirmed" (structured query)

### Decision 6: Pipeline is Simple and Deterministic

```
Upload → Classify (haiku) → Parse (RAGFlow) → Extract (Instructor, typed) → Dedup → Store → Evaluate (SQL)
```

No agent reasoning in the pipeline. No tool calling. Just sequential API calls
with structured Pydantic models. Testable, predictable, cost-efficient.

Agent reasoning happens ONLY in the chat layer, when the PO interacts.

---

## The Architecture (Definitive)

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                         │
│  Dashboard (readiness, requirements, gaps)                    │
│  Chat (PO talks to coordinator agent)                        │
│  Document viewer (uploaded files, extracted data)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   BACKEND (FastAPI + Python 3.12)             │
│                                                               │
│  PIPELINE (deterministic):                                    │
│  Upload → Classify → Parse (RAGFlow) → Extract (Instructor)  │
│  → Dedup → Store (PostgreSQL + RAGFlow) → Evaluate (SQL)     │
│                                                               │
│  AGENT (Pydantic AI):                                         │
│  Coordinator + 3 subagents + tools                            │
│  (search, web research, code analysis, reports)               │
│                                                               │
│  API (REST):                                                  │
│  Projects, documents, chat, dashboard, control points, auth   │
└──────────────────────────────────────────────────────────────┘
         │                    │
  ┌──────▼──────┐      ┌─────▼──────┐
  │   RAGFlow   │      │ PostgreSQL │
  │             │      │            │
  │ 2 datasets  │      │ typed      │
  │ per project │      │ tables:    │
  │ + GraphRAG  │      │ reqs       │
  │             │      │ constraints│
  │ ES+MySQL    │      │ decisions  │
  │ +MinIO      │      │ stakeholdr │
  │ +BGE-M3     │      │ assumptions│
  └─────────────┘      │ scope      │
                       │ + users    │
  + Redis              │ + projects │
  (queue + cache)      │ + history  │
                       └────────────┘
```

---

## What We DON'T Build (MVP)

| Temptation | Why Not |
|-----------|---------|
| Cross-project learning | Need 20+ projects first |
| .memory-bank/ sync from Phase 2-4 | v1.5 — after core discovery works |
| Browser automation | Complex, niche use case |
| Meeting transcription | Requires ASR setup |
| OpenAPI analysis | Specialized |
| WebSocket real-time | Polling is fine for 2-3 POs |
| Neo4j graph database | RAGFlow GraphRAG handles it |
| SSE streaming for skills | Loading indicator is fine |
| Circuit breakers | Restart Docker containers |
| /simulate (multi-perspective) | POs need basic trust first |
| Autonomous research loops | v2 |
| A2A protocol | v2+ |

---

## What We DO Build (MVP, 8 weeks)

### Weeks 1-2: Foundation
- FastAPI + PostgreSQL (typed tables: requirements, constraints, decisions, stakeholders, assumptions, scope_items)
- RAGFlow setup (Docker Compose, 2 datasets per project)
- Document upload API + classification (haiku)
- Redis queue for async pipeline

### Weeks 3-4: Pipeline + Extraction
- RAGFlow parse integration (template selection based on classification)
- Instructor extraction with DiscoveryExtraction typed model
- Dedup logic (search RAGFlow + LLM judgment)
- Store to PostgreSQL + RAGFlow
- Readiness evaluation (SQL queries + limited LLM for quality checks)
- Dashboard API (readiness score, requirements list, gaps count)

### Weeks 5-6: Agent + Chat
- Pydantic AI coordinator agent with tools
- 3 subagents (gap-analyzer, doc-generator, meeting-prep) with SKILL.md prompts
- Web research tools (DuckDuckGo, Tavily, WebFetch)
- Chat API with streaming (SSE)
- Control point templates (6 project types)

### Weeks 7-8: Frontend + Polish
- Next.js dashboard (readiness gauge, requirements table, gap indicators)
- Chat interface (messages + structured subagent results)
- Document upload with pipeline status
- Project creation + template selection
- Auth (OAuth2)
- Error handling, logging, LLM cost tracking

---

## The One-Page Summary

| Question | Answer |
|----------|--------|
| **What are we building?** | AI assistant that helps POs extract structured requirements from client communications |
| **What's the core value?** | Typed extraction (requirements, constraints, decisions) + gap detection + document generation |
| **Agent engine?** | Pydantic AI (fits our FastAPI/Pydantic stack, type-safe, model-agnostic) |
| **How many subagents?** | 3 (gap-analyzer, doc-generator, meeting-prep) + tools for everything else |
| **What do we extract?** | 6 typed models: Requirements, Constraints, Decisions, Stakeholders, Assumptions, Scope Items |
| **How do we evaluate readiness?** | SQL queries on typed tables (70%) + limited LLM quality checks (30%) |
| **Document search?** | RAGFlow (DeepDoc parsing, hybrid search, GraphRAG) |
| **Structured data?** | PostgreSQL (typed tables with lifecycle tracking) |
| **Pipeline?** | Deterministic: classify → parse → extract → dedup → store → evaluate. No agent reasoning. |
| **Infrastructure?** | 8 Docker containers: RAGFlow stack (5) + our app (3) + PostgreSQL + Redis |
| **Cost per project?** | $8-20 (20-30 docs + skills + chat + research) |
| **Timeline?** | 8 weeks to MVP |
| **Phase 2 handoff?** | 3 structured documents (Brief, Scope, Requirements) with source attribution |
