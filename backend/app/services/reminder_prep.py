"""Reminder prep — invoke the prep agent, capture the brief, and surface the run in chat.

For a pending reminder, builds a focused prompt with an explicit reminder-context
preamble (so the agent knows it is executing a scheduled job, not a live turn),
runs the configured prep agent via the Claude Code runner, streams events into
the shared conversation (visible in chat history), and records the written
brief path on the reminder row.

The prep agent writes the artifact itself (that's its job — see
`assistants/.claude/agents/discovery-prep-agent.md`). We don't parse or
compose the brief here; we watch the meeting-prep directory for the file
that appeared during the run and record its path.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.claude_runner import claude_runner
from app.models.operational import ActivityLog
from app.models.reminder import Reminder
from app.services import conversation_store
from app.services.tool_labels import tool_label as _tool_label

log = structlog.get_logger()


def _filename_slug(reminder: Reminder) -> str:
    """Unique-per-reminder filename stem. Includes reminder_id[:8] so two
    reminders with the same (date, person, subject) can never collide."""
    when = reminder.due_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    person = (reminder.person or "prep").lower().replace(" ", "-")
    subj = (reminder.subject_id or reminder.subject_type).lower()
    short_id = str(reminder.id)[:8]
    return f"{when}-{person}-{subj}-{short_id}"


def _build_prompt(r: Reminder) -> str:
    """Compose the message the prep agent sees.

    Prefixed with a [REMINDER CONTEXT] block so the agent knows which
    scheduled job it is executing — session reuse across prep runs is
    intentional (warm context), but without explicit framing the agent
    could conflate two reminders in the same session."""
    if r.subject_type == "requirement":
        subject_desc = f"requirement {r.subject_id}"
    elif r.subject_type == "gap":
        subject_desc = f"gap {r.subject_id}"
    else:
        subject_desc = "the topic described in the request below"

    person_desc = f" with {r.person}" if r.person else ""
    due_utc = r.due_at.astimezone(timezone.utc)
    due_local = r.due_at.astimezone()
    created_utc = (r.created_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    file_stem = _filename_slug(r)

    preamble = (
        "[REMINDER CONTEXT]\n"
        f"- reminder_id: {r.id}\n"
        f"- scheduled_at: {created_utc.isoformat()} (UTC)\n"
        f"- due_at_utc: {due_utc.isoformat()}\n"
        f"- due_at_local: {due_local.isoformat()} ({due_local.tzname() or '?'})\n"
        f"- channel: {r.channel}\n"
        f"- original_pm_request: {r.raw_request!r}\n"
        "You are executing a scheduled prep job — this is NOT a live chat turn. "
        "Do not ask the user for clarification. Produce the brief and a short "
        "chat reply confirming where it landed.\n"
        "[/REMINDER CONTEXT]\n\n"
    )

    body = (
        f"Prepare a focused brief for a 1-on-1{person_desc} on {due_utc.strftime('%Y-%m-%d %H:%M UTC')} "
        f"about {subject_desc}.\n\n"
        "Follow your standard process (readiness → gaps → context), but scope the output tightly to "
        f"this {r.subject_type} and the person named above. Pull the relevant requirement / gap / "
        "stakeholder data via your MCP tools, then write a client-ready brief to "
        ".memory-bank/docs/meeting-prep/ using the meeting-agenda template. Name the file "
        f"{file_stem}.md — this filename is reserved for this reminder, do not reuse a prior name. "
        "Reply in chat with one or two sentences confirming the file path."
    )

    return preamble + body


def _meeting_prep_dir(project_id: uuid.UUID) -> Path:
    return claude_runner.get_project_dir(project_id) / ".memory-bank" / "docs" / "meeting-prep"


def _latest_brief_after(dir_path: Path, since: datetime, file_stem: str) -> Path | None:
    """Prefer the file whose stem matches our reserved slug; fall back to
    the most recently modified .md in the dir if the agent ignored the
    filename instruction."""
    if not dir_path.exists():
        return None
    exact = dir_path / f"{file_stem}.md"
    if exact.exists() and exact.stat().st_mtime >= since.timestamp():
        return exact
    since_ts = since.timestamp()
    candidates = [p for p in dir_path.glob("*.md") if p.stat().st_mtime >= since_ts]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _subject_label(r: Reminder) -> str:
    parts = []
    if r.subject_id:
        parts.append(r.subject_id)
    if r.person:
        parts.append(f"with {r.person}")
    if not parts:
        parts.append(r.raw_request[:60])
    return " ".join(parts)


async def _post_chat(
    db: AsyncSession,
    reminder: Reminder,
    kind: str,
    content: str,
    extra: dict | None = None,
) -> None:
    """Append a reminder-sourced message to the project's shared conversation
    so the user sees prep/delivery events in chat history when they return."""
    msg: dict = {
        "role": "assistant",
        "source": "reminder",
        "kind": kind,
        "reminder_id": str(reminder.id),
        "content": content,
    }
    if extra:
        msg.update(extra)
    try:
        await conversation_store.append_message(db, reminder.project_id, msg)
    except Exception as e:
        # Chat surfacing is best-effort — never let it block prep/deliver.
        log.warning("reminder.chat.post.failed", id=str(reminder.id), kind=kind, error=str(e))


async def _log_activity(
    db: AsyncSession,
    reminder: Reminder,
    action: str,
    summary: str,
    details: dict | None = None,
) -> None:
    try:
        entry = ActivityLog(
            project_id=reminder.project_id,
            user_id=reminder.created_by_user_id,
            action=action,
            summary=summary,
            details=details or {},
        )
        db.add(entry)
    except Exception as e:
        log.warning("reminder.activity.failed", id=str(reminder.id), action=action, error=str(e))


async def prep_reminder(db: AsyncSession, reminder_id: uuid.UUID) -> Reminder:
    """Run the prep agent for a reminder. Idempotent via status guard.

    Returns the updated Reminder row. Caller is responsible for deciding
    whether to proceed to delivery (status will be 'prepared' on success,
    'failed' otherwise)."""
    reminder = await db.scalar(select(Reminder).where(Reminder.id == reminder_id))
    if reminder is None:
        raise LookupError(f"reminder {reminder_id} not found")
    if reminder.status not in {"pending", "processing"}:
        log.info("reminder.prep.skipped", id=str(reminder_id), status=reminder.status)
        return reminder

    started_at = datetime.now(timezone.utc)
    prep_dir = _meeting_prep_dir(reminder.project_id)
    prompt = _build_prompt(reminder)
    label = _subject_label(reminder)

    # Announce to chat + activity log so the user sees prep happening.
    await _post_chat(
        db,
        reminder,
        kind="reminder_prep_starting",
        content=f"🔔 Preparing your reminder ({label}) — due {reminder.due_at.astimezone().strftime('%A %Y-%m-%d %H:%M %Z')}.",
    )
    await _log_activity(
        db,
        reminder,
        action="reminder_prep_started",
        summary=f"Reminder prep started: {label}",
        details={"reminder_id": str(reminder_id), "prep_agent": reminder.prep_agent},
    )
    await db.commit()

    text_chunks: list[str] = []
    tool_calls: list[str] = []
    thinking_count = 0
    segments: list[dict] = []
    activity_tools: list[str] = []
    activity_thinking = 0
    last_phase: str | None = None

    def _flush_activity() -> None:
        nonlocal activity_tools, activity_thinking
        if activity_tools or activity_thinking > 0:
            segments.append({
                "type": "activity",
                "tools": list(activity_tools),
                "thinkingCount": activity_thinking,
            })
            activity_tools = []
            activity_thinking = 0

    try:
        async for event in claude_runner.run_stream(
            project_id=reminder.project_id,
            user_id=reminder.created_by_user_id,
            message=prompt,
            agent=reminder.prep_agent,
        ):
            etype = event.get("type")
            if etype == "thinking":
                thinking_count += 1
                activity_thinking += 1
                last_phase = "activity"
            elif etype == "text":
                if last_phase == "activity":
                    _flush_activity()
                last_phase = "text"
                chunk = event.get("content", "")
                text_chunks.append(chunk)
                if segments and segments[-1]["type"] == "text":
                    segments[-1]["content"] = segments[-1].get("content", "") + chunk
                else:
                    segments.append({"type": "text", "content": chunk})
            elif etype == "tool_use":
                last_phase = "activity"
                label = _tool_label(event.get("tool", "unknown"), event.get("input", {}) or {})
                tool_calls.append(label)
                activity_tools.append(label)
    except Exception as e:
        reminder.status = "failed"
        reminder.error_message = f"prep_agent_error: {e}"
        await _post_chat(
            db,
            reminder,
            kind="reminder_prep_failed",
            content=f"⚠️ Reminder prep failed ({label}): `{e}`",
        )
        await _log_activity(
            db, reminder,
            action="reminder_prep_failed",
            summary=f"Reminder prep failed: {label}",
            details={"reminder_id": str(reminder_id), "error": str(e)},
        )
        await db.commit()
        log.exception("reminder.prep.failed", id=str(reminder_id))
        return reminder

    brief = _latest_brief_after(prep_dir, started_at, _filename_slug(reminder))
    if brief is None:
        reminder.status = "failed"
        reminder.error_message = (
            "prep agent ran but produced no new file in .memory-bank/docs/meeting-prep/"
        )
        await _post_chat(
            db,
            reminder,
            kind="reminder_prep_failed",
            content=f"⚠️ Reminder prep ran but no brief file landed in `docs/meeting-prep/` ({label}).",
        )
        await _log_activity(
            db, reminder,
            action="reminder_prep_failed",
            summary=f"Reminder prep produced no file: {label}",
            details={"reminder_id": str(reminder_id)},
        )
        await db.commit()
        log.warning("reminder.prep.no_output", id=str(reminder_id))
        return reminder

    # Close out any trailing activity segment so the web chat renders the
    # final "1 action · N thinking" badge correctly.
    _flush_activity()

    rel_path = brief.relative_to(claude_runner.get_project_dir(reminder.project_id))
    reminder.prep_output_path = str(rel_path)
    reminder.prepared_at = datetime.now(timezone.utc)
    reminder.status = "prepared"

    # Agent's own chat reply is what the user most wants to see; include
    # a clickable link to the brief (vault viewer route).
    agent_reply = ("".join(text_chunks)).strip() or "_(agent wrote no chat text)_"
    viewer_url = f"/projects/{reminder.project_id}/vault?path={rel_path}"
    filename = str(rel_path).rsplit("/", 1)[-1]
    chat_content = (
        f"✅ **Reminder prep complete** — {label}\n\n"
        f"{agent_reply}\n\n"
        f"Brief: [📄 {filename}]({viewer_url})"
    )
    await _post_chat(
        db,
        reminder,
        kind="reminder_prep_done",
        content=chat_content,
        extra={
            "prep_output_path": str(rel_path),
            "toolCalls": tool_calls,
            "thinkingCount": thinking_count,
            "segments": segments,
        },
    )
    await _log_activity(
        db, reminder,
        action="reminder_prep_done",
        summary=f"Reminder prep complete: {label}",
        details={
            "reminder_id": str(reminder_id),
            "prep_output_path": str(rel_path),
            "tool_calls": tool_calls,
        },
    )
    await db.commit()
    log.info("reminder.prep.done", id=str(reminder_id), path=str(rel_path))
    return reminder
