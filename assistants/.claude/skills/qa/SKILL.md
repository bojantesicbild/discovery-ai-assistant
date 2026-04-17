# QA Skill

[QA-SKILL-LOADED]

## When to Use
Activated when user message contains: analyze, qa, automate, report, defect, debug, test cases, fix tests + specific target.

## Anti-Patterns (NEVER do these)
- "Executing phase work manually" (Always delegate to the appropriate agent via Task tool)
- "Skipping Gate 1 or Gate 2 checks" (Gates exist because environment issues waste agent turns)
- "Auto-proceeding after agent returns" (Always validate output and show phase completion prompt)
- "Editing application source code" (QA edits `e2e/` test files only, never `src/` or `app/`)
- "Silently skipping missing MCP" (Surface critical MCP blockers to user, offer fallback)
- "Skipping delegation checkpoint" (Implementing without approval means claiming you know what the user wants)

---

## Classification

| Priority | Pattern | Action |
|----------|---------|--------|
| 1 | "analyze [KEY]" / "qa [KEY]" | Analysis (Phase 1+2) |
| 2 | "automate [KEY]" | Automation (Phase 3) |
| 3 | "report [KEY]" | Reporting (Phase 4) |
| 4 | "defect" / "file bugs" | Defect Management (Phase 5) |
| 5 | "debug" / "fix tests" | Debug (Phase 4.5, direct orchestration) |
| 6 | "research [TOPIC]" | Research-agent |
| 7 | Question (no work implied) | Answer directly |

### Compound Requests
"analyze and automate KEY" → classify as earliest phase (Analysis), note subsequent phases for after completion.

---

## Session Start Protocol

On EVERY new session, before responding:

**Step 1 — Check active task:**
1. Read `.memory-bank/active-tasks/qa.md`
2. If in-progress work exists and >24h old:
   > "Found in-progress work: [TASK_NAME] from [DATE]. Options:
   > (a) Resume this task
   > (b) Archive as complete, start fresh
   > (c) Archive as blocked, start fresh"
3. Update `.memory-bank/active-task.md` router: Current Domain = qa

**Step 2 — Check testing standards:**
1. Read `.memory-bank/testing-standards.md`
2. If `TEMPLATE_STATUS: UNCONFIGURED` → trigger Testing Standards Questionnaire (Section below)
3. If `CONFIGURED` → proceed normally

---

## Testing Standards Questionnaire

**Trigger**: `TEMPLATE_STATUS: UNCONFIGURED` detected.

> Testing standards are not configured. This affects browser targets, exit criteria, and auth setup.
> (a) Configure now (recommended, 3 questions)
> (b) Skip — use defaults (Chrome-only, 95% pass rate, no auth)
> (c) Configure manually later (edit `.memory-bank/testing-standards.md`)

**If (a) — ask these 3 questions:**

**Q1: Browser matrix & screen resolutions**
- Chrome Desktop 1920x1080 (always included)
- Chrome Desktop 1366x768, Firefox Desktop, Safari Desktop, Edge Desktop
- iOS Safari 375x667, Android Chrome 360x740

**Q2: Exit criteria**
- Pass rate threshold (default: 95%, blocking: <90%)
- Tolerance for non-blocking failures? (default: yes, up to 5%)

**Q3: Auth method**
- (a) None — public app
- (b) Session-based (cookies)
- (c) OAuth / SSO
- (d) JWT tokens

After answers: update `testing-standards.md`, flip `TEMPLATE_STATUS` to `CONFIGURED`.

---

## State Checks (Pre-Delegation)

Before spawning any phase agent, run the checks for that phase. These are the ORCHESTRATOR's responsibility — agents assume prerequisites are met.

### Phase 1+2: Analysis + Planning

**Prerequisites**: Jira story key provided

1. **Conflict check**: Read `active-tasks/qa.md`. If different story in-progress → conflict prompt
2. **Load Jira story**: Call `mcp__mcp-atlassian__jira_get_issue` with key
   - 404 → "Story [KEY] not found. Check the key."
   - 403 → "No permission to access [KEY]."
   - MCP unavailable → "Jira MCP not connected. Provide story details manually."
3. **[GATE: Delegation Checkpoint]**: "Ready to analyze [KEY]: [TITLE]. This will generate test cases from [N] acceptance criteria. Proceed?"
4. **Spawn** `qa-analysis-planning-agent` with: story key, title, description, ACs, story type, testing standards, linked URLs

