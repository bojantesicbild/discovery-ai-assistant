"""Per-kind markdown rendering and vault landing page generation.

Extracted from tasks.py. This module owns all of the per-kind markdown
rendering (render_*_text, *_to_payload) and the three vault landing-page
generators (write_dashboard, write_hot, write_schema_md). tasks.py imports
the public API from here instead of defining these functions inline.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from app.services import schema_lib, raw_store

if TYPE_CHECKING:
    from app.models.document import Document


# ---------------------------------------------------------------------------
# Vault landing pages
# ---------------------------------------------------------------------------


def write_dashboard(
    vault_root,
    reqs_rows,
    constraints,
    gaps_rows,
    stakeholders,
    readiness: dict,
    lint_summary: dict | None = None,
):
    """Generate `.memory-bank/dashboard.md` — a Dataview-driven landing
    page that surfaces what needs attention. Requires the Dataview
    plugin (bundled in assistants/.obsidian/community-plugins.json).

    Each section uses a `dataview` code block which Obsidian's Dataview
    plugin renders as a live table. Outside Obsidian (e.g. on GitHub)
    the blocks render as code which is harmless.

    `lint_summary` is the dict returned by
    `app.services.vault_lint.LintReport.summary()`. When provided, the
    dashboard renders a "Vault health" section so the PM sees drift
    (broken wikilinks, missing source_raw, etc.) without having to run
    the lint CLI. Optional so tests that don't care about lint can
    still call this."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    score = readiness.get("score", 0)

    # Static counters that aren't Dataview-dependent — useful when
    # opening the file in plain markdown viewers.
    open_gaps = sum(1 for g, _, _ in gaps_rows if g.status == "open")
    high_gaps = sum(1 for g, _, _ in gaps_rows if g.status == "open" and g.severity == "high")
    unconfirmed = sum(1 for r, _, _ in reqs_rows if r.status != "confirmed")
    must_haves = sum(1 for r, _, _ in reqs_rows if r.priority == "must")

    lines = [
        "---",
        "category: dashboard",
        f"updated: {now}",
        f"readiness: {score}",
        "tags: [dashboard]",
        "cssclasses: [dashboard]",
        "---",
        "",
        "# Discovery Dashboard",
        "",
        f"_Last updated: {now}_",
        "",
        "## At a glance",
        "",
        f"- **Readiness:** {score}%",
        f"- **Requirements:** {len(reqs_rows)} total · {must_haves} must-have · **{unconfirmed} unconfirmed**",
        f"- **Gaps:** {len(gaps_rows)} total · **{open_gaps} open** · {high_gaps} high-severity",
        f"- **Constraints:** {len(constraints)}",
        f"- **Stakeholders:** {len(stakeholders)}",
        "",
        "---",
        "",
    ]

    if lint_summary is not None:
        from app.services.vault_lint import format_dashboard_section
        lines += format_dashboard_section(lint_summary)
        lines += ["", "---", ""]

    lines += [
        "## Open gaps (by severity)",
        "",
        "```dataview",
        "TABLE severity, area, status, blocked_reqs",
        'FROM "docs/discovery/gaps"',
        'WHERE status = "open"',
        "SORT severity DESC, area ASC",
        "```",
        "",
        "## Unconfirmed requirements",
        "",
        "```dataview",
        "TABLE priority, status, confidence, source_person",
        'FROM "docs/discovery/requirements"',
        'WHERE status != "confirmed"',
        "SORT priority ASC, status ASC",
        "```",
        "",
        "## Must-have requirements",
        "",
        "```dataview",
        "TABLE status, confidence, source_doc",
        'FROM "docs/discovery/requirements"',
        'WHERE priority = "must"',
        "SORT status ASC, file.name ASC",
        "```",
        "",
        "## Constraints by type",
        "",
        "```dataview",
        "TABLE type, status",
        'FROM "docs/discovery/constraints"',
        "SORT type ASC, status ASC",
        "```",
        "",
        "## Recently ingested",
        "",
        "```dataview",
        "TABLE source_origin AS source, source_raw AS original, date",
        'FROM "docs/discovery/requirements"',
        "WHERE source_raw",
        "SORT date DESC",
        "LIMIT 15",
        "```",
        "",
        "## Stale unconfirmed (>14 days, still proposed)",
        "",
        "```dataview",
        "TABLE priority, confidence, date",
        'FROM "docs/discovery/requirements"',
        'WHERE status = "proposed" AND date < date(today) - dur(14 days)',
        "SORT date ASC",
        "```",
        "",
        "---",
        "",
        "## Quick links",
        "",
        "- [[index|Discovery wiki index]]",
        "- [[log|Operation log]]",
        "- [Open gaps folder](docs/discovery/gaps/)",
        "- [Requirements folder](docs/discovery/requirements/)",
        "- [Raw sources](.raw/)",
        "",
        "---",
        "",
        "_This file is auto-generated by the discovery pipeline after every ingest._",
        "_Edit the schemas in `assistants/.claude/schemas/` instead of editing this file directly._",
    ]
    (vault_root / "dashboard.md").write_text("\n".join(lines), encoding="utf-8")


