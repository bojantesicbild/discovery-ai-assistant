import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, Text, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
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
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    alternatives_considered: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    scope_note: Mapped[str | None] = mapped_column(String, nullable=True)
    blocked_by: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")  # ["BR-001", ...]
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
    source_person: Mapped[str | None] = mapped_column(String, nullable=True)
    affects_reqs: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    workaround: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="assumed")
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


class Gap(Base, IdMixin, TimestampMixin):
    __tablename__ = "gaps"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    gap_id: Mapped[str] = mapped_column(String, nullable=False)  # GAP-001
    question: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String, default="missing_info", server_default="missing_info")
    severity: Mapped[str] = mapped_column(String, default="medium")  # high, medium, low
    area: Mapped[str] = mapped_column(String, default="general")
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    source_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_person: Mapped[str | None] = mapped_column(String, nullable=True)
    blocked_reqs: Mapped[list] = mapped_column(JSONB, default=list)  # ["BR-001", "BR-002"]
    suggested_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")  # open, resolved, dismissed
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    assignee: Mapped[str | None] = mapped_column(String, nullable=True)  # who's responsible for closing this gap
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Contradiction(Base, IdMixin, TimestampMixin):
    __tablename__ = "contradictions"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)

    # First-class free-form fields — how the extraction agent actually
    # produces contradictions. title is the short headline; side_a /
    # side_b are the two conflicting statements; area is the domain
    # category (e.g. 'tech-stack', 'scope', 'governance').
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    side_a: Mapped[str | None] = mapped_column(Text, nullable=True)
    side_b: Mapped[str | None] = mapped_column(Text, nullable=True)
    area: Mapped[str | None] = mapped_column(String, nullable=True)

    # Per-side provenance — document + person for each side. Populated by
    # the extraction agent from the source quotes it reads. The UI renders
    # these as source + person chips next to each side's content.
    side_a_source: Mapped[str | None] = mapped_column(String, nullable=True)
    side_a_person: Mapped[str | None] = mapped_column(String, nullable=True)
    side_b_source: Mapped[str | None] = mapped_column(String, nullable=True)
    side_b_person: Mapped[str | None] = mapped_column(String, nullable=True)

    # Legacy pointer fields — kept nullable for the rare case where a
    # contradiction genuinely references two existing DB rows. Not the
    # default path. Migration 025 nulled out the 'unknown'/random-UUID
    # placeholders the old MCP handler was writing.
    item_a_type: Mapped[str | None] = mapped_column(String, nullable=True)
    item_a_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    item_b_type: Mapped[str | None] = mapped_column(String, nullable=True)
    item_b_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

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
