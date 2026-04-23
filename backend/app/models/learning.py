"""Learning — patterns the agent observes across sessions.

Phase 3 of the session-heartbeat architecture. See the research doc:
docs/research/2026-04-23-session-heartbeat-plan.md.

The idea: instead of bolting on model fine-tuning, grow a searchable
inbox of insights the agent can read at session start. Rejections with
reasons, recurring PM preferences, recurring anti-patterns all land
here. The agent cites them in its reasoning; promoted ones become
Tier 1 context in CLAUDE.md's terminology.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin


LEARNING_CATEGORIES = (
    "pm_preference",       # "this PM prefers terse commit messages"
    "domain_fact",         # "the EU hosting constraint is non-negotiable"
    "workflow_pattern",    # "after meetings, PM always resolves SOC-2 first"
    "anti_pattern",        # "never propose Auth0 here — rejected 3 times"
)
LEARNING_STATUS = ("transient", "promoted", "dismissed")


class Learning(Base, IdMixin):
    __tablename__ = "learnings"

    # NULL project_id = global learning that applies across projects.
    # Opt-in only — PM promotes explicitly; agents default to
    # project-scoped emissions.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
    )
    origin_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True,
    )

    category: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Normalized content (lowercased + whitespace-collapsed + truncated)
    # for the UNIQUE dedup index. Computed by the service layer; never
    # exposed to agents.
    content_key: Mapped[str] = mapped_column(String(256), nullable=False)

    evidence_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="transient",
    )
    reference_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1",
    )
    last_relevant_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    promoted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    promoted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    dismissed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id", "category", "content_key",
            name="uq_learnings_dedup",
        ),
    )
