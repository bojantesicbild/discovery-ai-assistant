# Tech Stories Skill

[TECH-STORIES-SKILL-LOADED]

## When to Use
Activated when user message contains: tech doc, stories, breakdown, pipeline, dashboard, sprint, document, full pipeline, tech doc and stories + specific target.

## Anti-Patterns (NEVER do these)
- "Agent asking user for approval" (Agents are autonomous — ALL user interaction is handled by the orchestrator)
- "Skipping breakdown approval gate" (User must explicitly approve breakdown before story creation)
- "Using swarm mode by default" (Sequential is default, swarm is opt-in)
- "Publishing to Atlassian without asking" (Atlassian publish is always ask-first)
- "Creating stories without tech doc" (Tech doc is prerequisite for story breakdown)
- "Agents writing to .claude/ infrastructure" (Agents may READ .claude/ files but never CREATE, MODIFY, or DELETE them)

---

## Classification

| Priority | Pattern | Action |
|----------|---------|--------|
| 1 | After ANY file modification | Completion check |
| 2 | "now"/"also"/"next"/"then" + active task exists | Continuation |
| 3 | "research"/"analyze" (no action verb) | Research |
| 4 | "tech doc" + ("stories"/"breakdown"/"pipeline") OR "full pipeline" | Guided Pipeline |
| 5 | "tech doc"/"document" + target | Tech doc only (story-tech-agent) |
| 6 | "stories"/"breakdown" + existing tech doc | Stories only (story-story-agent) |
| 7 | "dashboard"/"sprint" | Dashboard (story-dashboard-agent) |
| 8 | "fix"/"implement"/"add"/"create"/"build"/"update" + target | Standard task |
| 9 | Question (no work implied) | Answer directly |

---

## State Checks

**Before any task work:**
1. Read `.memory-bank/active-tasks/tech-stories.md`
2. Check content — placeholders only → Initialize & proceed
3. Real work documented → Show task detection prompt & WAIT
4. Update `.memory-bank/active-task.md` router: Current Domain = tech-stories

---

## Workflows

### Standard Task Flow (non-pipeline)
Same as coding: Initialize → Knowledge Search → Research (if complex) → **[GATE: Checkpoint]** → Implement → **[GATE: Completion]**

### Guided Pipeline

**Trigger**: "tech doc" + ("stories"/"breakdown"/"pipeline"), OR "full pipeline", OR "tech doc and stories"

```
User: "Create tech doc and stories for [feature]"
  │
  ▼
ORCHESTRATOR invokes story-tech-agent
  → Agent creates tech doc, returns results
  │
  ▼
[GATE: Transition 1]
  (a) Generate story breakdown → invoke story-story-agent Mode A
  (b) Archive tech doc only → archive (orchestrator)
  (c) Review tech doc first → show doc, re-prompt
  (d) Publish tech doc to Confluence → ask for instructions first
  │ User picks (a)
  ▼
ORCHESTRATOR invokes story-story-agent Mode A
  → Agent creates breakdown, returns results
  │
  ▼
[GATE: Breakdown Approval]
  → Orchestrator shows breakdown to user for review/approval
  │
  ▼
[GATE: Transition 2]
  (a) Sequential story creation (default, reliable)
  (b) Parallel swarm creation (faster for 5+)
  (c) Archive breakdown only
  │ User picks (a) or (b)
  ▼
ORCHESTRATOR invokes story-story-agent Mode B
  → Agent creates stories, returns results
  │
  ▼
[GATE: Post-Creation]
  (a) Review stories (show summaries)
  (b) Archive everything → archive (orchestrator)
  (c) Keep working on stories
  (d) Push to Atlassian → ask for Jira/Confluence details
  (e) Generate project-wide dashboard → collect team config first
  │ User picks (e)
  ▼
[GATE: Team Config Collection]
  → Collect member count, names, per-member capacity
  │
  ▼
ORCHESTRATOR invokes story-dashboard-agent
  → Agent generates JSON + HTML dashboard, returns results
  │
  ▼
[GATE: Transition 3]
  (a) Archive everything → archive (orchestrator)
  (b) Push stories to Atlassian → ask for instructions
  (c) Regenerate dashboard → re-invoke story-dashboard-agent
```

### Stage Gate Rules
- Each stage has ONE valid exit: the next stage
- Pipeline can exit at any transition prompt — user can archive and stop at any stage
- You cannot skip ahead
- If you want to jump to a later stage, that impulse is a red flag

---

## Pipeline Rules

