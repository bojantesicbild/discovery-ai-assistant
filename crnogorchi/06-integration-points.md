# Integration Points

## Overview

Crnogorchi connects to multiple external systems. Each integration
serves a specific purpose and syncs data into the shared knowledge system.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CRNOGORCHI                                   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                  SHARED KNOWLEDGE SYSTEM                       │  │
│  │              (RAGFlow + Mem0 + Neo4j)                         │  │
│  └───────┬────────┬────────┬────────┬────────┬──────────────────┘  │
│          │        │        │        │        │                      │
│          ▼        ▼        ▼        ▼        ▼                      │
│  ┌──────────┐┌────────┐┌──────┐┌────────┐┌──────────┐┌─────────┐  │
│  │Atlassian ││ Figma  ││ Git  ││Report  ││ Claude   ││ LLM API │  │
│  │Jira +    ││        ││Repos ││Portal  ││ Code     ││Anthropic│  │
│  │Confluence││        ││      ││        ││          ││         │  │
│  └──────────┘└────────┘└──────┘└────────┘└──────────┘└─────────┘  │
│                                                                     │
│  Used by:     Used by:  Used by: Used by:  Used by:    Used by:    │
│  Phase 2      Phase 2   Phase   Phase 4   Phase 1-4   All phases   │
│  (read/write) (read)    2,3,4   (write)   (analysis)  (reasoning)  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Atlassian (Jira + Confluence)

### Role in Crnogorchi
Primary storage for Phase 2 (Story/Tech Docs). Other phases read from it.

### Integration Details

| Aspect | Jira | Confluence |
|--------|------|-----------|
| **Used by** | Phase 2 (write), Phase 3 (read), Phase 4 (read + write bugs) | Phase 2 (write), Phase 3 (read), Phase 4 (read) |
| **Operations** | Create stories, transition status, create bugs, read stories | Create pages, update specs, read pages |
| **Sync to knowledge** | Story created/updated → RAGFlow + Mem0 | Page created/updated → RAGFlow + Mem0 |
| **Sync method** | Webhook (real-time) + periodic full sync | Webhook (real-time) + periodic full sync |

### What gets synced to the knowledge system

**From Jira:**
```
Story created: PROJ-142 "Implement Microsoft SSO"
       │
       ├──→ RAGFlow: index story as document
       │    metadata: {
       │      project: "NacXwan",
       │      phase: "story_tech",
       │      type: "jira_story",
       │      key: "PROJ-142",
       │      priority: "must-have",
       │      status: "in_progress",
       │      sprint: "Sprint 2",
       │      assignee: "developer-name"
       │    }
       │
       └──→ Mem0: extract facts if story contains decisions
            Link: Story ──[implements]──→ Requirement (from Discovery)

Bug created: BUG-023 "SSO fails with MFA prompt"
       │
       └──→ Mem0 Graph:
            Bug ──[affects]──→ Feature (SSO)
            Bug ──[found_in]──→ Story (PROJ-142)
            Bug ──[traces_to]──→ Requirement (Auth method: SSO)
```

**From Confluence:**
```
Page updated: "Auth API Contract"
       │
       ├──→ RAGFlow: index page, chunked by section
       │    metadata: {
       │      project: "NacXwan",
       │      phase: "story_tech",
       │      type: "confluence_spec",
       │      space: "NACXWAN",
       │      author: "tech-lead",
       │      last_updated: "2025-03-05"
       │    }
       │
       └──→ Mem0: extract architecture decisions
            "API style: REST" → fact
            "Auth endpoint: /api/v1/auth/token" → fact
```

### Authentication
- Atlassian API token or OAuth 2.0 (3LO)
- Service account for sync operations
- Per-project Jira project and Confluence space mapping

---

## Figma

### Role in Crnogorchi
Design context for Phase 2 (Story/Tech Docs). Read-only.

### Integration Details