def write_hot(vault_root, doc: "Document", reqs_rows, gaps_rows, readiness: dict):
    """Generate `.memory-bank/hot.md` — the warm-context carry-over file
    that the next agent session loads on startup.

    Distilled, short, cheap to read. Answers: "if I had 30 seconds to
    catch up before this agent session, what should I know?"

    Pulled into the agent's startup context via SKILL.md / CLAUDE.md so
    fresh sessions don't have to re-derive what's currently in flux."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    score = readiness.get("score", 0)

    # The most recently ingested document (this run)
    last_doc = doc.filename if doc else "unknown"
    last_source = (doc.classification or {}).get("source", "upload") if doc else "unknown"

    # Top 3 high-severity open gaps
    high_gaps = [g for g, _, _ in gaps_rows if g.status == "open" and g.severity == "high"]
    high_gaps.sort(key=lambda g: g.gap_id)
    top_gaps = high_gaps[:3]

    # Top 3 unconfirmed must-have requirements
    must_unconfirmed = [r for r, _, _ in reqs_rows if r.priority == "must" and r.status != "confirmed"]
    must_unconfirmed.sort(key=lambda r: r.req_id)
    top_must = must_unconfirmed[:3]

    lines = [
        "---",
        "category: hot-context",
        f"updated: {now}",
        f"readiness: {score}",
        "tags: [hot, context]",
        "---",
        "",
        "# What's Hot",
        "",
        f"_Snapshot at {now} · readiness **{score}%**_",
        "",
        "## Just ingested",
        "",
        f"- **{last_doc}** ({last_source})",
        "",
    ]

    if top_gaps:
        lines.append("## High-severity open gaps (top 3)")
        lines.append("")
        for g in top_gaps:
            q = (g.question or "")[:90]
            lines.append(f"- [[{g.gap_id}]] — {q}")
            if g.blocked_reqs:
                blocked = ", ".join(f"[[{rid}]]" for rid in g.blocked_reqs[:3])
                lines.append(f"  - blocks: {blocked}")
        lines.append("")

    if top_must:
        lines.append("## Unconfirmed must-haves (top 3)")
        lines.append("")
        for r in top_must:
            lines.append(f"- [[{r.req_id}]] — {r.title} _({r.status}, {r.confidence})_")
        lines.append("")

    lines.extend([
        "---",
        "",
        "## Context links",
        "",
        "- [[dashboard|Project dashboard]]",
        "- [[docs/discovery/index|Discovery wiki index]]",
        "- [[docs/discovery/log|Operation log]]",
        "",
        "_Auto-generated after every ingest. Read by the agent on session start._",
    ])

    (vault_root / "hot.md").write_text("\n".join(lines), encoding="utf-8")


def write_schema_md(vault_root):
    """Generate `.memory-bank/schema.md` — human-readable catalog of every
    finding kind the system understands. Mirrors the YAML schemas in
    assistants/.claude/schemas/ but rendered for humans.

    The agent reads this on session startup so it knows what fields
    exist, what enum values are valid, and where each kind lives. The
    human reads this when they want to understand the data model.

    Generated from `schema_lib.load_all()` so editing a YAML schema
    automatically updates the markdown on the next pipeline run."""
    registry = schema_lib.load_all()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines: list[str] = [
        "---",
        "category: schema-catalog",
        f"updated: {now}",
        "tags: [schema, catalog]",
        "---",
        "",
        "# Discovery Schemas",
        "",
        f"_Generated {now} from `assistants/.claude/schemas/*.yaml` —_",
        "_DO NOT EDIT THIS FILE BY HAND. Edit the YAML and re-run the pipeline._",
        "",
        "This is the canonical catalog of every kind of finding the discovery",
        "pipeline understands. Each kind has a schema YAML that drives the",
        "on-disk frontmatter, the MCP store_finding validator, and the",
        "Obsidian Templater templates.",
        "",
        "## Kinds at a glance",
        "",
        "| Kind | Display ID | Folder | Required fields |",
        "|---|---|---|---|",
    ]
    for kind in sorted(registry):
        s = registry[kind]
        prefix = s.prefix or "—"
        required = [f.key for f in s.fields if f.required]
        req_label = ", ".join(required[:5]) + ("…" if len(required) > 5 else "")
        lines.append(f"| **{s.display_name}** (`{kind}`) | {prefix}-NNN | `{s.folder}/` | {req_label} |")

    lines.append("")
    lines.append("---")
    lines.append("")

    # Per-kind detail
    for kind in sorted(registry):
        s = registry[kind]
        lines.append(f"## {s.display_name} (`{kind}`)")
        lines.append("")
        if s.prefix:
            lines.append(f"- **Display ID prefix:** `{s.prefix}-NNN`")
        if s.id_field:
            lines.append(f"- **Identifier field:** `{s.id_field}`")
        lines.append(f"- **Folder:** `{s.folder}/`")
        lines.append(f"- **SQLAlchemy model:** `{s.model}`")
        if s.classification.cssclasses:
            lines.append(f"- **Visual class:** {', '.join('`' + c + '`' for c in s.classification.cssclasses)}")
        lines.append("")

        # Fields table
        lines.append("**Fields**")
        lines.append("")
        lines.append("| Field | Type | Required | Default | In frontmatter | Notes |")
        lines.append("|---|---|---|---|---|---|")
        for f in s.fields:
            t = f.type
            if t == "enum" and f.values:
                t = "enum[" + " \\| ".join(f.values) + "]"
            req = "✓" if f.required else ""
            default = "—"
            if f.default is not None:
                default = f"`{f.default}`"
            in_fm = "✓" if f.frontmatter else ""
            notes = f.description or ""
            if f.db_column and f.db_column != f.key:
                notes = f"db col: `{f.db_column}` · {notes}".rstrip(" ·")
            lines.append(f"| `{f.key}` | {t} | {req} | {default} | {in_fm} | {notes} |")
        lines.append("")

        # Sections
        if s.sections:
            lines.append("**Body sections** (rendered after the H1)")
            lines.append("")
            for section in s.sections:
                src = f" from `{section.source_field}`" if section.source_field else ""
                gen = f" generated from `{section.generated_from}`" if section.generated_from else ""
                req_marker = " (required)" if section.required else ""
                if section.name == "body":
                    lines.append(f"- _body paragraph_{src}{req_marker}")
                else:
                    lines.append(f"- **{section.name}** ({section.format}){src}{gen}{req_marker}")
            lines.append("")

        # Relationships
        if s.relationships:
            lines.append("**Relationships**")
            lines.append("")
            for rel in s.relationships:
                derived = f" — _derived: {rel.derived}_" if rel.derived else ""
                lines.append(f"- `{rel.name}` → `{rel.target}`{derived}")
            lines.append("")

        if s.extraction_prompt:
            lines.append("**Extraction prompt** (what the agent reads when extracting this kind)")
            lines.append("")
            lines.append("```")
            lines.append(s.extraction_prompt.strip())
            lines.append("```")
            lines.append("")

        lines.append("---")
        lines.append("")

    lines.extend([
        "## How to add a new field",
        "",
        "1. Edit `assistants/.claude/schemas/{kind}.yaml`",
        "2. Run `cd backend && .venv/bin/python -m tests.check_schemas` — should still pass",
        "3. Run `assistants/.claude/scripts/render-templates.py` to regenerate the agent + Obsidian templates",
        "4. The next pipeline ingest will pick the new field up automatically — no Python code change required (frontmatter only).",
        "",
        "## How to add a new finding kind",
        "",
        "1. Add `assistants/.claude/schemas/{new_kind}.yaml` (model after existing schemas)",
        "2. Add the SQLAlchemy model in `backend/app/models/extraction.py`",
        "3. Add an Alembic migration for the table",
        "4. Add a per-row writer in `backend/app/pipeline/tasks.py` (mirror `requirement_to_payload` + `render_requirement_text`)",
        "5. Add an MCP store_finding branch in `mcp-server/db_server.py`",
        "6. Run `tests.check_schemas` and `tests.check_mcp_inserts` to verify",
        "",
        f"_Total kinds: {len(registry)} · See `assistants/.claude/schemas/_meta.md` for the schema YAML format._",
    ])

    (vault_root / "schema.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Hand-edit preserving writer
# ---------------------------------------------------------------------------

HAND_EDIT_MARKER = (
    "<!-- END-GENERATED — hand-edits below this line are preserved across pipeline re-renders -->"
)


def write_with_hand_edits(path: Path, generated_text: str) -> None:
    """Write generated markdown to `path`, preserving any hand-edits below
    the END-GENERATED marker.

    The contract, visible in-vault:
    - Everything ABOVE the marker is owned by the pipeline and replaced
      on every re-render.
    - Everything BELOW the marker is owned by the PM and carried forward
      verbatim, byte-for-byte.

    Behaviour:
    - File missing: write `{generated}\\n\\n{MARKER}\\n` (establishes
      the contract going forward).
    - File exists with marker: replace everything up to and including
      the marker, preserve the tail verbatim.
    - File exists without marker (legacy): treat whole file as generated
      and overwrite. The fresh write installs the marker, so future runs
      preserve any hand-edits added after this one.

    Only applied to per-item files (requirements, gaps, decisions, etc.).
    Landing pages (dashboard.md, hot.md, schema.md) stay full-overwrite
    because they are derived views, not capture surfaces."""
    new_body = generated_text.rstrip("\n")
    hand_edits = ""

    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if HAND_EDIT_MARKER in existing:
            _, _, tail = existing.partition(HAND_EDIT_MARKER)
            hand_edits = tail

    if hand_edits:
        out = f"{new_body}\n\n{HAND_EDIT_MARKER}{hand_edits}"
    else:
        out = f"{new_body}\n\n{HAND_EDIT_MARKER}\n"

    path.write_text(out, encoding="utf-8")


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------


def stakeholder_filename_safe(name: str) -> str:
    """Mirror of the sanitization the stakeholder writer uses for filenames.

    Stakeholder notes live at people/{safe_name}.md where unsafe characters
    become underscores. Wikilinks pointing at people from other notes
    must use this same sanitized form to actually resolve to the file."""
    safe = re.sub(r"[^\w\s-]", "_", name or "").strip().replace(" ", "_")[:80]
    return safe or "unnamed"


# ---------------------------------------------------------------------------
# Payload builders — pure functions, no DB access
# ---------------------------------------------------------------------------


def requirement_to_payload(
    r,
    doc_name: str | None,
    doc_class: dict | None,
    today: str,
    co_extracted: list[str],
) -> dict:
    """Build the writer-input payload from a Requirement SQLAlchemy row.

    Pure function — no DB access. Co-extracted siblings are pre-computed
    by the caller because they require cross-row knowledge that the
    renderer shouldn't have to query."""
    return {
        "id": r.req_id,
        "title": r.title or "",
        "priority": r.priority or "should",
        "status": r.status or "proposed",
        "confidence": r.confidence or "medium",
        "source_doc": doc_name or "unknown",
        "source_person": r.source_person or "unknown",
        "version": r.version or 1,
        "date": today,
        "description": r.description or "",
        "user_perspective": r.user_perspective or "",
        "business_rules": list(r.business_rules or []),
        "edge_cases": list(r.edge_cases or []),
        "acceptance_criteria": list(r.acceptance_criteria or []),
        # Session-2 additions: absorb decision/scope info that used to
        # live in separate kinds. All optional — missing fields render
        # as empty sections and the markdown stays clean.
        "rationale": r.rationale or "",
        "alternatives_considered": list(r.alternatives_considered or []),
        "scope_note": r.scope_note or "",
        "blocked_by": list(r.blocked_by or []),
        "source_quote": r.source_quote or "",
        "sources": list(r.sources or []),
        "co_extracted": co_extracted,
        # Source raw + origin only set when document was ingested via
        # Gmail / Drive / upload / Slack (Phase 4a).
        "_doc_class": doc_class or {},
    }


