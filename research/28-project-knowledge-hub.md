# 28 — Discovery AI as Project Knowledge Hub

> **Date:** 2026-04-02
> **Purpose:** Extend Discovery AI to ingest ALL project phase outputs, becoming the
> central intelligence for the full project lifecycle
> **Builds on:** research/27 (pipeline integration), ARCHITECTURE.md

---

## 1. The Idea

Every phase in Bild's pipeline produces markdown files that are git-committed:

```
Phase 1 (Discovery AI):
  → Discovery Brief, MVP Scope, Functional Requirements
  → Facts, control points, research findings

Phase 2 (Unified Assistant — tech-stories domain):
  → .memory-bank/docs/tech-docs/*.md          (16-section tech documentation)
  → .memory-bank/docs/completed-tasks/*.md     (story creation tasks)
  → .memory-bank/docs/decisions/*.md           (technical decisions)
  → .memory-bank/docs/research-sessions/*.md   (tech research)
  → .memory-bank/docs/system-architecture/*.md (architecture patterns)
  → .memory-bank/project-brief.md              (project summary — evolves)
  → .memory-bank/system-patterns.md            (architecture overview)
  → .memory-bank/tech-context.md               (technology constraints)

Phase 3 (Unified Assistant — coding domain):
  → .memory-bank/docs/completed-tasks/*.md     (implementation tasks)
  → .memory-bank/docs/decisions/*.md           (code architecture decisions)
  → .memory-bank/docs/errors/*.md              (error documentation)
  → .memory-bank/docs/best-practices/*.md      (coding guidelines)
  → .memory-bank/docs/system-architecture/*.md (new patterns discovered)
  → .memory-bank/learnings.jsonl               (developer observations)

Phase 4 (Unified Assistant — QA domain):
  → .memory-bank/docs/qa-analysis-reports/*.md  (test analysis)
  → .memory-bank/docs/test-cases/*.csv          (test case definitions)
  → .memory-bank/docs/reports/*.md              (execution reports)
  → .memory-bank/docs/defects/*.md              (defect records)
  → .memory-bank/docs/test-strategy/*.md        (test strategies)
  → .memory-bank/testing-standards.md           (QA configuration)
```

**All of these are markdown/CSV/JSON files in git.**

If Discovery AI ingests ALL of them into RAGFlow, the PO has a single place
to ask any question about the entire project.

---

## 2. How It Works

### The Sync Mechanism: Git → RAGFlow

```
Project Git Repository
├── .memory-bank/                    ← Unified Assistant writes here
│   ├── project-brief.md
│   ├── system-patterns.md
│   ├── tech-context.md
│   ├── testing-standards.md
│   ├── learnings.jsonl
│   ├── active-tasks/
│   └── docs/
│       ├── tech-docs/               ← Phase 2 output
│       ├── completed-tasks/         ← Phase 2+3+4 output
│       ├── decisions/               ← All phases
│       ├── research-sessions/       ← All phases
│       ├── system-architecture/     ← Phase 2+3
│       ├── best-practices/          ← Phase 3
│       ├── errors/                  ← Phase 3
│       ├── qa-analysis-reports/     ← Phase 4
│       ├── test-cases/              ← Phase 4
│       ├── reports/                 ← Phase 4
│       ├── defects/                 ← Phase 4
│       └── test-strategy/           ← Phase 4
│
└── docs/discovery/                  ← Discovery AI writes here (Option B from research/27)
    ├── discovery-brief.md
    ├── mvp-scope-freeze.md
    └── functional-requirements.md
```

### RAGFlow Dataset Structure (Revised)

Instead of 2 datasets per project, we now have **3**:

| Dataset | Contains | Chunking | Purpose |
|---------|----------|----------|---------|
| `project-{id}-client-docs` | Client documents (meeting notes, emails, specs, contracts) | Template-matched (book, email, manual, etc.) | "What did the client say about X?" |
| `project-{id}-facts` | Extracted structured facts | naive (one fact per chunk) | "Is hosting confirmed?" Control point evaluation. |
| `project-{id}-pipeline` | ALL .memory-bank/ md files from the git repo | naive or manual (section-based) | "What did the dev team implement for auth?" "Are tests passing?" |

