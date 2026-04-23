"""Relationship — a typed edge between two findings, with provenance.

Part of the session-heartbeat architecture (Phase 1). See
docs/research/2026-04-23-session-heartbeat-plan.md for the full design.

Each row represents one assertion of the form "from_uuid is rel_type
to_uuid", carrying the source quote and source doc on the row itself
so queries answer "why does this edge exist" without a join.

Status model is retract-not-delete: rejected edges survive with
`retraction_reason` so the past-rejections learning loop (see
migration 030) can consume them.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, ENUM as PGENUM
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin


# Enum values mirror the migration. Listed as tuples so the test suite
# can import them without pulling in a migration module.
CONFIDENCE_VALUES = ("explicit", "derived", "proposed")
SOURCE_VALUES = ("extraction", "propose_update", "human",
                 "graph_parser", "review_portal")


# Reusable enum descriptors — create_type=False because the migration
# owns the type creation (see alembic/versions/032_relationships_table.py).
_CONFIDENCE_ENUM = PGENUM(*CONFIDENCE_VALUES, name="rel_confidence",
                          create_type=False)
_SOURCE_ENUM = PGENUM(*SOURCE_VALUES, name="rel_source",
                      create_type=False)


class Relationship(Base, IdMixin):
    __tablename__ = "relationships"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Endpoints — UUIDs so renames never break edges. Display IDs
    # (BR-004, GAP-007) are resolved at read time against the finding
    # tables.
    from_type: Mapped[str] = mapped_column(String(32), nullable=False)
    from_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    to_type: Mapped[str] = mapped_column(String(32), nullable=False)
    to_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    rel_type: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[str] = mapped_column(_CONFIDENCE_ENUM, nullable=False)
    created_by: Mapped[str] = mapped_column(_SOURCE_ENUM, nullable=False)

    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    # Lifecycle — retract, don't destroy. Keeps the lesson.
    status: Mapped[str] = mapped_column(String(16), nullable=False,
                                        server_default="active")
    retracted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    retracted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    retraction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "project_id", "from_uuid", "to_uuid", "rel_type", "created_by",
            name="uq_relationships_endpoints",
        ),
    )
