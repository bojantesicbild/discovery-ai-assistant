"""Add closed_at + closed_by to gaps

Revision ID: 015_gap_closure
Revises: 014_drop_resolution_type
Create Date: 2026-04-17

Closure accountability: when a gap moves to resolved/dismissed, capture
when it happened and who did it. Both fields are nullable — they stay
NULL while the gap is open/in-progress.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "015_gap_closure"
down_revision: Union[str, None] = "014_drop_resolution_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("gaps", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("gaps", sa.Column("closed_by", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("gaps", "closed_by")
    op.drop_column("gaps", "closed_at")
