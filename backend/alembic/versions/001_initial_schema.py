"""Initial schema — all tables from ARCHITECTURE.md

Revision ID: 001_initial
Revises: None
Create Date: 2026-04-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users
    op.create_table("users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String, unique=True, nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("auth_provider", sa.String, nullable=False),
        sa.Column("auth_provider_id", sa.String, nullable=False),
        sa.Column("is_admin", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Projects
    op.create_table("projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("client_name", sa.String, nullable=False),
        sa.Column("project_type", sa.String, nullable=False),
        sa.Column("status", sa.String, default="active"),
        sa.Column("repo_url", sa.String, nullable=True),
        sa.Column("git_access_token", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table("project_members",
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Documents
    op.create_table("documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("filename", sa.String, nullable=False),
        sa.Column("file_type", sa.String, nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=True),
        sa.Column("ragflow_doc_id", sa.String, nullable=True),
        sa.Column("ragflow_dataset_id", sa.String, nullable=True),
        sa.Column("chunking_template", sa.String, nullable=True),
        sa.Column("classification", JSONB, nullable=True),
        sa.Column("pipeline_stage", sa.String, default="queued"),
        sa.Column("pipeline_error", sa.Text, nullable=True),
        sa.Column("pipeline_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pipeline_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("items_extracted", sa.Integer, default=0),
        sa.Column("contradictions_found", sa.Integer, default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Requirements
    op.create_table("requirements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("req_id", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("priority", sa.String, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("user_perspective", sa.Text, nullable=True),
        sa.Column("business_rules", JSONB, default=[]),
        sa.Column("edge_cases", JSONB, default=[]),
        sa.Column("source_doc_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("source_quote", sa.Text, nullable=False),
        sa.Column("status", sa.String, default="proposed"),
        sa.Column("confidence", sa.String, default="medium"),
        sa.Column("ragflow_chunk_id", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Constraints
    op.create_table("constraints",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("impact", sa.Text, nullable=False),
        sa.Column("source_doc_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("source_quote", sa.Text, nullable=False),
        sa.Column("status", sa.String, default="assumed"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Decisions
    op.create_table("decisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("decided_by", sa.String, nullable=True),
        sa.Column("decided_date", sa.Date, nullable=True),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column("alternatives", JSONB, default=[]),
        sa.Column("impacts", JSONB, default=[]),
        sa.Column("source_doc_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("status", sa.String, default="tentative"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Stakeholders
    op.create_table("stakeholders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("organization", sa.String, nullable=False),
        sa.Column("decision_authority", sa.String, default="informed"),
        sa.Column("interests", JSONB, default=[]),
        sa.Column("source_doc_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Assumptions
    op.create_table("assumptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("statement", sa.Text, nullable=False),
        sa.Column("basis", sa.Text, nullable=False),
        sa.Column("risk_if_wrong", sa.Text, nullable=False),
        sa.Column("needs_validation_by", sa.String, nullable=True),
        sa.Column("validated", sa.Boolean, default=False),
        sa.Column("source_doc_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Scope Items
    op.create_table("scope_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("in_scope", sa.Boolean, nullable=False),
        sa.Column("rationale", sa.Text, nullable=False),
        sa.Column("source_doc_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Contradictions
    op.create_table("contradictions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("item_a_type", sa.String, nullable=False),
        sa.Column("item_a_id", UUID(as_uuid=True), nullable=False),
        sa.Column("item_b_type", sa.String, nullable=False),
        sa.Column("item_b_id", UUID(as_uuid=True), nullable=False),
        sa.Column("explanation", sa.Text, nullable=False),
        sa.Column("resolved", sa.Boolean, default=False),
        sa.Column("resolution_note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Change History
    op.create_table("change_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("item_type", sa.String, nullable=False),
        sa.Column("item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String, nullable=False),
        sa.Column("old_value", JSONB, nullable=True),
        sa.Column("new_value", JSONB, nullable=True),
        sa.Column("triggered_by", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Control Point Templates
    op.create_table("control_point_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_type", sa.String, nullable=False),
        sa.Column("category", sa.String, nullable=False),
        sa.Column("description", sa.String, nullable=False),
        sa.Column("priority", sa.String, nullable=False),
        sa.Column("weight", sa.Float, default=1.0),
    )

    # Readiness History
    op.create_table("readiness_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("breakdown", JSONB, nullable=True),
        sa.Column("triggered_by", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Conversations
    op.create_table("conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("messages", JSONB, default=[]),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "user_id"),
    )

    # Activity Log
    op.create_table("activity_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String, nullable=False),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("details", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # LLM Calls
    op.create_table("llm_calls",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("trace_id", UUID(as_uuid=True), nullable=True),
        sa.Column("model", sa.String, nullable=False),
        sa.Column("purpose", sa.String, nullable=False),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("cost_usd", sa.Numeric(10, 6), nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("retries", sa.Integer, default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Pipeline Checkpoints
    op.create_table("pipeline_checkpoints",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id")),
        sa.Column("stage", sa.String, nullable=False),
        sa.Column("data", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Learnings
    op.create_table("learnings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("skill", sa.String, nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("key", sa.String, nullable=False),
        sa.Column("insight", sa.Text, nullable=False),
        sa.Column("confidence", sa.Integer, nullable=False),
        sa.Column("source", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "key", "type"),
    )

    # Pipeline Syncs
    op.create_table("pipeline_syncs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id")),
        sa.Column("repo_url", sa.String, nullable=True),
        sa.Column("files_synced", sa.Integer, default=0),
        sa.Column("sync_status", sa.String, default="never"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    tables = [
        "pipeline_syncs", "learnings", "pipeline_checkpoints", "llm_calls",
        "activity_log", "conversations", "readiness_history", "control_point_templates",
        "change_history", "contradictions", "scope_items", "assumptions",
        "stakeholders", "decisions", "constraints", "requirements",
        "documents", "project_members", "projects", "users",
    ]
    for table in tables:
        op.drop_table(table)
