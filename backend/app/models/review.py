"""Review portal models — token-gated client review of discovery findings."""

import uuid
from datetime import datetime
from typing import Any
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class ReviewToken(Base, IdMixin, TimestampMixin):
    """A shareable, time-limited token that gives a client read access to
    a project's requirements and gaps for review + confirmation."""
    __tablename__ = "review_tokens"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String, nullable=True)
    client_email: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    round_number: Mapped[int] = mapped_column(Integer, default=1)


class ReviewSubmission(Base, IdMixin, TimestampMixin):
    """Immutable audit record of a client's review submission. The raw
    payload is preserved even after requirement statuses are updated."""
    __tablename__ = "review_submissions"

    review_token_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("review_tokens.id"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    client_ip: Mapped[str | None] = mapped_column(String, nullable=True)
    client_user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    requirement_actions: Mapped[list] = mapped_column(JSONB, default=list)
    gap_actions: Mapped[list] = mapped_column(JSONB, default=list)
    summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ProposedUpdate(Base, IdMixin, TimestampMixin):
    """A staged patch to a requirement, generated from a client's gap answer.

    Never applied silently. The PM reviews each proposal and explicitly
    accepts (applies the patch), rejects (marks resolved without changes),
    or edits before accepting."""
    __tablename__ = "proposed_updates"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    # Exactly one of source_gap_id / source_doc_id is populated. Gap path
    # is the original client-review flow; doc path is the re-extraction
    # flow introduced in migration 030.
    source_gap_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    source_person: Mapped[str | None] = mapped_column(String, nullable=True)
    target_req_id: Mapped[str] = mapped_column(String, nullable=False)
    # field on Requirement to patch: description / user_perspective / rationale /
    # scope_note / acceptance_criteria / business_rules / edge_cases /
    # alternatives_considered / blocked_by / source_person. See
    # app.api.review._apply_patch for the live whitelist.
    proposed_field: Mapped[str] = mapped_column(String, nullable=False)
    # JSONB so we can carry either a string (description) or a list (criteria/rules)
    proposed_value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    current_value: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_round: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # Free-text rationale the PM gave when rejecting (or approving with
    # reservations). Fed back to the extraction agent on the next run as
    # part of the "past rejections to avoid" section — this is how the
    # agent stops re-proposing the same pattern.
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
