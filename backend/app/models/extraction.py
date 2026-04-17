import uuid
from datetime import date, datetime
from sqlalchemy import String, Integer, Boolean, Text, Date, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class Requirement(Base, IdMixin, TimestampMixin):
    __tablename__ = "requirements"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    req_id: Mapped[str] = mapped_column(String, nullable=False)  # BR-001, BR-002
    title: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # functional, non_functional
    priority: Mapped[str] = mapped_column(String, nullable=False)  # must, should, could, wont
    description: Mapped[str] = mapped_column(Text, nullable=False)
    user_perspective: Mapped[str | None] = mapped_column(Text, nullable=True)
    business_rules: Mapped[list] = mapped_column(JSONB, default=list)
    edge_cases: Mapped[list] = mapped_column(JSONB, default=list)
    acceptance_criteria: Mapped[list] = mapped_column(JSONB, default=list)  # ["AC1: GIVEN... WHEN... THEN...", ...]
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    source_quote: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="proposed")
    confidence: Mapped[str] = mapped_column(String, default="medium")
    ragflow_chunk_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_person: Mapped[str | None] = mapped_column(String, nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list)  # [{doc_id, filename, quote, added_at}]
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Constraint(Base, IdMixin, TimestampMixin):
    __tablename__ = "constraints"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # budget, timeline, technology, regulatory, organizational
    description: Mapped[str] = mapped_column(Text, nullable=False)
    impact: Mapped[str] = mapped_column(Text, nullable=False)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    source_quote: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="assumed")
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Decision(Base, IdMixin, TimestampMixin):
    __tablename__ = "decisions"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    decided_by: Mapped[str | None] = mapped_column(String, nullable=True)
    decided_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    alternatives: Mapped[list] = mapped_column(JSONB, default=list)
    impacts: Mapped[list] = mapped_column(JSONB, default=list)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    status: Mapped[str] = mapped_column(String, default="tentative")
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Stakeholder(Base, IdMixin, TimestampMixin):
    __tablename__ = "stakeholders"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    organization: Mapped[str] = mapped_column(String, nullable=False)
    decision_authority: Mapped[str] = mapped_column(String, default="informed")
    interests: Mapped[list] = mapped_column(JSONB, default=list)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Assumption(Base, IdMixin, TimestampMixin):
    __tablename__ = "assumptions"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    basis: Mapped[str] = mapped_column(Text, nullable=False)
    risk_if_wrong: Mapped[str] = mapped_column(Text, nullable=False)
    needs_validation_by: Mapped[str | None] = mapped_column(String, nullable=True)
    validated: Mapped[bool] = mapped_column(Boolean, default=False)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ScopeItem(Base, IdMixin, TimestampMixin):
    __tablename__ = "scope_items"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    in_scope: Mapped[bool] = mapped_column(Boolean, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Gap(Base, IdMixin, TimestampMixin):
    __tablename__ = "gaps"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    gap_id: Mapped[str] = mapped_column(String, nullable=False)  # GAP-001
    question: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String, default="medium")  # high, medium, low
    area: Mapped[str] = mapped_column(String, default="general")
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    source_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_person: Mapped[str | None] = mapped_column(String, nullable=True)
    blocked_reqs: Mapped[list] = mapped_column(JSONB, default=list)  # ["BR-001", "BR-002"]
    suggested_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")  # open, in-progress, resolved, dismissed
    resolution_type: Mapped[str | None] = mapped_column(String, nullable=True)  # auto_resolve, ask_client, ask_po
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Contradiction(Base, IdMixin, TimestampMixin):
    __tablename__ = "contradictions"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    item_a_type: Mapped[str] = mapped_column(String, nullable=False)
    item_a_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    item_b_type: Mapped[str] = mapped_column(String, nullable=False)
    item_b_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChangeHistory(Base, IdMixin, TimestampMixin):
    __tablename__ = "change_history"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    item_type: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String, nullable=True)
