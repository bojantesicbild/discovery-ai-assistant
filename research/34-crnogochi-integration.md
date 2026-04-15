# 34 — Integration with crnogochi-assistants (Unified AI Assistant)

> **Date:** 2026-04-03
> **Purpose:** Define how Discovery AI communicates with the working Unified Assistant
> **Source:** `/Users/bojantesic/git-tests/crnogochi-assistants/`

---

## 1. What crnogochi-assistants IS

A **working, installed, production-ready** Claude Code extension with:
- 3 domains: Coding, Tech Stories, QA
- 9 agents (setup, research, 3 story agents, 4 QA agents)
- 3 domain SKILL.md files with anti-rationalization, stage gates, scope lock
- Two-tier knowledge: `learnings.jsonl` (transient) + `docs/` (permanent, git-committed)
- Multi-domain active task router
- Templates for everything (24 files)
- Install scripts for Unix + Windows
- MCP integrations (context7, Atlassian, Figma, Chrome DevTools)

**This is the real system.** It's installed in project repos. Developers USE it daily.
The `.memory-bank/` files are the ACTUAL artifacts our Discovery AI needs to read and write.

---

## 2. The Integration Points

### What Discovery AI WRITES (→ consumed by crnogochi)

Discovery AI produces 3 handoff documents + seed files. The Unified Assistant
picks them up automatically via its Context Loading protocol.

| Discovery AI Output | Where It Goes in crnogochi | Consumed By |
|--------------------|---------------------------|-------------|
| **Discovery Brief** | `.memory-bank/docs/discovery/discovery-brief.md` | All domains (context loading) |
| **MVP Scope Freeze** | `.memory-bank/docs/discovery/mvp-scope-freeze.md` | All domains (context loading) |
| **Functional Requirements** | `.memory-bank/docs/discovery/functional-requirements.md` | tech-stories (story-tech-agent input) |
| **project-brief.md** (seed) | `.memory-bank/project-brief.md` | All domains (core context) |
| **tech-context.md** (seed) | `.memory-bank/tech-context.md` | Coding + QA domains |
| **system-patterns.md** (seed) | `.memory-bank/system-patterns.md` | Coding domain |
| **Research findings** | `.memory-bank/docs/research-sessions/` | research-agent (knowledge search) |
| **Decisions** | `.memory-bank/docs/decisions/` | All domains (knowledge search) |

### What Discovery AI READS (← produced by crnogochi)

When PO syncs the project repo, Discovery AI ingests these `.memory-bank/` files
into the `project-{id}-pipeline` RAGFlow dataset (v1.5).

| crnogochi Output | What Discovery AI Learns |
|-------------------|-------------------------|
| `docs/tech-docs/*.md` | What tech architecture was decided |
| `docs/completed-tasks/*.md` | What was implemented, by whom, outcome |
| `docs/decisions/*.md` | Technical decisions made during development |
| `docs/errors/*.md` | Problems encountered and solutions |
| `docs/best-practices/*.md` | Patterns that worked |
| `docs/system-architecture/*.md` | Architecture patterns discovered |
| `docs/test-cases/*.csv` | What's being tested |
| `docs/qa-analysis-reports/*.md` | Test analysis findings |
| `docs/reports/*.md` | Test execution results |
| `docs/defects/*.md` | Bugs found |
| `project-brief.md` | How project brief evolved |
| `system-patterns.md` | Architecture evolution |
| `tech-context.md` | Tech context evolution |

---

## 3. The Exact Integration Flow

### Flow A: Discovery → Development (handoff)

