# Unified AI Assistant

## Domain Detection (EXECUTE FIRST)

Every user message MUST be classified into a domain. Match the FIRST row that fits:

| Keywords | Domain | Load |
|----------|--------|------|
| fix, implement, build, refactor, add feature, bug, code | coding | `.claude/skills/coding/SKILL.md` |
| tech doc, stories, breakdown, pipeline, dashboard, sprint, document | tech-stories | `.claude/skills/tech-stories/SKILL.md` |
| analyze, qa, automate, report, defect, debug, test cases | qa | `.claude/skills/qa/SKILL.md` |
| discovery, readiness, gaps, requirements, client said, meeting prep, handoff, constraints, stakeholders, scope | discovery | `.claude/skills/discovery/SKILL.md` |
| research, investigate, compare (no action verb) | — | Use research-agent directly |
| archive | — | Execute Archival Protocol (below) |
| setup, init | — | Use setup-agent directly |
| question (no work implied) | — | Answer directly |

After domain detection, **READ the matching SKILL.md and follow its rules**.

Asserting you loaded a SKILL.md without actually reading it is a false claim — the rules differ per domain, and guessing them produces wrong behavior.

### Compound Requests
If message contains keywords from MULTIPLE domains:
- Classify as the earliest-phase domain (research → coding → stories → QA)
- Note subsequent domains for after completion

### Ambiguous Messages
If intent is unclear, ask:
> "What would you like me to do?
> (a) [Domain A action]
> (b) [Domain B action]
> (c) Explain / research first"

---

## Active Task Router

1. Read `.memory-bank/active-task.md`
2. Different domain in-progress → OK, both coexist
3. SAME domain in-progress for DIFFERENT story/task → show conflict prompt:
   > (a) Archive current as complete → start new
   > (b) Continue current task
   > (c) Cancel
4. Domain-specific tracking: `.memory-bank/active-tasks/[domain].md`
5. Stale detection: if task >24h old, show resume prompt

---

## Context Loading (All Domains)

For any task, load:
- `.memory-bank/project-brief.md`
- `.memory-bank/system-patterns.md`
- `.memory-bank/tech-context.md`
- `.memory-bank/active-task.md` (router)
- `.memory-bank/active-tasks/[domain].md`
- `.memory-bank/learnings.jsonl` (top 5 relevant entries)

---

## Knowledge Search (All Domains)

Recommending an approach without checking past work is presenting uninformed opinion as informed recommendation.

Search these locations and show results to user:
- `docs/completed-tasks/` — Similar past work
- `docs/system-architecture/` — Architecture patterns
- `docs/best-practices/` — Guidelines
- `docs/decisions/` — Technical decisions
- `docs/errors/` — Known solutions
- `docs/research-sessions/` — Research findings
- `docs/discovery/` — Discovery phase handoff documents
- `learnings.jsonl` — Transient observations (Tier 1)

Score each result 1-10 on relevance. Show 6+ results. Suppress below 6 unless user asks.

Flag knowledge last validated >90 days ago:
> "Warning: This knowledge was last validated [X] days ago. Verify before applying."

---

## Completion Prompt (All Domains)

After ANY file changes, show:
> "Task completed. Archive? (yes/no)"

Asserting completion without showing this prompt is a false claim — the prompt is how you verify completion with the user. Skipping it means asserting something you haven't confirmed.

---

## Archival Protocol (orchestrator executes directly)

When user says "archive" or confirms archival at completion:

1. **Read router** — `.memory-bank/active-task.md` → identify current domain
2. **Update domain task** — fill remaining sections in `active-tasks/[domain].md` (status, completion details)
3. **Copy to archive** — `cp .memory-bank/active-tasks/[domain].md .memory-bank/docs/completed-tasks/YYYY-MM-DD_[category]_[task-name]-task.md`
4. **Reset domain task** — `cp .claude/templates/active-task-[domain].template.md .memory-bank/active-tasks/[domain].md`
5. **Update router** — set domain row to `idle` in `active-task.md`
6. **Update indexes** — run `.claude/scripts/update-archive-stats.sh`
7. **Promote learnings?** — ask user: "Any insights worth saving to permanent knowledge (docs/)?"

Only reset the archived domain's task file — never touch other domains.

---

## Knowledge Capture

When capturing knowledge (errors, practices, decisions):
- Ask: "Would this save 5+ minutes in a future session?"
- **YES** → Save to `docs/` (Tier 2, permanent, git-committed)
- **MAYBE** → Append to `learnings.jsonl` (Tier 1, transient, decaying)
- **NO** → Don't save

---

## Core File Update Detection

Proactively detect when core memory bank files need updating:
- **Tech/dependency changes** → update `tech-context.md`
- **Architecture decisions** → update `system-patterns.md`
- **Scope/objective changes** → update `project-brief.md`

---

## Shared Agents

| Agent | Use When |
|-------|----------|
| setup-agent | `.memory-bank/` doesn't exist or user says "setup"/"init" |
| research-agent | Unfamiliar tech, multiple approaches, security/perf critical, or user requests research |

---

## Agent Handoff Protocol

Every agent MUST provide upon completion:
1. **Work Summary** — files created/modified with clickable paths
2. **Context Transfer** — key findings, file references, blockers
3. **Next Steps** — exact commands with context

---

## File Structure
```
.claude/
├── agents/           # All agent definitions
├── skills/           # Domain orchestration
│   ├── coding/SKILL.md
│   ├── tech-stories/SKILL.md
│   └── qa/SKILL.md
├── templates/        # All templates
└── scripts/          # Automation scripts

.memory-bank/
├── active-task.md              # Router file (~15 lines)
├── active-tasks/               # Domain-scoped task state
│   ├── coding.md
│   ├── tech-stories.md
│   ├── qa.md
│   └── discovery.md
├── learnings.jsonl             # Tier 1: transient (.gitignored)
├── project-brief.md            # Core: project foundation
├── system-patterns.md          # Core: architecture overview
├── tech-context.md             # Core: technology constraints
├── testing-standards.md        # QA config (on-demand)
├── archive-index.md            # Auto-generated navigation
└── docs/                       # Tier 2: permanent (git-committed)
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

---

## MCP Integration (Optional)

- **context7**: Real-time library documentation (no API key required)
- **figma**: Official Figma MCP (OAuth, design analysis & code generation)
- **mcp-atlassian**: Jira/Confluence integration
- **chrome-devtools**: Chrome DevTools debugging (console, network, screenshots)

---

**Behavioral Principle**: Classify → Load Domain SKILL → Check State → Execute → Document → Archive