def constraint_to_payload(
    con,
    con_id: str,
    today: str,
    affected_reqs: list[str],
) -> dict:
    """Build the writer-input payload from a Constraint SQLAlchemy row.

    `affected_reqs` is the derived (same-source-doc) list. The explicit
    `affects_reqs` stored by the agent takes precedence when present — if
    the agent linked the constraint to specific BRs, we trust that over
    the ambient co-source heuristic."""
    explicit = list(getattr(con, "affects_reqs", None) or [])
    return {
        "id": con_id,
        "title": f"{con.type}: {(con.description or '')[:50]}",
        "type": con.type,
        "description": con.description or "",
        "impact": con.impact or "",
        "status": con.status or "assumed",
        "source_quote": con.source_quote or "",
        "source_person": getattr(con, "source_person", None) or "",
        "workaround": getattr(con, "workaround", None) or "",
        "date": today,
        "affected_reqs": explicit or affected_reqs,
    }


def gap_to_payload(g, doc_name: str | None, today: str, doc_class: dict | None = None) -> dict:
    """Build the writer-input payload from a Gap SQLAlchemy row."""
    return {
        "id": g.gap_id,
        "question": g.question or "",
        "kind": getattr(g, "kind", None) or "missing_info",
        "severity": g.severity or "medium",
        "area": g.area or "general",
        "status": g.status or "open",
        "source_doc": doc_name or "unknown",
        "source_person": g.source_person or "unknown",
        "blocked_reqs": list(g.blocked_reqs or []),
        "suggested_action": g.suggested_action or "",
        "source_quote": g.source_quote or "",
        "resolution": g.resolution or "",
        # Closure accountability fields (migration 015/016). Kept as None
        # when the gap is still open, so the frontmatter reads cleanly.
        "closed_at": g.closed_at.isoformat() if g.closed_at else None,
        "closed_by": g.closed_by,
        "assignee": g.assignee,
        "date": today,
        "_doc_class": doc_class or {},
    }


