# Unified Knowledge System

## The Core Idea

All four phases of Crnogochi share one knowledge system. Every phase
reads from it and writes to it. This means:

- Discovery knowledge is available in Code
- Code learnings are available in future Discovery projects
- QA results trace back to original requirements
- Nothing is lost between handoffs

```
┌──────────────────────────────────────────────────────────────────┐
│                   SHARED KNOWLEDGE SYSTEM                         │
│                                                                  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ RAGFlow         │  │ Mem0 Facts       │  │ Mem0 Graph       │  │
│  │ Document Search │  │ Structured Know  │  │ Entity Relations │  │
│  │                │  │                 │  │                  │  │
│  │ SEARCH:        │  │ KNOW:           │  │ CONNECT:         │  │
│  │ "Find text     │  │ "What do we     │  │ "How is X        │  │
│  │  about X"      │  │  know about X?" │  │  related to Y?"  │  │
│  └───────┬────────┘  └────────┬────────┘  └────────┬─────────┘  │
│          │                    │                     │            │
│          └────────────────────┴─────────────────────┘            │
│                              │                                   │
│            Every phase reads and writes here                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## What Each Phase Contributes

### Phase 1: Discovery — Creates the Foundation

| Output | Goes into | How |
|--------|----------|-----|
| Discovery Brief, MVP Scope, Functional Reqs | RAGFlow | Full documents parsed, chunked, indexed |
| Requirements, decisions, stakeholders | Mem0 Facts | LLM extracts structured facts with status |
| People, features, integrations, decisions | Mem0 Graph | Entities and relationships extracted |
| Meeting summaries | RAGFlow | Searchable by date, attendee, topic |
| Repo analysis (if client provides code) | All layers | Architecture facts + tech stack entities |

**After Discovery, the knowledge system contains:**
- All discovery documents (searchable)
- Structured facts: requirements, decisions, constraints, assumptions
- Entity graph: stakeholders, features, integrations, decisions, timelines

---

### Phase 2: Story/Tech Docs — Refines and Specifies

| Output | Source | Goes into | How |
|--------|--------|----------|-----|
| User stories | Jira | RAGFlow | Jira API sync → stories indexed as documents with metadata (project, sprint, priority, status) |
| Tech specs | Confluence | RAGFlow | Confluence API sync → specs indexed with section-level chunking |
| Architecture docs | Confluence | RAGFlow + Mem0 | Documents indexed; architecture decisions extracted as facts |
| decision.md | Git / local | Mem0 Facts + Graph | "Chose PostgreSQL over MongoDB because..." → fact + decision entity linked to reasoning |
| learning.md | Git / local | Mem0 Facts | "Estimate 3 sprints for auth migration" → tagged as cross-project learning |

**After Story/Tech, the knowledge system adds:**
- Jira stories linked to discovery requirements
- Confluence specs with detailed architecture
- Architecture decisions with reasoning
- Estimation learnings

**Atlassian → RAG sync approach:**
```
Jira Story Created/Updated
       │
       ▼
Webhook or periodic sync
       │
       ├──→ RAGFlow: index story text + metadata
       │    (project, sprint, priority, assignee, status)
       │
       └──→ Mem0: extract facts if story contains decisions
            ("API will use REST, not GraphQL" → fact)

Confluence Page Created/Updated
       │
       ▼
Webhook or periodic sync
       │
       ├──→ RAGFlow: index page content, chunked by section
       │    (metadata: space, parent page, author, last updated)
       │
       └──→ Mem0: extract architecture decisions, constraints
```

---

### Phase 3: Code — Resolves and Implements

| Output | Source | Goes into | How |
|--------|--------|----------|-----|
| decision.md | Git repo | Mem0 Facts + Graph | Implementation decisions with context and alternatives considered |
| learning.md | Git repo | Mem0 Facts | Technical learnings tagged for cross-project reuse |
| PR descriptions | Git (GitHub/GitLab) | RAGFlow | What changed and why, linked to stories |
| Code documentation | Git repo | RAGFlow | API docs, README updates, architecture notes |
| Jira story updates | Jira | RAGFlow (update) | Story status changes, implementation notes |

**After Code, the knowledge system adds:**
- Implementation decisions ("chose event-driven because...")
- Technical learnings ("React Server Components reduced bundle by 40%")
- Code-level documentation searchable alongside specs
- Story status updates

**Git md files → RAG sync approach:**
```
Developer commits decision.md or learning.md
       │
       ▼
