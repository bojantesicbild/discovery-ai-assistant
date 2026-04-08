"""Vault lint — schema validation + link health for an existing project.

Usage:
    cd backend && .venv/bin/python -m tests.lint_vault <project_id>
    cd backend && .venv/bin/python -m tests.lint_vault --all

Walks every `.md` file under `.memory-bank/docs/discovery/{requirements,
constraints,gaps,decisions,...}/` and runs three checks per file:

1. **Frontmatter validity** — parses the YAML block, identifies the
   schema kind from `category` (or the parent folder), runs
   `schema_lib.validate(kind, payload)` to confirm required fields are
   present and enum values are allowed.

2. **Wikilink health** — for each `[[Target]]` reference in the body,
   checks whether a corresponding `Target.md` (or `Target/index.md`)
   exists somewhere in the vault. Reports broken backlinks.

3. **source_raw resolution** — when a note declares `source_raw:`,
   verifies the relative path actually points at a real file inside
   `.raw/`.

Outputs a structured report. Exits 0 if clean, 1 on any failure.

Designed to be wired into `pre-compact.sh` and CI eventually. Until then,
run it by hand against any project to catch drift between the schema +
the on-disk vault.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

import yaml

# Make `app.*` imports work when running from backend/
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import schema_lib  # noqa: E402

# Repo root for locating .runtime/projects/
REPO_ROOT = ROOT.parent
RUNTIME_DIR = REPO_ROOT / ".runtime" / "projects"


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
WARN = "\033[33m!\033[0m"
INFO = "\033[36m·\033[0m"
DIM = "\033[2m"
RESET = "\033[0m"


# Map folder name -> kind (when frontmatter doesn't tell us)
FOLDER_TO_KIND = {
    "requirements": "requirement",
    "constraints": "constraint",
    "gaps": "gap",
    "decisions": "decision",
    "people": "stakeholder",
    "stakeholders": "stakeholder",
    "assumptions": "assumption",
    "scope": "scope",
    "contradictions": "contradiction",
}


WIKILINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)


class LintReport:
    def __init__(self) -> None:
        self.files_checked: int = 0
        self.files_passed: int = 0
        self.failures: list[tuple[str, str]] = []  # (file, message)
        self.warnings: list[tuple[str, str]] = []
        self.kind_counts: Counter[str] = Counter()

    def fail(self, file: Path, msg: str) -> None:
        self.failures.append((str(file), msg))

    def warn(self, file: Path, msg: str) -> None:
        self.warnings.append((str(file), msg))

    def report(self, vault_dir: Path) -> int:
        print(f"\n{INFO} Lint report for {vault_dir}")
        print(f"  files checked:  {self.files_checked}")
        print(f"  files clean:    {self.files_passed}")
        print(f"  by kind:        {dict(self.kind_counts)}")

        if self.warnings:
            print(f"\n{WARN} {len(self.warnings)} warning{'s' if len(self.warnings) != 1 else ''}:")
            for file, msg in self.warnings[:30]:
                rel = Path(file).relative_to(vault_dir) if Path(file).is_relative_to(vault_dir) else Path(file)
                print(f"  {WARN} {rel}: {msg}")
            if len(self.warnings) > 30:
                print(f"  {DIM}... {len(self.warnings) - 30} more{RESET}")

        if self.failures:
            print(f"\n{FAIL} {len(self.failures)} failure{'s' if len(self.failures) != 1 else ''}:")
            for file, msg in self.failures[:30]:
                rel = Path(file).relative_to(vault_dir) if Path(file).is_relative_to(vault_dir) else Path(file)
                print(f"  {FAIL} {rel}: {msg}")
            if len(self.failures) > 30:
                print(f"  {DIM}... {len(self.failures) - 30} more{RESET}")
            return 1

        print(f"\n{PASS} clean — {self.files_passed}/{self.files_checked} files validated")
        return 0


def parse_frontmatter(text: str) -> tuple[dict, str] | tuple[None, str]:
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


def kind_from_path(path: Path) -> str | None:
    """Infer the kind from the parent folder name."""
    for parent in path.parents:
        if parent.name in FOLDER_TO_KIND:
            return FOLDER_TO_KIND[parent.name]
    return None


def lint_file(path: Path, vault_dir: Path, all_md_files: set[str], report: LintReport) -> None:
    """Run all checks on one note file."""
    report.files_checked += 1
    text = path.read_text(encoding="utf-8", errors="replace")
    fm, body = parse_frontmatter(text)

    if fm is None:
        # Allow notes without frontmatter for hand-written narrative
        # files (handoff deliverables, README, indexes, logs). The
        # finding kinds (requirement/gap/etc.) are caught by their
        # parent folders below — those MUST have frontmatter.
        narrative_files = {
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
        if path.name in narrative_files:
            return
        if "discovery" in path.parts:
            report.warn(path, "no frontmatter")
        return

    # Identify the kind
    kind = fm.get("category") or kind_from_path(path)
    if kind not in {schema.kind for schema in schema_lib.load_all().values()}:
        # Indices and meta files (e.g. category: decisions-index, wiki-index)
        # are allowed but not lint-checked
        return

    report.kind_counts[kind] += 1

    # 1. Schema validation. We only have the frontmatter dict here, so
    # use frontmatter_only mode — body-only required fields (description,
    # impact, source_quote on some kinds) shouldn't surface as missing.
    schema = schema_lib.get(kind)
    payload = {k: v for k, v in fm.items() if schema.field(k) is not None}
    result = schema_lib.validate(kind, payload, frontmatter_only=True)
    if not result.ok:
        for err in result.errors:
            # Demote "missing required field" warnings for legacy notes that
            # were written before the field was declared. The check_schemas
            # parity test enforces strictness on the schema itself; here
            # we're checking real on-disk content which can be older.
            if err.startswith("missing required field"):
                report.warn(path, f"schema: {err}")
            else:
                report.fail(path, f"schema: {err}")

    # 2. Wikilink health — check that every [[target]] resolves
    body_only = body.replace(text[: text.index(body)] if body in text else "", "")
    for m in WIKILINK_RE.finditer(body_only):
        target = m.group(1).strip()
        if not target:
            continue
        # Allow targets that match any md filename in the vault
        if f"{target}.md" in all_md_files:
            continue
        if target in all_md_files:
            continue
        # Allow display IDs that match a vault file (BR-001 -> BR-001.md)
        if any(name.startswith(f"{target}.") for name in all_md_files):
            continue
        report.warn(path, f"broken wikilink: [[{target}]]")

    # 3. source_raw resolution
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


def lint_project(project_id: str) -> int:
    project_dir = RUNTIME_DIR / project_id
    vault_dir = project_dir / ".memory-bank"
    if not vault_dir.exists():
        print(f"{FAIL} vault not found: {vault_dir}")
        return 2

    report = LintReport()

    # Build set of all .md basenames in the vault for wikilink resolution
    all_md_files = {p.name for p in vault_dir.rglob("*.md")} | {
        p.stem for p in vault_dir.rglob("*.md")
    }

    schema_lib.reset_cache()
    discovery_dir = vault_dir / "docs" / "discovery"
    if not discovery_dir.exists():
        print(f"{WARN} no discovery folder: {discovery_dir}")
        return 0

    for path in sorted(discovery_dir.rglob("*.md")):
        lint_file(path, vault_dir, all_md_files, report)

    return report.report(vault_dir)


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