### Phase 3: Automation

**Prerequisites**: Phase 1+2 output exists + Gate 1 PASS + Gate 2 PASS

1. **Verify Phase 1+2 output**: Check `docs/test-cases/` for CSV, `docs/qa-analysis-reports/` for report
   - Missing → "No test cases found for [KEY]. Run `analyze [KEY]` first."
2. **Gate 1 — Analysis quality**: Read from Phase 1+2 report
   - BLOCK → show blocker details: (a) Re-run / (b) Provide more info / (c) Override / (d) Stop
   - PASS → continue
3. **Gate 2 — Environment check**:
   - `e2e/.env` exists with `BASE_URL`? → If missing: "Set BASE_URL in e2e/.env"
   - `e2e/.auth/user.json` exists? (if auth needed) → If missing: "Auth required but no credentials found"
   - `e2e/playwright.config.ts` exists? → If missing: "No Playwright config found"
   - ANY check fails → show what's missing: (a) Fix now / (b) Skip auth / (c) Stop
4. **[GATE: Delegation Checkpoint]**: "Ready to generate Playwright tests for [KEY]. [N] test cases. Environment checks passed. Proceed?"
5. **Spawn** `qa-automation-agent` with: story key, CSV path, analysis report, testing standards, base URL

### Phase 4: Reporting

**Prerequisites**: Test results exist

1. **Verify results**: Check `e2e/test-results/` or `e2e/playwright-report/`
   - Missing → "No test results found. Run tests first: `npx playwright test`"
2. **Check ReportPortal**: Read `e2e/.env` for `RP_ENABLED`
3. **[GATE: Delegation Checkpoint]**: "Ready to generate report for [KEY]. Results in [location]. ReportPortal: [status]. Proceed?"
4. **Spawn** `qa-reporting-agent` with: story key, results location, ReportPortal config

### Phase 5: Defect Management

**Prerequisites**: Test failure data available

1. **Load failure data**: Check `e2e/test-results/`, screenshots, traces, Phase 4 report
   - Missing → "No test failures found. Run tests first or provide failure details."
2. **[GATE: Delegation Checkpoint]**: "Ready to file defects for [N] failures. Jira MCP: [status]. Proceed?"
3. **Spawn** `qa-defect-management-agent` with: story key, failure data, Phase 4 report

### Phase 4.5: Debug (Direct Orchestration — No Agent)

1. Load failures from `e2e/test-results/` — parse errors, stack traces
2. Categorize: UI (SELECTOR/TIMING/AUTH/DATA/ENV) or API (STATUS_CODE/SCHEMA/AUTH_API/PAYLOAD/CONNECTION)
3. Fix order: ENV → AUTH → TIMING → SELECTOR → DATA
4. Apply fixes to `e2e/tests/`, re-run, iterate

---

## Agent Delegation Protocol

| User Says | Agent | max_turns | Prerequisites |
|-----------|-------|-----------|---------------|
| "analyze [KEY]" / "qa [KEY]" | `qa-analysis-planning-agent` | 40 | Jira story key |
| "automate [KEY]" | `qa-automation-agent` | 30 | Test cases CSV + Gate 1 + Gate 2 |
| "report [KEY]" | `qa-reporting-agent` | 20 | Test results exist |
| "defect" / "file bugs" | `qa-defect-management-agent` | 15 | Failure data available |

### Hard Rules
1. **NEVER execute phase work manually** — always delegate via Task tool
2. **ALWAYS include max_turns** in Task calls
3. **Retry limit**: On spawn failure, retry up to 2x. After 2 failures, offer manual option
4. **After agent returns**: Always run Output Validation before showing results

---

## Output Validation

After EVERY agent returns:

1. **Read the agent's chat reply** — 1–3 sentences per Tone rule #8. The agent states what it did, where the artifact landed, and whether it succeeded or was blocked.
2. **Verify expected files exist on disk** — don't trust the prose alone, check the artifact:

| Phase | Expected output |
|---|---|
| 1+2 | `docs/qa-analysis-reports/[DATE]_[STORY]_phase1_analysis.md` AND `docs/test-cases/[DATE]_[STORY]_test-cases.csv` |
| 3 | `e2e/tests/[story-slug]/*.spec.ts` (at least 1 file) |
| 4 | `docs/reports/[DATE]_[STORY]_phase4_report.md` |
| 5 | `docs/defects/[DATE]_[STORY]_*_defect.md` OR Jira ticket confirmation |