Git hook or CI pipeline trigger
       │
       ├──→ RAGFlow: index document with metadata
       │    (project, phase: "code", author, date, related_story)
       │
       └──→ Mem0: extract facts
            decision.md → fact with type "implementation_decision"
            learning.md → fact with type "technical_learning"
                          tagged for cross-project search
```

---

### Phase 4: QA — Validates and Closes the Loop

| Output | Source | Goes into | How |
|--------|--------|----------|-----|
| Test plans | Local / Jira | RAGFlow | Test strategy documents |
| Test results | Report Portal | RAGFlow + Mem0 | Pass/fail per test, coverage metrics |
| Bug reports | Jira | RAGFlow + Mem0 Graph | Bug details + linked to feature → story → requirement |
| decision.md | Git repo | Mem0 Facts | QA decisions ("skipped perf test because...") |
| learning.md | Git repo | Mem0 Facts | Testing learnings for future projects |
| Report Portal data | Report Portal API | RAGFlow + Mem0 | Quality dashboards, regression trends |

**After QA, the knowledge system adds:**
- Test coverage per requirement (traced back to discovery)
- Bug reports linked to features, stories, and requirements
- QA decisions and learnings
- Quality metrics per feature and per project

**Report Portal → RAG sync approach:**
```
Test suite completes
       │
       ▼
Report Portal API webhook or periodic sync
       │
       ├──→ RAGFlow: index test results as documents
       │    (metadata: suite, feature, pass/fail, date)
       │
       └──→ Mem0: extract structured facts
            "Feature X: 95% pass rate"
            "Edge case: token expiry during meeting — FAIL → BUG-023"
            Graph: Bug → affects → Feature → Story → Requirement
```

---

## Cross-Project Knowledge

The most powerful aspect: knowledge from past projects is available
to future ones.

### How It Works

Each fact in Mem0 has a `project_id` for isolation. But facts tagged
as `type: "learning"` or `type: "cross_project_pattern"` are also
available in a shared cross-project scope.

```
Project A (completed):
  Learning: "Auth migration from JWT to SSO took 3 sprints"
  Learning: "Client changed hosting provider mid-project — cost 2 weeks"
  Learning: "API contract testing caught 3 integration issues early"
  Pattern:  "Greenfield web apps typically need 4-6 discovery meetings"

Project B (starting discovery):
  PO asks: "What should we watch out for?"
  System queries cross-project learnings:
  → "Similar projects had auth migration issues (3 sprints)"
  → "Hosting decisions changed mid-project in 30% of cases — confirm early"
  → "API contract testing recommended — caught issues in 3 past projects"
```

### What Crosses Project Boundaries

| Crosses boundaries | Stays within project |
|-------------------|---------------------|
| Technical learnings (learning.md) | Client-specific requirements |
| Estimation patterns ("features like X took Y sprints") | Meeting notes and emails |
| Common pitfalls and warnings | Stakeholder details |
| Architecture decision patterns | Business context |
| Testing strategies that worked | Financial information |
| Quality metrics by feature type | Proprietary client data |

**Privacy is maintained:** Only learnings and patterns cross boundaries.
Client-specific data stays within its project scope.

---

## Knowledge Lifecycle Across Phases

A single piece of knowledge evolves as it moves through phases:

```
DISCOVERY (Phase 1):
  Fact created: "Auth method: Microsoft SSO"
  Status: confirmed
  Source: Meeting 3, decided by Sarah Chen
  Entity: [Auth Decision] ──[decided_by]──→ [Sarah Chen]

STORY/TECH (Phase 2):
  Fact enriched: "Auth method: Microsoft SSO using MSAL.js v2"
  Architecture doc: "SSO flow: redirect → token → silent refresh"
  Entity updated: [Auth Decision] ──[specified_in]──→ [PROJ-142]
                                  ──[architecture]──→ [MSAL + silent refresh]

