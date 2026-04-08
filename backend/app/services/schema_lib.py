"""Schema library — single source of truth for finding kinds.

Loads YAML schemas from `assistants/.claude/schemas/`, validates payloads
against them, and renders markdown frontmatter and section bodies.

Every consumer that touches a finding (pipeline writer, MCP store_finding,
template generator, lint script) reads from this module instead of
maintaining its own field list. See `assistants/.claude/schemas/_meta.md`
for the schema YAML format.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError, model_validator


# ─────────────────────────────────────────────────────────────────────────────
# Locations
# ─────────────────────────────────────────────────────────────────────────────

# backend/app/services/schema_lib.py -> repo root
ROOT_DIR = Path(__file__).resolve().parents[3]
SCHEMAS_DIR = ROOT_DIR / "assistants" / ".claude" / "schemas"


# ─────────────────────────────────────────────────────────────────────────────
# Meta-schema (the schema for our schemas)
# ─────────────────────────────────────────────────────────────────────────────

FieldType = Literal[
    "string", "text", "int", "bool", "date", "datetime",
    "enum", "list", "uuid_ref",
]


class FieldDef(BaseModel):
    key: str
    db_column: str | None = None
    type: FieldType
    required: bool = False
    default: Any = None
    values: list[str] | None = None  # for enum
    item_type: str | None = None     # for list
    description: str | None = None
    frontmatter: bool = True
    secret: bool = False

    @model_validator(mode="after")
    def _check_enum_has_values(self):
        if self.type == "enum" and not self.values:
            raise ValueError(f"field {self.key!r}: enum must declare `values`")
        if self.type != "enum" and self.values:
            raise ValueError(f"field {self.key!r}: only enum may have `values`")
        return self

    @property
    def column(self) -> str:
        """SQLAlchemy column name (db_column override or key)."""
        return self.db_column if self.db_column is not None else self.key


SectionFormat = Literal["paragraphs", "blockquote", "bullets", "wikilinks", "table"]


class SectionDef(BaseModel):
    name: str
    format: SectionFormat
    source_field: str | None = None
    generated_from: str | None = None
    required: bool = False


class RelationshipDef(BaseModel):
    name: str
    target: str
    derived: str | None = None


class ClassificationDef(BaseModel):
    cssclasses: list[str] = Field(default_factory=list)
    default_tags: list[str] = Field(default_factory=list)


class ViewDef(BaseModel):
    dataview_columns: list[str] = Field(default_factory=list)
    default_sort: list[str] = Field(default_factory=list)
    group_by: str | None = None


class SchemaDoc(BaseModel):
    kind: str
    display_name: str
    prefix: str | None = None
    id_field: str | None = None
    folder: str
    model: str  # fully-qualified SQLAlchemy class
    fields: list[FieldDef]
    sections: list[SectionDef] = Field(default_factory=list)
    relationships: list[RelationshipDef] = Field(default_factory=list)
    classification: ClassificationDef = Field(default_factory=ClassificationDef)
    view: ViewDef = Field(default_factory=ViewDef)
    extraction_prompt: str | None = None

    @model_validator(mode="after")
    def _check_unique_field_keys(self):
        keys = [f.key for f in self.fields]
        dupes = [k for k in keys if keys.count(k) > 1]
        if dupes:
            raise ValueError(f"schema {self.kind!r}: duplicate field keys {set(dupes)}")
        return self

    @model_validator(mode="after")
    def _check_id_field_exists(self):
        if self.id_field and self.id_field not in {f.key for f in self.fields}:
            raise ValueError(
                f"schema {self.kind!r}: id_field {self.id_field!r} not in fields"
            )
        return self

    def field(self, key: str) -> FieldDef | None:
        for f in self.fields:
            if f.key == key:
                return f
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Loader
# ─────────────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def load_all(schemas_dir: Path | None = None) -> dict[str, SchemaDoc]:
    """Load every schema from disk into a {kind: SchemaDoc} registry.

    Cached after first call. Pass an explicit dir to bypass the cache (used
    in tests). Raises ValidationError on the first malformed schema with a
    pointer to which file failed."""
    base = schemas_dir or SCHEMAS_DIR
    if not base.exists():
        raise FileNotFoundError(f"schemas directory not found: {base}")

    out: dict[str, SchemaDoc] = {}
    for path in sorted(base.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            raise ValueError(f"{path.name}: invalid YAML — {e}") from e
        if not isinstance(data, dict):
            raise ValueError(f"{path.name}: top level must be a mapping")
        try:
            doc = SchemaDoc.model_validate(data)
        except ValidationError as e:
            raise ValueError(f"{path.name}: schema invalid — {e}") from e
        if doc.kind in out:
            raise ValueError(f"{path.name}: duplicate kind {doc.kind!r}")
        out[doc.kind] = doc
    return out


def reset_cache() -> None:
    """Clear the load_all cache. Used in tests."""
    load_all.cache_clear()


def get(kind: str) -> SchemaDoc:
    """Look up a schema by kind. KeyError if missing."""
    registry = load_all()
    if kind not in registry:
        raise KeyError(f"unknown finding kind: {kind!r}. Known: {sorted(registry)}")
    return registry[kind]


# ─────────────────────────────────────────────────────────────────────────────
# Payload validation
# ─────────────────────────────────────────────────────────────────────────────

class ValidationResult(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    coerced: dict[str, Any] = Field(default_factory=dict)


def validate(kind: str, payload: dict[str, Any]) -> ValidationResult:
    """Validate a finding payload against its schema.

    Returns a ValidationResult with `ok`, any errors, and a `coerced` dict
    that has defaults filled in and types coerced where possible. Does NOT
    write anything — purely a check."""
    schema = get(kind)
    errors: list[str] = []
    coerced: dict[str, Any] = {}

    declared = {f.key: f for f in schema.fields}

    # Required fields present?
    for f in schema.fields:
        present = f.key in payload and payload[f.key] not in (None, "")
        if f.required and not present:
            if f.default is not None:
                coerced[f.key] = _resolve_default(f.default)
            else:
                errors.append(f"missing required field {f.key!r}")
        elif present:
            value, err = _coerce_value(f, payload[f.key])
            if err:
                errors.append(f"{f.key}: {err}")
            else:
                coerced[f.key] = value
        elif f.default is not None:
            coerced[f.key] = _resolve_default(f.default)

    # Unknown fields?
    for k in payload.keys():
        if k not in declared:
            errors.append(f"unknown field {k!r} (not in schema {kind!r})")

    return ValidationResult(ok=not errors, errors=errors, coerced=coerced)


def _resolve_default(default: Any) -> Any:
    if default == "today":
        return date.today()
    if default == "now":
        return datetime.now(timezone.utc)
    return default


def _coerce_value(field: FieldDef, value: Any) -> tuple[Any, str | None]:
    """Coerce a raw value to the field's declared type. Returns (value, error)."""
    t = field.type
    try:
        if t in ("string", "text"):
            if not isinstance(value, str):
                return None, f"expected string, got {type(value).__name__}"
            return value, None
        if t == "int":
            return int(value), None
        if t == "bool":
            if isinstance(value, bool):
                return value, None
            if isinstance(value, str) and value.lower() in ("true", "false"):
                return value.lower() == "true", None
            return None, f"expected bool, got {value!r}"
        if t == "date":
            if isinstance(value, date) and not isinstance(value, datetime):
                return value, None
            if isinstance(value, str):
                return date.fromisoformat(value), None
            return None, f"expected date, got {type(value).__name__}"
        if t == "datetime":
            if isinstance(value, datetime):
                return value, None
            if isinstance(value, str):
                return datetime.fromisoformat(value.replace("Z", "+00:00")), None
            return None, f"expected datetime, got {type(value).__name__}"
        if t == "enum":
            if value not in (field.values or []):
                return None, f"expected one of {field.values}, got {value!r}"
            return value, None
        if t == "list":
            if not isinstance(value, list):
                return None, f"expected list, got {type(value).__name__}"
            return value, None
        if t == "uuid_ref":
            return str(value), None  # uuid is opaque here
    except (ValueError, TypeError) as e:
        return None, str(e)
    return value, None


