"""Add meeting_agendas table

Revision ID: 011_meeting_agendas
Revises: 010_review_tokens
Create Date: 2026-04-15
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "011_meeting_agendas"
down_revision: Union[str, None] = "010_review_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table("meeting_agendas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("content_md", sa.Text, nullable=False),
        sa.Column("generated_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("round_number", sa.Integer, server_default="1"),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_meeting_agendas_project", "meeting_agendas", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_meeting_agendas_project")
    op.drop_table("meeting_agendas")
