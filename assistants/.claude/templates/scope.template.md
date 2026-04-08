<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/scope.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [SCO-NNN — assigned by writer]
description: [description]
in_scope: false
source_doc: [source_doc]
date: YYYY-MM-DD
category: scope
tags: [scope, in_scope:{{in_scope}}]
aliases: [SCO-XXX]
cssclasses: [scope, node-{{in_scope_color}}]
---

# SCO-XXX: [Title]

_(description)_

## Rationale

_(content)_

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract scope items as things the client explicitly said are IN or OUT
of the MVP.

For each scope item, capture:
- description: the feature or capability
- in_scope: true (client said "yes, in MVP") or false ("not in MVP")
- rationale: why it's in or out

Only extract scope items when there's an EXPLICIT in/out statement.
Don't infer scope from priority — that's what `priority` is for on
requirements.
-->
