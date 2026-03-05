# Discovery Output → Next Phases

## The Pipeline

Each phase is run by **different people** using **different assistants**.

```
Phase 1: DISCOVERY ASSISTANT        ← WE BUILD THIS
         Run by: POs, BDs
         Input: client meetings, emails, docs
         Output: Discovery Brief + MVP Scope + Functional Requirements
              │
              │  (PO hands docs over to next team)
              ▼
Phase 2: STORY/TECH DOC ASSISTANT   ← EXISTS
         Run by: POs, Tech Leads
         Input: discovery docs from Phase 1
         Output: user stories, PBIs, tech specs, design specs
              │
              ▼
Phase 3: CODE ASSISTANT             ← EXISTS
         Run by: Developers
         Input: tech + story docs from Phase 2
         Output: code, architecture, APIs, DB schemas
              │
              ▼
Phase 4: QA ASSISTANT               ← EXISTS
         Run by: QA Engineers
         Input: code repo + docs from Phases 2-3
         Output: test plans, test cases, bug reports
```

## What Discovery Must Produce

Three key documents that Phase 2 users feed into the Story/Tech Doc Assistant:

| Document | What it covers | Why Phase 2 needs it |
|----------|---------------|---------------------|
| **Project Discovery Brief** | Client, business context, users, market | Big picture understanding |
| **MVP Scope Freeze** | What's in/out, platforms, integrations, deployment | Boundaries and constraints |
| **Functional Requirements** | Features, priorities, business rules, NFRs, tech context | Detail for story/spec generation |

Supporting docs (used by PO during discovery, may also be shared):

| Document | Purpose |
|----------|---------|
| Meeting Summaries | Decision log |
| Gap Analysis Reports | What's still missing |
| Multi-Perspective Analysis | Deep dives on complex features |

## Quality Bar

Discovery docs are good enough for handoff when:
- Phase 2 user can understand the project without asking the PO basic questions
- Assumptions are clearly labeled (so Story/Tech Doc Assistant can flag them)
- Scope is explicit — what's in, what's out, no grey areas
- Control points checklist is substantially complete (Phase 1-4)
