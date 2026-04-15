# Discovery AI Assistant — Architecture Reference

> **Last updated:** 2026-04-03
> **Status:** FINAL — approved for MVP development
> **Research base:** 36 research documents in `docs/research/`
>
> This is the single source of truth. Research documents provide background — this document provides decisions.

---

## 1. What We're Building

An AI-powered tool that helps Product Owners (POs) extract structured business
requirements from client communications and produce handoff documents for the
development team.

```
DISCOVERY ASSISTANT → Story/Tech Doc Assistant → Code Assistant → QA Assistant
  (we build this)       (exists)                  (exists)        (exists)
```

**Core value:** Turn messy client meetings, emails, and documents into typed,
structured business requirements with priorities, gap analysis, and source attribution.

**Output:** Three documents for Phase 2:
1. **Project Discovery Brief** — business context, stakeholders, market
2. **MVP Scope Freeze** — features in/out, platforms, integrations
3. **Functional Requirements** — FR-001... with MoSCoW priority, user stories, business rules

> Product definition: `research/00-what-is-discovery-assistant.md`
> Output templates: `research/04-output-templates.md`
> Phase 2 integration: `research/27-pipeline-integration.md`

---

## 2. The Three Things That Determine Success

| # | What | Why It Matters |
|---|------|---------------|
| 1 | **Extraction Quality** | If we can't accurately extract what the client said — with correct priority, typed structure, source attribution — nothing else matters. |
| 2 | **Gap Intelligence** | If we can't tell the PO what's MISSING and what to ask next, we're just a search engine. |
| 3 | **Document Generation Quality** | If the handoff docs are wrong or untrustworthy, POs won't use them and Phase 2 can't work. |

Everything else is built on these three foundations.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                         │
│  Dashboard + Chat + Document viewer                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API + SSE streaming + polling
┌──────────────────────▼──────────────────────────────────────┐
│                BACKEND (FastAPI + Python 3.12)                │
│                                                               │
│  PIPELINE (deterministic, no LLM reasoning):                  │
│  Upload → Classify → Parse → Extract (typed) → Dedup →       │
│  Store → Evaluate (SQL)                                       │
│                                                               │
│  AGENT (Pydantic AI, for PO interaction):                     │
│  Coordinator Agent + 3 subagents + tools                      │
│                                                               │
│  API: Projects, Documents, Chat, Dashboard, Auth              │
└──────────────────────────────────────────────────────────────┘
         │                    │
  ┌──────▼──────┐      ┌─────▼──────┐
  │   RAGFlow   │      │ PostgreSQL │
  │ (Docker)    │      │            │
  │             │      │ typed      │
  │ 2 datasets  │      │ tables:    │
  │ per project │      │ requiremts │
  │ + GraphRAG  │      │ constraits │
  │             │      │ decisions  │
  │ ES+MySQL    │      │ stakehldr  │
  │ +MinIO      │      │ assumptns  │
  │ +BGE-M3     │      │ scope      │
  └─────────────┘      │ + users    │
                       │ + projects │
  + Redis              │ + history  │
  (queue + cache)      └────────────┘
```

**8 Docker containers (MVP):**
- RAGFlow: Elasticsearch, MySQL, MinIO, RAGFlow app, TEI embedding (5)
- Our app: backend, frontend, worker (3)
- Infrastructure: PostgreSQL, Redis (2)

---

## 4. Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Backend** | Python 3.12 + FastAPI | Async, Pydantic-native |
| **Agent Engine** | Pydantic AI | Same team as FastAPI/Pydantic. Type-safe tools, 25+ model providers, built-in TestModel, Capabilities pattern. |
| **LLM** | Claude (primary) via Pydantic AI | Best reasoning. Model-agnostic — can use cheaper models per task. |
| **Extraction** | Instructor (pipeline only) | Pydantic validation + retry + citation verification |
| **Document parsing** | RAGFlow (DeepDoc) | XGBoost text concat, 14 chunking templates, OCR, position tracking |
| **Semantic search** | RAGFlow (Elasticsearch) | Hybrid 95% vector / 5% BM25, reranked to 70/30 |
| **Structured data** | PostgreSQL | Typed tables with lifecycle, SQL queries for readiness |
| **Entity graph** | RAGFlow GraphRAG | Leiden communities, PageRank, entity resolution. Neo4j in v2 if needed. |
| **Queue** | Redis (arq) | Async pipeline processing |
| **Cache** | Redis | Dashboard data, readiness scores |
| **Frontend** | Next.js + React | Dashboard + chat + document viewer |
| **Embedding** | BGE-M3 (local, bundled with RAGFlow) | Multilingual, free |

### Model Tiering

| Task | Model | Cost |
|------|-------|------|
| Document classification | `claude-haiku` | ~$0.001 |
| Typed extraction (requirements, decisions, etc.) | `claude-sonnet` | ~$0.02-0.08 |
| Subagent skills (gaps, docs, meeting prep) | `claude-sonnet` | ~$0.05-0.30 |
| Chat (simple queries) | `claude-sonnet` | ~$0.01-0.05 |

**Per project:** $8-20 (20-30 docs + skills + chat + occasional research).

---

## 5. The Extraction Model (The Core of the Product)

### What We Extract: 6 Typed Business Models

Instead of generic "facts," we extract structured business data that Phase 2 directly consumes.

```python
class DiscoveryExtraction(BaseModel):
    """Everything extracted from a single client document."""
    requirements: list[Requirement]
    constraints: list[Constraint]
    decisions: list[Decision]
    stakeholders: list[Stakeholder]
    assumptions: list[Assumption]
    scope_items: list[ScopeItem]
    contradictions: list[Contradiction]
    document_summary: str
