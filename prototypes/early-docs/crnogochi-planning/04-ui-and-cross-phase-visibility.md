# UI & Cross-Phase Visibility

## Design Principle

Crnogochi's UI shows each user their current phase in detail, while giving
them visibility into other phases that affect their work. A developer in
Phase 3 should see the discovery context behind their stories. A PO in
Phase 1 should see patterns from past projects' Code and QA phases.

---

## UI Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│  CRNOGOCHI                                    [NacXwan Project ▾]  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  PROJECT HEADER                                               │  │
│  │                                                               │  │
│  │  NacXwan — Outlook Add-in           Status: Phase 2 (Active)  │  │
│  │                                                               │  │
│  │  Phase 1 ✅ ──→ Phase 2 🔵 ──→ Phase 3 ⚪ ──→ Phase 4 ⚪     │  │
│  │  Discovery      Story/Tech       Code           QA            │  │
│  │  91% ready      In progress      Not started    Not started   │  │
│  │                 34/52 stories                                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────┬─────────────────────────────────────────────────────┐  │
│  │ NAV     │  MAIN CONTENT AREA                                  │  │
│  │         │                                                     │  │
│  │ Overview│  (varies by phase and view)                         │  │
│  │         │                                                     │  │
│  │ Phase 1 │                                                     │  │
│  │ Phase 2 │                                                     │  │
│  │ Phase 3 │                                                     │  │
│  │ Phase 4 │                                                     │  │
│  │         │                                                     │  │
│  │ Chat    │                                                     │  │
│  │ Docs    │                                                     │  │
│  │ Settings│                                                     │  │
│  └─────────┴─────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Views

### 1. Project Overview

The landing page for any project. Shows status across all phases.

```
┌─────────────────────────────────────────────────────────────────┐
│  PROJECT OVERVIEW — NacXwan                                      │
│                                                                 │
│  Timeline:                                                      │
│  Jan 15 ──────────────── Feb 28 ──── Mar (now) ──── Apr ───    │
│  │ Discovery │ Story/Tech │ Code (planned)  │ QA (planned)│     │
│  │ ✅ Done   │ 🔵 Active  │                 │             │     │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────┐  │
│  │ DISCOVERY     │ │ STORY/TECH   │ │ CODE     │ │ QA       │  │
│  │              │ │              │ │          │ │          │  │
│  │ Readiness:   │ │ Stories:     │ │ PRs:     │ │ Tests:   │  │
│  │ 91% ✅       │ │ 34/52 done   │ │ —        │ │ —        │  │
│  │              │ │              │ │          │  │          │  │
│  │ Stakeholders:│ │ Specs:       │ │ Coverage:│ │ Pass:    │  │
│  │ 5 identified │ │ 8/12 done    │ │ —        │ │ —        │  │
│  │              │ │              │ │          │ │          │  │
│  │ Decisions:   │ │ Architecture:│ │ Deploys: │ │ Bugs:    │  │
│  │ 12 confirmed │ │ Approved ✅   │ │ —        │ │ —        │  │
│  └──────────────┘ └──────────────┘ └──────────┘ └──────────┘  │
│                                                                 │
│  Recent Activity:                                               │
│  • Story/Tech: 3 new stories created (2 hours ago)              │
│  • Story/Tech: Architecture doc approved by Tech Lead           │
│  • Discovery: Project marked as handed off (Feb 28)             │
│                                                                 │
│  Knowledge Base:                                                │
│  • 47 documents indexed                                         │
│  • 89 facts tracked (82 confirmed, 5 assumed, 2 contradicted)  │
│  • 34 entities in graph                                         │
│                                                                 │
│  Cross-Project Insights:                                        │
│  • 2 past projects had similar scope (Outlook add-in)           │
│  • Common risk: platform API version compatibility              │
│  • Average discovery-to-code: 6 weeks for this project type     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Phase Views

Each phase has its own detailed view, tailored to that phase's users.

#### Phase 1: Discovery View

```
┌─────────────────────────────────────────────────────────────────┐
│  DISCOVERY — NacXwan                            Readiness: 91%  │
│                                                                 │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐ │
│  │ Control Points           │  │ Recent Ingestion              │ │
│  │                         │  │                              │ │
│  │ Business:    95% ████▓  │  │ Meeting 5 notes    (2h ago)  │ │
│  │ Functional:  88% ████▓  │  │ Client spec v2     (1d ago)  │ │
│  │ Technical:   85% ████░  │  │ Repo analyzed      (3d ago)  │ │
│  │ Scope:       95% █████  │  │                              │ │
│  └─────────────────────────┘  └──────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Open Gaps (3 remaining)                                   │  │
│  │                                                          │  │
│  │ ⚠️ Performance targets — assumed, not confirmed           │  │
│  │ ⚠️ Data retention policy — never discussed                │  │
│  │ ⚠️ Offline capability — mentioned but unclear scope       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Cross-Phase Context                                       │  │
│  │                                                          │  │
│  │ From past projects (similar scope):                      │  │
│  │ • "Outlook add-in auth required platform-specific token  │  │
│  │    handling" — learned in Code phase, Project Acme        │  │
│  │ • "Performance testing for add-ins needs Office-specific  │  │
│  │    test harness" — learned in QA phase, Project Beta      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Chat with Agent]  [Generate Docs]  [Prepare Meeting]         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Phase 2: Story/Tech View

