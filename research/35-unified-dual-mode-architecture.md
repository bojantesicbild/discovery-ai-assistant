# 35 — Unified Dual-Mode Architecture

> **Date:** 2026-04-03
> **Purpose:** Design a system that runs the SAME assistant in two modes:
> web UI (for POs) and Claude Code (for developers), both sharing the same backend
> **This changes the fundamental architecture.**

---

## 1. The Vision

Instead of two separate systems (Discovery AI web app + crnogochi-assistants),
we build ONE system with TWO interfaces:

```
┌─────────────────────┐     ┌──────────────────────┐
│  WEB UI (Next.js)   │     │  CLAUDE CODE (local)  │
│  PO uses browser    │     │  Dev uses terminal    │
│                     │     │                       │
│  Discovery phase:   │     │  All phases:          │
│  upload docs, chat, │     │  coding, tech-stories,│
│  gaps, meeting prep,│     │  QA, + discovery      │
│  generate docs      │     │  queries              │
└─────────┬───────────┘     └──────────┬────────────┘
          │                            │
          │    REST / MCP / HTTP       │
          └──────────┬─────────────────┘
                     │
          ┌──────────▼──────────────────┐
          │    SHARED BACKEND SERVICES   │
          │                             │
          │  RAGFlow (document search)  │
          │  PostgreSQL (typed data)    │
          │  Redis (queue + cache)      │
          └──────────┬──────────────────┘
                     │
          ┌──────────▼──────────────────┐
          │    .memory-bank/ (git)       │
          │    Source of truth           │
          │    Synced both directions    │
          └─────────────────────────────┘
```

### Why This Is Better

| Separate systems (before) | Unified system (now) |
|--------------------------|---------------------|
| Discovery AI = web app, crnogochi = local CLI | One system, two interfaces |
| Different data stores (RAGFlow vs files) | Same data, two access patterns |
| Manual handoff (download ZIP, place in repo) | Automatic — same backend |
| PO can't see dev progress without sync | PO sees everything in real-time |
| Dev can't query discovery data without sync | Dev queries same RAGFlow/PostgreSQL |
| Two codebases to maintain | One backend, two frontends |

---

## 2. How It Works

### The Data Model

```
.memory-bank/ files (git-tracked)
    = portable, works offline, developer-friendly
    = the SOURCE OF TRUTH for project knowledge

RAGFlow (server)
    = search INDEX over .memory-bank/ files + client documents
    = enables semantic search across everything
    = enables web UI access without local files

PostgreSQL (server)
    = typed structured data (requirements, decisions, stakeholders)
    = enables SQL queries (readiness scoring, filtering, aggregation)
    = enables multi-user features (auth, conversations, activity log)
```

**Files are truth. Server is index + structured queries.**

### Sync Flow

```
Developer writes files locally (Claude Code)
  → git commit + push
  → Server detects push (webhook or PO clicks "sync")
  → RAGFlow re-indexes .memory-bank/ files
  → PostgreSQL updates if typed data changed
  → Web UI reflects latest state

PO takes action via web UI
  → Server updates PostgreSQL + RAGFlow
  → Server generates/updates .memory-bank/ files
  → git commit + push
  → Developer pulls → sees latest in Claude Code
```

---

## 3. Why .memory-bank/ Files SHOULD Go in RAGFlow

My previous answer said "no, just give the agent file-reading tools." That was
wrong for THIS architecture. Here's why:

**Web UI users don't have local files.** They access everything via the server.
If .memory-bank/ files aren't in RAGFlow, web UI can't search them.

**Claude Code users have local files AND can query the server.** They get the
best of both worlds — fast local file reading + semantic search via RAGFlow.

**RAGFlow is the shared search layer that makes both modes work.**

### The 3 RAGFlow Datasets (Revised, with clear purpose)

