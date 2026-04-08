<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/gap.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [GAP-NNN identifier]
question: [question]
severity: medium
area: general
status: open
blocked_reqs: []
source_person: [source_person]
source_doc: [source_doc]
source_raw: [source_raw]
date: YYYY-MM-DD
category: gap
tags: [gap, {{severity}}, {{status}}]
aliases: [GAP-XXX]
cssclasses: [gap, node-amber]
---

# GAP-XXX: [Title]

_What we don't know yet_

## Suggested Action

_(content)_

## Blocked Requirements

- [[item]]

## Source

> "[exact quote]"

## Resolution

_(content)_

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract gaps as things we don't know that we need to know.

A gap is NOT a requirement. A requirement is a known thing the system
shall do. A gap is a question whose answer would unlock requirements.

For each gap, capture:
- question: the missing information, phrased as a question
- severity: high (blocks major work), medium (slows work), low (cosmetic)
- area: which domain it lives in (business / functional / technical / scope)
- blocked_reqs: BR-NNN ids that can't be confirmed without this answer
- suggested_action: who to ask + how (e.g. "ask CTO in next meeting")
- source_quote: if the gap was raised by a client statement, the quote

Gaps drive readiness scoring. Resolving a gap = converting it to a
confirmed requirement / decision / constraint.
-->
