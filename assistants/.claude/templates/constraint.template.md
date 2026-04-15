<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/constraint.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [CON-NNN — assigned by writer, not stored in DB]
title: [title]
type: <budget|timeline|technology|regulatory|organizational>
description: [description]
status: assumed
source_doc: [source_doc]
source_raw: [source_raw]
date: YYYY-MM-DD
category: constraint
tags: [constraint, {{type}}, {{status}}]
aliases: [CON-XXX]
cssclasses: [constraint, node-cyan]
---

# CON-XXX: [Title]

_(description)_

## Impact

_How the constraint limits the project_

## Source

> "[exact quote]"

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract constraints as things that LIMIT what the project can do.

For each constraint, capture:
- type: budget / timeline / technology / regulatory / organizational
- description: what the constraint is (1 sentence)
- impact: how it limits the project (1-2 sentences)
- source_quote: verbatim quote (≥10 chars)
- status: confirmed (client stated as fact), assumed (we inferred),
          negotiable (client open to changing it)

Constraints are things that NARROW the solution space. They are NOT
requirements (what the system shall do) — they are walls the system
must stay within.
-->
