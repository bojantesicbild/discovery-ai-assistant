<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/constraint.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [CON-NNN — assigned by writer, not stored in DB]
title: [title]
type: <budget|timeline|technology|regulatory|organizational>
description: [description]
status: assumed
source_person: [source_person]
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

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract constraints as things that LIMIT what the project can do.

Constraints are things that NARROW the solution space. They are NOT
requirements (what the system shall do) — they are walls the system
must stay within.

Structural fields (always populate when applicable):
- type: budget / timeline / technology / regulatory / organizational
- description: what the constraint is (1 sentence)
- impact: how it TECHNICALLY limits the project (1-2 sentences)
- source_quote: verbatim quote (≥10 chars)
- source_person: stakeholder who imposed / stated it, when named
- affects_reqs: list of BR ids this constraint shapes (e.g. ['BR-004']).
                Only include when the source explicitly links the
                constraint to specific requirements — don't guess.
- status: confirmed (client stated as fact), assumed (we inferred),
          negotiable (client open to changing it)

Negotiation context fields (migration 039 — populate to give PM
enough info to push back / accept):

- cost_if_kept: BUSINESS cost of accepting the constraint as-is.
  Different from `impact` (how it limits TECHNICALLY): cost_if_kept
  is what the BUSINESS pays — scope ruled out, customers we can't
  serve, time/money locked in. Required when affects_reqs is non-
  empty. Bounded inference allowed — derive from the affected BRs +
  the constraint type. E.g. "Locks the product to EU-only
  sub-processor agreement; rules out US/APAC clients in MVP without
  a separate 3mo legal cycle. ~€8k legal review cost per region."

- workaround_options: list of options the source mentions for
  working around the constraint. ≥1 entry. Each entry: "<option> —
  <pros / cons or why rejected>". REPLACES the legacy `workaround`
  text — populate this list instead. Skip when the source mentions
  no options.

- renegotiation_path: what changing or lifting the constraint would
  take. Most actionable when status is `assumed` or `negotiable`.
  Include who must approve, lead time, cost, conditions. E.g.
  "Legal team must approve new sub-processor agreement (~3mo,
  ~€8k); Sarah Chen is the gatekeeper. Negotiable only if target
  region has a pre-cleared sub-processor template." Skip when
  status is `confirmed` — the constraint is final.

Anti-fabrication rules — DO NOT INVENT CONTENT:

- workaround_options: only list options the SOURCE NAMES. Don't
  invent fictional alternatives to fill the list. Single-option
  constraints stay single-option.
- cost_if_kept: bounded inference allowed when affects_reqs is non-
  empty (we can describe what's locked in by the affected BRs).
  Without affects_reqs, leave null rather than guess.
- renegotiation_path: required only for status ∈ {assumed,
  negotiable}. For `confirmed` it's not actionable — leave null.

WRONG (sparse, single string for workaround):
  type: regulatory
  description: "Must host on AWS eu-west-1"
  impact: "All data must stay in EU. Affects ingestion + agents."
  workaround: "CDN was considered, rejected"
  affects_reqs: ["BR-004", "BR-007"]
  status: assumed

RIGHT (descriptive fields populated from source):
  type: regulatory
  description: "Must host on AWS eu-west-1 — legal sub-processor agreement already approved"
  impact: "Legal has approved the eu-west-1 sub-processor agreement; changing region requires 3 months of re-review. All data must remain in-region — includes S3 buckets used by document ingestion (BR-004) and core agents (BR-007)."
  affects_reqs: ["BR-004", "BR-007"]
  cost_if_kept: "Locks the product to EU-only sub-processor agreement; rules out US/APAC clients in MVP without a separate 3mo legal cycle. ~€8k legal review cost per additional region."
  workaround_options: [
    "CDN in front of eu-west-1 — rejected by Sarah Chen, data must stay in region not just traffic.",
    "Switch to AWS eu-central-1 — adds 3mo legal review lead time; sub-processor agreement re-approval needed.",
    "Self-hosted EU storage — out of scope for MVP, considered for post-launch."
  ]
  renegotiation_path: "Legal team must approve a new sub-processor agreement (~3mo lead, ~€8k cost). Sarah Chen is the named gatekeeper. Negotiable only if the target region has a pre-cleared sub-processor template."
  status: assumed

The legacy `workaround` text field still works (lands on the same
column), but new extractions should populate workaround_options
instead — the renderer prefers the structured list.
-->
