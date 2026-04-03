# 27 — Pipeline Integration: Discovery AI → Unified Assistant (Phases 2-4)

> **Date:** 2026-04-02
> **Purpose:** Define how Discovery AI Assistant output connects to the existing
> Unified AI Assistant pipeline (tech-stories, coding, QA)
> **Source:** `/Users/bojantesic/git-tests/ai-coding-assistant/UNIFIED-ASSISTANT-IMPLEMENTATION-GUIDE.md`

---

## 1. The Full Pipeline

```
PHASE 1                     PHASE 2                    PHASE 3              PHASE 4
Discovery AI Assistant      Unified AI Assistant        Unified AI Assistant  Unified AI Assistant
(our product — web app)     (tech-stories domain)       (coding domain)      (qa domain)
                            (Claude Code, local)        (Claude Code, local)  (Claude Code, local)
─────────────────────       ─────────────────────       ──────────────────   ──────────────────
PO uploads docs,            PO + Tech Lead use          Developers use       QA engineers use
chats with agent,           Claude Code locally to      Claude Code to       Claude Code for
generates discovery         create tech docs +          implement code       test analysis,
documents                   user stories                                     automation, reports

Output:                     Input:                      Input:               Input:
• Discovery Brief      ──►  • Discovery Brief           • Tech docs          • Code repo
• MVP Scope Freeze     ──►  • MVP Scope Freeze          • User stories       • User stories
• Functional Reqs      ──►  • Functional Requirements   • Tech specs         • Tech docs
                            Output:                     Output:              Output:
                            • Tech documentation        • Code               • Test cases
                            • User stories / PBIs       • Architecture       • Test reports
                            • Sprint dashboard          • APIs               • Defect reports
```

### Key Difference

| Aspect | Discovery AI (Phase 1) | Unified Assistant (Phase 2-4) |
|--------|----------------------|------------------------------|
| **Runtime** | Web application (FastAPI + Agent SDK) | Local CLI (Claude Code) |
| **Users** | POs, BDs (non-technical) | Devs, Tech Leads, QA (technical) |
| **Knowledge** | RAGFlow + PostgreSQL (server) | `.memory-bank/` files (local, git-committed) |
| **State** | PostgreSQL DB + Redis | `.memory-bank/active-tasks/*.md` files |
| **Output** | Generated markdown documents | Code, specs, stories, tests |
| **Sharing** | Multi-user via web UI | Git-committed files in repo |

---

## 2. The Handoff Point

Discovery AI produces 3 documents. The Unified Assistant consumes them.

### What Discovery Produces (our output)

```markdown
# Project Discovery Brief - NacXwan
## 1. Client Overview (company, contacts, decision authority)
## 2. Business Context (pain point, objectives, KPIs, timeline, budget)
## 3. Target Users (personas, goals, pain points)
## 4. Competitive / Market Context
## 5. Discovery Status (completeness %, assumptions, open questions)

# MVP Scope Freeze - NacXwan
## 1. Purpose & MVP Goal
## 2. Supported Platforms & Entry Points
## 3. Authentication & User Identity
## 4. Core Functionalities (feature list with descriptions)
## 5. Integration Points
## 6. Deployment & Distribution
## 7. UI/UX Scope
## 8. Out of Scope (explicit exclusion list)
## 9. Assumptions & Risks
## 10. Sign-off

# Functional Requirements - NacXwan
## 1. Overview (description, business objective, target users)
## 2. User Roles & Permissions (table)
## 3. Functional Requirements (FR-001, FR-002... with priority, description, user stories, business rules)
## 4. Non-Functional Requirements (performance, security, scalability)
## 5. Technical Context (existing systems, constraints, hosting)
## 6. Assumptions
## 7. Dependencies
## 8. Out of Scope
## 9. Glossary
```

### What Unified Assistant Consumes (their input)

The tech-stories domain (Phase 2) starts with:
1. **01-tech-agent** reads discovery docs → produces 16-section tech documentation
2. **02-story-agent** (Mode A) reads tech doc → breaks down into stories with acceptance criteria
3. **02-story-agent** (Mode B) creates stories in the project repo / publishes to Jira
4. **03-dashboard-agent** generates sprint dashboard