def stakeholder_to_payload(
    s,
    today: str,
    person_reqs: list[tuple[str, str]],
) -> dict:
    """Build the writer-input payload from a Stakeholder SQLAlchemy row.

    `person_reqs` is a pre-computed list of (req_id, title) tuples for
    requirements this person requested."""
    return {
        "name": s.name,
        "role": s.role or "",
        "organization": s.organization or "",
        "decision_authority": s.decision_authority or "informed",
        "interests": list(s.interests or []),
        "date": today,
        "_person_reqs": person_reqs,
    }


def contradiction_to_payload(ctr, ctr_id: str, today: str) -> dict:
    """Build the writer-input payload from a Contradiction SQLAlchemy row.

    Since migration 025 the first-class fields (title / side_a / side_b /
    area) are the canonical story. Legacy item_a_* / item_b_* are kept
    for the rare case where the agent mapped to real DB rows, but the
    renderer prefers the native fields."""
    return {
        "id": ctr_id,
        "title": ctr.title or "",
        "side_a": ctr.side_a or "",
        "side_b": ctr.side_b or "",
        "area": ctr.area or "",
        "side_a_source": ctr.side_a_source or "",
        "side_a_person": ctr.side_a_person or "",
        "side_b_source": ctr.side_b_source or "",
        "side_b_person": ctr.side_b_person or "",
        "item_a_type": ctr.item_a_type or "",
        "item_a_id": str(ctr.item_a_id) if ctr.item_a_id else "",
        "item_b_type": ctr.item_b_type or "",
        "item_b_id": str(ctr.item_b_id) if ctr.item_b_id else "",
        "explanation": ctr.explanation or "",
        "resolved": bool(ctr.resolved),
        "resolution_note": ctr.resolution_note or "",
        "date": today,
    }


