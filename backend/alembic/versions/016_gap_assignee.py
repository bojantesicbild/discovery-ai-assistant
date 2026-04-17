"""Add assignee to gaps

Revision ID: 016_gap_assignee
Revises: 015_gap_closure
Create Date: 2026-04-17

source_person tells us who RAISED a gap. assignee tells us who's
responsible for closing it — different role, different person often.
Free-form string (email, name, or team tag).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "016_gap_assignee"
down_revision: Union[str, None] = "015_gap_closure"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("gaps", sa.Column("assignee", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("gaps", "assignee")