```

### The 6 Types

```python
class Requirement(BaseModel):
    id: str                           # FR-001, NFR-001 (auto-generated)
    title: str                        # "SSO Authentication"
    type: Literal["functional", "non_functional"]
    priority: Literal["must", "should", "could", "wont"]  # MoSCoW
    description: str                  # "System shall authenticate via Microsoft SSO"
    user_perspective: Optional[str]   # "As an admin, I want SSO so that..."
    business_rules: list[str]         # ["Only company email domains allowed"]
    edge_cases: list[str]             # ["SSO provider down"]
    source_doc: str
    source_quote: str                 # Exact quote (validated ≥10 chars)
    status: Literal["proposed", "discussed", "confirmed", "changed", "dropped"]
    confidence: Literal["high", "medium", "low"]

class Constraint(BaseModel):
    type: Literal["budget", "timeline", "technology", "regulatory", "organizational"]
    description: str                  # "Budget capped at $50K for MVP"
    impact: str                       # "Limits technology choices"
    source_doc: str
    source_quote: str
    status: Literal["confirmed", "assumed", "negotiable"]

class Decision(BaseModel):
    title: str                        # "Azure for hosting"
    decided_by: str                   # "Sarah Chen (CTO)"
    date: Optional[str]
    rationale: str                    # "Company IT policy mandates Azure"
    alternatives_considered: list[str]
    impacts: list[str]                # Requirement IDs affected
    source_doc: str
    status: Literal["confirmed", "tentative", "reversed"]

class Stakeholder(BaseModel):
    name: str
    role: str                         # "CTO", "Product Manager"
    organization: str
    decision_authority: Literal["final", "recommender", "informed"]
    interests: list[str]              # ["Security", "Cost optimization"]

class Assumption(BaseModel):
    statement: str                    # "500 concurrent users max"
    basis: str                        # "PO estimate"
    risk_if_wrong: str                # "Architecture may not scale"
    needs_validation_by: Optional[str]

class ScopeItem(BaseModel):
    description: str                  # "Real-time notifications"
    in_scope: bool                    # True = in MVP, False = excluded
    rationale: str
    source_doc: str

class Contradiction(BaseModel):
    item_a: str                       # "Single tenant (Meeting 1)"
    item_b: str                       # "Multi-tenant (Email, Mar 18)"
    type: Literal["direct_conflict", "partial_conflict", "supersedes", "narrows_scope"]
    explanation: str
    recommended_resolution: Literal["keep_a", "keep_b", "merge", "flag_for_review"]
```

### Why This Matters

| Generic "Facts" (old) | Typed Extraction (new) | Impact |
|----------------------|----------------------|--------|
| `"Hosting: Azure"` | Requirement FR-007 with priority MUST, source, status CONFIRMED | Phase 2 gets structured input |
| `"Budget $50K"` | Constraint (budget, confirmed, impact: limits tech choices) | Architecture decisions bounded |
| `"CTO chose Azure"` | Decision (who: CTO, why: IT policy, alternatives: AWS/GCP) | Audit trail, no re-debating |
| `"500 concurrent users"` | Assumption (risk: architecture won't scale, validate with CTO) | Phase 2 knows what's validated vs guessed |

> Full extraction analysis: `research/32-simplification-and-requirements.md`

---

## 6. The Pipeline (Deterministic)

```
Document Upload
      │
