"""Slack inbound integration models.

SlackChannelLink — channel→project mapping (a project is Slack-active iff
it has ≥1 link). Created via the Directory UI.

SlackThreadSession — thread→Claude Code session mapping. Created on first
@-mention in a thread; reused via `claude --resume <session_id>` on every
subsequent message in the same thread.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin, TimestampMixin


class SlackChannelLink(Base, IdMixin, TimestampMixin):
    __tablename__ = "slack_channel_links"
    __table_args__ = (
        UniqueConstraint("team_id", "channel_id", name="uq_slack_team_channel"),
        Index("ix_slack_channel_links_project", "project_id"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    team_id: Mapped[str] = mapped_column(String, nullable=False)
    channel_id: Mapped[str] = mapped_column(String, nullable=False)
    channel_name: Mapped[str | None] = mapped_column(String, nullable=True)


class SlackThreadSession(Base, IdMixin, TimestampMixin):
    __tablename__ = "slack_thread_sessions"
    __table_args__ = (
        UniqueConstraint("team_id", "channel_id", "thread_ts", name="uq_slack_thread"),
        Index("ix_slack_thread_sessions_project", "project_id"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    team_id: Mapped[str] = mapped_column(String, nullable=False)
    channel_id: Mapped[str] = mapped_column(String, nullable=False)
    thread_ts: Mapped[str] = mapped_column(String, nullable=False)
    claude_session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
