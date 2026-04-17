"""Add resolution_type column to gaps

Revision ID: 012_gap_resolution_type
Revises: 011_meeting_agendas
Create Date: 2026-04-17
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "012_gap_resolution_type"
down_revision: Union[str, None] = "011_meeting_agendas"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "gaps",
        sa.Column("resolution_type", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("gaps", "resolution_type")
