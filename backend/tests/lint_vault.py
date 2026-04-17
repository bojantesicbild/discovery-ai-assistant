"""Vault lint — schema validation + link health for an existing project.

Usage:
    cd backend && .venv/bin/python -m tests.lint_vault <project_id>
    cd backend && .venv/bin/python -m tests.lint_vault --all

Core lint logic lives in `app.services.vault_lint`. This file is the CLI
wrapper: resolves project IDs to vault paths, pretty-prints the report,
exits non-zero on failure.

The pipeline calls `app.services.vault_lint.lint_vault(vault_dir)`
directly after every export and surfaces the summary into log.md +
dashboard.md — see `backend/app/pipeline/tasks.py::_stage_export_markdown`.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.vault_lint import LintReport, lint_vault  # noqa: E402

REPO_ROOT = ROOT.parent
RUNTIME_DIR = REPO_ROOT / ".runtime" / "projects"

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
WARN = "\033[33m!\033[0m"
INFO = "\033[36m·\033[0m"
DIM = "\033[2m"
RESET = "\033[0m"


def _print_report(report: LintReport, vault_dir: Path) -> int:
    print(f"\n{INFO} Lint report for {vault_dir}")
    print(f"  files checked:  {report.files_checked}")
    print(f"  files clean:    {report.files_passed}")
    print(f"  by kind:        {dict(report.kind_counts)}")

    if report.warnings:
        print(f"\n{WARN} {len(report.warnings)} warning{'s' if len(report.warnings) != 1 else ''}:")
        for file, msg in report.warnings[:30]:
            p = Path(file)
            rel = p.relative_to(vault_dir) if p.is_relative_to(vault_dir) else p
            print(f"  {WARN} {rel}: {msg}")
        if len(report.warnings) > 30:
            print(f"  {DIM}... {len(report.warnings) - 30} more{RESET}")

    if report.failures:
        print(f"\n{FAIL} {len(report.failures)} failure{'s' if len(report.failures) != 1 else ''}:")
        for file, msg in report.failures[:30]:
            p = Path(file)
            rel = p.relative_to(vault_dir) if p.is_relative_to(vault_dir) else p
            print(f"  {FAIL} {rel}: {msg}")
        if len(report.failures) > 30:
            print(f"  {DIM}... {len(report.failures) - 30} more{RESET}")
        return 1

    print(f"\n{PASS} clean — {report.files_passed}/{report.files_checked} files validated")
    return 0


def lint_project(project_id: str) -> int:
    project_dir = RUNTIME_DIR / project_id
    vault_dir = project_dir / ".memory-bank"
    if not vault_dir.exists():
        print(f"{FAIL} vault not found: {vault_dir}")
        return 2

    report = lint_vault(vault_dir)
    discovery_dir = vault_dir / "docs" / "discovery"
    if not discovery_dir.exists():
        print(f"{WARN} no discovery folder: {discovery_dir}")
        return 0
    return _print_report(report, vault_dir)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    if sys.argv[1] == "--all":
        if not RUNTIME_DIR.exists():
            print(f"{FAIL} no projects in {RUNTIME_DIR}")
            return 2
        worst = 0
        for project_dir in sorted(RUNTIME_DIR.iterdir()):
            if not project_dir.is_dir():
                continue
            print(f"\n{INFO} === {project_dir.name} ===")
            code = lint_project(project_dir.name)
            worst = max(worst, code)
        return worst

    return lint_project(sys.argv[1])


if __name__ == "__main__":
    sys.exit(main())
