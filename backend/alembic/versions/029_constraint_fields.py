"""Constraint enrichment: source_person, affects_reqs, workaround.

Revision ID: 029_constraint_fields
Revises: 028_chat_sessions
Create Date: 2026-04-23

Adds three fields to constraints to match the signal density BR and Gap
already carry:

- source_person (string) — stakeholder who imposed / stated the constraint
  (mirrors Requirement.source_person). Lets the PM know who to ask for a
  workaround without digging through the source document.
- affects_reqs (jsonb string array) — BR ids this constraint shapes,
  e.g. ["BR-004", "BR-007"]. Mirrors Requirement.blocked_by for the
  opposite direction. Gives a one-click "what's at risk if this stays"
  view.
- workaround (text) — short mitigation note. "Swap MongoDB for Postgres?
  → team has zero Mongo ops experience." Captures the negotiation lever
  the PM needs when the client pushes back on an assumed constraint.

All three are nullable / default empty. Existing rows stay as-is.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "029_constraint_fields"
down_revision: Union[str, None] = "028_chat_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("constraints", sa.Column("source_person", sa.String(), nullable=True))
    op.add_column(
        "constraints",
        sa.Column("affects_reqs", JSONB, nullable=False, server_default="[]"),
    )
    op.add_column("constraints", sa.Column("workaround", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("constraints", "workaround")
    op.drop_column("constraints", "affects_reqs")
    op.drop_column("constraints", "source_person")