| Aspect | Detail |
|--------|--------|
| **Used by** | Phase 2 (read only) |
| **Operations** | Read designs, extract component information, link to stories |
| **Sync to knowledge** | Design references stored as metadata on stories |
| **Sync method** | On-demand (when writing stories) via Figma API |

### How it works
```
Tech Lead writes story for a feature
       │
       ▼
Claude Code (Phase 2) reads linked Figma file
       │
       ├── Extracts component structure
       ├── Identifies UI patterns
       ├── Notes design constraints
       │
       ▼
Story in Jira includes:
  - Reference to Figma frame
  - UI component notes
  - Design constraints for developer
```

**Figma data is NOT ingested into RAGFlow/Mem0 directly.** It's consumed
by the Story/Tech Doc Assistant and embedded into stories and specs,
which then get synced to the knowledge system.

---

## Git Repositories

### Role in Crnogorchi
Source of truth for code (Phase 3), documentation, and decision/learning
artifacts (Phases 2, 3, 4).

### Integration Details

| Aspect | Detail |
|--------|--------|
| **Used by** | Phase 2 (write md files), Phase 3 (read/write code + md), Phase 4 (read code + write md) |
| **Operations** | Read code, create PRs, commit files, read md files |
| **Sync to knowledge** | decision.md + learning.md + PR descriptions → RAGFlow + Mem0 |
| **Sync method** | Git hook or CI pipeline trigger on push/merge |

### What gets synced

**decision.md and learning.md files:**
```
Git push with new decision.md
       │
       ▼
CI pipeline or Git hook
       │
       ├──→ RAGFlow: index document
       │    metadata: {
       │      project: "NacXwan",
       │      phase: "code",  (or "story_tech", "qa")
       │      type: "decision" (or "learning"),
       │      author: "developer",
       │      date: "2025-03-12"
       │    }
       │
       └──→ Mem0:
            decision.md → fact with type "implementation_decision"
                          → graph: Decision entity linked to Feature, Technology
            learning.md → fact with type "technical_learning"
                          → tagged: cross_project = true
```

**Pull Requests:**
```
PR created/merged: #47 "Implement SSO with MSAL.js v2"
       │
       ▼
GitHub/GitLab webhook
       │
       └──→ RAGFlow: index PR description + linked story
            metadata: {
              project: "NacXwan",
              phase: "code",
              type: "pull_request",
              story: "PROJ-142",
              author: "developer",
              status: "merged"
            }
```

### Client Repository Analysis (Discovery)

In Phase 1, the PO can provide a client's repository for analysis:

```
PO provides: https://github.com/client/their-product
       │
       ▼
Claude Code analyzes
       │
       ├── Architecture summary → RAGFlow (as document)
       ├── Tech stack facts → Mem0 (as confirmed facts)
       ├── API surface → Mem0 graph (Service → exposes → API)
       ├── Dependencies → Mem0 graph (Project → depends_on → Library)
       └── Tech debt assessment → Mem0 facts
```

---

## Report Portal

### Role in Crnogorchi
Test results and quality metrics storage for Phase 4 (QA).

### Integration Details

| Aspect | Detail |
|--------|--------|
| **Used by** | Phase 4 (write results, read history) |
| **Operations** | Push test results, read dashboards, query history |
| **Sync to knowledge** | Test outcomes + quality metrics → RAGFlow + Mem0 |
| **Sync method** | Webhook on suite completion + periodic sync for dashboards |

### What gets synced

```
Test suite completes
       │
       ▼
Report Portal webhook
       │
       ├──→ RAGFlow: index test results summary
       │    metadata: {
       │      project: "NacXwan",
       │      phase: "qa",
       │      type: "test_results",
       │      suite: "SSO Integration Tests",
       │      pass_rate: "95%",
       │      date: "2025-04-01"
       │    }
       │
       └──→ Mem0:
            Facts: "SSO Integration: 95% pass rate, 12/12 core, 1/2 edge"
            Graph: Test Suite ──[validates]──→ Feature (SSO)
                   Test Suite ──[covers]──→ Story (PROJ-142)
                   Failed Test ──[found]──→ Bug (BUG-023)
```

