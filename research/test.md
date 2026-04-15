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