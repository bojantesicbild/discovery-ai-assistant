---
name: meeting
description: Post-meeting processing — extract requirements, decisions, action items, flag contradictions
user_invocable: true
---

# Meeting

Process meeting notes or a transcript to extract structured discovery data, decisions, and action items.

## When to Use
- After a client meeting, stakeholder interview, or internal discovery session
- User provides meeting notes, transcript, or recording summary

## Steps

1. **Receive meeting input** — Accept meeting notes, transcript, or summary from the user
2. **Extract meeting metadata**:
   - Date, duration, attendees (with roles)
   - Meeting type (kickoff, requirements review, stakeholder interview, sprint review, ad-hoc)
   - Agenda items covered
3. **Extract structured data** using the extraction framework from SKILL.md:
   - Requirements (FR-xxx, NFR-xxx) with MoSCoW priority and source quotes
   - Constraints identified or updated
   - Decisions made (who, what, why, alternatives discussed)
   - Assumptions stated or challenged
   - Scope changes (items added/removed from MVP)
4. **Extract action items**:
   - What needs to happen
   - Who is responsible
   - Due date (if mentioned)
   - Priority (blocking / important / nice-to-have)
5. **Flag contradictions** — Compare against existing requirements and decisions in:
   - `.memory-bank/docs/discovery/requirements.md`
   - `.memory-bank/docs/discovery/decisions.md`
6. **Present extraction review** — Show the Extraction Review gate from SKILL.md
7. **On approval** — Store all approved items:
   - Create meeting record at `.memory-bank/docs/discovery/meetings/YYYY-MM-DD_[topic].md`
   - Update requirements, decisions, contradictions files
   - Update readiness scores
8. **Generate follow-up** — List action items and suggested next meeting agenda topics
9. **Log activity** — Append to `.memory-bank/.logs/session-history.log`

## Files Read
- `.memory-bank/docs/discovery/requirements.md`
- `.memory-bank/docs/discovery/decisions.md`
- `.memory-bank/docs/discovery/readiness.md`
- `.memory-bank/active-tasks/discovery.md`

## Files Written
- `.memory-bank/docs/discovery/meetings/YYYY-MM-DD_[topic].md`
- `.memory-bank/docs/discovery/requirements.md`
- `.memory-bank/docs/discovery/decisions.md`
- `.memory-bank/docs/discovery/contradictions.md`
- `.memory-bank/docs/discovery/readiness.md`
- `.memory-bank/.logs/session-history.log`
- `.memory-bank/active-tasks/discovery.md`

## Output Format

```
Meeting Processing Report
─────────────────────────
Meeting: [type] — [topic]
Date: YYYY-MM-DD | Duration: Xh Xm
Attendees: [names with roles]

Extracted:
  Requirements:   X new, Y updated
  Constraints:    X new
  Decisions:      X new
  Assumptions:    X new, Y challenged
  Scope changes:  X items
  Contradictions: X found

Action Items:
  [ ] [action] — Owner: [name] — Due: [date]
  [ ] [action] — Owner: [name] — Due: [date]
  [ ] [action] — Owner: [name] — Due: [date]

Readiness: X% (was Y%, delta +Z%)

Suggested Next Meeting Agenda:
  1. [topic based on gaps/contradictions]
  2. [topic based on action items]
  3. [topic based on pending requirements]

Review the extraction above. Options:
(a) Approve all — store as shown
(b) Edit — I'll correct specific items
(c) Re-extract — try again with different focus
(d) Cancel — discard this extraction
```

## Rules
- Every requirement MUST include an exact source quote from the meeting notes
- Decisions require: who decided, rationale, alternatives considered
- Action items without owners should be flagged for assignment
- If meeting notes are sparse (under 100 words), ask the user to elaborate before extracting
- Never auto-confirm requirements — default status is "proposed" unless client explicitly confirmed
