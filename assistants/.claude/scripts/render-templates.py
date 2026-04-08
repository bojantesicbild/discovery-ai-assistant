#!/usr/bin/env python3
"""Generate agent + Obsidian templates from the schemas.

For each schema in assistants/.claude/schemas/, emits two files:

1. assistants/.claude/templates/{kind}.template.md
   Agent-side fill-in template with placeholder values like `[BR-XXX]` and
   `YYYY-MM-DD`. The agent reads this when it needs to write a finding by
   hand (rare — most go through MCP store_finding).

2. assistants/.obsidian/templates/new-{kind}.md
   Obsidian Templater template with `<% tp.date.now("YYYY-MM-DD") %>` and
   `<% tp.file.title %>` so a human creating a note manually inside
   Obsidian gets the same frontmatter shape.

Both files are derived from the SAME schema, so they can never drift.
Run this script after editing any schema:

    cd backend && .venv/bin/python ../assistants/.claude/scripts/render-templates.py

Idempotent — overwrites existing files. Adds a header comment explaining
"DO NOT EDIT BY HAND" so human edits land in the schema instead.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Locate the repo root by walking up from this script
SCRIPT_DIR = Path(__file__).resolve().parent
ASSISTANTS_DIR = SCRIPT_DIR.parent.parent
ROOT_DIR = ASSISTANTS_DIR.parent

# We need schema_lib from the backend
sys.path.insert(0, str(ROOT_DIR / "backend"))
from app.services import schema_lib  # noqa: E402
from app.services.schema_lib import FieldDef, SchemaDoc  # noqa: E402


SCHEMAS_DIR = ASSISTANTS_DIR / ".claude" / "schemas"
AGENT_TEMPLATES_DIR = ASSISTANTS_DIR / ".claude" / "templates"
OBSIDIAN_TEMPLATES_DIR = ASSISTANTS_DIR / ".obsidian" / "templates"

HEADER_AGENT = "<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/{kind}.yaml. Run assistants/.claude/scripts/render-templates.py. -->"
HEADER_OBSIDIAN = "%% DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/{kind}.yaml. Run assistants/.claude/scripts/render-templates.py. %%"


def agent_placeholder(field: FieldDef) -> str:
    """Render a placeholder value for the agent template (mustache style)."""
    if field.default == "today":
        return "YYYY-MM-DD"
    if field.default == "now":
        return "YYYY-MM-DDTHH:MM:SSZ"
    if field.default is not None:
        return str(field.default)
    if field.type == "enum":
        return f"<{'|'.join(field.values or [])}>"
    if field.type == "bool":
        return "false"
    if field.type == "int":
        return "0"
    if field.type == "date":
        return "YYYY-MM-DD"
    if field.type == "datetime":
        return "YYYY-MM-DDTHH:MM:SSZ"
    if field.type == "list":
        return "[]"
    if field.type == "uuid_ref":
        return "null"
    if field.key == "id" and field.type == "string":
        return f"[{field.description or 'ID'}]"
    return f"[{field.key}]"


def templater_placeholder(field: FieldDef) -> str:
    """Render a placeholder value for the Obsidian Templater template."""
    if field.default == "today" or field.type == "date":
        return '<% tp.date.now("YYYY-MM-DD") %>'
    if field.default == "now" or field.type == "datetime":
        return '<% tp.date.now("YYYY-MM-DDTHH:mm:ssZ") %>'
    if field.default is not None:
        if isinstance(field.default, bool):
            return str(field.default).lower()
        return str(field.default)
    if field.type == "enum":
        return field.values[0] if field.values else ""
    if field.type == "bool":
        return "false"
    if field.type == "int":
        return "0"
    if field.type == "list":
        return "[]"
    if field.type == "uuid_ref":
        return "null"
    if field.key in ("title", "name"):
        return '<% tp.file.title %>'
    if field.key == "id":
        return f"{{{{prefix}}}}-XXX"
    return '""'


def render_frontmatter_block(
    schema: SchemaDoc,
    placeholder_fn,
    resolve_tokens: bool = False,
) -> list[str]:
    """Render a frontmatter block of `key: placeholder` pairs.

    `resolve_tokens` controls how `{{field}}` references in the schema's
    classification block are handled. Agent templates leave them as
    literal `{{priority}}` (the agent fills them in). Obsidian Templater
    templates substitute them to the field's default value (so Templater
    doesn't try to evaluate them as tp.* expressions)."""

    def maybe_resolve(items: list[str]) -> list[str]:
        if not resolve_tokens:
            return items
        out: list[str] = []
        for item in items:
            replaced = item
            for f in schema.fields:
                token = "{{" + f.key + "}}"
                if token in replaced:
                    default = f.default if f.default is not None else (f.values[0] if f.type == "enum" and f.values else "")
                    replaced = replaced.replace(token, str(default))
            out.append(replaced)
        return out

    lines = ["---"]
    for f in schema.fields:
        if not f.frontmatter or f.secret:
            continue
        if f.type == "uuid_ref":
            continue
        value = placeholder_fn(f)
        if f.key == "id" and schema.prefix:
            value = value.replace("{{prefix}}", schema.prefix)
        lines.append(f"{f.key}: {value}")
    lines.append(f"category: {schema.kind}")

    tags = maybe_resolve(schema.classification.default_tags)
    if tags:
        lines.append(f"tags: [{', '.join(tags)}]")

    if schema.id_field and schema.prefix:
        lines.append(f"aliases: [{schema.prefix}-XXX]")

    css = maybe_resolve(schema.classification.cssclasses)
    if css:
        lines.append(f"cssclasses: [{', '.join(css)}]")

    lines.append("---")
    return lines