3. **Act on what you see:**
   - File exists + prose confirms success → proceed to Phase Completion Prompt.
   - File missing or agent reported *"Blocked on X. Need Y."* → show the blocker to the user, do NOT auto-proceed.
   - Partial output (some files created, some missing) → surface to the user and ask whether to continue with partial results or re-run.

---

## Phase Completion Prompts

### After Phase 1+2 (Analysis)
> Analysis Complete for [KEY]: [TITLE]
> - AC Triage: [N] TEST / [N] MERGE / [N] SKIP / [N] GAP
> - Test cases generated: [N]
> - Gate 1: [PASS/BLOCK]
> Next: (a) "automate [KEY]" / (b) "redo" / (c) "archive"

### After Phase 3 (Automation)
> Tests Generated for [KEY]
> - [N] spec files with [M] test cases in e2e/tests/[slug]/
> Next: (a) Run tests / (b) "redo" / (c) "archive"

### After Phase 4 (Reporting)
> Report Generated for [KEY]
> - Recommendation: [GO/NO-GO]
> Next: (a) "defect"/"file bugs" / (b) "archive" / (c) Stop

### After Phase 5 (Defect Management)
> Defects Filed for [KEY]
> - [N] blocker / [N] critical / [N] major / [N] minor
> Next: (a) File more / (b) "archive"

---

## Checkpoints

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
- Do NOT add features beyond approval
- Do NOT fix "nearby" code unless directly blocking
- Discovered issues → note in active-task "Discovered Issues", do NOT fix
- If scope must change → STOP, show new checkpoint, get approval

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

## Fix-First Classification (Debug Mode)

### MECHANICAL (auto-fix, no prompt needed):
- Selector updates (element changed in DOM)
- Timeout increases (slow environment)
- Import fixes, test data updates

### JUDGMENT (MUST ask user):
- Test logic changes, removing tests
- Auth flow changes, API endpoint changes

After auto-fixing mechanical issues, re-run verification to confirm.

---

## Active Task Checkboxes

| Checkbox | Check when... |
|----------|---------------|
| `Phase selected` | User's intent classified to a specific phase |
| `Context loaded` | Memory bank + testing standards loaded |
| `Gate 1 passed (analysis quality)` | Phase 1+2 report shows PASS |
| `Gate 2 passed (environment check)` | Environment prerequisites verified |
| `Phase execution complete` | Agent completed and output validated |
| `ReportPortal pushed` | Results pushed to RP, or skipped |
| `Completion prompt shown` | Phase completion prompt displayed |

### Skip Rules
When a step doesn't apply:
- Check the box AND append "(skipped)"
- Never delete checkboxes

---

## MCP & Error Handling

| Phase | Critical MCP | Optional MCP | Fallback |
|-------|-------------|--------------|----------|
| Analyze+Plan | mcp-atlassian (Jira) | figma, context7 | Ask for story details manually |
| Automate | None | context7 | Use existing test patterns |
| Report | None | reportportal | Local JSON results only |
| Defect | mcp-atlassian (Jira) | — | Log defects locally |

- **Critical MCP missing** → surface blocker, offer fallback, do NOT silently skip
- **Optional MCP missing** → continue without it, don't mention unless it affects quality

---

## Editing Boundaries
- **SHOULD edit**: `e2e/` test files (`*.spec.ts`, `*.page.ts`, `fixtures/`, `helpers/`, `data/`)
- **SHOULD NOT edit**: Application source (`src/`, `app/`, `components/`), CI/CD configs, root `package.json`

---

## AC Triage Strategy
Test count driven by AC Triage, capped at 1.5x AC count:
- Phase 1 classifies each AC: TEST / MERGE / SKIP / GAP
- Effective budget = TEST count + MERGE groups + GAP count (max 3)

---

## Available Agents

| Agent | Use When | Prerequisites |
|-------|----------|---------------|
| qa-analysis-planning-agent | User provides Jira key + "analyze"/"qa" | Jira story key |
| qa-automation-agent | After analysis + Gate 1 PASS + Gate 2 PASS | Test cases CSV |
| qa-reporting-agent | After test results exist | e2e/test-results/ |
| qa-defect-management-agent | After failures identified + user confirms | Failure data |
| setup-agent | `.memory-bank/` doesn't exist or "setup"/"init" | None |
| research-agent | Unfamiliar tech or user requests research | Topic |
