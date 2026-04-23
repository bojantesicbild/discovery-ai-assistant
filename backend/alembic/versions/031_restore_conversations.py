"""Restore conversations to pre-028 shape after the multi-session revert.

Revision ID: 031_restore_conversations
Revises: 030_propose_from_extraction
Create Date: 2026-04-23

Commit a7f850a reverted the multi-session chat Python changes and
deleted migration 028, but the DB had already been upgraded through
028 — so it ended up with `chat_sessions` present and
`conversations.chat_session_id` in place, while the Python
Conversation model expects the old `conversations.user_id` column.
Every /conversation fetch 500s as a result.

This migration aligns the DB with the reverted code:
  - add conversations.user_id (nullable), rebuild the
    (project_id, user_id) partial unique index that migration 006 had,
    and seed one shared row per project (user_id NULL);
  - drop conversations.chat_session_id + its FK;
  - drop chat_sessions.

No data is preserved — the chat_sessions table was empty for all
practical purposes (feature was never shipped to users), and the
per-session messages array (if any) would be unreachable from the
reverted code anyway. All existing pipeline / reminder / slack chat
cards live in the shared row.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "031_restore_conversations"
down_revision: Union[str, None] = "030_propose_from_extraction"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Bring user_id back.
    op.add_column(
        "conversations",
        sa.Column(
            "user_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )

    # 2. Drop the FK + column added by 028. FK name was the default
    # conversations_chat_session_id_fkey; use IF EXISTS so this is
    # idempotent if the constraint was already gone.
    op.execute(
        "ALTER TABLE conversations "
        "DROP CONSTRAINT IF EXISTS conversations_chat_session_id_fkey"
    )
    op.drop_column("conversations", "chat_session_id")

    # 3. Drop the chat_sessions table. CASCADE so we don't trip over
    # any unique / fk / default-session constraints that lingered.
    op.execute("DROP TABLE IF EXISTS chat_sessions CASCADE")

    # 4. Restore the partial unique index on the shared row that
    # migration 006 created. The index name matches 006 so a fresh
    # DB build (001..031) ends up with the same schema.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_project_shared "
        "ON conversations (project_id) WHERE user_id IS NULL"
    )

    # 5. Seed one shared row per project so the conversation_store
    # lookups that expect "row exists" keep working. ON CONFLICT DO
    # NOTHING because the partial index above enforces one-per-project.
    op.execute(
        "INSERT INTO conversations (id, project_id, user_id, messages, created_at) "
        "SELECT gen_random_uuid(), p.id, NULL, '[]'::jsonb, NOW() "
        "FROM projects p "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    # Intentional no-op. 028_chat_sessions was deleted from the repo;
    # re-introducing the multi-session schema would require re-landing
    # that migration's full upgrade, which is out of scope here. The
    # chat-sessions feature should be re-introduced cleanly via a
    # future numbered migration when the Python side is ready.
    pass