# ─────────────────────────────────────────────────────────────────────────────
# Frontmatter rendering
# ─────────────────────────────────────────────────────────────────────────────

def render_frontmatter(kind: str, payload: dict[str, Any]) -> str:
    """Render the YAML frontmatter block for a finding.

    Includes a closing `---` and trailing newline. Skips fields with
    `frontmatter: false` or `secret: true`. Adds `tags`, `aliases`, and
    `cssclasses` from the schema's `classification` block, with template
    placeholders like `{{priority}}` filled from the payload."""
    schema = get(kind)
    lines: list[str] = ["---"]

    for f in schema.fields:
        if not f.frontmatter or f.secret:
            continue
        if f.key not in payload or payload[f.key] in (None, ""):
            continue
        value = payload[f.key]
        lines.append(f"{f.key}: {_yaml_scalar(value)}")

    # category — derived from kind
    lines.append(f"category: {schema.kind}")

    # tags
    tags = _interpolate_tokens(schema.classification.default_tags, payload)
    if tags:
        lines.append(f"tags: [{', '.join(tags)}]")

    # aliases — display id if present
    if schema.id_field:
        idv = payload.get(schema.id_field)
        if idv:
            lines.append(f"aliases: [{idv}]")

    # cssclasses
    css = _interpolate_tokens(schema.classification.cssclasses, payload)
    if css:
        lines.append(f"cssclasses: [{', '.join(css)}]")

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def _yaml_scalar(value: Any) -> str:
    """Tiny scalar serializer that quotes strings safely."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat() if isinstance(value, datetime) else value.strftime("%Y-%m-%d")
    if isinstance(value, list):
        return "[" + ", ".join(_yaml_scalar(v) for v in value) + "]"
    s = str(value)
    if any(ch in s for ch in ":#\n\"'") or s.strip() != s:
        escaped = s.replace('"', '\\"')
        return f'"{escaped}"'
    return s


_TOKEN_RE = re.compile(r"\{\{(\w+)\}\}")


def _interpolate_tokens(items: list[str], payload: dict[str, Any]) -> list[str]:
    """Replace `{{field}}` tokens in classification strings with payload values.

    Items whose tokens cannot be resolved are dropped (rather than rendering
    a literal `{{x}}` to disk)."""
    out: list[str] = []
    for item in items:
        try:
            replaced = _TOKEN_RE.sub(
                lambda m: str(payload.get(m.group(1), "")) or _raise_missing(m.group(1)),
                item,
            )
            out.append(replaced)
        except _MissingToken:
            continue
    return out


class _MissingToken(Exception):
    pass


def _raise_missing(name: str) -> str:
    raise _MissingToken(name)


# ─────────────────────────────────────────────────────────────────────────────
# Section rendering
# ─────────────────────────────────────────────────────────────────────────────

def render_section(section: SectionDef, payload: dict[str, Any]) -> list[str]:
    """Render a single body section. Returns a list of markdown lines (no
    trailing blank line — caller joins). Returns [] if there's nothing to
    render and the section isn't required."""
    if section.format == "paragraphs":
        text = payload.get(section.source_field or "")
        if not text and not section.required:
            return []
        body = (text or "").strip()
        return [f"## {section.name}", "", body] if section.name != "body" else [body]

    if section.format == "blockquote":
        text = payload.get(section.source_field or "")
        if not text:
            return [] if not section.required else [f"## {section.name}", "", "> (no quote)"]
        return [f"## {section.name}", "", f'> "{text}"']

    if section.format == "bullets":
        items = payload.get(section.generated_from or section.source_field or "") or []
        if not items and not section.required:
            return []
        out = [f"## {section.name}", ""]
        if not items:
            out.append("- (none)")
        else:
            out.extend(f"- {item}" for item in items)
        return out

    if section.format == "wikilinks":
        items = payload.get(section.generated_from or section.source_field or "") or []
        if not items and not section.required:
            return []
        out = [f"## {section.name}", ""]
        if not items:
            out.append("- (none)")
        else:
            out.extend(f"- [[{item}]]" for item in items)
        return out

    return []


