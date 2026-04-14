"""Add sources/version/updated_at to non-requirement entity tables.

Brings constraints, decisions, stakeholders, assumptions, scope_items, and
gaps in line with requirements: each can now record which documents have
contributed (sources JSONB array), how many merges have happened (version),
and when it was last touched (updated_at).

Revision ID: 009_finding_history
Revises: 008_backfill_finding_views
Create Date: 2026-04-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "009_finding_history"
down_revision: Union[str, None] = "008_backfill_finding_views"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES = ("constraints", "decisions", "stakeholders", "assumptions", "scope_items", "gaps")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("sources", JSONB, nullable=False, server_default="[]"))
        op.add_column(table, sa.Column("version", sa.Integer, nullable=False, server_default="1"))
        op.add_column(
            table,
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "updated_at")
        op.drop_column(table, "version")
        op.drop_column(table, "sources")
