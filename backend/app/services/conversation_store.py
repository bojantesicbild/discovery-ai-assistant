"""Per-session chat store + chat_sessions CRUD.

Replaces the older single-shared-conversation model. Each project has one
or more `chat_sessions` rows (the "tabs" in the chat panel UI); each
session has its own `conversations.messages` JSONB and its own
Claude Code --resume id.

Routing rules:
- Web chat writes to whichever session_id the request specifies.
- Slack inbound is permanently pinned to the project's default session
  (the row where is_pinned_slack = true).
- Project-level system messages (doc ingestion notices, reminder
  lifecycle cards from project-wide events) live in the default
  session's timeline. Reminders created from a specific tab carry
  that session's id on `reminders.chat_session_id` so their card lands
  back in the originating tab.

Schema notes:
- chat_sessions.is_default identifies the default tab; partial unique
  index (migration 028) enforces exactly one per project.
- chat_sessions.is_pinned_slack identifies the Slack target; same
  partial unique constraint. v1 always pins to default.
- conversations is now per-(project, session); the legacy user_id
  column was dropped in 028.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational import ChatSession, Conversation

log = structlog.get_logger()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ──────────────────────────────────────────────────────────────────
# Session CRUD
# ──────────────────────────────────────────────────────────────────


async def list_sessions(db: AsyncSession, project_id: uuid.UUID) -> list[ChatSession]:
    """Return all chat sessions for a project, default first then by position."""
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.project_id == project_id)
        .order_by(ChatSession.is_default.desc(), ChatSession.position.asc(), ChatSession.created_at.asc())
    )
    return list(result.scalars().all())


async def get_session(db: AsyncSession, session_id: uuid.UUID) -> ChatSession | None:
    return await db.get(ChatSession, session_id)


async def get_default_session(db: AsyncSession, project_id: uuid.UUID) -> ChatSession:
    """Return (or create) the project's default session.

    Migration 028 backfills a default session for every existing project,
    so this should always find one. The lazy-create branch covers race
    conditions for projects created via the API after migration but
    before the first chat read."""
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.project_id == project_id,
            ChatSession.is_default.is_(True),
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        return row
    # Lazy create — also pins Slack here.
    row = ChatSession(
        project_id=project_id,
        name="Default",
        is_default=True,
        is_pinned_slack=True,
        position=0,
    )
    db.add(row)
    await db.flush()
    await db.commit()
    return row


async def create_session(
    db: AsyncSession, project_id: uuid.UUID, name: str = "Untitled",
) -> ChatSession:
    """Create a new (non-default) chat session at the end of the list."""
    # Place at end — query the current max position.
    max_pos = await db.scalar(
        select(ChatSession.position)
        .where(ChatSession.project_id == project_id)
        .order_by(ChatSession.position.desc())
        .limit(1)
    )
    row = ChatSession(
        project_id=project_id,
        name=name,
        is_default=False,
        is_pinned_slack=False,
        position=(max_pos or 0) + 1,
    )
    db.add(row)
    await db.flush()
    await db.commit()
    return row


async def rename_session(
    db: AsyncSession, session_id: uuid.UUID, name: str,
) -> ChatSession | None:
    row = await db.get(ChatSession, session_id)
    if row is None:
        return None
    row.name = name
    await db.commit()
    return row


async def delete_session(db: AsyncSession, session_id: uuid.UUID) -> bool:
    """Delete a non-default session. Returns False if the session is the
    default (caller should turn that into a 400). The conversations row
    cascades via the FK ondelete."""
    row = await db.get(ChatSession, session_id)
    if row is None:
        return False
    if row.is_default:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def update_claude_session_id(
    db: AsyncSession, session_id: uuid.UUID, claude_session_id: str,
) -> None:
    """Persist Claude Code's captured session id to the chat_sessions row.

    Called from claude_runner on system/init and result events so the
    --resume thread survives backend restarts without re-priming from
    the messages JSONB."""
    row = await db.get(ChatSession, session_id)
    if row is None:
        return
    if row.claude_session_id != claude_session_id:
        row.claude_session_id = claude_session_id
        row.last_active_at = datetime.now(timezone.utc)
        await db.commit()


# ──────────────────────────────────────────────────────────────────
# Conversation (messages) — per session
# ──────────────────────────────────────────────────────────────────


async def _get_or_create_conversation(
    db: AsyncSession, project_id: uuid.UUID, session_id: uuid.UUID,
) -> Conversation:
    """Return the conversation row for (project, session), creating it
    on first use. The unique index from migration 028 keeps this 1:1."""
    result = await db.execute(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.chat_session_id == session_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = Conversation(
            project_id=project_id, chat_session_id=session_id, messages=[],
        )
        db.add(row)
        await db.flush()
    return row


async def append_message(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    message: dict[str, Any],
) -> str:
    """Append a fully-formed message dict to a session's conversation.

    Caller sets role, content, source, and any source-specific metadata.
    We assign a stable id and timestamp if missing. Returns the assigned
    id so callers can update_message_by_id later."""
    if "id" not in message:
        message["id"] = uuid.uuid4().hex
    if "timestamp" not in message:
        message["timestamp"] = _now()
    conv = await _get_or_create_conversation(db, project_id, session_id)
    history = list(conv.messages or [])
    history.append(message)
    conv.messages = history
    await db.commit()
    return message["id"]


async def find_latest_message_by(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    predicate,
) -> str | None:
    """Scan the session's conversation newest-first; return the id of
    the first message for which `predicate(message)` is True.

    Used by reminder delivery to locate the streaming prep card so it
    can be patched in place rather than appending a duplicate."""
    conv = await _get_or_create_conversation(db, project_id, session_id)
    for msg in reversed(list(conv.messages or [])):
        try:
            if predicate(msg):
                return msg.get("id")
        except Exception:
            continue
    return None


async def update_message_by_id(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    message_id: str,
    patch: dict[str, Any],
) -> bool:
    """Find a message by stable id within a session and patch it.
    Returns True if a row was updated, False if the id wasn't found.
    SQLAlchemy needs a fresh JSONB list for change detection so we
    rebuild the array."""
    conv = await _get_or_create_conversation(db, project_id, session_id)
    history = list(conv.messages or [])
    found = False
    new_history: list[dict] = []
    for msg in history:
        if msg.get("id") == message_id:
            new_history.append({**msg, **patch})
            found = True
        else:
            new_history.append(msg)
    if found:
        conv.messages = new_history
        await db.commit()
    return found


async def append_user_message_web(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    text: str,
) -> str:
    return await append_message(db, project_id, session_id, {
        "role": "user",
        "content": text,
        "source": "web",
    })


async def append_user_message_slack(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    text: str,
    slack_user_name: str | None,
    slack_user_id: str | None,
    slack_channel_id: str | None,
    slack_channel_name: str | None,
    slack_thread_ts: str | None,
) -> str:
    return await append_message(db, project_id, session_id, {
        "role": "user",
        "content": text,
        "source": "slack",
        "slack_user_name": slack_user_name,
        "slack_user_id": slack_user_id,
        "slack_channel_id": slack_channel_id,
        "slack_channel_name": slack_channel_name,
        "slack_thread_ts": slack_thread_ts,
    })


async def append_assistant_placeholder(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    *,
    source: str,
    slack_channel_id: str | None = None,
    slack_channel_name: str | None = None,
    slack_thread_ts: str | None = None,
) -> str:
    """Persist an empty assistant placeholder so the polling web UI can
    immediately show 'Thinking…' the moment a Slack message starts being
    processed. Returned id is patched progressively as Claude streams."""
    msg: dict[str, Any] = {
        "role": "assistant",
        "content": "",
        "source": source,
        "_processing": True,
        "segments": [],
        "toolCalls": [],
        "thinkingCount": 0,
    }
    if source == "slack":
        if slack_channel_id:
            msg["slack_channel_id"] = slack_channel_id
        if slack_channel_name:
            msg["slack_channel_name"] = slack_channel_name
        if slack_thread_ts:
            msg["slack_thread_ts"] = slack_thread_ts
    return await append_message(db, project_id, session_id, msg)


async def append_assistant_message(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    *,
    content: str,
    source: str,
    session_id_claude: str | None = None,
    tool_calls: list | None = None,
    thinking_count: int = 0,
    activity_log: list | None = None,
    segments: list | None = None,
    stats: dict | None = None,
    slack_channel_id: str | None = None,
    slack_channel_name: str | None = None,
    slack_thread_ts: str | None = None,
) -> None:
    msg: dict[str, Any] = {
        "role": "assistant",
        "content": content,
        "source": source,
    }
    if session_id_claude:
        msg["session_id"] = session_id_claude
    if tool_calls is not None:
        msg["toolCalls"] = tool_calls
    if thinking_count:
        msg["thinkingCount"] = thinking_count
    if activity_log is not None:
        msg["activityLog"] = activity_log
    if segments is not None:
        msg["segments"] = segments
    if stats is not None:
        msg["stats"] = stats
    if source == "slack":
        if slack_channel_id:
            msg["slack_channel_id"] = slack_channel_id
        if slack_channel_name:
            msg["slack_channel_name"] = slack_channel_name
        if slack_thread_ts:
            msg["slack_thread_ts"] = slack_thread_ts
    await append_message(db, project_id, session_id, msg)


async def get_messages(
    db: AsyncSession, project_id: uuid.UUID, session_id: uuid.UUID, limit: int = 40,
) -> list[dict]:
    conv = await _get_or_create_conversation(db, project_id, session_id)
    return list((conv.messages or [])[-limit:])


async def clear_conversation(
    db: AsyncSession, project_id: uuid.UUID, session_id: uuid.UUID,
) -> None:
    """Empty a session's messages without deleting the row.
    For non-default sessions, callers usually prefer delete_session."""
    conv = await _get_or_create_conversation(db, project_id, session_id)
    conv.messages = []
    await db.commit()


# ──────────────────────────────────────────────────────────────────
# System messages (project-level events)
# ──────────────────────────────────────────────────────────────────


async def append_system_message(
    db: AsyncSession,
    project_id: uuid.UUID,
    text: str,
    kind: str = "system",
    data: dict | None = None,
) -> str:
    """Append a system-generated message (doc ingestion notice, etc.).

    Project-level events live in the default session's timeline so the
    UI has a single canonical 'what happened to my project' feed; the
    `data.kind_class = 'project_event'` tag lets the topbar toast pick
    them out without scanning every session."""
    default = await get_default_session(db, project_id)
    payload: dict[str, Any] = {**(data or {}), "kind_class": "project_event"}
    return await append_message(db, project_id, default.id, {
        "role": "system",
        "content": text,
        "source": "pipeline",
        "kind": kind,
        "data": payload,
    })


async def consume_unseen_system_messages(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> list[dict]:
    """Find system messages in the default session that haven't been
    consumed yet, mark them consumed, and return them.

    Used by the chat handler to inject fresh ingestion notices into the
    agent's context on the user's next turn — without firing an
    unprompted agent run on each ingest."""
    default = await get_default_session(db, project_id)
    conv = await _get_or_create_conversation(db, project_id, default.id)
    history = list(conv.messages or [])
    unseen: list[dict] = []
    new_history: list[dict] = []
    changed = False
    for msg in history:
        if msg.get("role") == "system" and not msg.get("consumed"):
            unseen.append(msg)
            new_history.append({**msg, "consumed": True})
            changed = True
        else:
            new_history.append(msg)
    if changed:
        conv.messages = new_history
        await db.commit()
    return unseen
