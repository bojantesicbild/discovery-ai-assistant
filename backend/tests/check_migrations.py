"""Alembic smoke test — bootstrap a fresh DB and verify schema.

Runs `alembic upgrade head` against a throwaway database, then checks
every SQLAlchemy model for column coverage. Would have caught the
missing-gaps-table bug that ate real data in April '26.

Run by hand:
    cd backend && .venv/bin/python tests/check_migrations.py

Or as part of a pre-push / CI gate. Uses the same postgres container as
the dev stack — creates / drops a side database so your main
discovery_db is never touched.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

# Make `app.*` imports work when running from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncpg  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.db.base import Base  # noqa: E402
import app.models  # noqa: F401,E402  — registers all tables on Base.metadata


PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"

ADMIN_URL = "postgresql://discovery_user:discovery_pass@localhost:5432/postgres"
TEST_DB = "discovery_migrations_test"
TEST_URL_SYNC = f"postgresql://discovery_user:discovery_pass@localhost:5432/{TEST_DB}"
TEST_URL_ASYNC = f"postgresql+asyncpg://discovery_user:discovery_pass@localhost:5432/{TEST_DB}"


async def _drop_and_create_db():
    """Drop the test DB if it exists, then create it fresh."""
    conn = await asyncpg.connect(ADMIN_URL)
    try:
        await conn.execute(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname = '{TEST_DB}' AND pid <> pg_backend_pid()"
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}"')
        await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()


async def _drop_test_db():
    """Clean up the test database."""
    conn = await asyncpg.connect(ADMIN_URL)
    try:
        await conn.execute(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname = '{TEST_DB}' AND pid <> pg_backend_pid()"
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}"')
    finally:
        await conn.close()


def _run_alembic() -> tuple[bool, str]:
    """Run `alembic upgrade head` against the test DB. Returns (ok, output)."""
    env = {**os.environ, "DATABASE_URL": TEST_URL_ASYNC, "PYTHONPATH": "."}
    proc = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    return proc.returncode == 0, out


async def _diff_schema() -> list[str]:
    """Return a list of model columns missing from the DB. Empty = good."""
    eng = create_async_engine(TEST_URL_ASYNC)
    missing: list[str] = []
    try:
        async with eng.connect() as c:
            for t in Base.metadata.sorted_tables:
                r = await c.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='public' AND table_name=:t"
                    ),
                    {"t": t.name},
                )
                db_cols = {row[0] for row in r.fetchall()}
                if not db_cols:
                    missing.append(f"[missing table] {t.name}")
                    continue
                missing.extend(
                    f"{t.name}.{col.name}"
                    for col in t.columns
                    if col.name not in db_cols
                )
    finally:
        await eng.dispose()
    return missing


async def main() -> int:
    print("Alembic smoke test")
    print("  test DB:", TEST_DB)

    try:
        await _drop_and_create_db()
        print(f"  {PASS} fresh test DB created")
    except Exception as e:
        print(f"  {FAIL} couldn't create test DB: {e}")
        print("     is postgres running on localhost:5432?")
        return 1

    try:
        ok, output = _run_alembic()
        if not ok:
            print(f"  {FAIL} alembic upgrade head failed:")
            print("    " + "\n    ".join(output.splitlines()[-15:]))
            return 1
        print(f"  {PASS} alembic upgrade head")

        missing = await _diff_schema()
        if missing:
            print(f"  {FAIL} model ↔ DB drift detected:")
            for m in missing:
                print(f"      - {m}")
            return 1
        print(f"  {PASS} model ↔ DB schema matches")
    finally:
        await _drop_test_db()
        print(f"  {PASS} test DB dropped")

    print("All migration checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
