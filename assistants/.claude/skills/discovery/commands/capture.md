---
name: capture
description: Capture freeform input (meeting notes, emails, Slack messages) and route through extraction
user_invocable: true
---

# Capture

Capture freeform input from any source and route it through the discovery extraction framework.

## When to Use
- User pastes meeting notes, email threads, Slack messages, or any unstructured text
- User provides a document or link containing client communication
- User wants to log a quick observation or stakeholder quote

## Steps

1. **Receive input** — Accept the pasted text or document reference from the user
2. **Classify source type** — Determine if this is:
   - Meeting notes
   - Email thread
   - Slack/chat messages
   - Document excerpt
   - Quick observation / verbal note
3. **Extract structured data** using the extraction framework from SKILL.md:
   - Requirements (FR-xxx, NFR-xxx) with MoSCoW priority
   - Constraints (budget, timeline, technology, regulatory)
   - Decisions (who decided what, why, alternatives)
   - Stakeholders (name, role, authority level)
   - Assumptions (what we believe + risk if wrong)
   - Scope items (explicitly in/out of MVP)
4. **Check for contradictions** — Compare extracted items against existing data in `.memory-bank/docs/discovery/requirements.md`
5. **Present extraction review** — Show the user what was extracted (Extraction Review gate from SKILL.md)
6. **On approval** — Store approved items:
   - Append requirements to `.memory-bank/docs/discovery/requirements.md`
   - Append decisions to `.memory-bank/docs/discovery/decisions.md`
   - Append contradictions to `.memory-bank/docs/discovery/contradictions.md`
   - Update `.memory-bank/docs/discovery/readiness.md`
7. **Log the capture** — Append entry to `.memory-bank/.logs/session-history.log`

## Files Read
- `.memory-bank/docs/discovery/requirements.md` (for contradiction check)
- `.memory-bank/docs/discovery/readiness.md` (for readiness delta)
- `.memory-bank/active-tasks/discovery.md`

## Files Written
- `.memory-bank/docs/discovery/requirements.md`
- `.memory-bank/docs/discovery/decisions.md`
- `.memory-bank/docs/discovery/contradictions.md`
- `.memory-bank/docs/discovery/readiness.md`
- `.memory-bank/.logs/session-history.log`
- `.memory-bank/active-tasks/discovery.md`

## Output Format

```
Capture Summary
───────────────
Source: [type] — [brief description]
Date: YYYY-MM-DD

Extracted:
  Requirements:   X new (FR-xxx, FR-xxx, ...)
  Constraints:    X new
  Decisions:      X new
  Stakeholders:   X new/updated
  Assumptions:    X new
  Scope items:    X new
  Contradictions: X found

Readiness: X% (was Y%)

Review the extraction above. Options:
(a) Approve all — store as shown
(b) Edit — I'll correct specific items
(c) Re-extract — try again with different focus
(d) Cancel — discard this extraction
```

## Rules
- Every extracted requirement MUST include an exact source quote (minimum 10 characters)
- Default status for new requirements is "proposed" — never auto-confirm
- Always show the Extraction Review gate before storing anything
- If the input is very short (under 50 words), ask the user to confirm intent before extracting
