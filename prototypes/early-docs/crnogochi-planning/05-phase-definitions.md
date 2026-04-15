# Phase Definitions

## Overview

Crnogochi has four phases. Each phase has specific users, tools, inputs,
outputs, and storage locations. All phases share the same knowledge system.

```
Phase 1: DISCOVERY          "Discover what to build"
Phase 2: STORY & TECH DOCS  "Specify and plan how to build it"
Phase 3: CODE               "Build it"
Phase 4: QA                 "Validate it works"
```

---

## Phase 1: Discovery

### Summary

| Aspect | Detail |
|--------|--------|
| **Purpose** | Discover what to build from client conversations, docs, and existing code |
| **Users** | Product Owner, Business Developer |
| **Status** | To build |
| **Technology** | Custom agent framework + RAGFlow + Mem0 + Claude Code |

### Inputs

| Input | Source | How ingested |
|-------|--------|-------------|
| Meeting notes | PO uploads (PDF, DOCX, TXT) | RAGFlow parses + Mem0 extracts facts |
| Email threads | PO uploads or copy-paste | RAGFlow indexes + Mem0 extracts facts |
| Client specifications | PO uploads (PDF, DOCX, presentations) | RAGFlow parses (DeepDoc: OCR, tables, layout) |
| Client repository | PO provides URL | Claude Code analyzes → facts to Mem0, summary to RAGFlow |
| Previous project knowledge | Automatic (shared knowledge base) | Cross-project search in Mem0 + RAGFlow |

### Agents

| Agent | Type | Purpose |
|-------|------|---------|
| Intake Agent | User-facing | Receives docs/repos, triggers ingestion pipeline |
| Analysis Agent | Internal | Cross-references info, finds contradictions, extracts entities |
| Gap Detection Agent | User-facing | Identifies what's missing, generates questions |
| Meeting Prep Agent | User-facing | Prepares agendas, talking points, confirmation prompts |
| Document Generator | User-facing | Produces Discovery Brief, MVP Scope, Functional Reqs |
| Control Point Agent | Internal | Evaluates readiness, scores control points, alerts |
| Role Simulation Agent | Internal | Analyzes from multiple perspectives (user, dev, QA, biz) |

### Outputs

| Output | Format | Stored in | Consumed by |
|--------|--------|----------|-------------|
| Project Discovery Brief | Markdown / PDF | RAGFlow + Mem0 | Phase 2 team |
| MVP Scope Freeze | Markdown / PDF | RAGFlow + Mem0 | Phase 2 team, client |
| Functional Requirements | Markdown / PDF | RAGFlow + Mem0 | Phase 2 team |
| Meeting Summaries | Markdown | RAGFlow + Mem0 | PO (internal) |
| Gap Analysis Reports | Markdown | RAGFlow | PO (internal) |
| Multi-Perspective Analysis | Markdown | RAGFlow | PO, Tech Lead |

### What goes into shared knowledge
- All documents (RAGFlow)
- Requirements, decisions, constraints, assumptions (Mem0 facts)
- Stakeholders, features, integrations, decisions (Mem0 graph)
- Repo analysis results (all layers)

### Handoff to Phase 2
- Trigger: Readiness score 85%+ (or PO override at 65%+)
- Deliverables: Discovery Brief + MVP Scope + Functional Requirements
- Knowledge base: fully populated with discovery findings

---

## Phase 2: Story & Tech Docs

### Summary

| Aspect | Detail |
|--------|--------|
| **Purpose** | Turn discovery findings into detailed stories, specs, and architecture |
| **Users** | Tech Lead, BA, Solution Architect, PO |
| **Status** | Built (existing assistant) |
| **Technology** | Claude Code + Atlassian (Jira + Confluence) + Figma |

### Inputs

| Input | Source | How accessed |
|-------|--------|-------------|
| Discovery documents | Phase 1 output | Read from shared knowledge (RAGFlow + Mem0) |
| Figma designs | Design team | Figma API integration (read) |
| Client repository | From Phase 1 or provided | Claude Code analysis |
| Atlassian context | Existing Jira/Confluence content | Atlassian API |
| Knowledge base | Shared system | Cross-phase queries for context |