**The third dataset is the game-changer.** It gives Discovery AI visibility into
everything that happens after discovery is complete.

### Ingestion Flow

```
Option A (MVP — manual):
  PO clicks "Sync project files" in Discovery AI
  → Discovery AI pulls latest from git repo
  → Reads all .memory-bank/**/*.md files
  → Uploads to RAGFlow project-{id}-pipeline dataset
  → Facts extracted from tech docs, decisions, defects
  → PO can now query across all phases

Option B (v2 — automatic):
  Git webhook fires on push to main
  → Discovery AI backend receives webhook
  → Diffs changed .memory-bank/ files since last sync
  → Uploads only changed/new files to RAGFlow
  → Re-runs extraction on new content
  → Dashboard updates with cross-phase status
```

---

## 3. What The PO Can Do (New Capabilities)

### 3.1 Cross-Phase Queries

```
PO: "Is the payment feature fully implemented and tested?"

Agent searches across all 3 datasets:
  → client-docs: "Client requested payment via Stripe" (Meeting 3)
  → facts: "Payment integration: Stripe" (status: confirmed, confidence: high)
  → pipeline:
    - tech-docs/payment-module.md: "Stripe SDK integration, webhook handling"
    - completed-tasks/implement-payment.md: "DONE, 3 files changed"
    - test-cases/payment-tests.csv: "12 test cases, 11 passed, 1 pending"
    - defects/DEF-003.md: "Payment webhook retry fails after 3 attempts"

Response: "Payment is mostly complete:
  ✅ Stripe integration implemented (3 files)
  ✅ 11/12 tests passing
  ⚠️ 1 open defect: webhook retry fails after 3 attempts (DEF-003)
  📋 Original requirement: Stripe payment via webhooks (Meeting 3, confirmed)"
```

### 3.2 Impact Analysis (When Client Changes Something)

```
PO: "The client wants to change from Stripe to PayPal. What's affected?"

Agent searches:
  → facts: All facts mentioning "Stripe" or "payment"
  → pipeline/tech-docs: Sections about payment architecture
  → pipeline/completed-tasks: Implementation tasks for payment
  → pipeline/test-cases: Tests related to payment
  → pipeline/decisions: Why Stripe was chosen

Response: "Changing from Stripe to PayPal affects:
  📄 Tech doc: payment-module.md (Stripe SDK references)
  🔧 Code: 3 implementation tasks completed for Stripe
  🧪 Tests: 12 test cases written for Stripe API
  📋 Decision: Stripe was chosen in Meeting 2 because 'client already has Stripe account'
  ⚠️ Estimated rework: tech doc revision + code changes + test rewrite

  RECOMMENDATION: Before changing, confirm with client:
  - Do they already have a PayPal business account?
  - Are webhook patterns similar enough to reuse test structure?
  [Flag this as a scope change in MVP Scope Freeze]"
```

### 3.3 Project Health Dashboard

```
PO: "What's the overall project status?"

Agent aggregates from all datasets:
  → Discovery: 92% readiness, 2 assumptions unvalidated
  → Tech docs: 5/5 features documented
  → Stories: 23 stories created, 18 in sprint, 5 in backlog
  → Code: 15 tasks completed, 3 in progress, 2 blocked
  → QA: 47 test cases, 38 passing, 4 failing, 5 not run
  → Defects: 2 open (1 critical, 1 minor)

Response shows project health across all phases.
```

### 3.4 Discovery Reopening (When Phase 2-4 Finds Gaps)

```
PO: "The dev team says the API rate limits aren't documented. Can you check?"

Agent searches:
  → facts: No fact about "API rate limits"
  → client-docs: Meeting 4 mentions "be careful with API limits" but no specifics
  → pipeline/errors: "RateLimitError encountered during integration testing"

Response: "API rate limits are NOT covered in discovery:
  ⚠️ Vague mention in Meeting 4: 'be careful with API limits'
  ❌ No specific rate limit values in any document
  🔴 Dev team hit RateLimitError during testing

  This is a discovery gap. Actions:
  A) I'll research common rate limits for [client's API] online
  B) Generate a specific question for the client
  C) Both — research first, then ask client to confirm

  RECOMMENDATION: Choose C"
```

