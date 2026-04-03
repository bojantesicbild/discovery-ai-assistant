# Cross-Phase Architecture

## How Phases Connect

Each phase produces outputs that serve two purposes:
1. **Direct handoff** to the next phase (primary consumer)
2. **Knowledge enrichment** into the shared system (available to all phases)

```
PHASE 1: DISCOVERY
  Produces → Discovery Brief, MVP Scope, Functional Requirements
  Stores in → RAGFlow (docs) + Mem0 (facts + entities)
  Hands off to → Phase 2
       │
       ▼
PHASE 2: STORY & TECH DOCS
  Reads ← Discovery docs + knowledge base
  Produces → User stories, tech specs, architecture docs (in Atlassian)
           → decision.md, learning.md
  Stores in → Atlassian (Jira + Confluence) → synced to RAGFlow + Mem0
  Hands off to → Phase 3
       │
       ▼
PHASE 3: CODE ASSISTANT
  Reads ← Atlassian stories/specs + knowledge base
  Produces → Working code, PRs, documentation
           → decision.md, learning.md
  Stores in → Git repo → md files synced to RAGFlow + Mem0
  Hands off to → Phase 4
       │
       ▼
PHASE 4: QA ASSISTANT
  Reads ← Code + stories + specs + knowledge base
  Produces → Test plans, test results, bug reports
           → decision.md, learning.md
           → Report Portal data
  Stores in → Report Portal → synced to RAGFlow + Mem0
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CRNOGORCHI                                     │
│                                                                         │
│  PHASE 1              PHASE 2              PHASE 3         PHASE 4      │
│  Discovery            Story/Tech           Code            QA           │
│  ┌─────────┐         ┌──────────┐         ┌─────────┐    ┌──────────┐  │
│  │ Agents   │         │ Claude   │         │ Claude  │    │ Claude   │  │
│  │ RAGFlow  │────────→│ Code     │────────→│ Code    │───→│ Code     │  │
│  │ Mem0     │         │          │         │         │    │          │  │
│  └────┬─────┘         └────┬─────┘         └────┬────┘    └────┬─────┘  │
│       │                    │                    │              │         │
│       │ outputs:           │ outputs:           │ outputs:     │ outputs:│
│       │ • Brief            │ • Jira stories     │ • Code/PRs   │ • Tests │
│       │ • MVP Scope        │ • Confluence specs  │ • decision.md│ • Bugs  │
│       │ • Func Reqs        │ • Architecture docs│ • learning.md│ • dec.md│
│       │ • Gap Analysis     │ • decision.md      │              │ • lrn.md│
│       │ • Meeting Notes    │ • learning.md      │              │ • Report│
│       │                    │                    │              │  Portal │
│       │                    │                    │              │         │
│       ▼                    ▼                    ▼              ▼         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    SHARED KNOWLEDGE SYSTEM                        │   │
│  │                                                                  │   │
│  │  ┌──────────────────┐  ┌───────────────────┐  ┌──────────────┐  │   │
│  │  │ RAGFlow           │  │ Mem0 Fact Store    │  │ Mem0 Graph   │  │   │
│  │  │ (document search) │  │ (structured facts) │  │ (entities)   │  │   │
│  │  │                  │  │                   │  │              │  │   │
│  │  │ All docs from    │  │ Facts from all    │  │ Stakeholders │  │   │
│  │  │ all phases       │  │ phases with       │  │ Components   │  │   │
│  │  │ searchable       │  │ lifecycle mgmt    │  │ Decisions    │  │   │
│  │  │                  │  │                   │  │ Dependencies │  │   │
│  │  │ Atlassian sync   │  │ Decision logs     │  │ Test coverage│  │   │
│  │  │ Report Portal    │  │ Learning logs     │  │ Bug links    │  │   │
│  │  │ Git md files     │  │ Test outcomes     │  │              │  │   │
│  │  └──────────────────┘  └───────────────────┘  └──────────────┘  │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase-by-Phase: What Goes In, What Comes Out

### Phase 1: Discovery

| Aspect | Detail |
|--------|--------|
| **Users** | Product Owner, Business Developer |
| **Inputs** | Client meetings, emails, docs, client repos |
| **Tool** | Discovery AI Assistant (custom agents + RAGFlow + Mem0) |
| **Outputs** | Discovery Brief, MVP Scope Freeze, Functional Requirements, Meeting Summaries, Gap Analysis |
| **Stores to** | RAGFlow (full documents), Mem0 (facts: requirements, decisions, stakeholders; graph: entity relationships) |
| **Handoff to Phase 2** | Three primary docs + readiness score + knowledge base populated |

### Phase 2: Story & Tech Docs

| Aspect | Detail |
|--------|--------|
| **Users** | Tech Lead, BA, Solution Architect, PO |
| **Inputs** | Discovery docs + Figma designs + client repo + knowledge base |
| **Tool** | Story/Tech Doc Assistant (Claude Code + Atlassian + Figma) |
| **Outputs** | User stories (Jira), tech specs (Confluence), architecture docs, decision.md, learning.md |
| **Stores to** | Atlassian (primary), md files → synced to RAGFlow + Mem0 |
| **Handoff to Phase 3** | Jira stories assigned, Confluence specs linked, architecture decisions documented |

**What goes into the shared knowledge:**
- Jira stories → RAGFlow (searchable by feature, priority, status)
- Confluence specs → RAGFlow (architecture decisions, API contracts, data models)
- decision.md → Mem0 facts ("We chose PostgreSQL because...") + graph (Decision → reasoning → alternatives)
- learning.md → Mem0 facts ("Auth migration estimate: 3 sprints") + cross-project tag

### Phase 3: Code Assistant

| Aspect | Detail |
|--------|--------|
| **Users** | Developers |
| **Inputs** | Jira stories + Confluence specs + knowledge base + codebase |
| **Tool** | Code Assistant (Claude Code) |
| **Outputs** | Working code, PRs, code documentation, decision.md, learning.md |
| **Stores to** | Git repo (code + md files), md files → synced to RAGFlow + Mem0 |
| **Handoff to Phase 4** | Code in repo, stories marked done, documentation updated |

**What goes into the shared knowledge:**
- decision.md → Mem0 facts ("Chose event-driven architecture for notification service because...")
- learning.md → Mem0 facts ("React Server Components reduced bundle size by 40%")
- Code documentation → RAGFlow (API docs, architecture notes)
- PR descriptions → RAGFlow (what changed and why)

### Phase 4: QA Assistant

| Aspect | Detail |
|--------|--------|
| **Users** | QA Engineers |
| **Inputs** | Code + stories + specs + knowledge base |
| **Tool** | QA Assistant (Claude Code + Report Portal) |
| **Outputs** | Test plans, test results, bug reports, decision.md, learning.md, Report Portal data |
| **Stores to** | Report Portal (test results), Jira (bugs), md files → synced to RAGFlow + Mem0 |
| **Project completion** | Final quality report, all tests passing, release readiness |

**What goes into the shared knowledge:**
- Test results → Mem0 facts ("Feature X: 95% pass rate, 2 edge cases failed")
- Bug reports → Mem0 graph (Bug → affects → Feature → was specified in → Story → came from → Requirement)
- decision.md → Mem0 facts ("Skipped performance testing because client confirmed <100 users")
- learning.md → Mem0 facts ("API contract testing caught 3 integration issues early")
- Report Portal data → RAGFlow (test coverage, regression results, quality trends)

---

## Handoff Triggers

What signals that one phase is ready to hand off to the next:

| Handoff | Trigger | Validation |
|---------|---------|-----------|
| Discovery → Story/Tech | Readiness score 85%+ (or PO override at 65%+) | Control points evaluated, documents generated |
| Story/Tech → Code | All must-have stories written, architecture approved | Tech Lead sign-off, specs complete |
| Code → QA | Feature branch ready, stories marked "ready for QA" | Code review passed, deployment to test env |
| QA → Release | All critical tests passing, no blocker bugs | QA sign-off, Report Portal green |

Each handoff is tracked in the shared knowledge system — who approved it,
when, and with what caveats.

---

## Cross-Phase Queries

The shared knowledge system enables queries that span phases:

| Query | Phases involved | How it works |
|-------|----------------|-------------|
| "What was the original requirement for this feature?" | Code → Discovery | Developer searches RAGFlow for discovery context |
| "Has the auth implementation matched the discovery spec?" | QA → Discovery + Code | Compare discovery facts with code implementation |
| "Similar projects — what issues came up in QA?" | Discovery → past QA | Cross-project search in Mem0 learning facts |
| "Who decided on this architecture and why?" | Code → Story/Tech + Discovery | Graph traversal: Architecture Decision → decided_by → Person → discussed_in → Meeting |
| "What's the full traceability for this bug?" | QA → all phases | Graph: Bug → Test → Story → Requirement → Discovery Meeting |
| "How long did similar features take to implement?" | Story/Tech → past Code | Cross-project search in Mem0: feature type + actual effort |

---

## Knowledge Enrichment Over the Project Lifecycle

The entity graph grows richer as the project moves through phases:

```
After Discovery:
  [Auth Requirement] ──decided_by──→ [Sarah Chen]
                     ──status──→ confirmed
                     ──method──→ Microsoft SSO

After Story/Tech:
  [Auth Requirement] ──specified_in──→ [PROJ-142: Implement SSO]
                     ──architecture──→ [MSAL + token refresh flow]
                     ──api_spec──→ [Confluence: Auth API Contract]

After Code:
  [Auth Requirement] ──implemented_in──→ [PR #47: SSO integration]
                     ──decision──→ "Used MSAL.js v2, not v1"
                     ──learning──→ "Token refresh needs silent flow for add-ins"

After QA:
  [Auth Requirement] ──tested_by──→ [TC-089: SSO login flow]
                     ──test_result──→ PASS
                     ──edge_case──→ "Token expiry during meeting — handled"
                     ──bug──→ [BUG-023: SSO fails with MFA prompt]
```

By the end, every requirement has full traceability — from the meeting
where it was first discussed, through spec, implementation, and testing.
