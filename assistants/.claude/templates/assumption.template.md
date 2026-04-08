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

Extract assumptions as beliefs we are operating on but have NOT confirmed.

For each assumption, capture:
- statement: what we believe (1 sentence)
- basis: why we believe it (industry norm, similar project, client hint…)
- risk_if_wrong: what breaks if the assumption fails
- needs_validation_by: who or what would resolve the assumption

An assumption is different from a constraint: a constraint is a known
limit; an assumption is a guess about a limit. Assumptions should
eventually become either confirmed constraints or rejected.
-->