# ---------------------------------------------------------------------------
# Renderers — convert a payload dict to a markdown string
# ---------------------------------------------------------------------------


def render_requirement_text(
    payload: dict,
    *,
    reqs_dir: "Path | None" = None,
    original_text: str | None = None,
) -> str:
    """Render a single requirement note as markdown.

    Phase 2B step 2: the YAML frontmatter is now produced by
    `schema_lib.render_frontmatter("requirement", payload)` so any
    schema edit (new field, renamed field, dropped field) automatically
    propagates to the on-disk output. Body sections (Source, People,
    Related, Sources) stay hand-built for now — they have per-row
    formatting (wikilinks, custom labels, raw backlinks) that doesn't
    fit cleanly into the simple schema_lib section primitives. Phase
    2B step 3 can refactor those if/when we extend schema_lib's body
    renderer.

    `reqs_dir` is the directory the file lives in (used to compute the
    `source_raw:` relative path). When None, source_raw is left as
    whatever's already in the payload (allows pre-resolved paths from
    the parity test).
    `original_text` is accepted but unused — kept so the parity test
    can pass it without a special-case."""
    rid = payload["id"]
    title = payload.get("title", "")
    source_doc_name = payload.get("source_doc") or "unknown"
    person = payload.get("source_person") or "unknown"
    sources_list = payload.get("sources") or []
    co_extracted = payload.get("co_extracted") or []
    doc_class = payload.get("_doc_class") or {}

    # Resolve source_raw to a relative path (or accept a pre-resolved one
    # from the parity test). The schema declares source_raw and
    # source_origin as frontmatter fields, so we set them in the payload
    # and let render_frontmatter pick them up.
    raw_rel: str | None = None
    if doc_class.get("source_raw_path"):
        raw_path_str = doc_class["source_raw_path"]
        if reqs_dir is not None and Path(raw_path_str).is_absolute():
            try:
                raw_rel = raw_store.relative_source_raw(Path(raw_path_str), reqs_dir)
            except Exception:
                raw_rel = None
        else:
            raw_rel = raw_path_str
    if raw_rel:
        payload["source_raw"] = raw_rel
    if doc_class.get("source"):
        payload["source_origin"] = doc_class["source"]

    # Frontmatter from schema — single source of truth for fields,
    # types, defaults, tags, aliases, cssclasses, category.
    fm_block = schema_lib.render_frontmatter("requirement", payload)

    # Body sections — hand-built for now (Phase 2B step 3 territory).
    # User Perspective / Business Rules / Acceptance Criteria / Edge Cases
    # are the BR fields the downstream chain (tech-stories, QA) needs —
    # surfacing them here keeps the Obsidian view aligned with the DB.
    lines: list[str] = [
        f"# {rid}: {title}",
        "",
        payload.get("description") or "",
        "",
        "## Source",
        f"> \"{payload.get('source_quote', '')}\"" if payload.get("source_quote") else "> (no quote)",
    ]

    user_perspective = payload.get("user_perspective") or ""
    if user_perspective:
        lines += ["", "## User Perspective", user_perspective]

    business_rules = payload.get("business_rules") or []
    if business_rules:
        lines += ["", "## Business Rules"]
        for rule in business_rules:
            lines.append(f"- {rule}")

    acceptance_criteria = payload.get("acceptance_criteria") or []
    if acceptance_criteria:
        lines += ["", "## Acceptance Criteria"]
        for ac in acceptance_criteria:
            lines.append(f"- {ac}")

    edge_cases = payload.get("edge_cases") or []
    if edge_cases:
        lines += ["", "## Edge Cases"]
        for ec in edge_cases:
            lines.append(f"- {ec}")

    # Session-2 BR sections: rationale + alternatives + scope_note +
    # blocked_by absorb what used to live in decisions / scope / assumptions.
    # All optional — we only emit the header when there's content.
    rationale = payload.get("rationale") or ""
    if rationale:
        lines += ["", "## Rationale", rationale]

    alternatives = payload.get("alternatives_considered") or []
    if alternatives:
        lines += ["", "## Alternatives considered"]
        for alt in alternatives:
            lines.append(f"- {alt}")

    scope_note = payload.get("scope_note") or ""
    if scope_note:
        lines += ["", "## Scope note", scope_note]

    blocked_by = payload.get("blocked_by") or []
    if blocked_by:
        lines += ["", "## Blocked by"]
        for br in blocked_by:
            lines.append(f"- [[{br}]]")

    lines += [
        "",
        "## People",
    ]
    if person and person != "unknown":
        lines.append(f"- [[{stakeholder_filename_safe(person)}|{person}]] — requested")
    else:
        lines.append("- (unknown)")

    lines.append("")
    lines.append("## Related")
    for other in co_extracted:
        lines.append(f"- [[{other}]] — co-extracted")

    lines.append("")
    lines.append("## Sources")
    if raw_rel:
        # Source has a .raw/ payload — markdown link resolves in
        # Obsidian instead of an orphan wikilink
        lines.append(f"- [{source_doc_name}]({raw_rel}) — original extraction")
    elif source_doc_name and source_doc_name != "unknown":
        # Legacy: source predates .raw/. Plain text — no broken link.
        lines.append(f"- {source_doc_name} — original extraction")
    else:
        lines.append("- _(no source document)_")
    for src in sources_list:
        fname = src.get("filename", "unknown")
        # Per-merge sources are plain text too — usually legacy uploads
        lines.append(f"- {fname} — v{payload.get('version', 1)} merge")

    if raw_rel:
        lines.append(f"- [Original source]({raw_rel})")

    lines.append("")
    return fm_block + "\n".join(lines)