┌─────▼──── Pre-Parse ────────────────────────────────────────┐
│  Read first ~2K tokens. Classify with haiku:                 │
│  .eml → email | .pptx → presentation | .xlsx → table        │
│  .pdf/.docx → LLM classifies: meeting/spec/contract/general │
│  Result: chunking template name for RAGFlow                  │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────▼──── Stage 1: Parse ───┴────────────────────────────────┐
│  RAGFlow: upload with selected template, parse (DeepDoc),     │
│  chunk, embed, index into project-{id}-documents dataset      │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────▼──── Stage 2: Extract ─┴────────────────────────────────┐
│  Instructor: extract DiscoveryExtraction (typed)              │
│  → Requirements, Constraints, Decisions, Stakeholders,        │
│    Assumptions, Scope Items, Contradictions                   │
│  All validated via Pydantic + citation verification           │
│  Long docs (>30 pages): chunked extraction with merge         │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────▼──── Stage 3: Dedup ───┴────────────────────────────────┐
│  For each extracted item: search RAGFlow for similar existing  │
│  items → LLM judges: ADD / UPDATE / CONTRADICTION / DUPLICATE │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────▼──── Stage 4: Store ───┴────────────────────────────────┐
│  PostgreSQL: typed tables (requirements, constraints, etc.)   │
│  RAGFlow: extracted items as text chunks in project-{id}-items│
│  Change history: audit trail for every item                   │
│  Trigger GraphRAG re-extraction on documents dataset          │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────▼──── Stage 5: Evaluate ┴────────────────────────────────┐
│  SQL queries on typed tables (70% of control points):         │
│    "Do we have confirmed auth requirements?"                  │
│    "Do we have stakeholders with decision authority?"          │
│  LLM quality checks (30% — only when /gaps invoked):         │
│    "Are requirements specific enough for story breakdown?"    │
│  Update readiness score → dashboard                           │
└──────────────────────────────────────────────────────────────┘
```

### Pipeline Queue
- Per-project sequential (Redis). One doc at a time per project.
- Different projects process in parallel.
- Stage checkpoints in PostgreSQL — retry from last successful stage.

---

## 7. The Agent (Pydantic AI)

### Coordinator + 3 Subagents + Tools

```
PO types in chat
       │
       ▼
┌─ Coordinator Agent (Pydantic AI) ──────────────────────┐
│                                                          │
│  TOOLS (coordinator uses directly):                     │
│  • search_documents (RAGFlow — raw passages)            │
│  • search_items (RAGFlow — extracted requirements, etc.)│
│  • search_pipeline (RAGFlow — Phase 2-4 .memory-bank/)  │
│  • get_control_points (PostgreSQL — readiness status)   │
│  • get_project_context (readiness, contradictions, gaps)│
│  • store_finding (PostgreSQL — pending PO review)       │
│  • web_search (DuckDuckGo/Tavily)                       │
│  • web_fetch (httpx)                                    │
│  • generate_report (HTML with Chart.js + Mermaid.js)    │
│  • bash_exec, read_file, grep_search (for code analysis)│
│                                                          │
│  SUBAGENTS (structured tasks with typed output):        │
│  • gap-analyzer → GapAnalysisResult                     │
│  • doc-generator → DiscoveryDocuments                   │
│  • meeting-prep → MeetingAgenda                         │
└──────────────────────────────────────────────────────────┘
```

### Why 3 Subagents (Not 6)

| Subagent | Why It's Separate | Output Type |
|----------|------------------|-------------|
| **gap-analyzer** | Needs skeptical persona + anti-rationalization. Structured gap classification. | `GapAnalysisResult` — AUTO-RESOLVE / ASK-CLIENT / ASK-PO per gap |
| **doc-generator** | Needs technical writer persona. Source attribution on every claim. | 3 markdown documents (Brief, Scope, Requirements) |
| **meeting-prep** | Needs consultant persona. Scope mode selection. | `MeetingAgenda` — prioritized questions per section |

Everything else (web research, code analysis, deep search, graph queries, status checks)
is just the coordinator using its tools. No separate persona needed.

### Tool Implementation

```python
from pydantic_ai import Agent, RunContext
from dataclasses import dataclass

@dataclass
class Deps:
    project_id: str
    ragflow: RAGFlowClient
    db: Database

coordinator = Agent(
    'anthropic:claude-sonnet-4-20250514',
    deps_type=Deps,
    system_prompt=COORDINATOR_PROMPT,
)

