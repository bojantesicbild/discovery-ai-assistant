"""Writer parity test — no information loss across the schema refactor.

For each fixture under tests/fixtures/writer/, this script:

1. Parses the original frontmatter + body
2. Reconstructs a payload dict (the SQLAlchemy row equivalent)
3. Calls the NEW writer's per-kind render function with that payload
4. Re-parses the output
5. Asserts:
   - Every key/value in the original frontmatter is present in the new
     output (the new writer may add fields, never lose them)
   - Every [[wikilink]] from the original body is present in the new body
   - The H1 title is preserved

The contract is "no information loss", not "byte identical". The new
writer is allowed to enrich the output (e.g. add `source_raw:` to notes
that didn't have it before) — that's the whole point of Phase 2B. What
it must NOT do is silently drop a field a real user has on disk.

Usage:
    cd backend && .venv/bin/python -m tests.check_writer_parity

Exits non-zero on any parity failure.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Callable

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "writer"

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
INFO = "\033[36m·\033[0m"

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
H1_RE = re.compile(r"^#\s+(.+)$", re.M)


class FailReport:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.checks: int = 0

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        self.checks += 1
        if ok:
            print(f"  {PASS} {label}")
        else:
            self.failures.append(f"{label}: {detail}" if detail else label)
            print(f"  {FAIL} {label}{(' — ' + detail) if detail else ''}")


def parse_note(text: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body)."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm = yaml.safe_load(m.group(1)) or {}
    return (fm if isinstance(fm, dict) else {}), text[m.end():]


def extract_wikilinks(body: str) -> set[str]:
    return {m.group(1).strip() for m in WIKILINK_RE.finditer(body)}


def extract_h1(body: str) -> str | None:
    m = H1_RE.search(body)
    return m.group(1).strip() if m else None


def assert_parity(report: FailReport, fixture_name: str, original_text: str, new_text: str) -> None:
    """Compare original vs new render. Original fields must all survive."""
    print(f"\n{INFO} {fixture_name}")
    orig_fm, orig_body = parse_note(original_text)
    new_fm, new_body = parse_note(new_text)

    # Frontmatter: every original field+value must be present in new
    for key, value in orig_fm.items():
        if key in ("aliases", "tags", "cssclasses", "category"):
            # These get re-derived by the writer, allow refresh
            report.check(
                f"{key} present in new frontmatter",
                key in new_fm,
                f"new frontmatter keys: {sorted(new_fm.keys())}",
            )
            continue
        report.check(
            f"frontmatter[{key}] preserved",
            new_fm.get(key) == value,
            f"orig={value!r} new={new_fm.get(key)!r}",
        )

    # H1 title preserved
    orig_h1 = extract_h1(orig_body)
    new_h1 = extract_h1(new_body)
    report.check(
        f"H1 title preserved",
        orig_h1 == new_h1 or (orig_h1 and new_h1 and orig_h1 in new_h1) or (orig_h1 and new_h1 and new_h1 in orig_h1),
        f"orig={orig_h1!r} new={new_h1!r}",
    )

    # Every wikilink in the original must survive
    orig_links = extract_wikilinks(orig_body)
    new_links = extract_wikilinks(new_body)
    missing = orig_links - new_links
    report.check(
        f"wikilinks preserved ({len(orig_links)} expected)",
        not missing,
        f"missing: {sorted(missing)[:5]}" if missing else "",
    )


def fixture_to_payload(kind: str, fm: dict, body: str) -> dict:
    """Reconstruct a writer-input payload from a fixture file.

    This pulls back fields the writer DERIVES from cross-row context
    (co_extracted siblings, source_raw classification) so the parity
    test exercises the same code paths the live pipeline does."""
    payload = dict(fm)

    # Body sections that aren't in frontmatter need extraction
    h1 = extract_h1(body)
    if h1:
        after = body.split(h1, 1)[-1]
        for line in after.split("\n"):
            line = line.strip()
            if line and not line.startswith("#") and not line.startswith(">"):
                payload.setdefault("description", line)
                break

    # `source_quote` lives in `## Source` blockquote
    src_match = re.search(r"##\s+Source\s*\n+\s*>\s*\"([^\"]+)\"", body)
    if src_match:
        payload["source_quote"] = src_match.group(1)

    # `co_extracted` is derived from `## Related` body lines like
    # `- [[BR-002]] — co-extracted`. Reconstruct it so the renderer
    # produces the same wikilinks.
    co_extracted: list[str] = []
    for m in re.finditer(r"-\s+\[\[([^\]]+)\]\]\s+—\s+co-extracted", body):
        co_extracted.append(m.group(1).strip())
    payload["co_extracted"] = co_extracted

    # `_doc_class` reconstructed from frontmatter source_raw + source_origin.
    # The renderer uses this to emit the same source_raw/source_origin lines.
    doc_class: dict = {}
    if fm.get("source_raw"):
        doc_class["source_raw_path"] = fm["source_raw"]
    if fm.get("source_origin"):
        doc_class["source"] = fm["source_origin"]
    payload["_doc_class"] = doc_class

    # Per-merge `sources` reconstructed from the `## Sources` body section.
    # Format: `- [[filename]] — original extraction` (first) then
    # `- [[filename]] — vN merge` for each merged source.
    sources: list[dict] = []
    in_sources = False
    for line in body.split("\n"):
        stripped = line.strip()
        if stripped.startswith("## "):
            in_sources = stripped == "## Sources"
            continue
        if not in_sources:
            continue
        m = re.match(r"-\s+\[\[([^\]]+)\]\]\s+—\s+v(\d+)\s+merge", stripped)
        if m:
            sources.append({"filename": m.group(1), "version": int(m.group(2))})
    payload["sources"] = sources

    return payload


def run_requirement_parity(report: FailReport, render_fn: Callable | None) -> None:
    """For each req_*.md fixture, run the writer and compare.

    `render_fn` is the new writer being tested. If None, just validates
    that fixtures parse cleanly (sanity check before any refactor)."""
    fixtures = sorted(FIXTURES.glob("req_*.md"))
    print(f"\n{INFO} Requirement fixtures: {len(fixtures)}")
    for fx in fixtures:
        original = fx.read_text(encoding="utf-8")
        if render_fn is None:
            # Sanity: just parse + report fields
            fm, body = parse_note(original)
            print(f"  {INFO} {fx.name}: {len(fm)} fm fields, {len(extract_wikilinks(body))} wikilinks")
            continue

        fm, body = parse_note(original)
        payload = fixture_to_payload("requirement", fm, body)
        new_text = render_fn(payload, original_text=original)
        assert_parity(report, fx.name, original, new_text)


def main() -> int:
    report = FailReport()

    # Try to import the new render function. If it doesn't exist yet,
    # do a sanity-only run that just parses the fixtures.
    render_fn = None
    try:
        from app.pipeline.tasks import render_requirement_text  # type: ignore
        render_fn = render_requirement_text
        print(f"{INFO} Found render_requirement_text — running parity")
    except ImportError:
        print(f"{INFO} render_requirement_text not yet defined — sanity only")

    run_requirement_parity(report, render_fn)

    print()
    if report.failures:
        print(f"{FAIL} {len(report.failures)} of {report.checks} checks failed")
        for f in report.failures[:20]:
            print(f"    - {f}")
        return 1
    if report.checks == 0:
        print(f"{INFO} no checks ran (sanity mode)")
        return 0
    print(f"{PASS} all {report.checks} parity checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