def render_constraint_text(
    payload: dict,
    *,
    original_text: str | None = None,
) -> str:
    """Render a single constraint note as markdown.

    Frontmatter comes from `schema_lib.render_frontmatter("constraint",
    payload)` so any schema edit propagates automatically. Body sections
    (## Impact, ## Source, ## Affected Requirements) are hand-built —
    they have per-row formatting that doesn't fit schema_lib's section
    primitives yet.

    `original_text` is unused — kept for parity-test API compatibility."""
    cid = payload["id"]
    con_type = payload.get("type", "")
    description = payload.get("description") or ""
    impact = payload.get("impact") or "Not specified"
    source_quote = payload.get("source_quote") or ""
    source_person = payload.get("source_person") or ""
    workaround = payload.get("workaround") or ""
    affected = payload.get("affected_reqs") or []

    fm_block = schema_lib.render_frontmatter("constraint", payload)

    lines: list[str] = [
        f"# {cid}: {con_type} constraint",
        "",
        description,
        "",
        "## Impact",
        impact,
        "",
    ]
    if source_quote:
        lines.append("## Source")
        lines.append(f'> "{source_quote}"')
        lines.append("")
    if source_person:
        lines.append(f"## Raised by\n- [[{stakeholder_filename_safe(source_person)}|{source_person}]]")
        lines.append("")
    if workaround:
        lines.append("## Workaround")
        lines.append(workaround)
        lines.append("")
    lines.append("## Affected Requirements")
    for rid in affected:
        lines.append(f"- [[{rid}]] — constrained")
    lines.append("")

    return fm_block + "\n".join(lines)


