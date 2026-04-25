%% DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/constraint.yaml. Run assistants/.claude/scripts/render-templates.py. %%

---
id: CON-XXX
title: <% tp.file.title %>
type: budget
description: ""
status: assumed
source_person: ""
source_doc: ""
source_raw: ""
date: <% tp.date.now("YYYY-MM-DD") %>
category: constraint
tags: [constraint, budget, assumed]
aliases: [CON-XXX]
cssclasses: [constraint, node-cyan]
---

# CON-XXX: <% tp.file.title %>

_(description)_

## Impact

_How the constraint limits the project_

## Cost if kept

_Business cost of accepting the constraint as-is. Different from `impact` (how it limits things technically): cost_if_kept is what the *business* pays — scope ruled out, customers we can't serve, time/money locked in. Required when affects_reqs is non-empty._

## Workaround options

- 

## Renegotiation path

_What it would take to change or lift this constraint. Most actionable when status is `assumed` or `negotiable`. Includes who needs to approve, lead time, cost, conditions. E.g. 'Legal must approve new sub-processor agreement (~3mo lead, ~€8k); Sarah Chen is the gatekeeper.' Skip when status is `confirmed` — the constraint is final._

## Affected Requirements

- [[item]]

## Source

> "[exact quote]"
