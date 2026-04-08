<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/contradiction.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [CTR-NNN — assigned by writer]
item_a_type: [item_a_type]
item_a_id: [item_a_id]
item_b_type: [item_b_type]
item_b_id: [item_b_id]
resolved: False
source_doc: [source_doc]
date: YYYY-MM-DD
category: contradiction
tags: [contradiction, resolved:{{resolved}}]
aliases: [CTR-XXX]
cssclasses: [contradiction, node-red]
---

# CTR-XXX: [Title]

## Explanation

_(content)_

## Items in conflict

- [[item]]

## Resolution

_(content)_

<!--
Extraction prompt (for the agent — strip before writing to disk):

A contradiction is when two existing items disagree. The agent does NOT
extract contradictions from raw text — they are produced by the dedup
stage of the pipeline when a new extraction conflicts with an existing
item.

Manual contradictions (logged by humans) capture:
- item_a_type / item_a_id: first item kind + display id
- item_b_type / item_b_id: second item kind + display id
- explanation: why they conflict (1-2 sentences)
- resolved: false until a human chooses a winner
- resolution_note: how it was resolved (if resolved)
-->