```
PO finishes discovery (85%+ readiness)
       │
       ▼
Discovery AI: /generate (doc-generator subagent)
       │
       ├── Generates 3 markdown documents
       ├── Generates .memory-bank/ seed files:
       │   ├── project-brief.md (from Discovery Brief)
       │   ├── tech-context.md (from MVP Scope, technical sections)
       │   └── system-patterns.md (from Functional Requirements, architecture)
       │
       ▼
PO downloads ZIP / Discovery AI commits to project repo
       │
       ▼
Developer opens project in Claude Code
       │
       ▼
crnogochi-assistants detects .memory-bank/ exists
  → Reads project-brief.md, tech-context.md, system-patterns.md
  → Reads docs/discovery/*.md
  → Ready to start Phase 2 with full context
       │
       ▼
Developer: "Create tech doc and stories for authentication"
  → tech-stories/SKILL.md activates
  → story-tech-agent reads discovery docs → produces 16-section tech doc
  → story-story-agent reads tech doc → breaks into user stories
```

### Flow B: Development → Discovery (feedback loop, v1.5)

```
Developer working in Phase 2-3-4
  → Creates tech docs, stories, test reports, defect records
  → All saved to .memory-bank/docs/ (git-committed)
       │
       ▼
PO clicks "Sync" in Discovery AI
  → Discovery AI pulls latest from git
  → Ingests .memory-bank/**/*.md into RAGFlow pipeline dataset
       │
       ▼
PO: "Is the auth requirement implemented and tested?"
  → Coordinator searches across all datasets:
    - client-docs: "Client required SSO" (Meeting 3)
    - items: Requirement FR-003 (SSO, Must, Confirmed)
    - pipeline: tech-docs/auth-module.md + completed-tasks/nop-42.md + test-cases/sso-tests.csv
  → "Yes, SSO is implemented (NOP-42) and tested (5/5 passing). No defects."
```

### Flow C: Discovery Reopened (gap found in later phase)

```
QA engineer discovers missing requirement during testing
  → Saves to .memory-bank/docs/defects/DEF-005.md
  → Notifies PO: "Auth doesn't handle MFA — was this in scope?"
       │
       ▼
PO opens Discovery AI
  → Syncs latest .memory-bank/
  → "The QA team found that MFA wasn't specified. What do we know?"
  → Agent searches:
    - No requirement for MFA exists
    - Assumption found: "SSO covers all auth needs"
    - Meeting 3 notes mention "might need MFA for admin"
  → "MFA was mentioned but never confirmed as a requirement.
     It's currently an unvalidated assumption.
     Suggested action: Confirm with client CTO."
       │
       ▼
PO contacts client, gets confirmation
  → Uploads new email to Discovery AI
  → Pipeline extracts: Requirement FR-015 (MFA for admin, Must)
  → Re-generates handoff docs with FR-015 included
  → Commits updated docs to project repo
       │
       ▼
Developer sees updated requirements
  → Creates implementation task for MFA
```

---

## 4. File Format Compatibility

### project-brief.md

crnogochi expects this format (from setup-agent):

```markdown
# Project Brief

## Project Name
[name]

## Overview
[what the project does]

## Core Requirements
[key things it must do]

## Technical Constraints
[known limitations]

## Team & Stakeholders
[who's involved]
```

Discovery AI generates this by mapping:
- Project Name → from project settings
- Overview → from Discovery Brief §2 (Business Context)
- Core Requirements → top MUST requirements from extraction
- Technical Constraints → confirmed constraints
- Team & Stakeholders → extracted stakeholders with roles

### tech-context.md

crnogochi expects:

```markdown
# Technical Context

## Tech Stack
[languages, frameworks, databases]

## Architecture Pattern
[monolith, microservices, etc.]

## Key Dependencies
[external services, APIs]

## Development Environment
[how to run locally]

## Deployment
[hosting, CI/CD]
```

Discovery AI generates this by mapping:
- Tech Stack → from technology decisions
- Architecture Pattern → from technical constraints/decisions
- Key Dependencies → from integration requirements + decisions
- Development Environment → "To be defined in Phase 2"
- Deployment → from hosting/deployment constraints

### system-patterns.md

crnogochi expects:

```markdown
# System Patterns

## Architecture Overview
[high-level architecture]

## Key Patterns
[patterns used: MVC, event-driven, etc.]

## Integration Points
[how system connects to others]

## Data Model
[key entities and relationships]
```