CODE (Phase 3):
  Fact enriched: "Auth: MSAL.js v2 with custom token cache"
  Decision: "Used in-memory token cache, not session storage — faster"
  Learning: "MSAL silent refresh fails in iframes — need popup fallback"
  Entity updated: [Auth Decision] ──[implemented_in]──→ [PR #47]
                                  ──[learning]──→ "iframe issue"

QA (Phase 4):
  Fact enriched: "Auth: tested, 3 edge cases found"
  Test result: "SSO flow: PASS (12/12 cases)"
  Bug: "MFA prompt breaks silent refresh in Outlook add-in"
  Entity updated: [Auth Decision] ──[tested_by]──→ [TC-089]
                                  ──[bug]──→ [BUG-023]
                                  ──[quality]──→ "95% pass"
```

At the end, "Auth method: Microsoft SSO" has a complete history:
- Who decided it (Discovery)
- How it was specified (Story/Tech)
- How it was implemented (Code)
- How it was tested (QA)
- What issues were found (QA)

This traceability happens automatically through the shared knowledge system.

---

## Sync Architecture

How external systems push data into the shared knowledge:

```
┌───────────────┐     ┌──────────────┐     ┌───────────────┐
│   Atlassian    │     │  Git Repos    │     │ Report Portal  │
│  (Jira +       │     │ (GitHub /     │     │               │
│   Confluence)  │     │  GitLab)      │     │               │
└───────┬───────┘     └──────┬───────┘     └───────┬───────┘
        │                    │                     │
        ▼                    ▼                     ▼
┌───────────────────────────────────────────────────────────┐
│              SYNC / INGESTION LAYER                        │
│                                                           │
│  Atlassian Sync         Git Sync          Report Sync     │
│  • Webhook on           • Git hook or     • Webhook on    │
│    story/page update      CI trigger        suite complete│
│  • Periodic full        • Watch for       • Periodic      │
│    sync (daily)           *.md changes      full sync     │
│  • Extract text +       • Parse md files  • Parse test    │
│    metadata             • Extract facts     results       │
│                                           • Link to       │
│                                             features      │
└───────────────┬───────────────┬───────────────┬───────────┘
                │               │               │
                ▼               ▼               ▼
        ┌───────────┐   ┌───────────┐   ┌───────────┐
        │  RAGFlow   │   │ Mem0 Facts │   │ Mem0 Graph │
        │  (search)  │   │  (know)    │   │ (connect)  │
        └───────────┘   └───────────┘   └───────────┘
```

### Sync Frequency

| Source | Sync method | Frequency |
|--------|-----------|-----------|
| Atlassian (Jira) | Webhook (story created/updated/transitioned) | Real-time |
| Atlassian (Confluence) | Webhook (page created/updated) | Real-time |
| Git (decision.md, learning.md) | Git hook or CI pipeline | On commit/merge |
| Git (PR descriptions) | GitHub/GitLab webhook | On PR create/merge |
| Report Portal | Webhook (suite complete) | On test completion |
| Manual upload (Discovery) | User action | On upload |

---

## Data Model Summary

What the shared knowledge system stores per project:

```
Project: NacXwan
├── Documents (RAGFlow)
│   ├── Discovery: Brief, Scope, Requirements, Meeting Notes
│   ├── Story/Tech: Jira stories, Confluence specs
│   ├── Code: decision.md, learning.md, PR descriptions
│   └── QA: test plans, Report Portal results
│
├── Facts (Mem0)
│   ├── Requirements (confirmed/assumed/changed)
│   ├── Decisions (with reasoning and alternatives)
│   ├── Technical learnings
│   ├── Test outcomes per feature
│   └── Quality metrics
│
└── Entities (Mem0 Graph)
    ├── People (stakeholders, team members)
    ├── Features (with priority, status, coverage)
    ├── Decisions (linked to people, meetings, code)
    ├── Stories (linked to requirements, code, tests)
    ├── Bugs (linked to features, tests, requirements)
    └── Integrations (external systems, APIs)
```