1. **Agents are fully autonomous** — agents NEVER ask the user for approval, confirmation, or choices. They complete their work and return a handoff. All transition prompts, approval gates, and user interaction are handled exclusively by the orchestrator.
2. **Breakdown approval gate** — user must explicitly approve the story breakdown before the orchestrator invokes Mode B. This gate is managed by the orchestrator, not the agent.
3. **Sequential is default, swarm is opt-in** — sequential creation is recommended unless user explicitly chooses swarm; recommend swarm when 5+ stories exist.
4. **Pipeline can exit at any transition prompt** — user can archive and stop at any stage; pipeline does not force completion.
5. **Pipeline context persists across agents** — the orchestrator maintains `tech_doc_path`, `feature_name`, `feature_folder`, `dashboard_path`, `team_config`, `confluence_url`, `jira_keys`, and `pipeline_mode: "guided"` in context.
6. **Backward compatible** — standalone agent invocations work identically; pipeline prompts only appear when `pipeline_mode` is active.
7. **Atlassian publish is always ask-first** — when user selects Atlassian option, orchestrator asks for project/space/labels instructions before proceeding.
8. **Jira issue summary uses full story title** — use the full `# [LAYER] | [CATEGORY] | [Feature Name]` heading as Jira summary.
9. **Enrich Resources when publishing to Jira** — orchestrator adds Confluence tech doc link to Resources section if `confluence_url` exists.
10. **Dashboard requires team config collection** — before invoking story-dashboard-agent, orchestrator MUST show Team Config prompt and pass result as `team_config`.
11. **Jira publishing is always sequential** — publish stories ONE AT A TIME in breakdown order. Do NOT use batch creation.
12. **Agents must never write to `.claude/` infrastructure** — agents may READ files in `.claude/` but must NEVER create, modify, or delete them.

---

## Team Config Collection Prompt

```
Sprint Dashboard — Team Configuration

Before generating the dashboard, I need your team setup:

1. How many team members? (1-10)
2. Member names and capacity (hours per sprint for each):

Example: Alice: 24h, Bob: 20h, Carol: 16h

Or: "3 members, 24h each" for defaults.
```

**Response Handling**:
- Number only (e.g., "3") → 3 members named "Member 1/2/3" with 24h each
- "3 members, 20h each" → 3 members with 20h
- Named list → named members with specified capacity
- "skip"/"default" → single member with 24h

---

## Checkpoints

### Implementation Checkpoint (standard tasks)
Same format as coding SKILL.md.

### Do NOT skip any checkpoint because:
| Excuse | Why It's Wrong |
|--------|---------------|
| "Too simple to need approval" | Simple tasks are where shortcuts cause the most damage |
| "The approach is obvious" | Obvious to whom? The user decides, not you |
| "I already know what to do" | You're following a cached summary, not the actual instructions |
| "I'll ask after" | After never comes |
| "The user didn't ask for this step" | The step exists because agents skip it without enforcement |

If you catch yourself thinking any of these → STOP, re-read this SKILL.md, restart from the last gate.

---

## Scope Lock (active after user approves approach)
- Approved scope is a CONTRACT for this task
- Do NOT add features, refactoring, or "improvements" beyond approval
- Do NOT fix "nearby" code unless directly blocking the approved task
- Discovered issues → note in active-task "Discovered Issues", do NOT fix
- If scope must change → STOP, show new checkpoint, get explicit approval

---

## Three-Strikes Rule
If 3 fix attempts for the same issue fail:
1. STOP
2. Document: what you tried, why each failed
3. Present options:
   (a) Discuss underlying architecture
   (b) Try fundamentally different approach
   (c) Mark as blocked and move on

---

## Active Task Checkboxes

| Checkbox | Check when... |
|----------|---------------|
| `Context loaded & knowledge searched` | Memory bank files read AND knowledge search shown |
| `Research complete` | Research done or skipped (note reason) |
| `User approved approach` | User responds "yes" to checkpoint |
| `Tech doc created` | story-tech-agent completes and file exists |
| `Story breakdown approved` | User explicitly approves breakdown table |
| `Stories created: [X/TOTAL]` | Update count after each story written |
| `Published to Atlassian` | Jira/Confluence published or skipped. **After publish, MUST update External Resources** with Jira keys and Confluence URL |
| `Archived` | Archival protocol executed, task in completed-tasks |

### Skip Rules
When a step doesn't apply:
- Check the box AND append "(skipped)" — e.g., `- [x] Published to Atlassian (skipped)`
- Never delete checkboxes — always check or skip them

---

## Mandatory Reading Support

Projects can define mandatory reading paths in `.memory-bank/project-brief.md` under a `## Mandatory Reading` section. Agents load project-brief.md as part of standard context loading, so any paths listed there will be read before generating output.

---

## Available Agents

| Agent | Use When |
|-------|----------|
| story-tech-agent | User requests tech doc, or pipeline activates |
| story-story-agent | After tech doc exists and user wants stories |
| story-dashboard-agent | After stories exist and user selects dashboard |
| setup-agent | `.memory-bank/` doesn't exist or user says "setup"/"init" |
| research-agent | Unfamiliar tech, multiple approaches, or user requests research |
