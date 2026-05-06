"""Tech-Story domain models — thin DB index over agent-owned vault files.

Tech docs (`docs/tech-docs/*.md`) and PBI story files are written by the
`story-tech-agent` and `story-story-agent` per the Artifact Ownership
Contract (assistants/CLAUDE.md). This module stores only the index needed
to render the web UI — display ids, parent FK, source-BR references,
status — while content remains in the vault and is fetched via the
existing wiki/vault file APIs.

`Story.tech_doc_id` is NOT NULL: every story belongs to a parent tech doc.
`Story.source_brs` is denormalized (inherited from the parent TD) so the
list view doesn't need a join just to render BR pills.
"""

import uuid
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin, TimestampMixin


class TechDoc(Base, IdMixin, TimestampMixin):
    __tablename__ = "tech_docs"
    __table_args__ = (
        UniqueConstraint("project_id", "td_id", name="uq_tech_docs_project_td"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    td_id: Mapped[str] = mapped_column(String, nullable=False)  # TD-001
    title: Mapped[str] = mapped_column(String, nullable=False)
    # Path relative to the project's vault root, e.g. "docs/tech-docs/auth-flow.md".
    # Nullable until the agent has actually written the file (DB row may
    # exist as a placeholder during generation).
    file_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # ["BR-001", "BR-005"] — display ids of the requirements that informed
    # this tech doc. Stored as text, not FKs, so the index survives BR
    # renames/version bumps the way the rest of the vault does.
    source_brs: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    status: Mapped[str] = mapped_column(
        String, default="draft", server_default="draft"
    )  # draft | reviewed | approved | superseded
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Story(Base, IdMixin, TimestampMixin):
    __tablename__ = "stories"
    __table_args__ = (
        UniqueConstraint("project_id", "us_id", name="uq_stories_project_us"),
        Index("ix_stories_tech_doc_id", "tech_doc_id"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    tech_doc_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tech_docs.id"), nullable=False
    )
    us_id: Mapped[str] = mapped_column(String, nullable=False)  # US-001
    title: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str | None] = mapped_column(String, nullable=True)
    source_brs: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    acceptance_criteria: Mapped[list] = mapped_column(
        JSONB, default=list, server_default="[]"
    )
    status: Mapped[str] = mapped_column(
        String, default="todo", server_default="todo"
    )  # todo | in_progress | done | dropped
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
