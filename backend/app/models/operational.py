import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Text, Boolean, ForeignKey, UniqueConstraint, LargeBinary, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, IdMixin, TimestampMixin


class Conversation(Base, IdMixin, TimestampMixin):
    __tablename__ = "conversations"
    # user_id is nullable: rows with user_id IS NULL are project-shared
    # conversations (one per project) used by both web chat and Slack inbound.
    # Uniqueness is enforced via a partial index in migration 006.

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
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


# The heartbeat-era Learning model lives in app.models.learning. This
# placeholder comment replaces the pre-heartbeat Learning class that
# migration 034 dropped. Leaving the namespace free so the new class
# (imported from app.models.learning) doesn't collide on import.


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
