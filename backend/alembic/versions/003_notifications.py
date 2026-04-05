"""Add notifications table for in-app alerts

Revision ID: 003_notifications
Revises: 002_project_repos
Create Date: 2026-04-05
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "003_notifications"
down_revision: Union[str, None] = "002_project_repos"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("read", sa.Boolean, server_default="false"),
        sa.Column("data", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_notifications_user_unread", "notifications", ["user_id", "project_id", "read"])


def downgrade() -> None:
    op.drop_index("ix_notifications_user_unread")
    op.drop_table("notifications")