| Dataset | Contents | Who Writes | Who Searches |
|---------|----------|-----------|-------------|
| `project-{id}-client-docs` | Client documents (meetings, emails, specs) | Pipeline (PO uploads) | Web UI + Claude Code |
| `project-{id}-items` | Extracted requirements, constraints, decisions | Pipeline (extraction) | Web UI + Claude Code |
| `project-{id}-memory-bank` | All .memory-bank/ markdown files | Git sync (both directions) | Web UI primarily. Claude Code for cross-file semantic search. |

**Wait — didn't we say 2 datasets was simpler?**

Yes, but that was for a web-only system. With dual-mode, the third dataset
serves a clear purpose: **it makes .memory-bank/ files searchable for web UI
users who don't have local copies.**

Claude Code users can read files locally (fast) OR search RAGFlow (semantic).
Web UI users can ONLY search RAGFlow. Both need the same data accessible.

---

## 4. The Dual-Mode Agent

### Same Skills, Same Prompts, Different Runtime

The SKILL.md files and agent prompts work in BOTH modes:

```
SKILL.md for gap-analyzer:
  - Same system prompt
  - Same anti-rationalization table
  - Same output type (GapAnalysisResult)

  In Web UI mode:
    → Pydantic AI agent calls search_items tool → RAGFlow
    → Pydantic AI agent calls get_control_points → PostgreSQL

  In Claude Code mode:
    → Claude reads .memory-bank/ files directly (local)
    → Claude calls server API for structured queries (PostgreSQL)
    → Or Claude uses MCP server to query RAGFlow
```

### How Claude Code Talks to the Backend

Two options (both work):

**Option A: MCP Servers (recommended)**
```json
// .claude/settings.json in crnogochi-assistants
{
  "mcpServers": {
    "discovery": {
      "command": "npx",
      "args": ["discovery-ai-mcp-server"],
      "env": {
        "DISCOVERY_API_URL": "https://discovery.bild.studio/api",
        "DISCOVERY_API_KEY": "$DISCOVERY_API_KEY"
      }
    }
  }
}
```

The MCP server exposes tools:
- `search_documents(project_id, query)` → RAGFlow search
- `search_items(project_id, query)` → RAGFlow items search
- `get_requirements(project_id, filters)` → PostgreSQL
- `get_readiness(project_id)` → PostgreSQL
- `get_contradictions(project_id)` → PostgreSQL
- `store_finding(project_id, ...)` → PostgreSQL + RAGFlow

**Option B: HTTP Tools (simpler)**
Claude Code can call REST APIs directly via `WebFetch` or custom tools:
```
Claude: I'll check the readiness score...
[calls WebFetch to https://discovery.bild.studio/api/projects/X/readiness]
```

**Option A (MCP) is better** because:
- Tools appear natively in Claude's tool list
- Type-safe parameters
- No URL construction in prompts
- Works with any Claude Code session

---

## 5. What Changes in crnogochi-assistants

### Add Discovery Domain

```markdown
# In CLAUDE.md Domain Detection table, add:

| discovery, readiness, gaps, requirements, client said, meeting prep | discovery | `.claude/skills/discovery/SKILL.md` |
```

### Add Discovery Skill

```
.claude/skills/discovery/SKILL.md
```

```markdown
# Discovery Skill

[DISCOVERY-SKILL-LOADED]

## When to Use
Activated when user asks about: discovery status, requirements, client
information, gaps, readiness, meeting preparation, or handoff documents.

## How It Works
This skill connects to the Discovery AI backend for data that lives in
RAGFlow + PostgreSQL. It uses the discovery MCP server.

## Available Actions
- "What are the gaps?" → search requirements + control points via MCP
- "What did the client say about X?" → search client-docs via MCP
- "What's the readiness?" → get readiness score via MCP
- "Any contradictions?" → get contradictions via MCP
- "Prepare meeting agenda" → get gaps + format as agenda

## Anti-Patterns
- "Reading .memory-bank/ files for discovery data" (Use MCP — server has latest data)
- "Guessing at requirements without checking" (Query the backend first)
```

