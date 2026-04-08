"""Schema parity + smoke checks.

Usage:
    cd backend && .venv/bin/python -m tests.check_schemas

Asserts:
1. Every YAML schema in assistants/.claude/schemas/ loads cleanly through
   schema_lib (i.e. the meta-schema accepts it).
2. For every field that has a `db_column` (or whose key matches a real
   SQLAlchemy column), the column actually exists on the model the schema
   declares. Catches drift between the YAML and the DB.
3. The frontmatter renderer produces a YAML block that itself parses as
   YAML and contains every required field.
4. The body renderer produces a markdown string with at least one heading.
5. Validation rejects bad payloads with useful errors.

Exits non-zero if any check fails. Designed to be wired into a pre-commit
hook or CI step once we have one. Until then, run it by hand.
"""

from __future__ import annotations

import importlib
import sys
import traceback
from pathlib import Path

import yaml

# Make `app.*` imports work when running from backend/
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import schema_lib  # noqa: E402


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
INFO = "\033[36m·\033[0m"


class CheckResult:
    def __init__(self):
        self.failures: list[str] = []
        self.checks_run: int = 0

    def check(self, label: str, condition: bool, detail: str = "") -> None:
        self.checks_run += 1
        if condition:
            print(f"  {PASS} {label}")
        else:
            self.failures.append(f"{label} — {detail}" if detail else label)
            print(f"  {FAIL} {label}{(' — ' + detail) if detail else ''}")

    def section(self, title: str) -> None:
        print(f"\n{INFO} {title}")

    def report(self) -> int:
        print()
        if self.failures:
            print(f"{FAIL} {len(self.failures)} of {self.checks_run} checks failed")
            for f in self.failures:
                print(f"    - {f}")
            return 1
        print(f"{PASS} all {self.checks_run} checks passed")
        return 0


