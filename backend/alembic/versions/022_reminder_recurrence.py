"""Add recurrence to reminders (daily / weekdays / weekly / monthly).

Revision ID: 022_reminder_recurrence
Revises: 021_reminder_retries
Create Date: 2026-04-20

One row per recurring reminder: after delivery, if recurrence != 'none',
the scanner rolls the same row forward to its next occurrence rather
than cloning. Keeps the Reminders panel clean (1 row = 1 recurring
series) and activity_log carries the per-fire history.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "022_reminder_recurrence"
down_revision: Union[str, None] = "021_reminder_retries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reminders", sa.Column("recurrence", sa.String(), nullable=False, server_default="none"))
    op.add_column("reminders", sa.Column("recurrence_end_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reminders", sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("reminders", "occurrence_count")
    op.drop_column("reminders", "recurrence_end_at")
    op.drop_column("reminders", "recurrence")
