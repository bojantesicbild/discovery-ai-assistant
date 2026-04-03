# Coding Skill

[CODING-SKILL-LOADED]

## When to Use
Activated when user message contains: fix, implement, add, create, build, update, refactor, bug, code + specific target.

## Anti-Patterns (NEVER do these)
- "Skipping checkpoint because task is simple" (Simple tasks are where shortcuts cause the most damage)
- "Auto-fixing architectural issues" (Architecture changes require user judgment)
- "Implementing without knowledge search" (Past work may solve this already)
- "Batch-updating active-task at the end" (Update after each significant action)
- "Adding features beyond what was approved" (Approved scope is a contract)

---

## Classification

| Priority | Pattern | Action |
|----------|---------|--------|
| 1 | After ANY file modification | Completion check → Show completion prompt |
| 2 | "now"/"also"/"next"/"then" + active task exists | Continuation → Workflow B |
| 3 | "research"/"analyze" (no action verb) | Research → Workflow C |
| 4 | "fix"/"implement"/"add"/"create"/"build"/"update" + target | New task → Workflow A |
| 5 | Question (no work implied) | Answer directly |
| 6 | Compound request (research + action) | Research first → Implementation checkpoint after |

### Ambiguous Messages
If intent is unclear, show clarification:
> "What would you like me to do?
> (a) Fix/implement the issue
> (b) Research potential solutions first
> (c) Explain what might be causing the problem"

---

## State Checks

**Before any task work:**
1. Read `.memory-bank/active-tasks/coding.md`
2. Check content — placeholders only → Initialize & proceed
3. Real work documented → Show task detection prompt & WAIT
4. Update `.memory-bank/active-task.md` router: Current Domain = coding

---

## Workflows

### Workflow A (New Task)
1. Initialize `active-tasks/coding.md` with task details
2. **Knowledge Search** (MANDATORY) — search all `docs/` directories + `learnings.jsonl`
3. Document discoveries in active task Cross-References
4. Research if complex (use research-agent if: unfamiliar tech, security/perf critical, multiple approaches, no past work for non-trivial task)
5. **[GATE: Implementation Checkpoint]** — Show approach & WAIT for approval
6. Implement ONLY after approval, following discovered patterns
7. Update `active-tasks/coding.md` continuously
8. **[GATE: Completion]** — Show completion prompt

### Workflow B (Continuation)
1. Update `active-tasks/coding.md` Progress Log
2. Continue implementation
3. Document decisions in Technical Details
4. **[GATE: Completion]** — Show completion prompt

### Workflow C (Research)
1. Use research-agent with full context
2. Save to `docs/research-sessions/`
3. **[GATE: Implementation Checkpoint]** — Show approach based on findings & WAIT
4. Implement ONLY after approval
5. **[GATE: Completion]** — Show completion prompt

### Stage Gate Rules
- Each stage has ONE valid exit: the next stage
- You cannot skip ahead
- If you want to jump to a later stage, that impulse is a red flag — it means you're rationalizing skipping a step

---

## Checkpoints

### Implementation Checkpoint
```
Ready to implement: [TASK_NAME]

Summary of proposed changes:
- [Key change 1]
- [Key change 2]

Recommended approach:
[Brief description + why this approach fits]

Files to be modified:
- [file1] - [what will change]

Following established patterns:
- [pattern/practice from knowledge search]

Potential risks:
- [Risk + mitigation]

Proceed? (yes / no / research)
```

### Do NOT skip this checkpoint because:
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
- Discovered issues → note in active-task.md "Discovered Issues", do NOT fix
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
This signals an architectural issue, not an investigative failure.

---

## Fix-First Classification

### MECHANICAL (auto-fix, no prompt needed):
- Import fixes, linting errors, type errors
- Dead code removal, unused variable cleanup
- Formatting, whitespace, trailing commas

### JUDGMENT (MUST ask user):
- Architecture changes, dependency additions
- Security-related changes, API modifications
- Removing or changing existing behavior

After auto-fixing mechanical issues, re-run verification to confirm.

---

## Pattern Recognition

After knowledge search, if 2+ similar past tasks found → show pattern detection prompt:
> Pattern Detected: [PATTERN_NAME]
> Found [X] similar tasks. Instead of fixing one-by-one:
> (a) Continue with current task only
> (b) Research and fix ALL instances systematically
> (c) Create a best-practice document, then fix current task

Only prompt ONCE per pattern type per session.

---

## Active Task Checkboxes

| Checkbox | Check when... |
|----------|---------------|
| `Context loaded & knowledge searched` | Memory bank files read AND knowledge search shown to user |
| `Research complete` | Research-agent saved findings, OR task doesn't need research (check + note "skipped") |
| `User approved approach` | User responds "yes" to implementation checkpoint |
| `Implementation complete` | All planned changes made |
| `Tests passing` | Tests run and passing, or no tests applicable (check + note "skipped") |
| `Completion prompt shown` | Completion prompt displayed to user |
| `Archived` | Archival protocol executed, task in completed-tasks |

### Skip Rules
When a step doesn't apply:
- Check the box AND append "(skipped)" — e.g., `- [x] Research complete (skipped - known solution)`
- Never delete checkboxes — always check or skip them

---

## Available Agents

| Agent | Use When |
|-------|----------|
| setup-agent | `.memory-bank/` doesn't exist or user says "setup"/"init" |
| research-agent | Unfamiliar tech, multiple approaches, security/perf critical, or user requests research |