---

## 4. Memory Bank for Discovery AI

### Discovery AI Gets Its Own .memory-bank

Just like the Unified Assistant, Discovery AI maintains its own memory bank.
But it's server-side (PostgreSQL + RAGFlow), not local files:

| Unified Assistant (local) | Discovery AI (server) | Same Concept? |
|--------------------------|----------------------|---------------|
| `.memory-bank/project-brief.md` | `projects` table + preamble builder | ✅ |
| `.memory-bank/system-patterns.md` | RAGFlow pipeline dataset (architecture docs) | ✅ |
| `.memory-bank/tech-context.md` | RAGFlow pipeline dataset (tech docs) | ✅ |
| `.memory-bank/learnings.jsonl` | `learnings` table (PostgreSQL) | ✅ |
| `.memory-bank/docs/decisions/` | `facts` table (category: decision) | ✅ |
| `.memory-bank/docs/errors/` | RAGFlow pipeline dataset (error docs) | ✅ |
| `.memory-bank/docs/completed-tasks/` | RAGFlow pipeline dataset (task docs) | ✅ |
| `.memory-bank/active-tasks/` | Pipeline status + activity log | ✅ |

**The data model is the same. The storage medium differs.**
- Unified Assistant: markdown files (developer-friendly, git-committed, local)
- Discovery AI: database + RAGFlow (multi-user, searchable, web-accessible)

### What Discovery AI Stores Natively

| Data | Storage | Source |
|------|---------|--------|
| Client documents (raw) | RAGFlow `client-docs` dataset | PO uploads |
| Extracted facts | RAGFlow `facts` dataset + PostgreSQL | Pipeline extraction |
| Entity graph | RAGFlow GraphRAG | Pipeline extraction |
| Control points | PostgreSQL | Templates + pipeline evaluation |
| Pipeline outputs (Phase 2-4) | RAGFlow `pipeline` dataset | Git sync |
| Research findings | PostgreSQL `learnings` + RAGFlow | Agent web research |
| Decisions | PostgreSQL `facts` (category: decision) | All phases |
| Project metadata | PostgreSQL `projects` | PO setup |
| Activity history | PostgreSQL `activity_log` | All actions |
| LLM call history | PostgreSQL `llm_calls` | All agent calls |
| Conversations | PostgreSQL `conversations` | Per-user chat |

---

## 5. The Revised Knowledge Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISCOVERY AI ASSISTANT                         │
│                    (Project Knowledge Hub)                        │
│                                                                  │
│  RAGFlow Datasets (per project):                                 │
│  ┌───────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ client-docs       │  │ facts        │  │ pipeline         │  │
│  │                   │  │              │  │                  │  │
│  │ Meeting notes     │  │ Extracted    │  │ Tech docs        │  │
│  │ Emails            │  │ structured   │  │ User stories     │  │
│  │ Client specs      │  │ facts with   │  │ Code decisions   │  │
│  │ Contracts         │  │ lifecycle    │  │ Test reports     │  │
│  │ Presentations     │  │ status       │  │ Defect records   │  │
│  │                   │  │              │  │ Architecture     │  │
│  │ "What did client  │  │ "Is X        │  │ Best practices   │  │
│  │  say about X?"    │  │  confirmed?" │  │                  │  │
│  └───────────────────┘  └──────────────┘  │ "What did devs   │  │
│                                           │  build for X?"   │  │
│  + GraphRAG (entities + relationships     │ "Are tests       │  │
│    across ALL datasets)                   │  passing?"       │  │
│                                           └──────────────────┘  │
│  PostgreSQL:                                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ projects, users, facts (lifecycle), control_points,      │    │
│  │ documents, readiness_history, conversations, learnings,  │    │
│  │ activity_log, llm_calls, pipeline_sync_status            │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ PO uploads                   │ Git sync (manual or webhook)
         │ client documents             │ .memory-bank/ files
         │                              │
    ┌────┴─────┐              ┌─────────┴──────────┐
    │  Client  │              │  Project Git Repo   │
    │  (email, │              │                     │
    │  meeting,│              │  .memory-bank/      │
    │  docs)   │              │  ├── docs/          │
    └──────────┘              │  │   ├── tech-docs/ │
                              │  │   ├── decisions/ │
                              │  │   ├── defects/   │
                              │  │   ├── reports/   │
                              │  │   └── ...        │
                              │  ├── project-brief  │
                              │  └── tech-context   │
                              └────────────────────┘
                                     ▲
                                     │ Developers write
                                     │ (Unified Assistant / Claude Code)