The tech-agent needs structured discovery docs to produce structured tech docs.

---

## 3. Integration Options

### Option A: Manual File Handoff (MVP)

```
Discovery AI → PO downloads 3 markdown files → PO places them in project repo
→ PO opens Claude Code → "Create tech doc from discovery documents"
→ tech-stories/SKILL.md activates → 01-tech-agent reads the files
```

**Implementation:**
- Discovery AI `/generate` skill produces markdown files matching the exact templates above
- PO downloads as ZIP (project export feature from research/24)
- PO places in project repo under `docs/discovery/` or `.memory-bank/docs/`
- Tech-agent knows to look there

**Pros:** Zero integration work. Works today.
**Cons:** Manual step. PO might forget to update. Files might drift from DB state.

### Option B: Git Integration (v1.5)

```
Discovery AI → auto-commits discovery docs to project repo
→ Unified Assistant reads them as part of its .memory-bank/
```

**Implementation:**
- Discovery AI has git access to the project repo (configured per project)
- When PO says "generate and sync docs," the agent:
  1. Generates the 3 discovery documents
  2. Commits them to `docs/discovery/` in the project repo
  3. Also updates `.memory-bank/project-brief.md` with discovery summary
- Unified Assistant picks them up automatically on next session

**Pros:** Seamless. Always up to date. Version history in git.
**Cons:** Needs git credentials per project. Merge conflicts if PO edits locally.

### Option C: Memory Bank Seeding (v1.5)

```
Discovery AI → generates .memory-bank/ files directly
→ Unified Assistant starts with pre-populated knowledge
```

**Implementation:**
Discovery AI doesn't just produce the 3 handoff docs — it produces the
entire `.memory-bank/` structure that Phase 2-4 assistants expect:

```
.memory-bank/
├── project-brief.md          ← generated from Discovery Brief
├── system-patterns.md        ← generated from Functional Requirements (architecture section)
├── tech-context.md           ← generated from MVP Scope Freeze (tech sections)
├── docs/
│   ├── research-sessions/    ← discovery research (web research, code analysis)
│   └── decisions/            ← decisions made during discovery
└── docs/discovery/           ← the 3 raw handoff documents
    ├── discovery-brief.md
    ├── mvp-scope-freeze.md
    └── functional-requirements.md
```

**This is the strongest option** because:
- Phase 2 gets pre-populated context (not just raw docs to parse)
- `project-brief.md` already has the summary the Unified Assistant needs
- `tech-context.md` already has technical constraints
- `system-patterns.md` already has architecture patterns identified during discovery
- Discovery research (competitor analysis, code repo analysis) feeds into `research-sessions/`
- Decisions made during discovery feed into `decisions/`

**Pros:** Phase 2 starts with rich context, not a cold start. Seamless integration.
**Cons:** Discovery AI needs to understand `.memory-bank/` format. More to generate.

---

## 4. Recommendation: Option A for MVP, Option C for v2

### MVP (Option A — manual handoff)

The `/generate` skill produces 3 markdown files. PO downloads and places in repo.
Zero integration code needed.

**What we need to ensure:**
1. Our output templates (research/04) match what 01-tech-agent expects as input
2. The markdown structure is clean, parseable, and consistent
3. Assumptions are clearly marked (the tech-agent uses these to flag uncertainties)
4. The glossary is populated (the tech-agent uses it for consistent terminology)

### v2 (Option C — memory bank seeding)

Discovery AI produces not just 3 docs but the full `.memory-bank/` seed:

