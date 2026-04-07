"""Add project_integrations table for connector directory

Revision ID: 004_project_integrations
Revises: 003_notifications
Create Date: 2026-04-06
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "004_project_integrations"
down_revision: Union[str, None] = "003_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_integrations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("connector_id", sa.String, nullable=False),
        sa.Column("config_encrypted", sa.LargeBinary, nullable=False),
        sa.Column("metadata_public", JSONB, nullable=True),
        sa.Column("status", sa.String, server_default="active"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "connector_id", name="uq_project_connector"),
    )
    op.create_index("ix_project_integrations_project", "project_integrations", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_integrations_project")
    op.drop_table("project_integrations")