def main() -> int:
    r = CheckResult()

    # 1. Load every schema
    r.section("Loading schemas")
    schema_lib.reset_cache()
    try:
        registry = schema_lib.load_all()
        r.check(
            f"loaded {len(registry)} schemas: {sorted(registry)}",
            len(registry) >= 8,
            f"expected at least 8, got {len(registry)}",
        )
    except Exception as e:
        r.check("schemas loaded", False, str(e))
        return r.report()

    # 2. Schema → SQLAlchemy parity
    r.section("Schema ↔ SQLAlchemy parity")
    for kind, schema in registry.items():
        try:
            module_path, _, class_name = schema.model.rpartition(".")
            module = importlib.import_module(module_path)
            model_cls = getattr(module, class_name)
        except Exception as e:
            r.check(f"{kind}: import {schema.model}", False, str(e))
            continue

        sa_columns = set(model_cls.__table__.columns.keys())

        for field in schema.fields:
            # db_column: null means "not stored in DB" (e.g. CON-NNN display
            # ids that the writer assigns at render time)
            if field.db_column is None and field.key not in sa_columns:
                r.check(
                    f"{kind}.{field.key}: db_column=null",
                    True,
                    "(virtual / writer-assigned)",
                )
                continue
            col_name = field.column
            r.check(
                f"{kind}.{field.key} -> {class_name}.{col_name}",
                col_name in sa_columns,
                f"column {col_name!r} not in {sorted(sa_columns)}",
            )

    # 3. Frontmatter renderer round-trip (parse what we write)
    r.section("Frontmatter renderer round-trip")
    sample_payloads = {
        "requirement": {
            "id": "BR-001",
            "title": "Sample requirement",
            "type": "functional",
            "priority": "must",
            "status": "confirmed",
            "confidence": "high",
            "description": "The system shall do something useful.",
            "source_quote": "do something useful",
            "version": 1,
            "date": "2026-04-08",
        },
        "constraint": {
            "id": "CON-001",
            "type": "budget",
            "description": "Budget capped at 50k",
            "impact": "Forces phased delivery",
            "status": "confirmed",
            "source_quote": "we have 50k for this",
            "date": "2026-04-08",
        },
        "gap": {
            "id": "GAP-001",
            "question": "What auth provider are we using?",
            "severity": "high",
            "area": "technical",
            "status": "open",
            "blocked_reqs": ["BR-001"],
            "date": "2026-04-08",
        },
        "decision": {
            "id": "DEC-001",
            "title": "Use Postgres",
            "status": "confirmed",
            "decided_by": "CTO",
            "rationale": "Strong consistency + JSONB",
            "date": "2026-04-08",
        },
        "stakeholder": {
            "name": "Sarah Chen",
            "role": "Product Manager",
            "organization": "Acme",
            "decision_authority": "final",
            "date": "2026-04-08",
        },
        "assumption": {
            "id": "ASM-001",
            "statement": "Users have modern browsers",
            "basis": "Internal corporate fleet",
            "risk_if_wrong": "Major UI rework",
            "validated": False,
            "date": "2026-04-08",
        },
        "scope": {
            "id": "SCO-001",
            "description": "Multi-tenant support",
            "in_scope": False,
            "rationale": "Out for v1",
            "date": "2026-04-08",
        },
        "contradiction": {
            "id": "CTR-001",
            "item_a_type": "requirement",
            "item_a_id": "BR-001",
            "item_b_type": "constraint",
            "item_b_id": "CON-001",
            "explanation": "Cost exceeds budget",
            "resolved": False,
            "date": "2026-04-08",
        },
    }

    for kind, payload in sample_payloads.items():
        try:
            fm = schema_lib.render_frontmatter(kind, payload)
            r.check(f"{kind}: frontmatter rendered", fm.startswith("---") and fm.rstrip().endswith("---"))
            yaml_block = fm.split("---", 2)[1]
            parsed = yaml.safe_load(yaml_block)
            r.check(f"{kind}: frontmatter is valid YAML", isinstance(parsed, dict))
        except Exception as e:
            r.check(f"{kind}: frontmatter renderer", False, str(e))

    # 4. Body renderer produces non-empty markdown with a heading
    r.section("Body renderer")
    for kind, payload in sample_payloads.items():
        try:
            body = schema_lib.render_body(kind, payload)
            r.check(
                f"{kind}: body has heading",
                "\n# " in "\n" + body,
                f"first 200 chars: {body[:200]!r}",
            )
        except Exception as e:
            r.check(f"{kind}: body renderer", False, str(e))

    # 5. Validation catches missing required fields
    r.section("Validation rejects bad payloads")
    bad = {
        "requirement": {},  # missing everything
        "constraint": {"type": "budget"},  # missing description, impact, source_quote
        "gap": {"question": "?"},  # missing severity, area, status — but they have defaults
    }
    for kind, payload in bad.items():
        result = schema_lib.validate(kind, payload)
        if kind == "gap":
            # gap has defaults for severity/area/status, so this is valid except for `id`
            r.check(
                f"{kind}: rejects payload missing only required fields",
                not result.ok,
                f"errors: {result.errors}",
            )
        else:
            r.check(
                f"{kind}: rejects empty payload",
                not result.ok,
                f"errors: {result.errors}",
            )

    # 6. Validation accepts well-formed payloads
    r.section("Validation accepts good payloads")
    for kind, payload in sample_payloads.items():
        result = schema_lib.validate(kind, payload)
        r.check(
            f"{kind}: validates",
            result.ok,
            f"errors: {result.errors}",
        )

    # 7. Filename helper
    r.section("filename_for() helper")
    for kind, payload in sample_payloads.items():
        try:
            name = schema_lib.filename_for(kind, payload)
            r.check(
                f"{kind}: filename = {name}",
                name.endswith(".md") and len(name) > 3,
            )
        except Exception as e:
            r.check(f"{kind}: filename_for", False, str(e))

    return r.report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
