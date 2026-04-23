"""Session + SessionEvent — project heartbeat models.

Phase 2 of the session-heartbeat architecture. Separate module
(not squeezed into operational.py) because sessions have their own
service layer and will grow more logic (archival, learnings
propagation) that we want to keep out of the generic ops namespace.

See docs/research/2026-04-23-session-heartbeat-plan.md.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin


SESSION_STATUS = ("active", "archived", "abandoned")


class Session(Base, IdMixin):
    """A user-project work window. See migration 033 for the full shape.

    NOTE: class name collides with SQLAlchemy's `Session` only in
    contexts that import `sqlalchemy.orm.Session` — the project uses
    `AsyncSession` throughout, so no conflict in practice.
    """
    __tablename__ = "sessions"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Nullable so pipeline / system sessions (ingests triggered by cron,
    # Gmail sync, etc.) can record events without a real user.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    domain: Mapped[str | None] = mapped_column(String(32), nullable=True)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_event_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="active",
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Accumulated over the session's lifetime: files written, proposal
    # ids touched, reminder ids created, etc. Free-form dict keyed by
    # artifact kind.
    artifacts_produced: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )


class SessionEvent(Base, IdMixin):
    """One row per mutating action in the product. Append-only —
    nothing updates or deletes these except the Phase 6 cleanup job."""
    __tablename__ = "session_events"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Denormalized so project-scoped queries don't have to join sessions.
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}",
    )
