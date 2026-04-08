<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/decision.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [DEC-NNN — assigned by writer, not stored in DB]
title: [title]
status: tentative
decided_by: [decided_by]
decided_date: YYYY-MM-DD
source_doc: [source_doc]
source_raw: [source_raw]
date: YYYY-MM-DD
category: decision
tags: [decision, {{status}}]
aliases: [DEC-XXX]
cssclasses: [decision, node-blue]
---

# DEC-XXX: [Title]

## Rationale

_(content)_

## Alternatives

- 

## Impacts

- 

## Decided By

_Person or role that made the call_

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract decisions as moments where someone CHOSE one thing over alternatives.

For each decision, capture:
- title: what was decided (short noun phrase)
- status: tentative (just discussed), confirmed (client signed off),
          reversed (later changed)
- decided_by: name + role of the decision maker
- rationale: why this option won
- alternatives: what else was on the table
- impacts: what changes as a result of this decision

A decision is different from a requirement: a requirement is a thing
the system shall do; a decision is a choice between ways to deliver it.
-->