```

---

## 6. New Features This Enables

### 6.1 Project-Wide Search (MVP enhancement)

PO types anything → agent searches ALL 3 datasets:

```python
@tool
def search_all(query: str, project_id: str) -> str:
    """Search across all project knowledge: client documents, facts, AND
    pipeline outputs (tech docs, stories, QA reports, code decisions).
    Use this for cross-phase questions."""

    results = []

    # Search client documents
    client_results = ragflow.search(f"project-{project_id}-client-docs", query)
    results.extend(tag_results(client_results, "client"))

    # Search extracted facts
    fact_results = ragflow.search(f"project-{project_id}-facts", query)
    results.extend(tag_results(fact_results, "fact"))

    # Search pipeline outputs (Phase 2-4)
    pipeline_results = ragflow.search(f"project-{project_id}-pipeline", query)
    results.extend(tag_results(pipeline_results, "pipeline"))

    # Merge, deduplicate, rank
    return format_cross_phase_results(results)
```

### 6.2 Requirement Traceability

Track a requirement from discovery → tech doc → story → code → test:

```
PO: "Trace the SSO authentication requirement"

Discovery: "Auth method: Microsoft SSO" (fact, confirmed, Meeting 3)
  → Tech doc: "Authentication: MSAL library, redirect flow" (tech-docs/auth-module.md)
    → Stories: "NOP-42: Implement SSO login flow" (completed-tasks/nop-42.md)
      → Code: "3 files changed, MSAL configured" (completed-tasks/nop-42.md details)
        → Tests: "SSO login flow: 5 test cases, all passing" (test-cases/sso-tests.csv)
          → No defects related to SSO ✅

Status: FULLY TRACED — requirement → implementation → tests → verified
```

### 6.3 Pipeline Sync Tool

```python
@tool
def sync_pipeline_files(project_id: str, repo_url: str) -> str:
    """Sync .memory-bank/ files from the project git repo into RAGFlow.
    Ingests tech docs, stories, decisions, test reports, defects — everything
    produced by the Unified Assistant (Phases 2-4)."""

    # Clone or pull latest
    repo_path = git_clone_or_pull(repo_url, project_id)

    # Find all .memory-bank/ markdown files
    memory_bank = Path(repo_path) / ".memory-bank"
    md_files = list(memory_bank.rglob("*.md"))
    csv_files = list(memory_bank.rglob("*.csv"))
    json_files = list(memory_bank.rglob("*.json"))

    # Filter: skip active-tasks (transient), skip learnings.jsonl (per-developer)
    files_to_ingest = [
        f for f in md_files + csv_files
        if "active-tasks" not in str(f)
        and "learnings.jsonl" not in str(f)
        and ".logs" not in str(f)
    ]

    # Upload to RAGFlow pipeline dataset
    dataset_id = f"project-{project_id}-pipeline"
    for file in files_to_ingest:
        # Determine chunking template
        template = "naive"  # default for most md files
        if file.suffix == ".csv":
            template = "table"

        await ragflow.upload(dataset_id, file, template=template)

    return f"Synced {len(files_to_ingest)} files from .memory-bank/"
```

### 6.4 Project Health Aggregation

```python
@tool
def get_project_health(project_id: str) -> str:
    """Aggregate project health across all phases.
    Combines discovery readiness, implementation progress, and QA status."""

    health = {}

    # Discovery phase
    readiness = await db.get_latest_readiness(project_id)
    health["discovery"] = {
        "readiness": readiness.score,
        "open_contradictions": await db.count_unresolved_contradictions(project_id),
        "unvalidated_assumptions": await db.count_assumptions(project_id),
    }

    # Implementation phase (from pipeline dataset)
    tasks = await ragflow.search(f"project-{project_id}-pipeline",
                                  "completed-tasks status", top_n=50)
    health["implementation"] = parse_task_statuses(tasks)

    # QA phase (from pipeline dataset)
    reports = await ragflow.search(f"project-{project_id}-pipeline",
                                    "test execution report results", top_n=10)
    defects = await ragflow.search(f"project-{project_id}-pipeline",
                                    "defect open critical", top_n=20)
    health["qa"] = parse_qa_status(reports, defects)

    return format_project_health(health)
