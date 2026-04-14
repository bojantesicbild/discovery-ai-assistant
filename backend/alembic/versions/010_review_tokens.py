"""Add review_tokens and review_submissions tables for client review portal

Revision ID: 010_review_tokens
Revises: 009_finding_history
Create Date: 2026-04-14
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "010_review_tokens"
down_revision: Union[str, None] = "009_finding_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("review_tokens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token", sa.String, unique=True, nullable=False),
        sa.Column("label", sa.String, nullable=True),
        sa.Column("client_name", sa.String, nullable=True),
        sa.Column("client_email", sa.String, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("round_number", sa.Integer, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_review_tokens_token", "review_tokens", ["token"])
    op.create_index("ix_review_tokens_project", "review_tokens", ["project_id", "revoked_at"])

    op.create_table("review_submissions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("review_token_id", UUID(as_uuid=True), sa.ForeignKey("review_tokens.id"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("client_ip", sa.String, nullable=True),
        sa.Column("client_user_agent", sa.String, nullable=True),
        sa.Column("requirement_actions", JSONB, server_default="[]"),
        sa.Column("gap_actions", JSONB, server_default="[]"),
        sa.Column("summary", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("review_submissions")
    op.drop_index("ix_review_tokens_project")
    op.drop_index("ix_review_tokens_token")
    op.drop_table("review_tokens")