```python
# New subagent or tool

@tool
def generate_memory_bank_seed(project_id: str) -> str:
    """Generate .memory-bank/ files for the Unified AI Assistant.
    Creates: project-brief.md, system-patterns.md, tech-context.md,
    plus discovery documents in docs/discovery/."""

    # Pull data from all knowledge layers
    facts = await search_facts(project_id=project_id, query="*")
    control_points = await get_control_points(project_id=project_id)
    context = await get_project_context(project_id=project_id)

    # Generate project-brief.md (summary for Phase 2 developers)
    brief = generate_project_brief(context, facts)

    # Generate tech-context.md (technical constraints, integrations, hosting)
    tech_ctx = generate_tech_context(facts, category="technical")

    # Generate system-patterns.md (architecture patterns from discovery)
    patterns = generate_system_patterns(facts, category="architecture")

    # Package as ZIP
    seed = {
        "project-brief.md": brief,
        "tech-context.md": tech_ctx,
        "system-patterns.md": patterns,
        "docs/discovery/discovery-brief.md": generate_discovery_brief(...),
        "docs/discovery/mvp-scope-freeze.md": generate_mvp_scope(...),
        "docs/discovery/functional-requirements.md": generate_func_reqs(...),
    }

    # Add research sessions if web research was done
    for research in get_research_sessions(project_id):
        seed[f"docs/research-sessions/{research.filename}"] = research.content

    # Add decisions made during discovery
    for decision in get_decisions(project_id):
        seed[f"docs/decisions/{decision.filename}"] = decision.content

    return save_as_zip(seed)
```

---

## 5. Knowledge Flow Between Phases

### What Flows Forward (Discovery → Phase 2-4)

| Knowledge | Discovery Source | Memory Bank Target | Used By |
|-----------|-----------------|-------------------|---------|
| Project summary | Discovery Brief | `project-brief.md` | All phases — context loading |
| Technical constraints | MVP Scope (tech sections) | `tech-context.md` | Coding, QA |
| Architecture patterns | Functional Reqs (tech context) | `system-patterns.md` | Coding |
| Feature list | Functional Reqs (FR-001...) | Discovery docs | Tech-stories (story breakdown) |
| User roles | Functional Reqs (user roles table) | Discovery docs | Stories, QA |
| Integration points | MVP Scope (integrations) | `tech-context.md` | Coding, QA |
| Assumptions | All docs (clearly marked) | Discovery docs | Tech-stories (flags them) |
| Glossary | Functional Reqs (glossary) | Discovery docs | All phases |
| Competitor research | Web research findings | `docs/research-sessions/` | Context for all phases |
| Code analysis | Code repo analysis | `docs/research-sessions/` | Coding (tech context) |
| Decisions | Control points resolved | `docs/decisions/` | All phases |

### What Flows Back (Phase 2-4 → Discovery)

Sometimes Phase 2 discovers gaps that discovery missed:

| Scenario | What Happens |
|----------|------------|
| Tech Lead finds missing requirement during story creation | Flags it in story comments. PO reopens discovery project. |
| Developer finds API incompatibility during coding | Logs in `.memory-bank/docs/errors/`. PO adds info to discovery project. |
| QA finds untested edge case | Files defect. PO may need client clarification → back to discovery. |

**For MVP:** This is manual. PO reopens Discovery AI, adds new info, re-generates docs.
**For v2:** Bidirectional sync — Unified Assistant can push findings back to Discovery AI via webhook or shared git.

---

## 6. Format Alignment

### Discovery Output → Tech-Agent Input Mapping

The 01-tech-agent produces a 16-section tech doc. Here's what it needs from discovery:

| Tech Doc Section | Discovery Source | Available? |
|-----------------|-----------------|-----------|
| 1. Document Information | Project metadata | ✅ From Discovery Brief |
| 2. Overview & Context | Business Context + Problem Statement | ✅ From Discovery Brief §2 |
| 3. Scope & Objectives | MVP Scope Freeze §1 | ✅ |
| 4. Constraints & Assumptions | MVP Scope §9 + Functional Reqs §6 | ✅ |
| 5. Architecture & Technology | Functional Reqs §5 (Tech Context) | ✅ But might be sparse if client didn't specify |
| 6. Key Features | Functional Reqs §3 (FR-001...) | ✅ |
| 7. Data Model & Storage | Depends on discovery depth | ⚠️ Only if client discussed data |
| 8. API Design | MVP Scope §5 (Integration Points) | ⚠️ Partial — integrations listed, not designed |
| 9. Authentication & Security | MVP Scope §3 + Functional Reqs §4 | ✅ |
| 10. Third-party Integrations | MVP Scope §5 | ✅ |
| 11. Testing Strategy | Functional Reqs §4 (NFRs) | ⚠️ Partial — requirements stated, not strategy |
| 12. Deployment & DevOps | MVP Scope §6 | ✅ |
| 13. Performance Requirements | Functional Reqs §4 (NFRs) | ✅ If client specified |
| 14. Monitoring & Logging | May not be in discovery | ❌ Rarely discussed in discovery |
| 15. Error Handling | May not be in discovery | ❌ Rarely discussed in discovery |
| 16. Resources & References | Glossary + external links | ✅ |

