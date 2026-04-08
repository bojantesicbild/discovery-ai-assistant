# Discovery Schemas

This directory is the **single source of truth** for the shape of every kind
of finding the discovery pipeline produces (requirements, gaps, decisions,
…). Every consumer reads from these YAML files instead of redefining its
own dialect:

| Consumer | What it does with the schema |
|---|---|
| `assistants/.claude/skills/discovery/SKILL.md` | Tells the agent which fields to extract and how |
| `backend/app/services/schema_lib.py` | Loads + validates schemas, renders frontmatter |
| `backend/app/pipeline/tasks.py` (`_stage_export_markdown`) | Renders BR-NNN.md / GAP-NNN.md from extracted rows |
| `backend/app/models/extraction.py` | Hand-written but covered by a parity test |
| `mcp-server/db_server.py` (`store_finding`) | Validates incoming agent writes |
| `assistants/.obsidian/templates/*.md` | Generated for human-in-Obsidian use (Templater) |
| `assistants/.claude/templates/*.template.md` | Generated for agent prompts |
| `dashboard.md` (vault root) | Generated Dataview queries |

## Schema YAML format

```yaml
kind: requirement                # snake_case singular
display_name: Requirement
prefix: BR                       # null if no display id
id_field: id                     # which field is the BR-NNN identifier (null if none)
folder: docs/discovery/requirements
model: app.models.extraction.Requirement   # for parity tests

fields:
  - key: id                      # frontmatter key + python attr
    db_column: req_id            # SQLAlchemy column (defaults to key)
    type: string                 # string|text|int|bool|date|datetime|enum|list|uuid_ref
    required: true
    default: null                # literal value, or "today"/"now"/null
    values: null                 # for enum: list of allowed values
    description: "BR-NNN identifier"
    frontmatter: true            # render in YAML frontmatter (default true)
    secret: false                # never write to disk (default false)

sections:
  - name: body                   # special: body = description as paragraph(s)
    format: paragraphs
    source_field: description
    required: true
  - name: Source
    format: blockquote
    source_field: source_quote
    required: false
  - name: People
    format: bullets
    generated_from: source_person
  - name: Related
    format: wikilinks
    generated_from: relationships

relationships:
  - name: co-extracted
    target: requirement
    derived: same_source_doc

classification:
  cssclasses: [requirement, "node-{{priority}}"]
  default_tags: [requirement, "{{priority}}", "{{status}}"]

view:
  dataview_columns: [priority, status, confidence, source_doc]
  default_sort: [priority, status, last_modified]
  group_by: priority

extraction_prompt: |
  Extract requirements as items the system shall do or be. ...
```

## Field types

| Type | Python | Notes |
|---|---|---|
| `string` | `str` | Single line; no newlines preserved |
| `text` | `str` | Multi-line block |
| `int` | `int` | |
| `bool` | `bool` | |
| `date` | `date` | YYYY-MM-DD |
| `datetime` | `datetime` | ISO 8601 |
| `enum` | `str` | Must declare `values:` list |
| `list` | `list` | Use `item_type:` to constrain |
| `uuid_ref` | `uuid.UUID` | FK to another table; not rendered to frontmatter |

## Special section formats

| `format` | Renders as |
|---|---|
| `paragraphs` | Plain markdown paragraphs |
| `blockquote` | `> "quoted text"` |
| `bullets` | `- item` per list element |
| `wikilinks` | `- [[Target]]` per link |
| `table` | Markdown table from list of dicts |
