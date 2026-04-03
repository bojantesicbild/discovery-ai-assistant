import uuid
from sqlalchemy import String, Float, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class ControlPointTemplate(Base, IdMixin):
    __tablename__ = "control_point_templates"

    project_type: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    priority: Mapped[str] = mapped_column(String, nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0)


class ReadinessHistory(Base, IdMixin, TimestampMixin):
    __tablename__ = "readiness_history"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String, nullable=True)
