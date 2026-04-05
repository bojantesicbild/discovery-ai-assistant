---
name: discovery-status
description: Show current discovery project status — readiness, gaps, contradictions, recent changes
user_invocable: true
---

# Discovery Status

Show a comprehensive status report for the current discovery project.

## Steps

1. Read `.memory-bank/docs/discovery/readiness.md` for current readiness scores
2. Read `.memory-bank/docs/discovery/requirements.md` for requirement count and status breakdown
3. Count requirements by status (confirmed / proposed / pending)
4. Read `.memory-bank/docs/discovery/contradictions.md` for unresolved contradictions
5. Check for gaps — requirements with confidence=low or status=pending
6. Read `.memory-bank/.logs/session-history.log` for recent activity

## Files Read
- `.memory-bank/docs/discovery/readiness.md`
- `.memory-bank/docs/discovery/requirements.md`
- `.memory-bank/docs/discovery/contradictions.md`
- `.memory-bank/.logs/session-history.log`
- `.memory-bank/active-tasks/discovery.md`
- `.memory-bank/key-decisions.md`

## Files Written
- None (read-only command)

## Output Format

Present as a structured report:

```
Discovery Status Report
═══════════════════════

Readiness Score: X% (was Y% last session)
  - Business Understanding:  X/20
  - Functional Requirements: X/35
  - Technical Context:       X/20
  - Scope Freeze:            X/25

Requirements: X total
  - Confirmed: Y
  - Proposed:  Z
  - Pending:   W

Gaps: X items needing clarification
  [list top 5 gaps with priority]

Contradictions: X unresolved
  [list each with brief description]

Recent Activity (last 3 sessions):
  - [date]: [summary]
  - [date]: [summary]
  - [date]: [summary]

Next Steps:
  1. [highest priority action]
  2. [second priority action]
  3. [third priority action]
```

## Error Handling
- If readiness.md does not exist, report "No readiness data yet — run gap analysis first"
- If requirements.md does not exist, report "No requirements captured yet"
- If session-history.log does not exist, skip the Recent Activity section