```
┌─────────────────────────────────────────────────────────────────┐
│  STORY & TECH DOCS — NacXwan                    34/52 stories   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Story Progress                                            │  │
│  │ ███████████████████████████████░░░░░░░░░░░  34/52 (65%)  │  │
│  │                                                          │  │
│  │ Must-have: 28/30  │  Should-have: 6/15  │  Could: 0/7   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Discovery Context Panel                                   │  │
│  │                                                          │  │
│  │ This story (PROJ-142: Implement SSO):                    │  │
│  │ • Requirement: "Microsoft SSO with MSAL"                 │  │
│  │   Source: Meeting 3, confirmed by Sarah Chen (CTO)       │  │
│  │ • Constraint: "Must work within Outlook add-in sandbox"  │  │
│  │   Source: Meeting 4, confirmed by IT Lead                │  │
│  │ • Assumption: "MFA not required for internal users"      │  │
│  │   ⚠️ Not confirmed by client — verify before implementing│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Architecture Decisions (4 made, 2 pending)                │  │
│  │                                                          │  │
│  │ ✅ Auth: MSAL.js v2 with silent refresh                   │  │
│  │ ✅ State: Redux Toolkit                                    │  │
│  │ ✅ API: REST (not GraphQL — client team more familiar)     │  │
│  │ ✅ Hosting: Azure App Service, EU region                   │  │
│  │ ⏳ Database: PostgreSQL vs CosmosDB (pending perf test)   │  │
│  │ ⏳ Caching: Redis vs in-memory (pending scale decision)   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Phase 3: Code View

```
┌─────────────────────────────────────────────────────────────────┐
│  CODE — NacXwan                                 Sprint 3 of 6   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Requirement Context                                       │  │
│  │                                                          │  │
│  │ Current task: Implement token refresh flow               │  │
│  │                                                          │  │
│  │ From Discovery:                                          │  │
│  │   "MSAL tokens for Outlook add-in, silent refresh        │  │
│  │    required. IT department confirmed SSO is mandatory."   │  │
│  │                                                          │  │
│  │ From Story/Tech:                                         │  │
│  │   Story PROJ-142: "As a user, I want single sign-on..."  │  │
│  │   Spec: Confluence/Auth-API-Contract                     │  │
│  │   Architecture: MSAL.js v2, silent refresh, popup fallback│  │
│  │                                                          │  │
│  │ From past projects:                                      │  │
│  │   ⚠️ "MSAL silent refresh fails in iframes — need popup  │  │
│  │      fallback" — learned in Project Acme, Code phase      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Decisions Made This Sprint                                │  │
│  │                                                          │  │
│  │ • Used in-memory token cache (faster than session storage)│  │
│  │ • Added popup fallback for iframe context                │  │
│  │ • Chose exponential backoff for token retry              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Phase 4: QA View