@coordinator.tool
async def search_documents(ctx: RunContext[Deps], query: str) -> str:
    """Search raw document chunks. Use for 'what did client say about X?'"""
    return await ctx.deps.ragflow.search(
        f"project-{ctx.deps.project_id}-documents", query
    )

@coordinator.tool
async def search_items(ctx: RunContext[Deps], query: str) -> str:
    """Search extracted requirements, decisions, constraints. Use for 'is X confirmed?'"""
    return await ctx.deps.ragflow.search(
        f"project-{ctx.deps.project_id}-items", query
    )

@coordinator.tool
async def search_pipeline(ctx: RunContext[Deps], query: str) -> str:
    """Search Phase 2-4 output: tech docs, stories, test reports, defects.
    Use for cross-phase questions like 'is auth implemented and tested?'"""
    return await ctx.deps.ragflow.search(
        f"project-{ctx.deps.project_id}-memory-bank", query
    )

@coordinator.tool
async def run_gap_analysis(ctx: RunContext[Deps]) -> str:
    """Run structured gap analysis on all control points."""
    result = await gap_analyzer.run("Analyze all gaps.", deps=ctx.deps)
    return result.output.model_dump_json()
```

### Chat Handler

```python
@app.post("/projects/{project_id}/chat")
async def chat(project_id: str, user_id: str, message: ChatMessage):
    conversation = await db.get_or_create_conversation(project_id, user_id)
    deps = Deps(project_id=project_id, ragflow=ragflow, db=database)

    async with coordinator.run_stream(
        message.text, deps=deps, message_history=conversation.messages[-20:],
    ) as stream:
        async for text in stream.stream_text(delta=True):
            yield sse_encode(text)

    await db.save_conversation(conversation.id, message.text, stream.result.new_messages())
```

> Agent engine decision: `research/29-agent-engine-survey.md`, `research/31-production-agent-engine-reality-check.md`
> Tool comparison: `research/30-pydantic-ai-vs-claude-sdk-tools.md`

---

## 8. Knowledge Layers

### RAGFlow Datasets (per project)

| Dataset | Contains | Written By | Queried For |
|---------|----------|-----------|-------------|
| `project-{id}-documents` | Raw document chunks (DeepDoc parsed) | Pipeline (PO uploads) | "What did client say about X?" |
| `project-{id}-items` | Extracted requirements, decisions, etc. as text | Pipeline (extraction) | "Find requirements related to auth" |
| `project-{id}-memory-bank` | `.memory-bank/` markdown files from project repo | Git push hook sync (v1.5) | "Is auth implemented?" "Are tests passing?" |

The third dataset (`memory-bank`) enables cross-phase visibility: PO can search
Phase 2-4 output (tech docs, stories, test reports, defects) from the web UI.
Synced automatically via git push webhook. See Section 8.1 for details.

### PostgreSQL Typed Tables

| Table | Queried For |
|-------|-------------|
| `requirements` | "All MUST requirements that are unconfirmed" |
| `constraints` | "Budget and timeline constraints" |
| `decisions` | "Who decided what, status" |
| `stakeholders` | "People with final decision authority" |
| `assumptions` | "Unvalidated assumptions with risk" |
| `scope_items` | "What's in/out of MVP" |
| `contradictions` | "Unresolved conflicts" |

### Why Both

- **RAGFlow:** "Find me stuff about authentication" (semantic similarity)
- **PostgreSQL:** "Show me all MUST requirements that are unconfirmed" (structured SQL)

### Entity Graph (RAGFlow GraphRAG)

RAGFlow extracts entities + relationships from the documents dataset automatically.
Provides PageRank scoring, Leiden community detection, entity resolution.
Used for: "Who decided on SSO?" "What's related to the auth module?"

> v2: Direct Neo4j if precise traversal or manual entity correction needed.

### 8.1 Git Push Hook Sync (v1.5 — .memory-bank/ → RAGFlow)

Phase 2-4 developers use crnogochi-assistants (Claude Code) which writes
`.memory-bank/` markdown files — git-committed to the project repo.

**How sync works:**
```
Developer pushes to main → GitHub/GitLab webhook fires
  → Backend receives webhook
  → Checks if .memory-bank/ files changed
  → Queues sync job (Redis)
  → Worker: git pull → diff changed files → upload to RAGFlow memory-bank dataset
  → PO's web UI immediately reflects latest dev output