### What it does
- Reads discovery documents and knowledge base
- Creates user stories in Jira from functional requirements
- Writes technical specifications in Confluence
- Creates architecture decision records
- Breaks features into implementable stories with acceptance criteria
- Produces decision.md and learning.md files

### Outputs

| Output | Format | Stored in | Synced to knowledge |
|--------|--------|----------|-------------------|
| User stories | Jira issues | Atlassian (Jira) | Webhook → RAGFlow (indexed with metadata: project, sprint, priority, status) |
| Tech specs | Confluence pages | Atlassian (Confluence) | Webhook → RAGFlow (chunked by section) |
| Architecture docs | Confluence pages | Atlassian (Confluence) | Webhook → RAGFlow + Mem0 (architecture decisions as facts) |
| decision.md | Markdown file | Git repo | Git hook → Mem0 (decision facts + graph entities) |
| learning.md | Markdown file | Git repo | Git hook → Mem0 (learning facts, cross-project tagged) |

### What goes into shared knowledge
- Jira stories with metadata (linked to discovery requirements)
- Confluence specs (searchable, linked to stories)
- Architecture decisions with reasoning and alternatives
- Estimation learnings (e.g., "auth migration: 3 sprints")

### Handoff to Phase 3
- Trigger: Must-have stories written, architecture approved, Tech Lead sign-off
- Deliverables: Jira board with stories, Confluence with specs
- Knowledge base: enriched with specs, architecture, and story details

---

## Phase 3: Code Assistant

### Summary

| Aspect | Detail |
|--------|--------|
| **Purpose** | Implement stories, produce working code with quality and documentation |
| **Users** | Developers |
| **Status** | Built (existing assistant) |
| **Technology** | Claude Code |

### Inputs

| Input | Source | How accessed |
|-------|--------|-------------|
| Jira stories | Phase 2 output | Atlassian API (read assigned stories) |
| Tech specs | Phase 2 output | Confluence API (read linked specs) |
| Codebase | Git repository | Claude Code (deep code understanding) |
| Knowledge base | Shared system | Cross-phase queries for discovery context, past learnings |

### What it does
- Reads assigned stories and linked specs
- Understands existing codebase via Claude Code
- Implements features, writes tests, creates PRs
- Documents decisions and learnings in markdown files
- Updates Jira story status
- Accesses discovery context when implementation questions arise

### Outputs

| Output | Format | Stored in | Synced to knowledge |
|--------|--------|----------|-------------------|
| Code + tests | Source files | Git repo | — (not indexed directly) |
| Pull requests | GitHub/GitLab PRs | Git platform | Webhook → RAGFlow (PR description and context) |
| Code documentation | Markdown | Git repo | Git hook → RAGFlow |
| decision.md | Markdown | Git repo | Git hook → Mem0 (implementation decisions) |
| learning.md | Markdown | Git repo | Git hook → Mem0 (technical learnings, cross-project) |
| Story updates | Jira transitions | Atlassian | Webhook → RAGFlow (status change) |

### What goes into shared knowledge
- Implementation decisions with reasoning
- Technical learnings (tagged for cross-project reuse)
- PR descriptions (what changed and why)
- Code documentation
- Story status updates

### Handoff to Phase 4
- Trigger: Feature branch ready, stories marked "ready for QA"
- Deliverables: Code in repo, stories transitioned, test environment deployed
- Knowledge base: enriched with implementation decisions and learnings

---

## Phase 4: QA Assistant

### Summary

| Aspect | Detail |
|--------|--------|
| **Purpose** | Validate implementation against requirements, find bugs, ensure quality |
| **Users** | QA Engineers |
| **Status** | Built (existing assistant) |
| **Technology** | Claude Code + Report Portal |

### Inputs

