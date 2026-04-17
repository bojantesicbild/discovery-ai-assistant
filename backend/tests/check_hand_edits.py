"""Hand-edit preservation check — verify the END-GENERATED marker contract.

The pipeline re-renders per-item vault files (BR-xxx.md, GAP-xxx.md, etc.)
on every ingest. Without protection, a PM who adds meeting context or
follow-up notes below the generated sections would lose them on the next
run. `write_with_hand_edits()` solves that by splitting on a sentinel
marker — everything above is pipeline-owned, everything below is PM-owned
and carried forward verbatim.

This test locks the contract down so a future refactor can't silently
drop it. Run by hand with:

    cd backend && .venv/bin/python tests/check_hand_edits.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Make `app.*` imports work when running from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline.markdown_writer import HAND_EDIT_MARKER, write_with_hand_edits  # noqa: E402

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"


def _check(label: str, condition: bool, detail: str = "") -> bool:
    marker = PASS if condition else FAIL
    suffix = f" — {detail}" if detail else ""
    print(f"  {marker} {label}{suffix}")
    return condition


def main() -> int:
    ok = True
    with tempfile.TemporaryDirectory() as td:
        tmpdir = Path(td)

        # 1. First write installs the marker
        path = tmpdir / "BR-001.md"
        write_with_hand_edits(path, "# BR-001\n\nbody v1")
        first = path.read_text(encoding="utf-8")
        ok &= _check(
            "first write installs END-GENERATED marker",
            HAND_EDIT_MARKER in first,
        )
        ok &= _check(
            "first write ends with marker (no hand-edits yet)",
            first.rstrip("\n").endswith(HAND_EDIT_MARKER),
        )

        # 2. PM appends hand-edits below the marker
        pm_tail = "\n\n## Meeting notes (PM)\n\n- follow up with legal\n"
        path.write_text(first + pm_tail, encoding="utf-8")

        # 3. Pipeline re-renders with updated body; hand-edits survive
        write_with_hand_edits(path, "# BR-001\n\nbody v2 with changes")
        second = path.read_text(encoding="utf-8")
        ok &= _check(
            "re-render replaces body above marker",
            "body v2 with changes" in second and "body v1" not in second,
        )
        ok &= _check(
            "re-render preserves hand-edits below marker verbatim",
            "## Meeting notes (PM)" in second and "follow up with legal" in second,
        )
        ok &= _check(
            "marker still present after re-render",
            second.count(HAND_EDIT_MARKER) == 1,
        )

        # 4. Legacy file (no marker) → first re-render installs marker,
        #    previous content is overwritten (documented first-run cost)
        legacy = tmpdir / "BR-002.md"
        legacy.write_text("# BR-002 (legacy, no marker)\n\nold body\n", encoding="utf-8")
        write_with_hand_edits(legacy, "# BR-002\n\nfresh body")
        third = legacy.read_text(encoding="utf-8")
        ok &= _check(
            "legacy file (no marker) gets marker on first re-render",
            HAND_EDIT_MARKER in third,
        )
        ok &= _check(
            "legacy file contents replaced by fresh body",
            "fresh body" in third and "old body" not in third,
        )

        # 5. Idempotent re-render (same body, same hand-edits) — content
        #    stable byte-for-byte after the first write cycle
        stable = tmpdir / "GAP-001.md"
        write_with_hand_edits(stable, "# GAP-001\n\nquestion?")
        stable.write_text(stable.read_text() + "\n## Notes\n\nasked CFO\n", encoding="utf-8")
        before = stable.read_text(encoding="utf-8")
        write_with_hand_edits(stable, "# GAP-001\n\nquestion?")
        after = stable.read_text(encoding="utf-8")
        ok &= _check(
            "idempotent re-render with same body is byte-identical",
            before == after,
            detail="" if before == after else "file changed on second identical render",
        )

    print()
    if ok:
        print(f"{PASS} hand-edit preservation — END-GENERATED contract holds")
        return 0
    print(f"{FAIL} hand-edit preservation — contract violated, see failures above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
