"""Learnings get a user_id — per-user scoping.

Revision ID: 036_learnings_user_scope
Revises: 035_api_tokens
Create Date: 2026-04-24

Multi-user stage 4. Adds nullable user_id so a learning can be
attributed to a specific PM ("Bojan's commit-message preference")
rather than shared across everyone on the project ("team convention
on this project"). Existing rows keep user_id NULL → treated as
team-level learnings, which is the correct default for everything
captured before multi-user existed.

Scope matrix the read path honors:

  (project_id, user_id)     → this user on this project   most specific
  (project_id, NULL)        → team convention on project
  (NULL, user_id)           → user's personal style anywhere
  (NULL, NULL)              → universal truth              least specific

Dedup widens to include user_id so Alice and Bob can hold different
positions on the same topic within the same project. NULLS NOT
DISTINCT semantics (Postgres 15+) let NULL collapse as intended.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID


revision: str = "036_learnings_user_scope"
down_revision: Union[str, None] = "035_api_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable user_id. Existing rows stay NULL → team-level scope,
    # which is the right default for everything pre-MU-4.
    op.add_column(
        "learnings",
        sa.Column(
            "user_id", PGUUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Widen the dedup constraint. Drop the 3-col one, recreate 4-col.
    # NULLS NOT DISTINCT preserved so team-level NULL user_id rows
    # still dedup against other team-level rows.
    op.drop_constraint("uq_learnings_dedup", "learnings", type_="unique")
    op.create_unique_constraint(
        "uq_learnings_dedup",
        "learnings",
        ["project_id", "user_id", "category", "content_key"],
        postgresql_nulls_not_distinct=True,
    )

    # Hot-read helper for the per-user session-start fetch: filtered by
    # user_id + status. Complements the existing project+last_relevant_at
    # index; query planner picks whichever cuts the row set harder.
    op.create_index(
        "idx_learnings_active_user",
        "learnings",
        ["user_id", "last_relevant_at"],
        postgresql_where=sa.text("status IN ('transient', 'promoted')"),
    )


def downgrade() -> None:
    op.drop_index("idx_learnings_active_user", table_name="learnings")
    op.drop_constraint("uq_learnings_dedup", "learnings", type_="unique")
    op.create_unique_constraint(
        "uq_learnings_dedup",
        "learnings",
        ["project_id", "category", "content_key"],
        postgresql_nulls_not_distinct=True,
    )
    op.drop_column("learnings", "user_id")