### Add Discovery MCP Server

```json
// .claude/settings.json, add:
{
  "mcpServers": {
    "discovery": {
      "command": "npx",
      "args": ["discovery-ai-mcp-server"],
      "env": {
        "DISCOVERY_API_URL": "$DISCOVERY_API_URL",
        "DISCOVERY_API_KEY": "$DISCOVERY_API_KEY"
      }
    }
  }
}
```

### Total Changes to crnogochi

| Change | File | Effort |
|--------|------|--------|
| Add discovery domain to detection table | CLAUDE.md | 1 line |
| Add discovery SKILL.md | .claude/skills/discovery/SKILL.md | New file (~50 lines) |
| Add MCP server config | .claude/settings.json | 5 lines |
| Add docs/discovery/ to knowledge search | CLAUDE.md | 1 line |

**~60 lines of changes. No existing functionality broken.**

---

## 6. What We Build for the Backend

### The Discovery AI MCP Server

A thin MCP server that exposes our backend APIs as tools for Claude Code:

```python
# mcp_server/server.py
from mcp import Server, Tool

server = Server("discovery-ai")

@server.tool
async def search_documents(project_id: str, query: str, top_n: int = 10) -> str:
    """Search client documents (meetings, emails, specs) via RAGFlow."""
    return await ragflow.search(f"project-{project_id}-client-docs", query, top_n)

@server.tool
async def search_requirements(project_id: str, query: str = None,
                                priority: str = None, status: str = None) -> str:
    """Search extracted requirements. Filter by priority (must/should/could) or status."""
    return await db.query_requirements(project_id, query, priority, status)

@server.tool
async def get_readiness(project_id: str) -> str:
    """Get current discovery readiness score and breakdown."""
    return await db.get_readiness(project_id)

@server.tool
async def get_gaps(project_id: str) -> str:
    """Get all identified gaps in discovery, classified as AUTO-RESOLVE/ASK-CLIENT/ASK-PO."""
    return await gap_analyzer.run(project_id)

@server.tool
async def get_contradictions(project_id: str) -> str:
    """Get all unresolved contradictions between requirements/decisions."""
    return await db.get_contradictions(project_id)

@server.tool
async def store_finding(project_id: str, statement: str, category: str,
                        confidence: str, source: str) -> str:
    """Store a new finding from development phase. Marked as pending PO review."""
    return await db.store_finding(project_id, statement, category, confidence, source)
```

This is ~100 lines of code. It's a thin proxy to our existing backend services.

### The Backend API (shared by Web UI + MCP Server)

```
FastAPI Backend
├── /api/projects/{id}/documents      → RAGFlow (upload, parse)
├── /api/projects/{id}/chat           → Pydantic AI agent (web UI)
├── /api/projects/{id}/requirements   → PostgreSQL (CRUD)
├── /api/projects/{id}/readiness      → PostgreSQL (score)
├── /api/projects/{id}/gaps           → gap-analyzer subagent
├── /api/projects/{id}/contradictions → PostgreSQL
├── /api/projects/{id}/search         → RAGFlow (all datasets)
├── /api/projects/{id}/sync           → Git sync (.memory-bank/ ↔ RAGFlow)
├── /api/projects/{id}/handoff        → Generate handoff package
└── /mcp                              → MCP server endpoint (for Claude Code)
```

Web UI calls these endpoints via REST.
Claude Code calls the same logic via MCP server.
Same backend, same data, two interfaces.

---

## 7. The File Sync Strategy

### .memory-bank/ as Source of Truth

```
WHO WRITES WHAT:

Discovery AI (web UI):
  → Generates: docs/discovery/*.md, project-brief.md, tech-context.md
  → Commits to git

crnogochi-assistants (Claude Code):
  → Generates: docs/tech-docs/*.md, docs/completed-tasks/*.md, etc.
  → Commits to git

SYNC:
  git push → webhook → server re-indexes .memory-bank/ in RAGFlow
  OR
  PO/dev clicks "sync" → server pulls latest → re-indexes
```

