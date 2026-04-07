"""Add Slack inbound tables (channel links + thread sessions)

Revision ID: 005_slack_inbound
Revises: 004_project_integrations
Create Date: 2026-04-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "005_slack_inbound"
down_revision: Union[str, None] = "004_project_integrations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "slack_channel_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("team_id", sa.String, nullable=False),
        sa.Column("channel_id", sa.String, nullable=False),
        sa.Column("channel_name", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("team_id", "channel_id", name="uq_slack_team_channel"),
    )
    op.create_index("ix_slack_channel_links_project", "slack_channel_links", ["project_id"])

    op.create_table(
        "slack_thread_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("team_id", sa.String, nullable=False),
        sa.Column("channel_id", sa.String, nullable=False),
        sa.Column("thread_ts", sa.String, nullable=False),
        sa.Column("claude_session_id", sa.String, nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("team_id", "channel_id", "thread_ts", name="uq_slack_thread"),
    )
    op.create_index("ix_slack_thread_sessions_project", "slack_thread_sessions", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_slack_thread_sessions_project")
    op.drop_table("slack_thread_sessions")
    op.drop_index("ix_slack_channel_links_project")
    op.drop_table("slack_channel_links")
