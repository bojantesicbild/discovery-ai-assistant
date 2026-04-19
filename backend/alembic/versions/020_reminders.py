"""Add reminders table for scheduled prep + notification jobs

Revision ID: 020_reminders
Revises: 019_schema_drift_backfill
Create Date: 2026-04-18

A PM can ask the orchestrator to schedule a reminder ("check BR-003 with
Sara tomorrow, prep me insights"). The request lands here as a pending row.
A periodic worker scans due rows, invokes discovery-prep-agent to prepare
a brief (written to docs/meeting-prep/), then delivers via the configured
channel (gmail draft, slack message, in-app card).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "020_reminders"
down_revision: Union[str, None] = "019_schema_drift_backfill"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reminders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # Subject: the thing the reminder is about. subject_id is a display id
        # (BR-003, GAP-012) rather than a row UUID so it survives re-extractions.
        sa.Column("subject_type", sa.String(), nullable=False),  # requirement | gap | free
        sa.Column("subject_id", sa.String(), nullable=True),
        sa.Column("person", sa.String(), nullable=True),
        sa.Column("raw_request", sa.Text(), nullable=False),
        # Timing.
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prep_lead", sa.Interval(), nullable=False, server_default="6 hours"),
        # Delivery + prep config.
        sa.Column("channel", sa.String(), nullable=False),  # gmail | slack | in_app
        sa.Column("prep_agent", sa.String(), nullable=False, server_default="discovery-prep-agent"),
        # State machine.
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),  # pending | prepared | delivered | canceled | failed
        sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("prep_output_path", sa.String(), nullable=True),
        sa.Column("external_ref", sa.String(), nullable=True),  # gmail_url / slack ts / null for in_app
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # Scanner query: WHERE status='pending' AND due_at - prep_lead <= now().
    # Index on (status, due_at) is sufficient; prep_lead is applied per-row.
    op.create_index("ix_reminders_due", "reminders", ["status", "due_at"])


def downgrade() -> None:
    op.drop_index("ix_reminders_due", table_name="reminders")
    op.drop_table("reminders")
