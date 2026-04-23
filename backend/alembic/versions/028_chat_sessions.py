"""Multi-session chat: chat_sessions table + per-session conversations.

Revision ID: 028_chat_sessions
Revises: 027_taxonomy_cleanup
Create Date: 2026-04-23

Until now every project had ONE shared Conversation row (user_id IS NULL,
enforced by partial unique index from migration 006) which both web chat
and Slack inbound wrote to, and which carried the single Claude Code
--resume session id per project.

This migration introduces first-class chat sessions:

  chat_sessions
    one row per "tab" the user sees in the chat panel. Every project
    gets a `Default` session (is_default = is_pinned_slack = true) which
    can be neither deleted nor unpinned. Users add more sessions for
    side-topics; each carries its own claude_session_id so a new tab
    starts a fresh --resume thread (no token replay → cheaper).

  conversations
    becomes per-(project, chat_session). The user_id column is dropped
    (it has been universally NULL since migration 006 and conflated
    "no user" with "shared row"; chat_session_id now carries identity).

  reminders
    gain optional chat_session_id so the lifecycle card (streamed via
    reminder_prep, patched by reminder_delivery) lands back in the same
    session the user created the reminder from. NULL on legacy rows
    means "fall back to default" at lookup time.

Backfill:
  - One Default session per existing project. claude_session_id is
    populated from the most recent message.session_id in the project's
    existing conversation messages JSONB, so the existing --resume
    thread carries forward without users having to re-prime context.
  - Existing conversations.user_id IS NULL row gets pointed at that
    default session; rows with user_id NOT NULL (none should exist —
    this column was dropped from app code paths in 006) are migrated
    too defensively, then user_id is dropped.
  - Reminders: chat_session_id stays NULL (legacy → default fallback).
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "028_chat_sessions"
down_revision: Union[str, None] = "027_taxonomy_cleanup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. chat_sessions table
    op.create_table(
        "chat_sessions",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id", UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "is_default", sa.Boolean(), nullable=False, server_default=sa.false(),
        ),
        sa.Column(
            "is_pinned_slack", sa.Boolean(), nullable=False, server_default=sa.false(),
        ),
        sa.Column("claude_session_id", sa.String(), nullable=True),
        sa.Column(
            "position", sa.Integer(), nullable=False, server_default="0",
        ),
        sa.Column(
            "last_active_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
    )
    # Exactly one default per project, exactly one Slack pin per project.
    op.create_index(
        "uq_chat_sessions_default", "chat_sessions", ["project_id"],
        unique=True, postgresql_where=sa.text("is_default"),
    )
    op.create_index(
        "uq_chat_sessions_slack_pin", "chat_sessions", ["project_id"],
        unique=True, postgresql_where=sa.text("is_pinned_slack"),
    )

    # 2. Backfill: one Default session per project that has a shared
    #    conversation row. claude_session_id pulled from the most recent
    #    message that has one — preserves the existing --resume thread.
    op.execute(
        """
        INSERT INTO chat_sessions
            (id, project_id, name, is_default, is_pinned_slack,
             claude_session_id, position, last_active_at, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            c.project_id,
            'Default',
            true,
            true,
            (
                SELECT m->>'session_id'
                FROM jsonb_array_elements(c.messages) m
                WHERE m->>'session_id' IS NOT NULL
                ORDER BY (m->>'timestamp') DESC NULLS LAST
                LIMIT 1
            ),
            0,
            now(), now(), now()
        FROM conversations c
        WHERE c.user_id IS NULL
        """
    )
    # Defensive: any project without a conversation row yet (brand-new
    # projects that have never been chatted with) also gets a Default
    # session so the API doesn't have to lazy-create on first read.
    op.execute(
        """
        INSERT INTO chat_sessions
            (id, project_id, name, is_default, is_pinned_slack,
             position, last_active_at, created_at, updated_at)
        SELECT gen_random_uuid(), p.id, 'Default', true, true,
               0, now(), now(), now()
        FROM projects p
        WHERE NOT EXISTS (
            SELECT 1 FROM chat_sessions cs WHERE cs.project_id = p.id
        )
        """
    )

    # 3. conversations.chat_session_id (FK), backfill, then drop user_id
    #    + the partial uniqueness, replace with (project_id, session) unique.
    op.add_column(
        "conversations",
        sa.Column(
            "chat_session_id", UUID(as_uuid=True),
            sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.execute(
        """
        UPDATE conversations c
        SET chat_session_id = cs.id
        FROM chat_sessions cs
        WHERE cs.project_id = c.project_id AND cs.is_default
        """
    )
    op.alter_column("conversations", "chat_session_id", nullable=False)
    op.drop_index(
        "uq_conversations_shared_project", table_name="conversations",
    )
    op.create_index(
        "uq_conversations_session", "conversations",
        ["project_id", "chat_session_id"], unique=True,
    )
    op.drop_column("conversations", "user_id")

    # 4. reminders.chat_session_id — nullable because legacy rows have no
    #    session context; lookup code falls back to the project default
    #    when this is NULL.
    op.add_column(
        "reminders",
        sa.Column(
            "chat_session_id", UUID(as_uuid=True),
            sa.ForeignKey("chat_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Reverse order: drop the FKs/indexes that depend on chat_sessions
    # before dropping the table itself.
    op.drop_column("reminders", "chat_session_id")

    op.add_column(
        "conversations",
        sa.Column(
            "user_id", UUID(as_uuid=True),
            sa.ForeignKey("users.id"), nullable=True,
        ),
    )
    op.drop_index("uq_conversations_session", table_name="conversations")
    # Re-create the partial unique index from migration 006.
    op.create_index(
        "uq_conversations_shared_project", "conversations", ["project_id"],
        unique=True, postgresql_where=sa.text("user_id IS NULL"),
    )
    op.drop_column("conversations", "chat_session_id")

    op.drop_index("uq_chat_sessions_slack_pin", table_name="chat_sessions")
    op.drop_index("uq_chat_sessions_default", table_name="chat_sessions")
    op.drop_table("chat_sessions")
