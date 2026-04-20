"""Shared conversation store — single conversation per project, used by both
web chat and Slack inbound.

Schema notes:
- Conversations.user_id IS NULL identifies the project-shared row (one per project)
- Each message in conversation.messages is a dict with at minimum:
    {role, content, timestamp, source}
  Optional fields:
    session_id, toolCalls, thinkingCount, activityLog, segments, stats,
    slack_user_name, slack_channel_name, slack_channel_id, slack_thread_ts
- source is one of: "web", "slack"

PROJECT_SHARED_USER is a sentinel UUID used as user_id when calling
claude_runner.run_stream(...) so that both web chat and Slack inbound share
the same Claude Code --resume session per project.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational import Conversation

log = structlog.get_logger()

# Sentinel user id used for project-shared Claude Code sessions.
PROJECT_SHARED_USER = uuid.UUID("00000000-0000-0000-0000-000000000000")

# Maximum messages we keep in the rolling conversation window.
MAX_MESSAGES = 80


async def get_shared(db: AsyncSession, project_id: uuid.UUID) -> Conversation:
    """Return the project's shared conversation row, creating it if missing."""
    result = await db.execute(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.user_id.is_(None),
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = Conversation(project_id=project_id, user_id=None, messages=[])
        db.add(row)
        await db.flush()
    return row


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def append_message(
    db: AsyncSession,
    project_id: uuid.UUID,
    message: dict[str, Any],
) -> str:
    """Append a fully-formed message dict to the shared conversation.

    The caller is responsible for setting role, content, source, and any
    source-specific metadata. We assign a stable `id`, add `timestamp` if
    missing, and trim to MAX_MESSAGES. Returns the assigned id so callers
    can update_message_by_id later.
    """
    if "id" not in message:
        message["id"] = uuid.uuid4().hex
    if "timestamp" not in message:
        message["timestamp"] = _now()
    conv = await get_shared(db, project_id)
    history = list(conv.messages or [])
    history.append(message)
    if len(history) > MAX_MESSAGES:
        history = history[-MAX_MESSAGES:]
    conv.messages = history
    await db.commit()
    return message["id"]


async def find_latest_message_by(
    db: AsyncSession,
    project_id: uuid.UUID,
    predicate,
) -> str | None:
    """Scan the project's shared conversation newest-first and return the
    id of the first message for which `predicate(message)` is True.

    Used by the reminder delivery step to locate the streaming prep card
    so it can be patched in place (one card per reminder lifecycle)
    rather than appending a second 'delivered' message."""
    conv = await get_shared(db, project_id)
    history = list(conv.messages or [])
    for msg in reversed(history):
        try:
            if predicate(msg):
                return msg.get("id")
        except Exception:
            continue
    return None


async def update_message_by_id(
    db: AsyncSession,
    project_id: uuid.UUID,
    message_id: str,
    patch: dict[str, Any],
) -> bool:
    """Find a message by its stable id in the shared conversation and patch
    it in place. Returns True if a row was updated, False if the id wasn't
    found. SQLAlchemy needs a fresh JSONB list for change detection so we
    rebuild the array."""
    conv = await get_shared(db, project_id)
    history = list(conv.messages or [])
    found = False
    new_history: list[dict] = []
    for msg in history:
        if msg.get("id") == message_id:
            new_msg = {**msg, **patch}
            new_history.append(new_msg)
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
    text: str,
) -> str:
    return await append_message(db, project_id, {
        "role": "user",
        "content": text,
        "source": "web",
    })


async def consume_unseen_system_messages(
    db: AsyncSession,
    project_id: uuid.UUID,
) -> list[dict]:
    """Find system messages that haven't been consumed yet, mark them
    consumed, and return them.

    Used by the chat handler to inject fresh ingestion notices into the
    agent's context on the user's next turn — without spamming the chat
    with auto-triggered agent runs."""
    conv = await get_shared(db, project_id)
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


async def append_system_message(
    db: AsyncSession,
    project_id: uuid.UUID,
    text: str,
    kind: str = "system",
    data: dict | None = None,
) -> str:
    """Append a system-generated message (e.g. document ingestion notice).

    `kind` lets the UI render different system messages with different
    styling. `data` is an opaque payload the UI may use for richer rendering
    (e.g. doc id, counts, source). The agent sees only the text content."""
    return await append_message(db, project_id, {
        "role": "system",
        "content": text,
        "source": "pipeline",
        "kind": kind,
        "data": data or {},
    })


async def append_user_message_slack(
    db: AsyncSession,
    project_id: uuid.UUID,
    text: str,
    slack_user_name: str | None,
    slack_user_id: str | None,
    slack_channel_id: str | None,
    slack_channel_name: str | None,
    slack_thread_ts: str | None,
) -> str:
    return await append_message(db, project_id, {
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
    *,
    source: str,
    slack_channel_id: str | None = None,
    slack_channel_name: str | None = None,
    slack_thread_ts: str | None = None,
) -> str:
    """Persist an empty assistant placeholder so the polling web UI can
    immediately show 'Thinking…' the moment a Slack message starts being
    processed. The id is returned so the caller can update_message_by_id
    progressively as Claude streams events."""
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
    return await append_message(db, project_id, msg)


async def append_assistant_message(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    content: str,
    source: str,
    session_id: str | None = None,
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
    if session_id:
        msg["session_id"] = session_id
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
    await append_message(db, project_id, msg)


async def get_messages(db: AsyncSession, project_id: uuid.UUID, limit: int = 40) -> list[dict]:
    conv = await get_shared(db, project_id)
    return list((conv.messages or [])[-limit:])


async def clear_conversation(db: AsyncSession, project_id: uuid.UUID) -> None:
    conv = await get_shared(db, project_id)
    conv.messages = []
    await db.commit()
