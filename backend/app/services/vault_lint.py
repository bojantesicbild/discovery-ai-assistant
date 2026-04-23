"""Vault lint — schema validation + link health for a project's vault.

Runs three checks per `.md` file under `.memory-bank/docs/discovery/`:

1. **Frontmatter validity** — YAML parses, required fields present,
   enum values allowed (via `schema_lib.validate(kind, payload,
   frontmatter_only=True)`).
2. **Wikilink health** — every `[[Target]]` resolves to a file in the vault.
3. **source_raw resolution** — `source_raw: ...` points at a real file
   inside `.raw/`.

Used from two places:
- `backend/tests/lint_vault.py` — CLI wrapper for manual runs and CI
- `backend/app/pipeline/tasks.py::_stage_export_markdown` — runs after
  every ingest and surfaces counts into `log.md` + `dashboard.md` so
  the PM sees drift without having to run anything.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

import yaml

from app.services import schema_lib

FOLDER_TO_KIND = {
    "requirements": "requirement",
    "constraints": "constraint",
    "gaps": "gap",
    "people": "stakeholder",
    "stakeholders": "stakeholder",
    "contradictions": "contradiction",
}

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)

NARRATIVE_FILES = {
    "discovery-brief.md",
    "functional-requirements.md",
    "mvp-scope-freeze.md",
    "README.md",
    "index.md",
    "log.md",
    "dashboard.md",
    "hot.md",
    "schema.md",
}


class LintReport:
    """Structured result — consumed both by the CLI pretty-printer and
    the pipeline summary that writes into log.md + dashboard.md."""

    def __init__(self) -> None:
        self.files_checked: int = 0
        self.files_passed: int = 0
        self.failures: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []
        self.kind_counts: Counter[str] = Counter()

    def fail(self, file: Path, msg: str) -> None:
        self.failures.append((str(file), msg))

    def warn(self, file: Path, msg: str) -> None:
        self.warnings.append((str(file), msg))

    def summary(self) -> dict:
        """Compact dict suitable for the pipeline's dashboard / log
        line — counts bucketed by category so we can render
        "2 broken wikilinks, 1 missing source_raw" instead of a wall
        of individual messages."""
        buckets: Counter[str] = Counter()
        for _, msg in self.warnings + self.failures:
            if msg.startswith("broken wikilink"):
                buckets["broken_wikilink"] += 1
            elif msg.startswith("source_raw"):
                buckets["missing_source_raw"] += 1
            elif msg.startswith("schema:"):
                buckets["schema_issue"] += 1
            elif msg == "no frontmatter":
                buckets["no_frontmatter"] += 1
            else:
                buckets["other"] += 1
        return {
            "files_checked": self.files_checked,
            "files_passed": self.files_passed,
            "warnings": len(self.warnings),
            "failures": len(self.failures),
            "by_category": dict(buckets),
        }


def _parse_frontmatter(text: str) -> tuple[dict | None, str]:
    """Returns (frontmatter_dict, body) or (None, full_text) if no fm."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
        if not isinstance(fm, dict):
            return None, text
        return fm, text[m.end():]
    except yaml.YAMLError:
        return None, text


def _kind_from_path(path: Path) -> str | None:
    for parent in path.parents:
        if parent.name in FOLDER_TO_KIND:
            return FOLDER_TO_KIND[parent.name]
    return None


def _lint_file(path: Path, vault_dir: Path, all_md_files: set[str], report: LintReport) -> None:
    """Run all checks on one note file."""
    report.files_checked += 1
    text = path.read_text(encoding="utf-8", errors="replace")
    fm, body = _parse_frontmatter(text)

    if fm is None:
        # Narrative files are allowed to skip frontmatter. Everywhere
        # else under docs/discovery/ expects it.
        if path.name in NARRATIVE_FILES:
            return
        if "discovery" in path.parts:
            report.warn(path, "no frontmatter")
        return

    kind = fm.get("category") or _kind_from_path(path)
    if kind not in {s.kind for s in schema_lib.load_all().values()}:
        # Index/meta files (e.g. category: decisions-index, wiki-index)
        # are allowed but not schema-checked.
        return

    report.kind_counts[kind] += 1

    schema = schema_lib.get(kind)
    payload = {k: v for k, v in fm.items() if schema.field(k) is not None}
    result = schema_lib.validate(kind, payload, frontmatter_only=True)
    if not result.ok:
        for err in result.errors:
            if err.startswith("missing required field"):
                report.warn(path, f"schema: {err}")
            else:
                report.fail(path, f"schema: {err}")

    # Wikilink health
    body_only = body.replace(text[: text.index(body)] if body in text else "", "")
    for m in WIKILINK_RE.finditer(body_only):
        target = m.group(1).strip()
        if not target:
            continue
        if f"{target}.md" in all_md_files:
            continue
        if target in all_md_files:
            continue
        if any(name.startswith(f"{target}.") for name in all_md_files):
            continue
        report.warn(path, f"broken wikilink: [[{target}]]")

    # source_raw resolution
    raw = fm.get("source_raw")
    if raw:
        try:
            target_path = (path.parent / raw).resolve()
            if not target_path.exists():
                report.warn(path, f"source_raw points at missing file: {raw}")
        except Exception as e:
            report.warn(path, f"source_raw could not be resolved: {e}")

    if not any(f == str(path) for f, _ in report.failures):
        report.files_passed += 1