| Input | Source | How accessed |
|-------|--------|-------------|
| Code | Phase 3 output | Git repo via Claude Code |
| Stories + acceptance criteria | Phase 2 output | Atlassian API |
| Test plans | QA team | Local / Jira |
| Knowledge base | Shared system | Full traceability: requirement → story → code |
| Report Portal history | Previous test runs | Report Portal API |

### What it does
- Reads stories, specs, and acceptance criteria
- Analyzes code changes via Claude Code
- Creates and executes test plans
- Reports results to Report Portal
- Files bugs in Jira linked to stories and requirements
- Traces failures back to requirements (discovers spec mismatches)
- Documents QA decisions and learnings

### Outputs

| Output | Format | Stored in | Synced to knowledge |
|--------|--------|----------|-------------------|
| Test plans | Markdown / Jira | Local + Jira | → RAGFlow |
| Test results | Report Portal data | Report Portal | Webhook → RAGFlow + Mem0 (pass/fail facts per feature) |
| Bug reports | Jira issues | Atlassian (Jira) | Webhook → Mem0 graph (Bug → Feature → Story → Requirement) |
| decision.md | Markdown | Git repo | Git hook → Mem0 (QA decisions) |
| learning.md | Markdown | Git repo | Git hook → Mem0 (testing learnings, cross-project) |
| Quality report | Report Portal dashboard | Report Portal | Periodic sync → RAGFlow + Mem0 |

### What goes into shared knowledge
- Test coverage per requirement (traced back to discovery)
- Bug reports linked to features, stories, and requirements
- QA decisions ("skipped perf test because client confirmed <100 users")
- Testing learnings and patterns
- Quality metrics per feature and project type

### Project completion
- Trigger: All critical tests passing, no blocker bugs, QA sign-off
- Deliverables: Report Portal dashboard green, quality report
- Knowledge base: fully enriched with outcomes from all four phases

---

## Cross-Phase Summary

| | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--|---------|---------|---------|---------|
| **Tool** | Custom agents | Claude Code | Claude Code | Claude Code |
| **Primary storage** | RAGFlow + Mem0 | Atlassian | Git | Report Portal |
| **Reads from knowledge** | Past projects | Discovery | Discovery + Specs | All phases |
| **Writes to knowledge** | Requirements, decisions, entities | Stories, specs, architecture decisions | Implementation decisions, learnings | Test results, bugs, quality metrics |
| **Key artifact** | Discovery Brief + MVP Scope | Jira stories + Confluence specs | Working code + PRs | Test results + Report Portal |
| **decision.md** | — (facts in Mem0) | Yes | Yes | Yes |
| **learning.md** | — (facts in Mem0) | Yes | Yes | Yes |

---

## The Common Pattern: decision.md + learning.md

Phases 2, 3, and 4 all produce these markdown files using Claude Code:

**decision.md** — Records a decision made during that phase:
```markdown
# Decision: Chose MSAL.js v2 over v1

## Context
SSO implementation for Outlook add-in requires Microsoft auth library.

## Decision
MSAL.js v2 (Microsoft Authentication Library)

## Alternatives Considered
- MSAL.js v1: deprecated, fewer features
- Custom JWT: would bypass Microsoft SSO requirement
- ADAL.js: legacy, replaced by MSAL

## Reasoning
v2 has better iframe support, required for Outlook add-in context.
Silent refresh works without popup in most cases.

## Consequences
- Must handle popup fallback for iframe restriction cases
- Token cache management needed for performance
```

**learning.md** — Records something learned that future projects benefit from:
```markdown
# Learning: MSAL silent refresh fails in iframes

## Context
Outlook add-in runs inside an iframe. MSAL.js silent refresh
opens a hidden iframe for token renewal.

## What Happened
Nested iframe blocked by browser security policy.
Silent refresh fails silently, user gets logged out.

## Solution
Added popup fallback: detect iframe context, use popup-based
refresh instead of silent iframe refresh.

## Applicable When
Any project using MSAL.js inside an iframe or webview context.
Common in: Outlook add-ins, Teams tabs, embedded web apps.
```

These files are automatically ingested into the shared knowledge system
and tagged for cross-project availability.
