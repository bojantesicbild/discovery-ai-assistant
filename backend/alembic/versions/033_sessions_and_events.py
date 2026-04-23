"""Sessions + session_events — the project heartbeat layer.

Revision ID: 033_sessions_and_events
Revises: 032_relationships_table
Create Date: 2026-04-23

Phase 2 of the session-heartbeat architecture (see
docs/research/2026-04-23-session-heartbeat-plan.md).

Two tables:

  sessions         — one row per user-project-domain work window.
                     Transitions through active → archived | abandoned.
                     `summary` and `artifacts_produced` are populated
                     at archive time by aggregating events.

  session_events   — append-only log. Every mutating action in the
                     product lands here with a JSONB payload. The
                     project's heartbeat — answers "what happened and
                     when" without joining five tables.

Session lifecycle:

  - `active`     — user is working; default state on creation.
  - `archived`   — user explicitly closed it OR we auto-closed on
                   inactivity (configurable window). Summary written.
  - `abandoned`  — session started but no meaningful events emitted
                   before it went cold. Pruned periodically.

Event volume note: every MCP write emits one event. On a busy pipeline
that's hundreds per minute. JSONB payload + partial indexes keep hot
queries fast. Partition-by-month planned for Phase 6 cleanup.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB

revision: str = "033_sessions_and_events"
down_revision: Union[str, None] = "032_relationships_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("project_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=False),
        # user_id nullable so pipeline / system sessions can record
        # events too (e.g. an automated ingest with no real user).
        sa.Column("user_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("domain", sa.String(32), nullable=True),

        sa.Column("started_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_event_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),

        sa.Column("status", sa.String(16), nullable=False,
                  server_default="active"),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("artifacts_produced", JSONB,
                  server_default="{}", nullable=False),

        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    # One active session per (project, user) — enforced as a partial
    # unique index. The chat lifecycle looks up "is there already an
    # active session for me" cheaply, and we avoid fragmentation.
    op.create_index(
        "uq_sessions_active_per_user",
        "sessions",
        ["project_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "idx_sessions_by_project",
        "sessions",
        ["project_id", "started_at"],
    )

    op.create_table(
        "session_events",
        sa.Column("id", PGUUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("sessions.id", ondelete="CASCADE"),
                  nullable=False),
        # project_id denormalized so "recent activity on project X"
        # stays a one-table query.
        sa.Column("project_id", PGUUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"),
                  nullable=False),

        sa.Column("ts", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("payload", JSONB, server_default="{}", nullable=False),
    )

    # The three hot query shapes:
    #   - all events in a session, time-ordered
    #   - recent events on a project
    #   - all events of type X (for "which BRs were rejected this week")
    op.create_index(
        "idx_session_events_by_session",
        "session_events",
        ["session_id", "ts"],
    )
    op.create_index(
        "idx_session_events_by_project",
        "session_events",
        ["project_id", "ts"],
    )
    op.create_index(
        "idx_session_events_by_type",
        "session_events",
        ["event_type", "ts"],
    )


def downgrade() -> None:
    op.drop_index("idx_session_events_by_type", table_name="session_events")
    op.drop_index("idx_session_events_by_project", table_name="session_events")
    op.drop_index("idx_session_events_by_session", table_name="session_events")
    op.drop_table("session_events")
    op.drop_index("idx_sessions_by_project", table_name="sessions")
    op.drop_index("uq_sessions_active_per_user", table_name="sessions")
    op.drop_table("sessions")