```

---

## 7. What Changes in Architecture

### New: Third RAGFlow Dataset

```
Datasets per project:
  project-{id}-client-docs     ← PO uploads (existing)
  project-{id}-facts           ← Pipeline extraction (existing)
  project-{id}-pipeline        ← Git sync from .memory-bank/ (NEW)
```

### New: Pipeline Sync Service

```python
# services/pipeline_sync.py

class PipelineSyncService:
    """Syncs .memory-bank/ files from project git repos into RAGFlow."""

    async def sync(self, project_id: str) -> SyncResult:
        """Manual sync triggered by PO."""
        project = await db.get_project(project_id)
        if not project.repo_url:
            return SyncResult(error="No git repo configured for this project")

        repo_path = await self.git.clone_or_pull(project.repo_url)
        files = self.discover_memory_bank_files(repo_path)
        uploaded = await self.ragflow.upload_batch(
            f"project-{project_id}-pipeline", files
        )
        await db.update_sync_status(project_id, len(uploaded))
        return SyncResult(files_synced=len(uploaded))
```

### New: search_all Tool

Agent can now search across all 3 datasets in one call.

### New: sync_pipeline_files Tool

Agent can trigger git sync when PO asks about implementation/QA status.

### New: get_project_health Tool

Agent can aggregate cross-phase status.

### New DB Table

```sql
CREATE TABLE pipeline_syncs (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    repo_url VARCHAR,
    last_sync_at TIMESTAMP,
    files_synced INTEGER,
    sync_status VARCHAR DEFAULT 'never',  -- never, synced, failed
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 8. Implementation Priority

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| Third RAGFlow dataset (pipeline) | v1.5 | 1 day | Enables all cross-phase features |
| Manual sync (PO clicks button) | v1.5 | 2-3 days | PO can sync when needed |
| search_all tool | v1.5 | 1 day | Cross-phase queries |
| Project health aggregation | v2 | 1 week | Dashboard-level visibility |
| Requirement traceability | v2 | 1 week | End-to-end tracking |
| Git webhook auto-sync | v2 | 2-3 days | Automatic, no manual step |
| Bidirectional feedback (push back to repo) | v3 | 1 week | Discovery AI writes to .memory-bank/ |

**For MVP:** Focus on discovery. The 3rd dataset is a v1.5 feature — easy to add
once the core works, but not needed for the first PO to get value.

**The v1.5 path:** After MVP ships and a project goes through Phase 2, add the pipeline
dataset + manual sync. PO immediately gets cross-phase visibility.

---

## 9. The Big Picture

```
        CLIENT                    DISCOVERY AI                 PROJECT REPO
        ─────                     ────────────                 ────────────
     Meetings                   ┌──────────────┐
     Emails      ──uploads──►   │              │
     Documents                  │  3 RAGFlow   │          .memory-bank/
                                │  datasets:   │          ├── tech-docs/
                                │              │          ├── decisions/
                                │  client-docs │          ├── test-reports/
                                │  facts       │◄──sync───├── defects/
                                │  pipeline    │          └── ...
                                │              │               ▲
                                │  PostgreSQL  │               │
                                │  (facts,     │          Devs write via
                                │   control    │          Unified Assistant
                                │   points,    │          (Claude Code)
                                │   health)    │
                                │              │
                                └──────┬───────┘
                                       │
                                   PO chats
                                   with agent
                                       │
                              "What's the full
                               project status?"
                              "Is auth implemented
                               and tested?"
                              "Client changed X,
                               what's affected?"
```

**Discovery AI becomes the PO's single pane of glass for the entire project.**

Not just discovery. Not just Phase 1. The FULL lifecycle — from first client meeting
to final test report — all searchable, all connected, all in one place.