```
┌─────────────────────────────────────────────────────────────────┐
│  QA — NacXwan                                   78% pass rate   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Traceability Matrix                                       │  │
│  │                                                          │  │
│  │ Requirement          Story       Code      Tests  Status │  │
│  │ ─────────────────────────────────────────────────────────│  │
│  │ SSO Authentication   PROJ-142    PR #47    TC-089  ✅ PASS│  │
│  │ Token Refresh        PROJ-143    PR #48    TC-090  ✅ PASS│  │
│  │ Meeting Scheduling   PROJ-156    PR #52    TC-095  ❌ FAIL│  │
│  │ Video Integration    PROJ-160    —         —       ⏳ TODO│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Requirement Context for Failed Test                       │  │
│  │                                                          │  │
│  │ TC-095 FAILED: Meeting Scheduling — timezone edge case   │  │
│  │                                                          │  │
│  │ Discovery said: "Meetings scheduled in organizer's TZ"   │  │
│  │   Source: Meeting 4, confirmed by client                 │  │
│  │ Story said: "Display times in user's local timezone"     │  │
│  │ Code does: Converts to UTC, displays in browser TZ      │  │
│  │                                                          │  │
│  │ ⚠️ Possible spec mismatch: "organizer's TZ" vs           │  │
│  │    "user's local TZ" — flag for review                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Report Portal: [View Full Report]                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Chat Interface

Available in every phase. Context-aware — knows which phase the user
is in and what project they're working on.

```
┌──────────────────────────────────────────────────────────────┐
│  CHAT — NacXwan                              Phase: Code      │
│                                                              │
│  Developer: "What did the client say about timezone handling  │
│              in meeting scheduling?"                          │
│                                                              │
│  Crnogochi: "The client confirmed in Meeting 4 (Feb 10)     │
│  that meetings should be scheduled in the organizer's        │
│  timezone. Sarah Chen (CTO) specifically mentioned that      │
│  'all times should reflect the organizer's calendar.'        │
│                                                              │
│  Note: The Story/Tech spec (PROJ-156) says 'display in       │
│  user's local timezone.' This may be a discrepancy worth     │
│  clarifying with the Tech Lead.                              │
│                                                              │
│  Sources:                                                    │
│  - Discovery: Meeting 4 notes, line 34                       │
│  - Story/Tech: PROJ-156 description                          │
│  - Confluence: Scheduling-Feature-Spec, section 3.2"         │
│                                                              │
│  [Ask follow-up]  [Flag to Tech Lead]  [View sources]        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The chat can answer questions that span phases because it queries the
shared knowledge system — not just the current phase's data.

### 4. Document Browser

View and search all documents across all phases:

```
┌──────────────────────────────────────────────────────────────┐
│  DOCUMENTS — NacXwan                     [Search...        ] │
│                                                              │
│  Filter: [All Phases ▾] [All Types ▾] [All Dates ▾]        │
│                                                              │
│  Phase 1: Discovery                                          │
│  ├── Project Discovery Brief                    Feb 28       │
│  ├── MVP Scope Freeze                           Feb 28       │
│  ├── Functional Requirements                    Feb 28       │
│  ├── Meeting Summary — Meeting 5                Feb 25       │
│  ├── Meeting Summary — Meeting 4                Feb 10       │
│  └── Gap Analysis Report                        Feb 20       │
│                                                              │
│  Phase 2: Story/Tech                                         │
│  ├── Architecture Decision Record               Mar 5        │
│  ├── Auth API Contract (Confluence)             Mar 3        │
│  ├── decision — chose MSAL.js v2                Mar 4        │
│  └── learning — Outlook sandbox limitations     Mar 6        │
│                                                              │
│  Phase 3: Code                                               │
│  ├── decision — in-memory token cache           Mar 12       │
│  └── learning — iframe popup fallback           Mar 14       │
│                                                              │
│  Phase 4: QA                                                 │
│  └── (no documents yet)                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Cross-Phase Information Panels

Every phase view includes context from other phases. What each role sees:

### PO in Discovery sees:
- Past project insights from Code and QA phases
- "Features like this typically take X sprints to implement"
- "Common QA issues for this project type: ..."
- Downstream impact: how many stories were created from their requirements

### Tech Lead in Story/Tech sees:
- Full discovery context behind each requirement
- Who said what, when, with what confidence level
- Client repo analysis (architecture, existing integrations)
- Assumption flags: "this requirement was assumed, not confirmed"

### Developer in Code sees:
- Original requirement and its history
- Story details and acceptance criteria
- Architecture decisions and reasoning
- Past project learnings relevant to current task
- Spec documents from Confluence

### QA Engineer in QA sees:
- Full traceability: requirement → story → code → test
- Which requirements were assumptions (test more carefully)
- Spec discrepancies detected by the knowledge system
- Code decisions that might affect test approach
- Report Portal integration for results

---

## Notification System

Cross-phase events that trigger notifications:

| Event | Who gets notified | Why |
|-------|------------------|-----|
| Discovery assumption proven wrong in Code | PO, Tech Lead | Requirement may need revision |
| Spec discrepancy detected between phases | Tech Lead, PO | Story doesn't match discovery |
| Bug linked to discovery assumption | PO, QA Lead | Original assumption needs review |
| Architecture decision changes | All stakeholders | Affects downstream phases |
| Cross-project pattern match | Current phase user | "Similar project had this issue" |
| Phase handoff ready | Next phase team | Time to start their work |
| Regression in test results | Developer, QA Lead | Code change broke something |

---

## Key Design Principles

1. **Phase-first, project-wide.** Users work in their phase but see the full picture.
2. **Context, not noise.** Show cross-phase info that's relevant to the current task, not everything.
3. **Traceability built-in.** Every piece of information links back to its source across phases.
4. **Chat everywhere.** Natural language queries work across all phases and projects.
5. **Progressive disclosure.** Summary first, details on demand.
