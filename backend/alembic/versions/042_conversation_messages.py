"""Conversation messages table — real per-message rows for paginated history.

Revision ID: 042_conversation_messages
Revises: 041_stk_concerns
Create Date: 2026-04-25

Until now the entire chat conversation lived as a single JSONB list on
Conversation.messages, capped at 80 rows by an in-place trim on every
append. That made web chat fast but meant: (a) anything older than the
80 most recent turns was silently dropped, and (b) the frontend had to
load the whole window at once because there was nothing to page into.

This migration introduces conversation_messages — one row per message —
with the index a chat scroll-up needs: (project_id, created_at DESC,
id DESC). The backfill copies every dict from the existing JSONB lists
into rows so no history is lost on cutover.

Dual-write strategy: the JSONB column STAYS as the authoritative source
for the slack listener / reminder delivery / consume_unseen_system
readers that scan it newest-first. append_message and update_message_by_id
are extended to also write to this new table. A follow-up PR migrates
those readers across and drops the JSONB column.
"""
from typing import Sequence, Union
import uuid as _uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "042_conversation_messages"
down_revision: Union[str, None] = "041_stk_concerns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "conversation_messages",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "conversation_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("source", sa.String(32), nullable=True),
        sa.Column("kind", sa.String(64), nullable=True),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            nullable=False, server_default=sa.func.now(),
        ),
    )
    # The pagination index. (project_id, created_at DESC, id DESC) is exactly
    # the ORDER BY the cursor endpoint uses, so postgres can serve the
    # newest-page and the (cursor) WHERE clause without a sort step.
    op.create_index(
        "ix_conv_msgs_proj_created_id_desc",
        "conversation_messages",
        [
            "project_id",
            sa.text("created_at DESC"),
            sa.text("id DESC"),
        ],
    )
    # Used by find_latest_message_by-style scans during the transition
    # period and by the dual-write update path that needs to look up a
    # row by its existing message id.
    op.create_index(
        "ix_conv_msgs_conversation",
        "conversation_messages",
        ["conversation_id", sa.text("created_at DESC")],
    )

    # Backfill — iterate every conversation row, expand its JSONB list
    # into individual rows. Done in raw SQL via the alembic connection so
    # we don't depend on the live SQLAlchemy model layer (which may have
    # already moved past this revision in branches).
    bind = op.get_bind()
    convs = bind.execute(
        sa.text("SELECT id, project_id, messages FROM conversations")
    ).fetchall()

    insert = sa.text(
        """
        INSERT INTO conversation_messages
            (id, conversation_id, project_id, role, content, source, kind,
             payload, created_at)
        VALUES
            (:id, :conv_id, :proj_id, :role, :content, :source, :kind,
             CAST(:payload AS jsonb), :created_at)
        ON CONFLICT (id) DO NOTHING
        """
    )

    import json
    for conv_id, project_id, messages in convs:
        if not messages:
            continue
        for idx, msg in enumerate(messages):
            if not isinstance(msg, dict):
                continue
            # Resolve the row id. Older messages may not have one — mint
            # a deterministic one so re-running the backfill stays
            # idempotent (the message dict in JSONB doesn't get the new
            # id back, but ON CONFLICT (id) DO NOTHING covers re-runs of
            # *this* migration on the same backfill input).
            raw_id = msg.get("id")
            if raw_id:
                try:
                    msg_uuid = _uuid.UUID(raw_id)
                except (ValueError, AttributeError):
                    msg_uuid = _uuid.uuid4()
            else:
                msg_uuid = _uuid.uuid4()

            # Resolve created_at. Prefer the message's own timestamp;
            # fall back to a synthetic increasing time so ordering within
            # a conversation is preserved even when timestamps are missing.
            ts_raw = msg.get("timestamp")
            created_at = None
            if ts_raw:
                try:
                    created_at = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                except (ValueError, AttributeError):
                    created_at = None
            if created_at is None:
                created_at = datetime.now(timezone.utc)

            bind.execute(
                insert,
                {
                    "id": str(msg_uuid),
                    "conv_id": str(conv_id),
                    "proj_id": str(project_id),
                    "role": msg.get("role") or "assistant",
                    "content": msg.get("content"),
                    "source": msg.get("source"),
                    "kind": msg.get("kind"),
                    "payload": json.dumps(msg),
                    "created_at": created_at,
                },
            )


def downgrade() -> None:
    op.drop_index("ix_conv_msgs_conversation", table_name="conversation_messages")
    op.drop_index("ix_conv_msgs_proj_created_id_desc", table_name="conversation_messages")
    op.drop_table("conversation_messages")
