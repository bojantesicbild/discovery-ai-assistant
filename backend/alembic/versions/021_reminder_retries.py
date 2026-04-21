"""Add retry tracking to reminders (retry_count, max_retries, last_attempted_at).

Revision ID: 021_reminder_retries
Revises: 020_reminders
Create Date: 2026-04-20

The scanner reclaims stuck 'processing' rows via a watchdog and re-picks
'failed' rows up to max_retries. These columns feed that loop without
creating a separate attempts table — the reminder IS the attempt log.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "021_reminder_retries"
down_revision: Union[str, None] = "020_reminders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reminders", sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("reminders", sa.Column("max_retries", sa.Integer(), nullable=False, server_default="2"))
    op.add_column("reminders", sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("reminders", "last_attempted_at")
    op.drop_column("reminders", "max_retries")
    op.drop_column("reminders", "retry_count")