### What Goes in RAGFlow memory-bank Dataset

```
INCLUDE (worth indexing):
  docs/discovery/*.md        — discovery handoff documents
  docs/tech-docs/*.md        — tech documentation
  docs/completed-tasks/*.md  — implementation records
  docs/decisions/*.md        — all decisions
  docs/research-sessions/*.md — research findings
  docs/system-architecture/*.md — architecture patterns
  docs/best-practices/*.md   — guidelines
  docs/errors/*.md           — error solutions
  docs/qa-analysis-reports/*.md — QA analysis
  docs/reports/*.md          — test reports
  docs/defects/*.md          — defect records
  project-brief.md           — project summary
  tech-context.md            — technical context
  system-patterns.md         — architecture overview

EXCLUDE (not worth indexing):
  active-task.md             — transient state
  active-tasks/*.md          — transient state
  learnings.jsonl            — per-developer, .gitignored
  .logs/                     — debug logs
  *.csv                      — test data (structured, not prose)
```

### Keeping RAGFlow in Sync

```python
# services/memory_bank_sync.py

class MemoryBankSync:
    """Syncs .memory-bank/ files between git repo and RAGFlow."""

    async def sync(self, project_id: str) -> SyncResult:
        """Pull latest from git, diff against last sync, update RAGFlow."""

        project = await self.db.get_project(project_id)
        repo = await self.git.pull(project.repo_url)

        # Find all indexable .memory-bank/ files
        files = self.discover_indexable_files(repo / ".memory-bank")

        # Diff against last sync
        last_sync = await self.db.get_last_sync(project_id)
        changed = self.diff_files(files, last_sync.file_hashes)

        if not changed:
            return SyncResult(status="up-to-date", files_changed=0)

        # Update RAGFlow
        dataset_id = f"project-{project_id}-memory-bank"
        for file_path, action in changed.items():
            if action == "added" or action == "modified":
                await self.ragflow.upload_or_replace(dataset_id, file_path)
            elif action == "deleted":
                await self.ragflow.delete(dataset_id, file_path)

        # Save sync state
        await self.db.save_sync(project_id, self.hash_files(files))

        return SyncResult(status="synced", files_changed=len(changed))
```

---

## 8. Revised Architecture Diagram

```
┌──────────────────┐        ┌─────────────────────┐
│  WEB UI          │        │  CLAUDE CODE         │
│  (Next.js)       │        │  (Terminal)          │
│                  │        │                      │
│  PO: upload docs │        │  Dev: code, stories, │
│  PO: chat, gaps, │        │  QA, + query         │
│  PO: generate    │        │  discovery data      │
└────────┬─────────┘        └──────────┬───────────┘
         │ REST + SSE                  │ MCP Server
         │                             │
┌────────▼─────────────────────────────▼───────────┐
│              BACKEND (FastAPI)                     │
│                                                   │
│  REST API (web UI)          MCP Server (Claude Code)
│  ├── /chat → Pydantic AI    ├── search_documents  │
│  ├── /documents → pipeline  ├── search_requirements│
│  ├── /requirements          ├── get_readiness      │
│  ├── /readiness             ├── get_gaps           │
│  ├── /gaps                  ├── store_finding      │
│  └── /sync                  └── get_contradictions │
│                                                   │
│  Shared Services:                                 │
│  Pydantic AI agents (coordinator + 3 subagents)   │
│  Instructor (pipeline extraction)                 │
│  RAGFlowClient, PostgreSQL, PreambleBuilder       │
│  MemoryBankSync (git ↔ RAGFlow)                   │
└────────────────────────┬──────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
  ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
  │  RAGFlow    │ │ PostgreSQL  │ │   Redis    │
  │             │ │             │ │            │
  │ 3 datasets: │ │ typed tables│ │ queue +    │
  │ client-docs │ │ + users     │ │ cache      │
  │ items       │ │ + history   │ │            │
  │ memory-bank │ │ + auth      │ │            │
  └─────────────┘ └─────────────┘ └────────────┘
         │
  ┌──────▼──────────────────────────────────┐
  │  .memory-bank/ (git — source of truth)   │
  │                                          │
  │  Written by: Discovery AI + crnogochi   │
  │  Synced to: RAGFlow memory-bank dataset  │
  │  Read by: Web UI (via RAGFlow search)    │
  │           Claude Code (local files +     │
  │           MCP for server queries)        │
  └──────────────────────────────────────────┘
```

