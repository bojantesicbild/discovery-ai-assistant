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

DO NOT extract individual scope items during document extraction.

Scope boundaries (what's in/out of MVP) should be captured as prose
in the document_summary field instead. The MVP Scope Freeze handoff
document is the canonical place for scope — it's a curated narrative,
not a list of tracked items.

If the pipeline receives scope items from legacy extractions they'll
still be stored, but new extractions should NOT produce them. Include
scope-relevant statements in the document_summary instead, e.g.:
"Client confirmed mobile is out of scope for v1, dashboard-only MVP."
-->
