<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/contradiction.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [CTR-NNN — assigned by writer]
title: [title]
area: <tech-stack|scope|governance|timeline|budget|other>
side_a_source: [side_a_source]
side_a_person: [side_a_person]
side_b_source: [side_b_source]
side_b_person: [side_b_person]
resolved: False
source_doc: [source_doc]
date: YYYY-MM-DD
category: contradiction
tags: [contradiction, resolved:{{resolved}}, area:{{area}}]
aliases: [CTR-XXX]
cssclasses: [contradiction, node-red]
---

# CTR-XXX: [Title]

## Conflicting statements

_(content)_

## Impact

_Why the contradiction matters — what's at stake if it stays unresolved (blocked decisions, scope/budget/quality risk, downstream BRs that depend on the call). 1–3 sentences._

## Resolution options

- 

## Resolution

_(content)_

<!--
Extraction prompt (for the agent — strip before writing to disk):

A contradiction is when two statements can't both be true. The
discovery-extraction-agent captures them as free-form two-sided
disagreements with enough context that a PM staring at the doc can
understand what's at stake and what their options are.

Required fields:
- title: short headline ("MVP handoff documents", "Extraction model")
- side_a: first conflicting statement, what one source/person said
- side_b: second conflicting statement, what the other source/person said
- area: tech-stack / scope / governance / timeline / budget / other
- side_a_source / side_a_person, side_b_source / side_b_person: provenance

Descriptive fields — populate when the source actually discusses them.
Do NOT invent. Leave empty rather than hallucinate.

- impact_summary: WHY the contradiction matters. What's blocked, what's at
  risk, who's affected if no one decides. 1–3 sentences. The grain is
  "consequences of staying unresolved", not a restatement of side_a/side_b.

- resolution_options: concrete paths to resolve, each with a short
  pros/cons or recommendation tail after an em-dash. Only emit when the
  source genuinely discusses options or trade-offs; otherwise omit.

WRONG (no impact, no options — PM has to guess what to do):
  title: "Extraction model"
  side_a: "Earlier decision: use Claude Sonnet for extraction quality."
  side_b: "Milan Kovac decided to use Haiku for 10x cost reduction.
           Quality vs. cost trade-off unresolved."

RIGHT (impact + options — PM can act):
  title: "Extraction model"
  side_a: "Earlier decision: use Claude Sonnet for extraction quality."
  side_b: "Milan Kovac decided to use Haiku for 10x cost reduction.
           Quality vs. cost trade-off unresolved."
  impact_summary: "Affects every BR depending on extraction accuracy
    (BR-001 budget tracking, BR-003 offline review). If Haiku quality
    drops below the confirmed-finding threshold, the client review
    portal surfaces wrong data; if we revert to Sonnet, Milan's 10x
    cost commitment to the client breaks."
  resolution_options:
    - "Run a 50-document benchmark — pick the model by quality threshold,
       empirical and lowest risk"
    - "Hybrid: Haiku by default, fall back to Sonnet on confidence<medium —
       keeps cost down but adds runtime branching"
    - "Stay on Haiku — accept quality loss as MVP trade-off, revisit post-launch"

Extract contradictions both WITHIN a document (one person says X, another
says Y) and ACROSS documents (this doc contradicts an earlier one — the
agent reads existing data via get_requirements / get_gaps to cross-check).
-->