---

## 9. What This Means for the Product

### PO Experience (Web UI)

Same as before, plus:
- Can see dev team's tech docs, stories, and test reports (via synced .memory-bank/)
- Can ask cross-phase questions: "Is auth implemented and tested?"
- Can reopen discovery when dev team finds gaps
- Real-time view of project health across all phases

### Developer Experience (Claude Code)

Same crnogochi-assistants as before, plus:
- New "discovery" domain in CLAUDE.md
- Can query discovery data via MCP: "What are the client requirements for auth?"
- Can check readiness: "Is discovery complete for this feature?"
- Can report findings back: "Found that MFA wasn't specified during discovery"
- No need to leave Claude Code — discovery data comes to them

### The Killer Feature

Developer working on auth implementation in Claude Code:

```
Dev: "What are the requirements for auth?"

Claude Code (via MCP):
  → Queries discovery backend
  → Returns:
    FR-003: SSO Authentication (Must, Confirmed)
    - "System shall authenticate via Microsoft SSO"
    - Business rules: Only company email domains
    - Edge cases: SSO provider downtime
    - Source: Meeting 3, CTO decision
    - Status: Confirmed (high confidence)

    FR-015: MFA for Admin (Must, Confirmed)
    - "Admin users require MFA"
    - Source: Email thread, Mar 28
    - Status: Confirmed (high confidence)

    Assumption: "Regular users don't need MFA"
    - Risk: Security audit may require it
    - Needs validation: Security team

Dev: "OK, implementing FR-003 and FR-015. Flagging the MFA assumption."
```

**The developer gets structured requirements IN their terminal, without leaving
Claude Code, without opening a web browser, without asking the PO.**

---

## 10. Implementation Priority

| Feature | Priority | Effort |
|---------|----------|--------|
| Backend API (REST endpoints for all data) | MVP | Already planned |
| MCP Server (thin proxy to backend) | MVP | ~100 lines |
| Discovery SKILL.md for crnogochi | MVP | ~50 lines |
| Memory bank sync (git → RAGFlow) | v1.5 | ~200 lines |
| Webhook auto-sync on git push | v2 | ~100 lines |
| Bidirectional: dev findings → discovery | v2 | ~200 lines |

**The MCP server is the bridge.** It takes ~100 lines and gives Claude Code
users full access to discovery data. Everything else builds on top.

---

## 11. Summary

| Question | Answer |
|----------|--------|
| **Should .memory-bank/ go in RAGFlow?** | **Yes** — it's the shared search index for web UI users who don't have local files |
| **How many RAGFlow datasets?** | **3**: client-docs, items, memory-bank |
| **How does Claude Code access discovery data?** | **MCP server** — ~100 lines, exposes backend APIs as tools |
| **How do files stay updated?** | **Git is the sync mechanism.** Both sides commit. Server re-indexes on sync. |
| **What changes in crnogochi?** | Add discovery domain (1 line), discovery SKILL.md (50 lines), MCP config (5 lines) |
| **Who is the source of truth?** | **.memory-bank/ files in git.** RAGFlow + PostgreSQL are derived indexes. |
| **Can PO and dev see the same data?** | **Yes.** PO via web UI → RAGFlow/PostgreSQL. Dev via Claude Code → MCP → same backend. |