### Report Portal Dashboard in Crnogorchi UI
The QA phase view embeds or links to Report Portal dashboards:
- Overall quality metrics
- Per-feature test coverage
- Regression trends
- Failure analysis

---

## Claude Code

### Role in Crnogorchi
Code understanding and AI-assisted work across all phases.

### Integration Details

| Phase | How Claude Code is used |
|-------|------------------------|
| **Phase 1: Discovery** | Analyzes client repos — extracts architecture, APIs, tech stack, debt |
| **Phase 2: Story/Tech** | Reads code + Figma, writes stories and specs, updates Atlassian |
| **Phase 3: Code** | Implements stories, writes code, creates PRs, produces decision/learning docs |
| **Phase 4: QA** | Reads code + stories, creates test plans, identifies test cases, reports results |

### Consistency across phases
Claude Code is the foundation of Phases 2-4. Using it in Phase 1 (Discovery)
for repo analysis means:
- Same code understanding capabilities across all phases
- Technical vocabulary and entity naming stay consistent
- Repo analysis from Discovery carries forward to later phases

### Integration method
- CLI integration for phases running locally
- API integration for server-side operations
- All calls go through Bild's Anthropic tenant (data stays secure)

---

## Anthropic LLM API

### Role in Crnogorchi
AI reasoning and generation for all phases.

### Configuration

| Aspect | Detail |
|--------|--------|
| **Provider** | Anthropic (Claude models) |
| **Tenant** | Bild's own Anthropic tenant |
| **Data policy** | Client data stays within tenant boundary. No training, no sharing. |
| **Models available** | Opus (complex reasoning), Sonnet (general), Haiku (fast/structured) |

### Model per operation

| Operation | Model | Phase |
|-----------|-------|-------|
| Fact extraction | Haiku | 1 |
| Agent reasoning | Sonnet | 1 |
| Document generation | Sonnet | 1 |
| Role simulation | Opus | 1 |
| Control point evaluation | Haiku | 1 |
| Story writing | Sonnet | 2 |
| Code generation | Sonnet/Opus | 3 |
| Test generation | Sonnet | 4 |
| Metadata extraction | Haiku | All |

---

## Integration Summary

| System | Phases | Direction | Sync method | Goes to knowledge? |
|--------|--------|-----------|-------------|-------------------|
| **Atlassian Jira** | 2, 3, 4 | Read/write | Webhook + periodic | Yes (stories, bugs) |
| **Atlassian Confluence** | 2, 3 | Read/write | Webhook + periodic | Yes (specs, docs) |
| **Figma** | 2 | Read only | On-demand API | Indirectly (via stories) |
| **Git (code repos)** | 2, 3, 4 | Read/write | Git hooks, CI triggers | Yes (md files, PRs) |
| **Git (client repos)** | 1 | Read only | On-demand (Claude Code) | Yes (analysis results) |
| **Report Portal** | 4 | Write results, read history | Webhook + periodic | Yes (test results, quality) |
| **Claude Code** | 1, 2, 3, 4 | Read/analyze/generate | CLI or API | Outputs feed other integrations |
| **Anthropic API** | All | API calls | Per-request | N/A (reasoning engine) |

---

## Authentication & Security

| System | Auth method | Notes |
|--------|-----------|-------|
| Atlassian | API token or OAuth 2.0 (3LO) | Service account for sync, user accounts for interactive use |
| Figma | Personal access token or OAuth 2.0 | Read-only access |
| Git (GitHub) | GitHub App or personal access token | Webhook secret for validation |
| Git (GitLab) | Project access token or OAuth 2.0 | Webhook token for validation |
| Report Portal | API token | Per-project access |
| Claude Code | Built into tool | Runs on Bild's Anthropic tenant |
| Anthropic API | API key (tenant) | All data within Bild's secure boundary |

All API keys and tokens are stored in a secret manager (not in code or
config files). Service accounts use minimum required permissions.
