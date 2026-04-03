import uuid
from decimal import Decimal
from sqlalchemy import String, Integer, Text, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class Conversation(Base, IdMixin, TimestampMixin):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    messages: Mapped[list] = mapped_column(JSONB, default=list)


class ActivityLog(Base, IdMixin, TimestampMixin):
    __tablename__ = "activity_log"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class LLMCall(Base, IdMixin, TimestampMixin):
    __tablename__ = "llm_calls"

    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    trace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    model: Mapped[str] = mapped_column(String, nullable=False)
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[Decimal | None] = mapped_column(nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retries: Mapped[int] = mapped_column(Integer, default=0)


class PipelineCheckpoint(Base, IdMixin, TimestampMixin):
    __tablename__ = "pipeline_checkpoints"

    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    stage: Mapped[str] = mapped_column(String, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class Learning(Base, IdMixin, TimestampMixin):
    __tablename__ = "learnings"
    __table_args__ = (UniqueConstraint("project_id", "key", "type"),)

    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    skill: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    insight: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)


class PipelineSync(Base, IdMixin, TimestampMixin):
    __tablename__ = "pipeline_syncs"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    repo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    files_synced: Mapped[int] = mapped_column(Integer, default=0)
    sync_status: Mapped[str] = mapped_column(String, default="never")
