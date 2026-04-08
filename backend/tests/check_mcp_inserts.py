"""End-to-end verification of mcp-server/db_server.py store_finding INSERTs.

For each finding kind, this script:
1. Connects to the real Postgres DB
2. Wraps everything in a transaction that gets ROLLED BACK at the end
3. Runs the same INSERT SQL the MCP server would issue (same columns,
   same default values)
4. Verifies no exception is raised
5. Reports per-kind PASS/FAIL

No data is persisted — the transaction always rolls back. Safe to run
against the dev database. Designed to catch the kind of column-drift
bugs Phase 2C-1 just fixed (e.g. INSERT into scope_items.item which
doesn't exist).

Usage:
    cd backend && .venv/bin/python -m tests.check_mcp_inserts
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
INFO = "\033[36m·\033[0m"

DB_URL = "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db"


# Each entry mirrors what mcp-server/db_server.py::store_finding would
# execute for that kind. Keep this in sync if the MCP code changes.
INSERT_SCENARIOS: list[dict] = [
    {
        "kind": "requirement",
        "sql": (
            "INSERT INTO requirements (id, project_id, req_id, title, description, type, priority, status, confidence, source_quote, source_person) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4, 'functional', $5, 'proposed', 'medium', $6, $7)"
        ),
        "args": lambda pid: (pid, "BR-TEST", "Test req", "Test description", "must", "Test description", "test"),
    },
    {
        "kind": "constraint",
        "sql": (
            "INSERT INTO constraints (id, project_id, type, description, impact, source_quote, status) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'assumed')"
        ),
        "args": lambda pid: (pid, "technology", "Test constraint", "Test impact", "Test quote"),
    },
    {
        "kind": "decision",
        "sql": (
            "INSERT INTO decisions (id, project_id, title, decided_by, rationale, alternatives, impacts, status) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, 'tentative')"
        ),
        "args": lambda pid: (pid, "Test decision", "tester", "Test rationale", "[]", "[]"),
    },
    {
        "kind": "stakeholder",
        "sql": (
            "INSERT INTO stakeholders (id, project_id, name, role, organization, decision_authority) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)"
        ),
        "args": lambda pid: (pid, "Test Person", "tester", "Test Inc", "informed"),
    },
    {
        "kind": "assumption",
        "sql": (
            "INSERT INTO assumptions (id, project_id, statement, basis, risk_if_wrong, validated) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4, false)"
        ),
        "args": lambda pid: (pid, "Test assumption", "Test basis", ""),
    },
    {
        "kind": "gap",
        "sql": (
            "INSERT INTO gaps (id, project_id, gap_id, question, severity, area, status, source_quote) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'open', $6)"
        ),
        "args": lambda pid: (pid, "GAP-TEST", "Test question", "medium", "general", "Test quote"),
    },
    {
        "kind": "scope",
        "sql": (
            "INSERT INTO scope_items (id, project_id, description, in_scope, rationale) "
            "VALUES (gen_random_uuid(), $1, $2, $3, $4)"
        ),
        "args": lambda pid: (pid, "Test scope item", True, "Test rationale"),
    },
    {
        "kind": "contradiction",
        "sql": (
            "INSERT INTO contradictions (id, project_id, item_a_type, item_a_id, item_b_type, item_b_id, explanation, resolved) "
            "VALUES (gen_random_uuid(), $1, 'unknown', gen_random_uuid(), 'unknown', gen_random_uuid(), $2, false)"
        ),
        "args": lambda pid: (pid, "Test contradiction explanation"),
    },
]


async def main() -> int:
    failures: list[str] = []
    passes: list[str] = []

    print(f"{INFO} Connecting to {DB_URL}")
    try:
        conn = await asyncpg.connect(DB_URL)
    except Exception as e:
        print(f"{FAIL} could not connect: {e}")
        return 2

    # Pick the most recent project as the test target
    pid = await conn.fetchval("SELECT id FROM projects ORDER BY created_at DESC LIMIT 1")
    if not pid:
        print(f"{FAIL} no projects in DB to use as test fixture")
        await conn.close()
        return 2
    print(f"{INFO} Using project: {pid}")

    print()
    for scenario in INSERT_SCENARIOS:
        kind = scenario["kind"]
        sql = scenario["sql"]
        args = scenario["args"](pid)

        # Wrap in a transaction that we ALWAYS roll back
        tx = conn.transaction()
        await tx.start()
        try:
            await conn.execute(sql, *args)
            await tx.rollback()
            print(f"  {PASS} {kind}: INSERT executes cleanly")
            passes.append(kind)
        except Exception as e:
            await tx.rollback()
            failures.append(f"{kind}: {e}")
            print(f"  {FAIL} {kind}: {e}")

    await conn.close()

    print()
    if failures:
        print(f"{FAIL} {len(failures)} of {len(INSERT_SCENARIOS)} INSERTs failed:")
        for f in failures:
            print(f"    - {f}")
        return 1
    print(f"{PASS} all {len(passes)} INSERT scenarios succeed against the real DB schema")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