def render_gap_text(
    payload: dict,
    *,
    gaps_dir: "Path | None" = None,
    original_text: str | None = None,
) -> str:
    """Render a single gap note as markdown.

    Frontmatter from `schema_lib.render_frontmatter("gap", payload)`.
    Body sections hand-built. The `## Source Documents` section now
    uses a markdown link to `.raw/...` when the source document was
    ingested via Phase 4a (gmail / drive / upload), and falls back to
    plain text (no wikilink) otherwise — avoids the broken-wikilink
    drift that lint was warning about.

    `gaps_dir` is the directory the file lives in (for source_raw
    relative path computation). `original_text` is unused — kept for
    parity-test API compatibility."""
    gid = payload["id"]
    question = payload.get("question", "")
    g_doc = payload.get("source_doc") or "unknown"
    g_person = payload.get("source_person") or "unknown"
    blocked = payload.get("blocked_reqs") or []
    suggested = payload.get("suggested_action") or ""
    source_quote = payload.get("source_quote") or ""
    doc_class = payload.get("_doc_class") or {}

    # Resolve source_raw to a relative path so the source document
    # link points at .raw/ instead of an orphan wikilink
    raw_rel: str | None = None
    if doc_class.get("source_raw_path"):
        raw_path_str = doc_class["source_raw_path"]
        if gaps_dir is not None and Path(raw_path_str).is_absolute():
            try:
                raw_rel = raw_store.relative_source_raw(Path(raw_path_str), gaps_dir)
            except Exception:
                raw_rel = None
        else:
            raw_rel = raw_path_str
    if raw_rel:
        payload["source_raw"] = raw_rel
    if doc_class.get("source"):
        payload["source_origin"] = doc_class["source"]

    fm_block = schema_lib.render_frontmatter("gap", payload)

    # Surface gap.kind as a subtitle when it's not the default, so
    # "unvalidated assumption" vs "missing info" reads at a glance.
    kind = payload.get("kind") or "missing_info"
    kind_labels = {
        "missing_info": "",
        "unvalidated_assumption": "_Unvalidated assumption_",
        "undecided": "_Undecided — needs a call_",
    }
    kind_line = kind_labels.get(kind, "")

    lines: list[str] = [
        f"# {gid}: {question}",
        "",
    ]
    if kind_line:
        lines += [kind_line, ""]
    if suggested:
        lines.append(suggested)
        lines.append("")
    if source_quote:
        lines.append("## Source")
        lines.append(f'> "{source_quote}"')
        lines.append("")
    if g_person and g_person != "unknown":
        lines.append("## Ask")
        lines.append(f"- [[{stakeholder_filename_safe(g_person)}|{g_person}]] — ask")
        lines.append("")
    if blocked:
        lines.append("## Blocked Requirements")
        for br in blocked:
            lines.append(f"- [[{br}]] — blocked")
        lines.append("")

    lines.append("## Source Documents")
    if raw_rel:
        # Markdown link to the .raw/ original — clickable in Obsidian,
        # never broken because it points at an in-vault file
        lines.append(f"- [{g_doc}]({raw_rel})")
    elif g_doc and g_doc != "unknown":
        # Legacy: source predates .raw/ flow. Plain text — no broken
        # wikilink. Lint stays clean.
        lines.append(f"- {g_doc}")
    else:
        lines.append("- _(no source document)_")
    lines.append("")

    # Closure section — only rendered when the gap is resolved/dismissed.
    # Gives the Obsidian reader the same closure context the UI shows:
    # who closed it, when, and what the answer was.
    status = payload.get("status") or "open"
    resolution = payload.get("resolution") or ""
    closed_at = payload.get("closed_at")
    closed_by = payload.get("closed_by")
    assignee = payload.get("assignee")
    if status in ("resolved", "dismissed"):
        heading = "Dismissal" if status == "dismissed" else "Resolution"
        lines.append(f"## {heading}")
        lines.append("")
        lines.append(resolution or "_(no resolution text)_")
        if closed_at or closed_by:
            when = closed_at or "unknown date"
            who = closed_by or "unknown"
            lines.append("")
            lines.append(f"*Closed {when} by {who}*")
        lines.append("")
    if assignee:
        lines.append("## Owner")
        lines.append(f"- {assignee}")
        lines.append("")

    return fm_block + "\n".join(lines)


