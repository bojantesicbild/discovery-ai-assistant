"""Add proposed_updates table for staged diff proposals from client reviews

Revision ID: 017_proposed_updates
Revises: 016_gap_assignee
Create Date: 2026-04-17

When a client answers a gap, an agent can propose a patch to the
requirements that gap blocks. Proposals are never applied silently —
they land here as pending, and the PM accepts or rejects each one.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "017_proposed_updates"
down_revision: Union[str, None] = "016_gap_assignee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "proposed_updates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("source_gap_id", sa.String(), nullable=False),
        sa.Column("target_req_id", sa.String(), nullable=False),
        sa.Column("proposed_field", sa.String(), nullable=False),
        sa.Column("proposed_value", postgresql.JSONB, nullable=False),
        sa.Column("current_value", postgresql.JSONB, nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("client_answer", sa.Text(), nullable=True),
        sa.Column("review_round", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_proposed_updates_status", "proposed_updates", ["project_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_proposed_updates_status", table_name="proposed_updates")
    op.drop_table("proposed_updates")
