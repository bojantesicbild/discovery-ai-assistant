"""Lint parity check — ruff F-rules (pyflakes) must pass clean.

The F-rule family catches programming bugs that otherwise drift silently:
- F401: unused imports (usually harmless, but sometimes signal refactor rot)
- F811: redefined name (almost always a real bug)
- F821: undefined name (almost always a real bug — e.g., a function was
        renamed and a call site wasn't updated)
- F841: assigned but never used (dead code)

Running this as a required check means "_requirement_to_payload is not
defined"-style bugs (where a call site drifts from its import) fail before
they ship, instead of getting swallowed by a broad `except Exception` in a
sync wrapper and logged as "non-fatal" for weeks.

Usage:
    cd backend && .venv/bin/python tests/check_lint.py

Exits non-zero if ruff reports any F-rule violation. Uses `uvx ruff`
because ruff isn't installed in the venv (dev dep listed in pyproject
but not necessarily installed). `uvx` is cached locally and fast.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"


def main() -> int:
    proc = subprocess.run(
        ["uvx", "ruff", "check", str(APP), "--select", "F", "--no-cache"],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        print(f"{PASS} ruff F-rule check passed — no programming-bug patterns found in {APP.relative_to(ROOT.parent)}")
        return 0
    # Ruff emits fix suggestions on stdout. Surface them so the failure is
    # self-explanatory; no need to re-run to see the diagnostics.
    print(proc.stdout.rstrip())
    if proc.stderr.strip():
        print(proc.stderr.rstrip(), file=sys.stderr)
    print()
    print(f"{FAIL} ruff F-rule check failed — fix the above or run `uvx ruff check {APP} --select F --fix` to auto-fix the easy ones")
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
