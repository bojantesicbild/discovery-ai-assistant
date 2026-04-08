"""Add finding_views table for per-user unread tracking

Revision ID: 007_finding_views
Revises: 006_shared_conversation
Create Date: 2026-04-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "007_finding_views"
down_revision: Union[str, None] = "006_shared_conversation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "finding_views",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("finding_type", sa.String, nullable=False),
        sa.Column("finding_id", UUID(as_uuid=True), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seen_version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "finding_type", "finding_id", name="uq_finding_view"),
    )
    op.create_index("ix_finding_views_user_project", "finding_views", ["user_id", "project_id"])
    op.create_index("ix_finding_views_user_type", "finding_views", ["user_id", "project_id", "finding_type"])


def downgrade() -> None:
    op.drop_index("ix_finding_views_user_type")
    op.drop_index("ix_finding_views_user_project")
    op.drop_table("finding_views")
