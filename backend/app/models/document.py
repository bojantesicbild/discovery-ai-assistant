import uuid
from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class Document(Base, IdMixin, TimestampMixin):
    __tablename__ = "documents"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_type: Mapped[str] = mapped_column(String, nullable=False)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ragflow_doc_id: Mapped[str | None] = mapped_column(String, nullable=True)
    ragflow_dataset_id: Mapped[str | None] = mapped_column(String, nullable=True)
    chunking_template: Mapped[str | None] = mapped_column(String, nullable=True)
    classification: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    pipeline_stage: Mapped[str] = mapped_column(String, default="queued")
    pipeline_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    pipeline_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pipeline_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items_extracted: Mapped[int] = mapped_column(Integer, default=0)
    contradictions_found: Mapped[int] = mapped_column(Integer, default=0)