def lint_vault(vault_dir: Path) -> LintReport:
    """Walk every `.md` file under `vault_dir/docs/discovery/` and return
    a LintReport. Safe to call on an empty vault (returns an empty report).

    Callers:
    - Pipeline: reads `.summary()` and surfaces counts into log.md + dashboard.
    - CLI (tests/lint_vault.py): pretty-prints the report and exits on failure."""
    report = LintReport()
    discovery_dir = vault_dir / "docs" / "discovery"
    if not discovery_dir.exists():
        return report

    all_md_files = {p.name for p in vault_dir.rglob("*.md")} | {
        p.stem for p in vault_dir.rglob("*.md")
    }

    schema_lib.reset_cache()
    for path in sorted(discovery_dir.rglob("*.md")):
        _lint_file(path, vault_dir, all_md_files, report)

    return report


def format_dashboard_section(summary: dict) -> list[str]:
    """Render the 'Vault health' markdown block for dashboard.md.

    Called by write_dashboard after lint runs. Returns a list of lines
    (no trailing blank — caller joins with \\n and adds spacing)."""
    warnings = summary.get("warnings", 0)
    failures = summary.get("failures", 0)
    checked = summary.get("files_checked", 0)
    buckets = summary.get("by_category", {})

    lines = ["## Vault health", ""]

    if warnings == 0 and failures == 0:
        lines.append(f"- **Clean** — {checked} files validated")
        return lines

    parts: list[str] = []
    if failures:
        parts.append(f"**{failures} failure{'s' if failures != 1 else ''}**")
    if warnings:
        parts.append(f"{warnings} warning{'s' if warnings != 1 else ''}")
    lines.append(f"- {' · '.join(parts)} across {checked} files")

    # (singular, plural) pairs so "1 broken wikilink" reads right.
    label_map = {
        "broken_wikilink": ("broken wikilink", "broken wikilinks"),
        "missing_source_raw": ("missing source_raw", "missing source_raw"),
        "schema_issue": ("schema issue", "schema issues"),
        "no_frontmatter": ("missing frontmatter", "missing frontmatter"),
        "other": ("other", "other"),
    }
    for key, (singular, plural) in label_map.items():
        count = buckets.get(key, 0)
        if count:
            lines.append(f"  - {count} {singular if count == 1 else plural}")

    lines.append("")
    lines.append("_Run `.venv/bin/python -m tests.lint_vault <project_id>` to see per-file detail._")
    return lines


def format_log_entry(summary: dict) -> str:
    """One-line lint summary for log.md. Empty string when clean — we
    skip the line entirely rather than emit "0 warnings, 0 failures"
    noise on every ingest."""
    warnings = summary.get("warnings", 0)
    failures = summary.get("failures", 0)
    if warnings == 0 and failures == 0:
        return ""

    buckets = summary.get("by_category", {})
    detail_parts: list[str] = []
    for key in ("broken_wikilink", "missing_source_raw", "schema_issue", "no_frontmatter"):
        count = buckets.get(key, 0)
        if count:
            label = {
                "broken_wikilink": "broken wikilink",
                "missing_source_raw": "missing source_raw",
                "schema_issue": "schema issue",
                "no_frontmatter": "no frontmatter",
            }[key]
            detail_parts.append(f"{count} {label}{'s' if count != 1 else ''}")

    detail = f" ({', '.join(detail_parts)})" if detail_parts else ""
    parts: list[str] = []
    if failures:
        parts.append(f"{failures} failure{'s' if failures != 1 else ''}")
    if warnings:
        parts.append(f"{warnings} warning{'s' if warnings != 1 else ''}")
    return f"Lint: {', '.join(parts)}{detail}"
