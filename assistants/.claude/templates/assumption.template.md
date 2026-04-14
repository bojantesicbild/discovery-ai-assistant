<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/assumption.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [ASM-NNN — assigned by writer]
statement: [statement]
needs_validation_by: [needs_validation_by]
validated: False
source_doc: [source_doc]
date: YYYY-MM-DD
category: assumption
tags: [assumption, validated:{{validated}}]
aliases: [ASM-XXX]
cssclasses: [assumption, node-orange]
---

# ASM-XXX: [Title]

_(description)_

## Basis

_Why we assume this_

## Risk if wrong

_(content)_

## Validation

_(content)_

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract ONLY high-risk assumptions — beliefs that, if wrong, would
force a major architectural change, scope rework, or budget overrun.

A typical project has 2-5 high-risk assumptions, NOT 20+. Skip:
- Obvious assumptions ("users have internet", "standard browsers")
- Low-impact guesses ("the client prefers blue")
- Anything that, if wrong, is a minor adjustment not a rework

For each HIGH-RISK assumption, capture:
- statement: what we believe (1 sentence)
- basis: why we believe it (industry norm, similar project, client hint…)
- risk_if_wrong: what breaks — be specific about the rework cost
- needs_validation_by: who or what would resolve the assumption

An assumption is a GAP in disguise — an unvalidated belief we're
building on. Surface it so the PM can confirm or reject it before
handoff. Don't extract trivial assumptions that nobody would question.
-->
