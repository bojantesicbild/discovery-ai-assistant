"""Per-user "seen / unread" tracking for findings.

Records that a user has reviewed a specific finding (requirement, gap,
constraint, decision, contradiction, assumption, scope item, stakeholder).
The polymorphic finding_id is not enforced by a DB FK because findings live
in 8 different tables — referential integrity is maintained by application
code (delete cascades happen via the deletion endpoints, and a daily
cleanup job sweeps orphans).

Read state is per-user so multiple project members each have their own
unread count.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin, TimestampMixin


class FindingView(Base, IdMixin, TimestampMixin):
    __tablename__ = "finding_views"
    __table_args__ = (
        UniqueConstraint("user_id", "finding_type", "finding_id", name="uq_finding_view"),
        Index("ix_finding_views_user_project", "user_id", "project_id"),
        Index("ix_finding_views_user_type", "user_id", "project_id", "finding_type"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    # One of: requirement, gap, constraint, decision, contradiction,
    # assumption, scope, stakeholder
    finding_type: Mapped[str] = mapped_column(String, nullable=False)
    # Polymorphic — references the row's UUID primary key in whichever
    # table matches finding_type. Not enforced by FK.
    finding_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Tracks the version of the finding the user saw. v1 always stores 1;
    # v1.1 will bump on row update so we can detect "changed since seen".
    seen_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
