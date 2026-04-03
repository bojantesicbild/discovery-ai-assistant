# Unified AI Assistant

Multi-domain AI assistant system for Claude Code, merging coding, tech-stories, and QA capabilities into a single composable architecture.

## Domains

| Domain | Purpose | Agents |
|--------|---------|--------|
| **Coding** | Software implementation, bug fixes, refactoring | setup-agent, research-agent |
| **Tech Stories** | Tech docs, user stories, sprint dashboards | story-tech-agent, story-story-agent, story-dashboard-agent |
| **QA** | Test analysis, automation, reporting, defects | qa-analysis-planning-agent, qa-automation-agent, qa-reporting-agent, qa-defect-management-agent |

## Architecture

- **Slim shared core** (`CLAUDE.md`) — domain detection, context loading, knowledge search (~150 lines)
- **Domain skills** (`.claude/skills/[domain]/SKILL.md`) — domain-specific workflows, gates, checkpoints
- **Shared agents** — setup, research (archival handled inline by orchestrator)
- **Domain agents** — specialized per domain, prefixed with domain name
- **Two-tier knowledge** — transient JSONL (per-developer) + permanent markdown (git-committed)
- **Multi-domain active tasks** — each domain has its own task file, coexisting without conflict

## Installation

```bash
# Unix/macOS
./install.sh

# Windows PowerShell
./install.ps1
```

## Quick Start

```
# Initialize a new project
Use setup-agent to initialize memory bank

# Coding tasks
fix the login button alignment

# Tech documentation pipeline
create tech doc and stories for authentication

# QA testing
analyze NOP-50
```

## MCP Integrations (Optional)

- **context7** — Real-time library documentation
- **mcp-atlassian** — Jira/Confluence integration
- **figma** — Design analysis (Official Figma MCP)
- **chrome-devtools** — Browser debugging

## Directory Structure

```
CLAUDE.md                    # Shared orchestration core
.claude/
├── agents/                  # All agent definitions (9 agents)
├── skills/                  # Domain orchestration
│   ├── coding/SKILL.md
│   ├── tech-stories/SKILL.md
│   └── qa/SKILL.md
├── templates/               # All templates (24 files)
├── scripts/                 # Automation scripts
└── settings.json

.memory-bank/                # Knowledge store (created per-project)
├── active-task.md           # Domain router
├── active-tasks/            # Per-domain task tracking
├── learnings.jsonl          # Tier 1: transient (.gitignored)
├── project-brief.md         # Project foundation
├── system-patterns.md       # Architecture overview
├── tech-context.md          # Technology constraints
└── docs/                    # Tier 2: permanent (git-committed)
    ├── completed-tasks/
    ├── research-sessions/
    ├── best-practices/
    ├── decisions/
    ├── errors/
    ├── system-architecture/
    ├── tech-docs/
    ├── test-cases/
    ├── qa-analysis-reports/
    ├── reports/
    └── defects/
```

## Part of Bild's AI Pipeline

This is Phases 2-4 of a 4-phase AI-assisted development pipeline:

1. **Discovery AI** (web app) — PO uploads docs, generates discovery artifacts
2. **Unified Assistant / Tech Stories** — Tech docs + user stories
3. **Unified Assistant / Coding** — Implementation
4. **Unified Assistant / QA** — Testing, reporting, defects