def render_stakeholder_text(payload: dict, *, original_text: str | None = None) -> str:
    """Render a single stakeholder note as markdown.

    Frontmatter from `schema_lib.render_frontmatter("stakeholder", payload)`.
    Body sections (Role, Interests, Requirements) hand-built — the
    Requirements list is pre-computed by the caller as cross-row context."""
    name = payload["name"]
    role = payload.get("role", "")
    interests = payload.get("interests") or []
    person_reqs = payload.get("_person_reqs") or []

    fm_block = schema_lib.render_frontmatter("stakeholder", payload)

    lines: list[str] = [
        f"# {name}",
        "",
        "## Role",
        "",
        role or "_(role not specified)_",
        "",
    ]
    if interests:
        lines.append("## Interests")
        lines.append("")
        for interest in interests:
            lines.append(f"- {interest}")
        lines.append("")
    if person_reqs:
        lines.append("## Requirements")
        lines.append("")
        for req_id, title in person_reqs:
            lines.append(f"- [[{req_id}]] — {title}")
        lines.append("")

    return fm_block + "\n".join(lines)


def render_contradiction_text(payload: dict, *, original_text: str | None = None) -> str:
    """Render a single contradiction note as markdown.

    Uses the first-class fields (title / side_a / side_b / area) since
    migration 025. Legacy item_a_*/item_b_* render only when side_a/side_b
    aren't populated (pre-025 data). explanation section appears only as
    a fallback when the native side fields are missing, to avoid doubling
    the same content once the agent writes both."""
    cid = payload["id"]
    title = payload.get("title") or ""
    side_a = payload.get("side_a") or ""
    side_b = payload.get("side_b") or ""
    area = payload.get("area") or ""
    explanation = payload.get("explanation", "")
    item_a_type = payload.get("item_a_type", "")
    item_a_id = payload.get("item_a_id", "")
    item_b_type = payload.get("item_b_type", "")
    item_b_id = payload.get("item_b_id", "")
    resolved = payload.get("resolved", False)
    resolution = payload.get("resolution_note", "")

    fm_block = schema_lib.render_frontmatter("contradiction", payload)

    status_badge = "✓ RESOLVED" if resolved else "⚠ UNRESOLVED"
    headline = title or (explanation[:80] if explanation else "Contradiction")

    lines: list[str] = [
        f"# {cid}: {headline}",
        "",
        f"**{status_badge}**" + (f"  ·  _{area}_" if area else ""),
        "",
    ]

    if side_a or side_b:
        lines += ["## Conflicting statements", ""]
        if side_a:
            src_a = payload.get("side_a_source") or ""
            per_a = payload.get("side_a_person") or ""
            meta_a = " · ".join(p for p in [per_a, src_a] if p)
            lines += ["**Side A**" + (f" — {meta_a}" if meta_a else ""), "", side_a, ""]
        if side_b:
            src_b = payload.get("side_b_source") or ""
            per_b = payload.get("side_b_person") or ""
            meta_b = " · ".join(p for p in [per_b, src_b] if p)
            lines += ["**Side B**" + (f" — {meta_b}" if meta_b else ""), "", side_b, ""]
    elif explanation:
        lines += ["## Explanation", "", explanation, ""]
    else:
        lines += ["## Explanation", "", "_(no explanation provided)_", ""]

    if (item_a_type or item_b_type) and (item_a_id or item_b_id):
        lines += ["## Items in conflict", ""]
        if item_a_type and item_a_id:
            lines.append(f"- {item_a_type}: `{item_a_id}`")
        if item_b_type and item_b_id:
            lines.append(f"- {item_b_type}: `{item_b_id}`")
        lines.append("")

    if resolved and resolution:
        lines += ["## Resolution", "", resolution, ""]

    return fm_block + "\n".join(lines)