Discovery AI generates this by mapping:
- Architecture Overview → from scope items + technical decisions
- Key Patterns → "To be refined in Phase 2"
- Integration Points → from integration requirements
- Data Model → from entity graph (if available from extraction)

---

## 5. Knowledge Search Compatibility

crnogochi's Knowledge Search (CLAUDE.md line 60-72) searches these directories:

```
docs/completed-tasks/    → Similar past work
docs/system-architecture/ → Architecture patterns
docs/best-practices/     → Guidelines
docs/decisions/          → Technical decisions
docs/errors/             → Known solutions
docs/research-sessions/  → Research findings
learnings.jsonl          → Transient observations
```

**Discovery AI can write to ALL of these** during the seed generation:

| Directory | What Discovery AI Writes |
|-----------|------------------------|
| `docs/research-sessions/` | Web research findings (company analysis, competitor research, industry trends) |
| `docs/decisions/` | Decisions made during discovery (CTO chose Azure, client confirmed SSO) |
| `docs/system-architecture/` | Architecture patterns identified from client requirements |

These get picked up by crnogochi's knowledge search automatically.
No changes to crnogochi needed.

---

## 6. What Discovery AI Needs to Generate (Seed Package)

### The Complete Seed

When PO clicks "Generate handoff package," Discovery AI produces:

```
.memory-bank/
├── project-brief.md              ← Generated from Discovery Brief
├── tech-context.md               ← Generated from technical constraints + decisions
├── system-patterns.md            ← Generated from architecture decisions + integrations
├── docs/
│   ├── discovery/                ← The 3 handoff documents
│   │   ├── discovery-brief.md
│   │   ├── mvp-scope-freeze.md
│   │   └── functional-requirements.md
│   ├── research-sessions/        ← Web research done during discovery
│   │   ├── YYYY-MM-DD_research_company-analysis.md
│   │   └── YYYY-MM-DD_research_competitor-review.md
│   └── decisions/                ← Decisions made during discovery
│       ├── YYYY-MM-DD_decision_hosting-azure.md
│       └── YYYY-MM-DD_decision_auth-sso.md
```

### What It Does NOT Generate

- `active-task.md` / `active-tasks/*.md` → Created by setup-agent
- `learnings.jsonl` → Per-developer, not seeded
- `testing-standards.md` → Created by QA domain on first use
- `docs/completed-tasks/` → Created during development
- Any `.claude/` files → These are the assistant infrastructure, never touched

---

## 7. Implementation in Discovery AI

### New Subagent Tool: generate_handoff_package

```python
@coordinator.tool
async def generate_handoff_package(ctx: RunContext[Deps]) -> str:
    """Generate the complete handoff package for Phase 2-4.
    Produces: 3 discovery documents + .memory-bank/ seed files.
    Returns a ZIP download link."""

    project = await ctx.deps.db.get_project(ctx.deps.project_id)
    requirements = await ctx.deps.db.get_all_requirements(ctx.deps.project_id)
    constraints = await ctx.deps.db.get_all_constraints(ctx.deps.project_id)
    decisions = await ctx.deps.db.get_all_decisions(ctx.deps.project_id)
    stakeholders = await ctx.deps.db.get_all_stakeholders(ctx.deps.project_id)
    assumptions = await ctx.deps.db.get_all_assumptions(ctx.deps.project_id)
    scope_items = await ctx.deps.db.get_all_scope_items(ctx.deps.project_id)

    # Generate 3 handoff documents (doc-generator subagent)
    docs = await doc_generator.run(
        "Generate all 3 discovery documents.",
        deps=ctx.deps,
    )

    # Generate .memory-bank/ seed files
    project_brief = generate_project_brief(project, requirements, stakeholders)
    tech_context = generate_tech_context(constraints, decisions)
    system_patterns = generate_system_patterns(decisions, requirements, scope_items)

    # Collect research sessions and decisions as markdown files
    research_files = format_research_as_markdown(ctx.deps.project_id)
    decision_files = format_decisions_as_markdown(decisions)

    # Package as ZIP
    package = {
        ".memory-bank/project-brief.md": project_brief,
        ".memory-bank/tech-context.md": tech_context,
        ".memory-bank/system-patterns.md": system_patterns,
        ".memory-bank/docs/discovery/discovery-brief.md": docs.output.brief,
        ".memory-bank/docs/discovery/mvp-scope-freeze.md": docs.output.scope,
        ".memory-bank/docs/discovery/functional-requirements.md": docs.output.requirements,
        **research_files,
        **decision_files,
    }

    zip_path = save_handoff_zip(ctx.deps.project_id, package)
    return f"Handoff package ready: {zip_path} ({len(package)} files)"
```

