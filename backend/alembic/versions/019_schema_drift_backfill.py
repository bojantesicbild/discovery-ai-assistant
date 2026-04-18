"""Backfill schema drift — missing digests table + columns on existing DBs.

Revision ID: 019_schema_drift_backfill
Revises: 018_reminders
Create Date: 2026-04-18

Historical drift: the codebase's models grew columns and a new `digests`
table that were never recorded in alembic. A fresh install now gets the
right schema via updated 001 (gaps, requirements.sources/version/
source_person, contradictions.source_doc_id). But long-lived DBs are
stuck at older states. This migration uses IF NOT EXISTS guards so it
no-ops where the column/table already exists and fills the gap otherwise.

Nothing here is destructive. Downgrade is a no-op because we can't
reliably know whether this migration created the column or an older
manual ALTER did.
"""
from typing import Sequence, Union
from alembic import op

revision: str = "019_schema_drift_backfill"
down_revision: Union[str, None] = "018_reminders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE requirements  ADD COLUMN IF NOT EXISTS source_person VARCHAR;")
    op.execute("ALTER TABLE requirements  ADD COLUMN IF NOT EXISTS sources       JSONB DEFAULT '[]';")
    op.execute("ALTER TABLE requirements  ADD COLUMN IF NOT EXISTS version       INTEGER DEFAULT 1;")
    op.execute("ALTER TABLE contradictions ADD COLUMN IF NOT EXISTS source_doc_id UUID REFERENCES documents(id);")
    op.execute("""
        CREATE TABLE IF NOT EXISTS digests (
            id           UUID PRIMARY KEY,
            project_id   UUID NOT NULL REFERENCES projects(id),
            digest_type  VARCHAR DEFAULT 'morning',
            data         JSONB NOT NULL,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
    """)


def downgrade() -> None:
    # Deliberately empty — see module docstring.
    pass