```

**Files synced:** docs/tech-docs, docs/completed-tasks, docs/decisions,
docs/research-sessions, docs/system-architecture, docs/best-practices,
docs/errors, docs/qa-analysis-reports, docs/reports, docs/defects,
project-brief.md, tech-context.md, system-patterns.md.

**Files NOT synced:** active-tasks/ (transient), learnings.jsonl (per-developer), .logs/.

**Bidirectional:** Discovery AI also commits handoff docs to the repo:
```
PO generates handoff → Discovery AI commits to .memory-bank/docs/discovery/
  → git push → developer pulls → sees handoff docs in Claude Code
```

**Merge conflict mitigation:** Discovery AI writes ONLY to `docs/discovery/`
and seed files (project-brief, tech-context, system-patterns). Developers write
to everything else. Minimal overlap.

**Requirements per project:**
- `repo_url` — git repository URL
- `git_access_token` — read/write access (encrypted in PostgreSQL)
- Webhook configured in GitHub/GitLab pointing to our endpoint

> Full design: `research/35-unified-dual-mode-architecture.md`

---

## 9. Control Points & Readiness

### How It Works

1. PO creates project → selects type (Greenfield, Add-on, Feature Extension, API, Mobile, Custom)
2. System loads control point template (17-26 items)
3. Pipeline evaluates control points via SQL after each upload
4. /gaps subagent does full evaluation on demand

### Readiness from SQL (Not LLM)

```sql
-- 70% of control points are existence checks:
SELECT
  (SELECT COUNT(*) FROM requirements WHERE project_id=$1 AND status='confirmed' AND priority='must') AS must_confirmed,
  (SELECT COUNT(*) FROM stakeholders WHERE project_id=$1 AND decision_authority='final') AS has_authority,
  (SELECT COUNT(*) FROM scope_items WHERE project_id=$1 AND in_scope=false) AS has_exclusions,
  (SELECT COUNT(*) FROM assumptions WHERE project_id=$1 AND validated=false) AS unvalidated;

-- 30% need LLM quality assessment (only when /gaps invoked):
-- "Are requirements specific enough for story breakdown?"
-- "Is technical context complete enough for architecture?"
```

### Readiness Score

```
Per area: covered_items / applicable_items
  Business Understanding: 20% weight
  Functional Requirements: 35% weight
  Technical Context: 20% weight
  Scope Freeze: 25% weight

Thresholds: 85%+ Ready | 65-84% Conditional | <65% Not Ready
```

> Control point templates: `research/03-discovery-agents-design.md`
> Readiness system: `research/07-readiness-and-feedback.md`

---

## 10. Database Schema

```sql
-- Users & Auth
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    auth_provider VARCHAR NOT NULL,
    auth_provider_id VARCHAR NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR NOT NULL,
    client_name VARCHAR NOT NULL,
    project_type VARCHAR NOT NULL,
    status VARCHAR DEFAULT 'active',
    repo_url VARCHAR,                  -- git repo URL (for push hook sync + handoff commits)
    git_access_token VARCHAR,          -- encrypted, read/write access
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE project_members (
    project_id UUID REFERENCES projects(id),
    user_id UUID REFERENCES users(id),
    role VARCHAR NOT NULL,  -- lead, member, viewer
    PRIMARY KEY (project_id, user_id)
);

