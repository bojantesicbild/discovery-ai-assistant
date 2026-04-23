import uuid
from datetime import datetime, timedelta
from sqlalchemy import String, Integer, Text, DateTime, Interval, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class Reminder(Base, IdMixin, TimestampMixin):
    __tablename__ = "reminders"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    subject_type: Mapped[str] = mapped_column(String, nullable=False)
    subject_id: Mapped[str | None] = mapped_column(String, nullable=True)
    person: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_request: Mapped[str] = mapped_column(Text, nullable=False)

    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    prep_lead: Mapped[timedelta] = mapped_column(Interval, nullable=False, default=timedelta(hours=6))

    channel: Mapped[str] = mapped_column(String, nullable=False)
    prep_agent: Mapped[str] = mapped_column(String, nullable=False, default="discovery-prep-agent")
    # output_kind decides what the reminder pipeline actually produces
    # when it fires. notification = just a ping. status = quick DB-backed
    # summary, no LLM. agenda = full meeting brief via discovery-prep-agent.
    # research reserved for future. Default is 'notification' — the prep
    # agent is opt-in, not the default.
    output_kind: Mapped[str] = mapped_column(String, nullable=False, default="notification")

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    last_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Recurrence (v1 enum, not RRULE — matches how PMs actually phrase it).
    # After delivery the scanner rolls due_at forward to next_occurrence
    # and resets the row for another run, unless recurrence_end_at passes.
    recurrence: Mapped[str] = mapped_column(String, nullable=False, default="none")
    recurrence_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prepared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prep_output_path: Mapped[str | None] = mapped_column(String, nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


SUBJECT_TYPES = {"requirement", "gap", "free"}
CHANNELS = {"gmail", "slack", "in_app", "calendar"}
STATUSES = {"pending", "processing", "prepared", "delivered", "canceled", "failed"}
RECURRENCES = {"none", "daily", "weekdays", "weekly", "monthly"}
OUTPUT_KINDS = {"notification", "status", "agenda", "research"}
