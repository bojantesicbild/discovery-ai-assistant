"""Stakeholder doc shape: role_title + decisions list.

Revision ID: 037_stakeholder_structured
Revises: 036_learnings_user_scope
Create Date: 2026-04-25

Adds two columns to `stakeholders`:

  - role_title VARCHAR(64) — short job title (≤40 chars in practice)
  - decisions JSONB — list of decision strings

The legacy `role` column stays as a free-form paragraph (now optional
in the schema). Existing rows keep their `role` text — Phase 4
backfill splits it into role_title + decisions.

Both columns nullable so the upgrade is non-blocking — old code paths
still write the original shape and the markdown writer falls back to
`role` when role_title is null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "037_stakeholder_structured"
down_revision: Union[str, None] = "036_learnings_user_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "stakeholders",
        sa.Column("role_title", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "stakeholders",
        sa.Column("decisions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    # `role` was NOT NULL — relax it now that role_title carries the
    # required short title. Existing rows with role text stay valid;
    # new rows can supply only role_title.
    op.alter_column("stakeholders", "role", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    # Best-effort: backfill empty role values before re-applying NOT NULL
    # so the constraint doesn't fail on rows written under the new schema.
    op.execute("UPDATE stakeholders SET role = COALESCE(role, role_title, '')")
    op.alter_column("stakeholders", "role", existing_type=sa.String(), nullable=False)
    op.drop_column("stakeholders", "decisions")
    op.drop_column("stakeholders", "role_title")