**Key insight:** Sections 7, 8, 11, 14, 15 are typically NOT fully covered by discovery — they're designed during Phase 2. This is expected and correct. Discovery provides the BUSINESS requirements; Phase 2 adds the TECHNICAL design.

Our `/generate` skill should produce documents that clearly mark which sections have content and which are "to be determined in Phase 2." This prevents the tech-agent from hallucinating missing technical details.

---

## 7. Shared Patterns Between Discovery AI and Unified Assistant

Both systems use the same foundational patterns:

| Pattern | Discovery AI (our product) | Unified Assistant (existing) |
|---------|--------------------------|------------------------------|
| **Anti-rationalization** | In SKILL.md prompts per subagent | In every checkpoint in every SKILL.md |
| **Stage gates** | Pipeline stages with checkpoints | Stage gates with single exits |
| **Scope lock** | "User sovereignty" (ETHOS.md, gstack) | Post-checkpoint contract |
| **Fix-First** | Gap classification (AUTO-RESOLVE/ASK) | MECHANICAL/JUDGMENT classification |
| **Three-strikes** | Pipeline retry limit | Three-strikes escalation |
| **Knowledge tiers** | RAGFlow search (tier 1) + PostgreSQL facts (tier 2) | JSONL transient (tier 1) + docs/ permanent (tier 2) |
| **Learnings** | Per-project learnings in PostgreSQL | learnings.jsonl per developer |
| **Confidence scoring** | Facts have high/medium/low confidence | Learnings have 1-10 confidence + decay |
| **Template-driven output** | 3 discovery document templates | 16-section tech doc + story templates + QA templates |
| **Description-as-trigger** | Subagent descriptions are triggers | Agent descriptions are triggers |

### Key Difference: Server vs Local

Discovery AI stores knowledge in **a server database** (PostgreSQL + RAGFlow).
Unified Assistant stores knowledge in **local files** (`.memory-bank/`).

The handoff translates: server DB → local files. This is the `.memory-bank/` seed.

---

## 8. What We Should Build for Integration

### MVP (Week 7-8, part of frontend polish)

1. **Export as ZIP** — `/generate` produces the 3 markdown documents as downloadable files
2. **Format validation** — ensure output matches templates exactly (research/04)
3. **Assumption markers** — every generated doc clearly marks `[ASSUMPTION]` vs `[CONFIRMED]`
4. **Glossary completeness** — extract all project-specific terms from facts
5. **"Handoff checklist"** — when readiness > 85%, show checklist:
   - [ ] Discovery Brief generated and reviewed
   - [ ] MVP Scope Freeze generated and reviewed
   - [ ] Functional Requirements generated and reviewed
   - [ ] Assumptions reviewed with client
   - [ ] Documents downloaded / committed to repo
   - [ ] Phase 2 team notified

### v2 (Post-MVP)

1. **Memory bank seed generator** — produce full `.memory-bank/` structure
2. **Git integration** — auto-commit discovery docs to project repo
3. **Bidirectional feedback** — webhook for Phase 2-4 to report gaps back to discovery
4. **Discovery → tech-stories pipeline automation** — PO clicks "Start Phase 2" → system generates `.memory-bank/`, Tech Lead opens Claude Code, context is already there

---

## 9. Action Items Before MVP

| # | Action | Why | Effort |
|---|--------|-----|--------|
| 1 | Validate output templates match tech-agent expectations | If format is wrong, Phase 2 breaks | 1-2 hours |
| 2 | Add `[ASSUMPTION]` / `[CONFIRMED]` markers to generated docs | Tech-agent uses these to flag uncertainties | Built into /generate prompt |
| 3 | Ensure glossary is always populated | Tech-agent uses glossary for terminology | Built into /generate prompt |
| 4 | Add "Phase 2 handoff" section to Discovery Brief | Tells Phase 2 team what's covered and what's not | Built into template |
| 5 | Test: feed generated discovery docs into tech-agent manually | Verify end-to-end pipeline works | 2-3 hours |
