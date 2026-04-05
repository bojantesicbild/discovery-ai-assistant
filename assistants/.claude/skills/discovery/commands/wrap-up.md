---
name: wrap-up
description: Session wrap-up — review changes, readiness delta, unresolved items, update memory
user_invocable: true
---

# Wrap-Up

End-of-session review that summarizes what changed, calculates readiness delta, lists unresolved items, and updates the memory bank.

## When to Use
- At the end of a discovery work session
- User says "wrap up", "end session", "session summary", or "done for now"

## Steps

1. **Read current state**:
   - `.memory-bank/active-tasks/discovery.md` for what was worked on
   - `.memory-bank/docs/discovery/readiness.md` for current readiness
   - `.memory-bank/.logs/session-history.log` for session start baseline
2. **Calculate session delta**:
   - Requirements added/modified this session
   - Decisions recorded
   - Contradictions found vs resolved
   - Readiness score change (before vs after)
3. **Identify unresolved items**:
   - Open contradictions from `.memory-bank/docs/discovery/contradictions.md`
   - Gaps (requirements with confidence=low or status=pending)
   - Action items without completion
   - Questions raised but not answered
4. **Update memory bank**:
   - Update `.memory-bank/active-tasks/discovery.md` with session summary
   - Append session entry to `.memory-bank/.logs/session-history.log`
   - Update `.memory-bank/key-decisions.md` if new decisions were made
   - Update `.memory-bank/gotchas.md` if new risks/gotchas were identified
5. **Present wrap-up report**

## Files Read
- `.memory-bank/active-tasks/discovery.md`
- `.memory-bank/docs/discovery/readiness.md`
- `.memory-bank/docs/discovery/requirements.md`
- `.memory-bank/docs/discovery/contradictions.md`
- `.memory-bank/.logs/session-history.log`
- `.memory-bank/key-decisions.md`
- `.memory-bank/gotchas.md`

## Files Written
- `.memory-bank/active-tasks/discovery.md`
- `.memory-bank/.logs/session-history.log`
- `.memory-bank/key-decisions.md` (if new decisions)
- `.memory-bank/gotchas.md` (if new gotchas)

## Output Format

```
Session Wrap-Up
═══════════════
Date: YYYY-MM-DD
Duration: ~Xh Xm

What Changed This Session:
  + Requirements: X added, Y updated
  + Decisions: X recorded
  + Contradictions: X found, Y resolved
  + Stakeholders: X added/updated

Readiness Delta:
  Before: X% → After: Y% (delta: +Z%)
  - Business Understanding:  X → Y
  - Functional Requirements: X → Y
  - Technical Context:       X → Y
  - Scope Freeze:            X → Y

Unresolved Items (carry forward):
  Contradictions: X open
    - [brief description]
  Gaps: X items
    - [brief description]
  Action Items: X pending
    - [brief description]
  Open Questions: X
    - [brief description]

Recommended Focus for Next Session:
  1. [highest priority item]
  2. [second priority item]
  3. [third priority item]

Memory bank updated. Session logged.
```

## Rules
- Always calculate the readiness delta — never skip it
- If no changes were made this session, say so explicitly rather than fabricating a summary
- Unresolved items must be carried forward — never silently drop them
- The session log entry should be concise (2-3 lines) for easy scanning