-- Documents
CREATE TABLE documents (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    filename VARCHAR NOT NULL,
    file_type VARCHAR NOT NULL,
    ragflow_doc_id VARCHAR,
    chunking_template VARCHAR,
    classification JSONB,
    pipeline_stage VARCHAR DEFAULT 'queued',
    pipeline_error TEXT,
    items_extracted INT DEFAULT 0,
    contradictions_found INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- The 6 Typed Tables (core business data)
CREATE TABLE requirements (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    req_id VARCHAR NOT NULL,             -- FR-001, NFR-001
    title VARCHAR NOT NULL,
    type VARCHAR NOT NULL,               -- functional, non_functional
    priority VARCHAR NOT NULL,           -- must, should, could, wont
    description TEXT NOT NULL,
    user_perspective TEXT,
    business_rules JSONB DEFAULT '[]',
    edge_cases JSONB DEFAULT '[]',
    source_doc_id UUID REFERENCES documents(id),
    source_quote TEXT NOT NULL,
    status VARCHAR DEFAULT 'proposed',
    confidence VARCHAR DEFAULT 'medium',
    ragflow_chunk_id VARCHAR,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE constraints (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    type VARCHAR NOT NULL,               -- budget, timeline, technology, regulatory, organizational
    description TEXT NOT NULL,
    impact TEXT NOT NULL,
    source_doc_id UUID REFERENCES documents(id),
    source_quote TEXT NOT NULL,
    status VARCHAR DEFAULT 'assumed',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE decisions (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    title VARCHAR NOT NULL,
    decided_by VARCHAR,
    decided_date DATE,
    rationale TEXT NOT NULL,
    alternatives JSONB DEFAULT '[]',
    impacts JSONB DEFAULT '[]',
    source_doc_id UUID REFERENCES documents(id),
    status VARCHAR DEFAULT 'tentative',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE stakeholders (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    name VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    organization VARCHAR NOT NULL,
    decision_authority VARCHAR DEFAULT 'informed',
    interests JSONB DEFAULT '[]',
    source_doc_id UUID REFERENCES documents(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE assumptions (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    statement TEXT NOT NULL,
    basis TEXT NOT NULL,
    risk_if_wrong TEXT NOT NULL,
    needs_validation_by VARCHAR,
    validated BOOLEAN DEFAULT FALSE,
    source_doc_id UUID REFERENCES documents(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE scope_items (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    description TEXT NOT NULL,
    in_scope BOOLEAN NOT NULL,
    rationale TEXT NOT NULL,
    source_doc_id UUID REFERENCES documents(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Cross-type contradictions
CREATE TABLE contradictions (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    item_a_type VARCHAR NOT NULL,
    item_a_id UUID NOT NULL,
    item_b_type VARCHAR NOT NULL,
    item_b_id UUID NOT NULL,
    explanation TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolution_note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Change history (audit trail)
CREATE TABLE change_history (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    item_type VARCHAR NOT NULL,
    item_id UUID NOT NULL,
    action VARCHAR NOT NULL,
    old_value JSONB,
    new_value JSONB,
    triggered_by VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Control point templates
CREATE TABLE control_point_templates (
    id UUID PRIMARY KEY,
    project_type VARCHAR NOT NULL,
    category VARCHAR NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR NOT NULL,
    weight FLOAT DEFAULT 1.0
);

-- Readiness history
CREATE TABLE readiness_history (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    score FLOAT NOT NULL,
    breakdown JSONB,
    triggered_by VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Conversations, activity, LLM tracking, pipeline checkpoints
CREATE TABLE conversations (
    id UUID PRIMARY KEY, project_id UUID, user_id UUID,
    messages JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE TABLE activity_log (
    id UUID PRIMARY KEY, project_id UUID, user_id UUID,
    action VARCHAR NOT NULL, summary TEXT NOT NULL, details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE llm_calls (
    id UUID PRIMARY KEY, project_id UUID, trace_id UUID,
    model VARCHAR NOT NULL, purpose VARCHAR NOT NULL,
    input_tokens INT, output_tokens INT, cost_usd DECIMAL(10,6),
    duration_ms INT, retries INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE pipeline_checkpoints (
    id UUID PRIMARY KEY, document_id UUID,
    stage VARCHAR NOT NULL, data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Learnings (per-project)
CREATE TABLE learnings (
    id UUID PRIMARY KEY, project_id UUID,
    skill VARCHAR NOT NULL, type VARCHAR NOT NULL, key VARCHAR NOT NULL,
    insight TEXT NOT NULL, confidence INT NOT NULL, source VARCHAR NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, key, type)
);

-- Pipeline sync (v1.5 — Phase 2-4 .memory-bank/ files)
CREATE TABLE pipeline_syncs (
    id UUID PRIMARY KEY, project_id UUID, repo_url VARCHAR,
    last_sync_at TIMESTAMP, files_synced INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 11. Auth & File Formats

### Authentication
- OAuth2 via company identity provider (Google Workspace / Azure AD / Okta)
- JWT tokens with `user_id`
- 3 roles per project: **Lead** (full access), **Member** (view + upload + chat), **Viewer** (read-only)
- Project-scoped: user sees only assigned projects

### Supported File Formats (v1)

| Format | Extensions | RAGFlow Template |
|--------|-----------|-----------------|
| PDF | `.pdf` | Auto-classified (haiku) |
| Word | `.docx`, `.doc` | Auto-classified (haiku) |
| Excel | `.xlsx`, `.xls`, `.csv` | `table` |
| PowerPoint | `.pptx`, `.ppt` | `presentation` |
| Email | `.eml` | `email` |
| Plain text | `.txt`, `.md` | `naive` |
| Images | `.png`, `.jpg` | `picture` |

File size limit: 50MB. Unsupported formats (.msg, Google Docs) have documented workarounds.

---

## 12. Project Structure (Monorepo)

Agent definitions live in `assistants/`, shared between web backend and local Claude Code.
One set of prompts, two runtimes, always in sync.

> Full monorepo design: `research/36-monorepo-agent-structure.md`

```
discovery-ai-assistant/                        # MONOREPO
│
├── assistants/                                # SHARED AGENT CORE
│   ├── CLAUDE.md                          # Domain detection (coding, stories, QA, discovery)
│   ├── install.sh / install.ps1           # Install into any project repo
│   ├── .claude/
│   │   ├── assistants/                        # 12 agent definitions (.md)
│   │   │   ├── setup-agent.md, research-agent.md       # [shared]
│   │   │   ├── story-*-agent.md (3)                    # [stories]
│   │   │   ├── qa-*-agent.md (4)                       # [qa]
│   │   │   └── discovery-*-agent.md (3)                # [discovery]
│   │   ├── skills/                        # Domain orchestration
│   │   │   ├── coding/SKILL.md
│   │   │   ├── tech-stories/SKILL.md
│   │   │   ├── qa/SKILL.md
│   │   │   └── discovery/SKILL.md
│   │   ├── templates/ (28+ files)
│   │   └── settings.json                  # MCP configs
│   ├── .memory-bank/ (template)           # Initialized per project
│   └── tests/                             # Prompt quality tests (golden tests)
│
├── discovery-web/                         # WEB APPLICATION
│   ├── backend/
│   │   ├── app/
│   │   │   ├── main.py                    # FastAPI
│   │   │   ├── api/                       # REST + webhooks
│   │   │   ├── pipeline/                  # Deterministic (Instructor)
│   │   │   ├── agent/                     # Pydantic AI (reads prompts from assistants/)
│   │   │   │   ├── coordinator.py
│   │   │   │   ├── subagents.py           # Loads .md from ../../assistants/.claude/
│   │   │   │   ├── tools/
│   │   │   │   └── capabilities/
│   │   │   ├── services/                  # RAGFlow, PostgreSQL, sync, handoff
│   │   │   ├── models/
│   │   │   └── db/
│   │   ├── tests/
│   │   ├── pyproject.toml
│   │   └── Dockerfile                     # COPY assistants/.claude into image
│   ├── frontend/                          # Next.js
│   └── docker-compose.yml
│
├── mcp-server/                            # MCP SERVER (Claude Code → web backend)
│   ├── server.py                          # ~100 lines
│   └── package.json
│
├── docs/
│   ├── research/                          # 36 research documents
│   └── work-logs/
│
└── ARCHITECTURE.md                        # This file
```

### How Prompts Are Shared

| Runtime | How It Reads Prompts |
|---------|---------------------|
| **Web backend** | Reads directly from `../../assistants/.claude/` (same repo) |
| **Local Claude Code** | `install.sh` copies `assistants/.claude/` into project repo |
| **Docker** | `COPY assistants/.claude /app/assistants/.claude` in Dockerfile |
| **Tests** | Both `assistants/tests/` and `discovery-web/backend/tests/` read same source |

Update workflow: change a prompt in `assistants/` → CI golden tests → merge →
Docker rebuild (web) + `install.sh` (local). Both environments always in sync.

---

## 13. MVP Scope

### Ships in v1

- Automated pipeline (classify → parse → extract typed → dedup → store → evaluate SQL)
- Chat powered by Pydantic AI coordinator with tools (natural routing)
- 3 subagents (gap-analyzer, doc-generator, meeting-prep)
- Web research tools (DuckDuckGo, Tavily, WebFetch)
- Dashboard (readiness gauge, requirements table, gaps, contradictions, activity)
- Control point templates (6 project types)
- Auth (OAuth2 + 3 roles)
- Per-project learnings
- LLM cost tracking (Pydantic AI capabilities)
- Structured logging
- Handoff package generator (3 docs + .memory-bank/ seed files as ZIP download)

### Ships in v1.5 (after core discovery works)

- Git push hook sync (.memory-bank/ → RAGFlow memory-bank dataset)
- 3rd RAGFlow dataset per project (memory-bank) for cross-phase search
- `search_pipeline` tool (PO asks "is auth implemented and tested?")
- Discovery AI commits handoff docs directly to repo (no more ZIP)
- Webhook endpoint for GitHub/GitLab
- Read-only MCP server for Claude Code (~50 lines — devs query discovery data)

### Deferred to v2+

| Feature | Why Defer |
|---------|-----------|
| Autonomous research loops | POs need trust in basics |
| Browser automation (Playwright) | Complex infrastructure |
| Meeting transcription | Requires ASR setup |
| Neo4j direct graph | RAGFlow GraphRAG sufficient |
| WebSocket real-time | Polling is fine for 2-3 POs |
| Cross-project learning | Need 20+ projects |
| /simulate (multi-perspective) | Trust in basics first |
| Advanced HTML reports + PDF export | Basic HTML sufficient |
| Bidirectional: dev findings push back to discovery | Need v1.5 working first |

---

## 14. Design Patterns

| Pattern | Source | Where Applied |
|---------|--------|--------------|
| Typed business extraction | First principles | 6 Pydantic models match Phase 2 needs |
| Anti-rationalization tables | Superpowers | Every subagent SKILL.md prompt |
| Iron Laws | Superpowers | One non-negotiable rule per subagent |
| Fix-First (AUTO-RESOLVE / ASK) | gstack | Gap-analyzer classifies gaps |
| AskUserQuestion format | gstack | CONTEXT → QUESTION → RECOMMENDATION → Options |
| Scope Modes (EXPANSION/HOLD/REDUCTION) | gstack | Meeting-prep adapts to phase |
| Coordinator + Subagent | Superpowers | Main agent dispatches 3 child agents |
| Type-safe tools with RunContext | Pydantic AI | Dependency injection like FastAPI |
| Capabilities for observability | Pydantic AI | Logging + guardrails hooks |
| Readiness from SQL | First principles | Existence checks are free, LLM only for quality |

> Superpowers patterns: `research/14-superpowers-research.md`
> gstack patterns: `research/15-gstack-research.md`
> Simplification rationale: `research/33-final-clarity.md`

---

## 15. Build Plan (8 Weeks)

| Weeks | Focus | Deliverable |
|-------|-------|-------------|
| 1-2 | Foundation | FastAPI + PostgreSQL typed tables + RAGFlow setup + Redis queue |
| 3-4 | Pipeline | Classify → parse → extract (Instructor, typed) → dedup → store → evaluate (SQL) |
| 5-6 | Agent | Pydantic AI coordinator + 3 subagents + tools + chat API + web research |
| 7-8 | Frontend | Next.js dashboard + chat + document upload + auth + polish |

---

## 16. Open Questions

1. Does RAGFlow API support per-document template override within a single dataset?
2. Does TEI embedding (BGE-M3) require GPU or runs on CPU?
3. Which auth provider does Bild use?
4. What languages do clients communicate in?
5. Where will production be hosted?
6. Have output templates been validated with the Story/Tech Doc Assistant?
7. If Pydantic AI multi-agent patterns prove insufficient, fall back to Claude Agent SDK or LangGraph.
8. Which git hosting does Bild use? (GitHub/GitLab/Bitbucket — affects webhook format for v1.5)
9. Git access token management: per-project tokens or a service account with org-wide access?

---

## 17. Research Index

| Doc | Title | Key Decision |
|-----|-------|-------------|
| 00 | What is Discovery Assistant | Product definition |
| 03 | Discovery Agents Design | Control point templates (6 types) |
| 04 | Output Templates | 3 handoff documents + supporting docs |
| 06 | Downstream Integration | Phase 2 handoff requirements |
| 07 | Readiness & Feedback | Scoring system, thresholds |
| 14 | Superpowers Research | Anti-rationalization, Iron Laws, verification |
| 15 | gstack Research | Fix-First, preamble, scope modes, learning |
| 18 | RAGFlow Deep Dive | DeepDoc, 14 templates, hybrid search |
| 19 | Structured Extraction | Instructor, citation validation |
| 22 | Architecture Review | Pressure test, Mem0 dropped |
| 23 | Final Decisions | Drop Mem0, unified chat, two RAGFlow datasets |
| 27 | Pipeline Integration | Phase 2 handoff, .memory-bank/ seeding |
| 28 | Project Knowledge Hub | 3rd dataset for cross-phase visibility |
| 29 | Agent Engine Survey | 17 frameworks compared |
| 31 | Production Reality Check | What real projects use |
| 32 | Simplification & Requirements | Typed extraction > generic facts, 3 subagents > 6 |
| 33 | Final Clarity | The three things that matter |
| 34 | crnogochi Integration | How Discovery AI connects to the Unified Assistant |
| 35 | Unified Dual-Mode | Push hook sync, MCP for Claude Code, bidirectional flow |
| 36 | Monorepo Agent Structure | Shared assistants/ dir, install.sh, both runtimes read same prompts |
| 32 | Simplification | Typed extraction > generic facts, 3 subagents > 6 |
| 33 | Final Clarity | The three things that matter |
