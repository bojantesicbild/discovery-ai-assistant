import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Text, Boolean, ForeignKey, UniqueConstraint, LargeBinary, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class ChatSession(Base, IdMixin, TimestampMixin):
    """One chat tab per row. Every project has exactly one is_default=true
    (and is_pinned_slack=true on the same row) — Slack inbound + project-
    level events route there. Users create extra sessions for side-topics;
    each carries its own claude_session_id so a fresh tab starts a fresh
    --resume thread."""
    __tablename__ = "chat_sessions"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_pinned_slack: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    claude_session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    # TimestampMixin only provides created_at; we want updated_at on this row
    # so the UI can sort tabs by recent activity if/when we expose that.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now(),
    )


class Conversation(Base, IdMixin, TimestampMixin):
    """One row per (project, chat_session). The messages JSONB holds the
    rolling timeline for that session; project-level events (doc ingestion,
    reminder lifecycle cards) live in the default session's row."""
    __tablename__ = "conversations"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False,
    )
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


class Digest(Base, IdMixin, TimestampMixin):
    __tablename__ = "digests"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    digest_type: Mapped[str] = mapped_column(String, default="morning")
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)


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


class Notification(Base, IdMixin, TimestampMixin):
    __tablename__ = "notifications"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # daily-digest, weekly-summary, etc.
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ProjectIntegration(Base, IdMixin, TimestampMixin):
    """An enabled connector (MCP server) for a project. Secrets are Fernet-encrypted."""
    __tablename__ = "project_integrations"
    __table_args__ = (UniqueConstraint("project_id", "connector_id"),)

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    connector_id: Mapped[str] = mapped_column(String, nullable=False)  # "gmail", "google_drive", "slack", ...
    # Encrypted config blob (Fernet). Contains tokens, refresh_tokens, api_keys, etc.
    config_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # Non-secret metadata shown in UI (team_id, email, workspace_name, scopes, ...)
    metadata_public: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active | error | pending_auth
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PipelineSync(Base, IdMixin, TimestampMixin):
    __tablename__ = "pipeline_syncs"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    repo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    files_synced: Mapped[int] = mapped_column(Integer, default=0)
    sync_status: Mapped[str] = mapped_column(String, default="never")