def render_body(kind: str, payload: dict[str, Any]) -> str:
    """Render the full body for a finding (frontmatter + heading + sections).

    Caller is responsible for choosing the file path; this function only
    produces the bytes."""
    schema = get(kind)
    parts: list[str] = []
    parts.append(render_frontmatter(kind, payload))

    # Heading: prefer "{display_id}: {title}" if both exist
    display_id = payload.get(schema.id_field) if schema.id_field else None
    title = payload.get("title") or payload.get("name") or payload.get("question") or display_id
    if display_id and title and title != display_id:
        parts.append(f"# {display_id}: {title}\n")
    elif title:
        parts.append(f"# {title}\n")

    for section in schema.sections:
        lines = render_section(section, payload)
        if lines:
            parts.append("\n".join(lines) + "\n")

    return "\n".join(parts).rstrip() + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: filename for a finding
# ─────────────────────────────────────────────────────────────────────────────

def filename_for(kind: str, payload: dict[str, Any]) -> str:
    """Return the on-disk filename for a finding (without folder)."""
    schema = get(kind)
    if schema.id_field:
        idv = payload.get(schema.id_field)
        if idv:
            safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(idv))
            return f"{safe}.md"
    title = payload.get("title") or payload.get("name") or payload.get("question") or "untitled"
    safe = re.sub(r"[^A-Za-z0-9._\s-]+", "_", str(title))[:80].strip()
    return f"{safe}.md"