---

## 8. What Changes in crnogochi-assistants

### Almost Nothing (v1)

For MVP handoff (Option A — manual), **zero changes** to crnogochi needed:
- PO places discovery files in `.memory-bank/docs/discovery/`
- PO updates `project-brief.md`, `tech-context.md`, `system-patterns.md`
- crnogochi reads them via existing context loading protocol

### Small Addition (v1.5)

Add `docs/discovery/` to crnogochi's knowledge search so agents find discovery docs:

```markdown
# In CLAUDE.md, Knowledge Search section, add:
- `docs/discovery/` — Discovery phase artifacts (requirements, scope, brief)
```

That's a **one-line change** to CLAUDE.md. Everything else works as-is.

### Optional Enhancement (v2)

Add a "discovery" domain to the Domain Detection table:

```markdown
| discovery refresh, update requirements, sync discovery | discovery | Load discovery sync skill |
```

With a `discovery/SKILL.md` that handles:
- Pulling latest from Discovery AI
- Updating seed files
- Flagging requirement changes for the team

---

## 9. The Full Pipeline (Both Systems Working Together)

```
CLIENT                  DISCOVERY AI               CRNOGOCHI-ASSISTANTS
──────                  ────────────               ─────────────────────

Meetings ──────►  PO uploads docs
Emails   ──────►  Pipeline extracts typed
Documents ─────►  data (requirements,
                  constraints, decisions)
                       │
                  PO uses chat:
                  gaps, meeting prep
                       │
                  Readiness 85%+
                       │
                  Generate handoff     ──►  .memory-bank/ seeded:
                  package (ZIP)             project-brief.md
                                           tech-context.md
                                           system-patterns.md
                                           docs/discovery/*.md
                                           docs/decisions/*.md
                                           docs/research-sessions/*.md
                                                │
                                           Developer opens Claude Code
                                                │
                                           "Create tech doc and stories
                                            for authentication"
                                                │
                                           story-tech-agent reads
                                           discovery docs → tech doc
                                                │
                                           story-story-agent reads
                                           tech doc → user stories
                                                │
                                           Developer implements code
                                           (coding/SKILL.md)
                                                │
                                           QA analyzes and tests
                                           (qa/SKILL.md)
                                                │
                  ◄── PO syncs ────────    All artifacts in
                  .memory-bank/            .memory-bank/docs/
                       │
                  PO: "Is auth done?"
                  → Cross-phase search
                  → "Yes, implemented
                     and tested"
```

---

## 10. Summary

| Question | Answer |
|----------|--------|
| **What does Discovery AI write?** | 3 handoff docs + `.memory-bank/` seed (project-brief, tech-context, system-patterns, research, decisions) |
| **What does Discovery AI read?** | All `.memory-bank/docs/` files (tech-docs, completed-tasks, test-cases, defects, etc.) via pipeline sync |
| **Changes needed in crnogochi?** | **Zero for MVP.** One line for v1.5 (add `docs/discovery/` to knowledge search). |
| **Format compatibility?** | Discovery AI generates files in the exact format crnogochi expects |
| **How does handoff work?** | PO downloads ZIP → places in repo (MVP). Or Discovery AI commits directly (v1.5). |
| **How does feedback flow back?** | PO clicks "Sync" → Discovery AI ingests latest `.memory-bank/` (v1.5) |
| **Is bidirectional?** | MVP: one-way (discovery → dev). v1.5: bidirectional (discovery ↔ dev) |