def render_body_block(schema: SchemaDoc, placeholder_text: str = "") -> list[str]:
    """Render the heading + section scaffold."""
    title_token = placeholder_text or "[Title]"
    if schema.id_field and schema.prefix:
        heading = f"# {schema.prefix}-XXX: {title_token}"
    else:
        heading = f"# {title_token}"

    lines: list[str] = ["", heading, ""]

    for section in schema.sections:
        if section.name == "body":
            sf = schema.field(section.source_field) if section.source_field else None
            placeholder = (sf.description if sf and sf.description else "(description)") if sf else "(content)"
            lines.append(f"_{placeholder}_")
            lines.append("")
            continue

        lines.append(f"## {section.name}")
        lines.append("")

        if section.format == "blockquote":
            lines.append('> "[exact quote]"')
        elif section.format == "bullets":
            lines.append("- ")
        elif section.format == "wikilinks":
            lines.append("- [[item]]")
        elif section.format == "paragraphs":
            sf = schema.field(section.source_field) if section.source_field else None
            placeholder = (sf.description if sf and sf.description else "(content)") if sf else "(content)"
            lines.append(f"_{placeholder}_")
        elif section.format == "table":
            lines.append("| col | col |")
            lines.append("|---|---|")
        lines.append("")

    return lines


def render_agent_template(schema: SchemaDoc) -> str:
    parts: list[str] = [HEADER_AGENT.format(kind=schema.kind), ""]
    parts.extend(render_frontmatter_block(schema, agent_placeholder))
    parts.extend(render_body_block(schema, placeholder_text="[Title]"))
    if schema.extraction_prompt:
        parts.append("<!--")
        parts.append("Extraction prompt (for the agent — strip before writing to disk):")
        parts.append("")
        parts.append(schema.extraction_prompt.rstrip())
        parts.append("-->")
    return "\n".join(parts).rstrip() + "\n"


def render_obsidian_template(schema: SchemaDoc) -> str:
    parts: list[str] = [HEADER_OBSIDIAN.format(kind=schema.kind), ""]
    parts.extend(render_frontmatter_block(schema, templater_placeholder, resolve_tokens=True))
    parts.extend(render_body_block(schema, placeholder_text="<% tp.file.title %>"))
    return "\n".join(parts).rstrip() + "\n"


def main() -> int:
    schema_lib.reset_cache()
    registry = schema_lib.load_all(SCHEMAS_DIR)

    AGENT_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    OBSIDIAN_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

    written = 0
    for kind, schema in sorted(registry.items()):
        agent_path = AGENT_TEMPLATES_DIR / f"{kind}.template.md"
        obsidian_path = OBSIDIAN_TEMPLATES_DIR / f"new-{kind}.md"

        agent_path.write_text(render_agent_template(schema), encoding="utf-8")
        obsidian_path.write_text(render_obsidian_template(schema), encoding="utf-8")
        written += 2
        print(f"  ✓ {kind}: agent → {agent_path.name}, obsidian → {obsidian_path.name}")

    print(f"\nWrote {written} files from {len(registry)} schemas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
