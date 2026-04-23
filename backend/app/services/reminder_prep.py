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
import time
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

# Max frequency of in-flight conversation updates while prep is streaming.
# Lower = more real-time in the chat but more DB traffic; higher = laggier.
_LIVE_UPDATE_THROTTLE_MS = 700

log = structlog.get_logger()


async def _resolve_session_id(db: AsyncSession, reminder: Reminder) -> uuid.UUID:
    """The chat session this reminder's lifecycle card lands in.
    Reads reminder.chat_session_id; falls back to project default for
    legacy rows where it's NULL. Stage 5 starts populating the column
    via the MCP schedule_reminder path; this fallback keeps pre-Stage-5
    rows routing into Default forever."""
    sid = getattr(reminder, "chat_session_id", None)
    if sid:
        return sid
    default = await conversation_store.get_default_session(db, reminder.project_id)
    return default.id


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


def _output_kind(r: Reminder) -> str:
    """Explicit output kind from the row, with a safe default. Superseded
    the older `_needs_brief` heuristic — output behavior is no longer
    inferred from subject_type/person; the agent sets it at create time."""
    return r.output_kind or "notification"


def _mark_failed_or_retry(r: Reminder, error: str) -> str:
    """Bump retry_count and decide the resulting status.

    Returns the new status so callers can branch UI/logging. Sets
    `error_message` to `error` either way — the scanner picks the row
    back up as long as status is 'pending' and retry_count < max_retries."""
    r.retry_count = (r.retry_count or 0) + 1
    r.error_message = error
    if r.retry_count < (r.max_retries or 0):
        r.status = "pending"  # scanner will retry on next tick
        return "pending"
    r.status = "failed"
    return "failed"


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
        session_id = await _resolve_session_id(db, reminder)
        await conversation_store.append_message(db, reminder.project_id, session_id, msg)
    except Exception as e:
        # Chat surfacing is best-effort — never let it block prep/deliver.
        log.warning("reminder.chat.post.failed", id=str(reminder.id), kind=kind, error=str(e))


def _friendly_channel(channel: str) -> str:
    """Map raw channel ids to user-facing language."""
    return {
        "in_app": "in-app notification",
        "gmail": "email (Gmail draft)",
        "calendar": "Google Calendar event",
        "slack": "Slack message",
    }.get(channel, channel)


def render_reminder_card(
    *,
    state: str,  # running | ready | failed | delivered
    label: str,
    due_local: str,
    channel: str | None = None,
    viewer_url: str | None = None,
    filename: str | None = None,
    agent_reply: str | None = None,
    error: str | None = None,
    output_kind: str = "agenda",  # drives the "Open …" link label
) -> str:
    """Compose the body of a reminder lifecycle message.

    One card per reminder evolves through states — 'running' while prep
    is composing the brief, 'ready' after the brief lands, 'delivered'
    after the channel handoff, 'failed' on error. Wording is PM-facing,
    not developer-facing: channel ids like `in_app` become
    'in-app notification'; link text is 'Open meeting agenda', not
    'Open brief'; the agent's technical recap is quoted below so the
    actionable info (what, when, where) leads the card.
    """
    headline = {
        "running": f"Preparing your reminder — **{label}**",
        "ready": f"Your reminder is ready — **{label}**",
        "delivered": f"Your reminder is ready — **{label}**",
        "failed": f"Reminder prep failed — **{label}**",
    }.get(state, f"Reminder — **{label}**")

    meta_parts = [f"Scheduled for {due_local}"]
    if state == "delivered" and channel:
        meta_parts.append(f"delivered as {_friendly_channel(channel)}")
    if viewer_url and filename and state in {"ready", "delivered"}:
        link_label = {
            "agenda": "Open meeting agenda",
            "status": "Open status brief",
            "research": "Open research",
        }.get(output_kind, "Open brief")
        meta_parts.append(f"[{link_label}]({viewer_url})")
    meta_line = "  ·  ".join(meta_parts)

    lines = [headline, "", meta_line]
    if error and state == "failed":
        lines += ["", f"`{error}`"]
    if agent_reply and state in {"ready", "delivered"}:
        # Blockquote the agent's technical summary so the headline +
        # action link stay dominant; power users still get the detail.
        quoted = "\n".join(f"> {ln}" if ln else ">" for ln in agent_reply.strip().splitlines())
        lines += ["", quoted]
    return "\n".join(lines)


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
    """Run the prep agent for a reminder and stream its progress into chat.

    Uses the placeholder + incremental-update pattern from slack/listener.py:
    one conversation message is created up front with _processing=True, and
    its `segments` / `toolCalls` / `thinkingCount` are patched in place as
    events arrive. The web chat (which polls the conversation endpoint)
    sees the activity panel grow in near real-time. On completion the same
    message is finalized with the agent's reply + a clickable brief link
    and _processing flips to False — no second message."""
    reminder = await db.scalar(select(Reminder).where(Reminder.id == reminder_id))
    if reminder is None:
        raise LookupError(f"reminder {reminder_id} not found")
    if reminder.status not in {"pending", "processing"}:
        log.info("reminder.prep.skipped", id=str(reminder_id), status=reminder.status)
        return reminder

    started_at = datetime.now(timezone.utc)
    reminder.last_attempted_at = started_at
    prep_dir = _meeting_prep_dir(reminder.project_id)
    prompt = _build_prompt(reminder)
    label = _subject_label(reminder)
    due_local = reminder.due_at.astimezone().strftime("%a %Y-%m-%d %H:%M %Z")
    # Reminder cards land in the session that created the reminder
    # (or default for legacy NULL rows). Resolved once up front and
    # threaded through every conversation_store call below.
    session_id = await _resolve_session_id(db, reminder)

    kind = _output_kind(reminder)

    # Notification: just a ping, no output file, no LLM. Fastest path.
    if kind == "notification":
        try:
            await conversation_store.append_message(
                db, reminder.project_id, session_id,
                {
                    "role": "assistant",
                    "source": "reminder",
                    "kind": "reminder_prep_done",
                    "reminder_id": str(reminder.id),
                    "content": render_reminder_card(
                        state="ready", label=label, due_local=due_local,
                    ),
                    "_processing": False,
                    "reminder_card_state": "ready",
                    "reminder_card_label": label,
                    "reminder_card_due_local": due_local,
                },
            )
        except Exception as e:
            log.warning("reminder.chat.placeholder.failed", id=str(reminder_id), error=str(e))
        await _log_activity(
            db, reminder,
            action="reminder_prep_skipped",
            summary=f"Notification-only reminder: {label}",
            details={"reminder_id": str(reminder_id), "output_kind": "notification"},
        )
        reminder.prepared_at = datetime.now(timezone.utc)
        reminder.status = "prepared"
        await db.commit()
        log.info("reminder.prep.notification", id=str(reminder_id))
        return reminder

    # Status: render a short DB-backed summary, no LLM spawn. Much cheaper
    # than the agenda path for "remind me about BR-003" style reminders.
    if kind == "status":
        from app.services.reminder_status import render_status_brief
        result = await render_status_brief(db, reminder)
        if result is None:
            # Subject no longer exists (edge case: BR deleted between
            # schedule and fire). Fall back to notification-only; don't
            # fail the reminder.
            log.warning("reminder.status.subject_missing", id=str(reminder_id), subject=reminder.subject_id)
            try:
                await conversation_store.append_message(
                    db, reminder.project_id, session_id,
                    {
                        "role": "assistant", "source": "reminder",
                        "kind": "reminder_prep_done", "reminder_id": str(reminder.id),
                        "content": render_reminder_card(state="ready", label=label, due_local=due_local),
                        "_processing": False,
                        "reminder_card_state": "ready", "reminder_card_label": label,
                        "reminder_card_due_local": due_local,
                    },
                )
            except Exception:
                pass
            reminder.prepared_at = datetime.now(timezone.utc)
            reminder.status = "prepared"
            await db.commit()
            return reminder

        brief_path, brief_body = result
        rel_path = brief_path.relative_to(claude_runner.get_project_dir(reminder.project_id))
        # Status briefs open in the Reminders tab (expanded detail) — they
        # aren't meeting agendas. agenda briefs keep routing to Meeting Prep.
        viewer_url = f"/projects/{reminder.project_id}/chat?tab=reminders&r={reminder.id}"
        filename = brief_path.name
        chat_content = render_reminder_card(
            state="ready", label=label, due_local=due_local,
            viewer_url=viewer_url, filename=filename,
            agent_reply=None,  # Status summary already IS the brief — don't double-print.
            output_kind="status",
        )
        try:
            await conversation_store.append_message(
                db, reminder.project_id, session_id,
                {
                    "role": "assistant", "source": "reminder",
                    "kind": "reminder_prep_done", "reminder_id": str(reminder.id),
                    "content": chat_content, "_processing": False,
                    "prep_output_path": str(rel_path),
                    "reminder_card_state": "ready", "reminder_card_label": label,
                    "reminder_card_due_local": due_local,
                    "reminder_card_viewer_url": viewer_url,
                    "reminder_card_filename": filename,
                },
            )
        except Exception as e:
            log.warning("reminder.chat.status.failed", id=str(reminder_id), error=str(e))
        await _log_activity(
            db, reminder,
            action="reminder_status_rendered",
            summary=f"Status brief rendered: {label}",
            details={"reminder_id": str(reminder_id), "path": str(rel_path)},
        )
        reminder.prep_output_path = str(rel_path)
        reminder.prepared_at = datetime.now(timezone.utc)
        reminder.status = "prepared"
        await db.commit()
        log.info("reminder.prep.status_done", id=str(reminder_id))
        return reminder

    # kind == "agenda" (or unknown future values): fall through to the full
    # discovery-prep-agent streaming path below.

    # Create the ONE streaming message up front. All subsequent updates
    # patch this row in place — the chat renderer shows it as a live
    # "processing" card that fills in with tool calls and text as they arrive.
    placeholder_id: str | None = None
    try:
        placeholder_id = await conversation_store.append_message(
            db, reminder.project_id, session_id,
            {
                "role": "assistant",
                "source": "reminder",
                "kind": "reminder_prep",
                "reminder_id": str(reminder.id),
                "content": render_reminder_card(
                    state="running", label=label, due_local=due_local,
                ),
                "segments": [],
                "toolCalls": [],
                "thinkingCount": 0,
                "_processing": True,
            },
        )
    except Exception as e:
        log.warning("reminder.chat.placeholder.failed", id=str(reminder_id), error=str(e))

    await _log_activity(
        db, reminder,
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
    last_update_ms = 0.0

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

    def _snapshot_segments() -> list[dict]:
        """Finalized segments plus a trailing in-flight activity segment
        (if the current phase is activity), so the UI never waits for the
        next 'text' event to flush a pending tool-call run."""
        snap = list(segments)
        if activity_tools or activity_thinking > 0:
            snap.append({
                "type": "activity",
                "tools": list(activity_tools),
                "thinkingCount": activity_thinking,
            })
        return snap

    async def _maybe_live_update() -> None:
        """Throttled in-place update of the streaming placeholder."""
        nonlocal last_update_ms
        if not placeholder_id:
            return
        now_ms = time.time() * 1000
        if now_ms - last_update_ms < _LIVE_UPDATE_THROTTLE_MS:
            return
        last_update_ms = now_ms
        try:
            await conversation_store.update_message_by_id(
                db, reminder.project_id, session_id, placeholder_id,
                {
                    "segments": _snapshot_segments(),
                    "toolCalls": list(tool_calls),
                    "thinkingCount": thinking_count,
                },
            )
        except Exception as e:
            log.warning("reminder.chat.live.failed", id=str(reminder_id), error=str(e))

    try:
        async for event in claude_runner.run_stream(
            project_id=reminder.project_id,
            ephemeral_key=f"reminder-prep:{reminder.id}",
            mcp_user_id=reminder.created_by_user_id,
            message=prompt,
            agent=reminder.prep_agent,
        ):
            etype = event.get("type")
            if etype == "thinking":
                thinking_count += 1
                activity_thinking += 1
                last_phase = "activity"
                await _maybe_live_update()
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
                await _maybe_live_update()
            elif etype == "tool_use":
                last_phase = "activity"
                tlabel = _tool_label(event.get("tool", "unknown"), event.get("input", {}) or {})
                tool_calls.append(tlabel)
                activity_tools.append(tlabel)
                await _maybe_live_update()
    except Exception as e:
        new_status = _mark_failed_or_retry(reminder, f"prep_agent_error: {e}")
        if placeholder_id:
            try:
                # Keep the card in 'running' if we're going to retry — the
                # user doesn't need to see transient failures; only flip to
                # the failed state when we've exhausted retries.
                card_state = "failed" if new_status == "failed" else "running"
                await conversation_store.update_message_by_id(
                    db, reminder.project_id, session_id, placeholder_id,
                    {
                        "kind": "reminder_prep_failed" if new_status == "failed" else "reminder_prep",
                        "content": render_reminder_card(
                            state=card_state, label=label, due_local=due_local,
                            error=str(e) if card_state == "failed" else None,
                        ),
                        "_processing": new_status == "pending",  # keep processing indicator if retrying
                        "segments": _snapshot_segments(),
                        "toolCalls": list(tool_calls),
                        "thinkingCount": thinking_count,
                    },
                )
            except Exception:
                pass
        await _log_activity(
            db, reminder,
            action="reminder_prep_failed" if new_status == "failed" else "reminder_prep_retry",
            summary=(
                f"Reminder prep failed terminally: {label}" if new_status == "failed"
                else f"Reminder prep will retry ({reminder.retry_count}/{reminder.max_retries}): {label}"
            ),
            details={"reminder_id": str(reminder_id), "error": str(e), "retry_count": reminder.retry_count},
        )
        await db.commit()
        log.exception("reminder.prep.failed", id=str(reminder_id), terminal=(new_status == "failed"))
        return reminder

    brief = _latest_brief_after(prep_dir, started_at, _filename_slug(reminder))
    if brief is None:
        new_status = _mark_failed_or_retry(
            reminder, "prep agent ran but produced no new file in .memory-bank/docs/meeting-prep/"
        )
        if placeholder_id:
            try:
                card_state = "failed" if new_status == "failed" else "running"
                await conversation_store.update_message_by_id(
                    db, reminder.project_id, session_id, placeholder_id,
                    {
                        "kind": "reminder_prep_failed" if new_status == "failed" else "reminder_prep",
                        "content": render_reminder_card(
                            state=card_state, label=label, due_local=due_local,
                            error="prep agent produced no brief file" if card_state == "failed" else None,
                        ),
                        "_processing": new_status == "pending",
                        "segments": _snapshot_segments(),
                        "toolCalls": list(tool_calls),
                        "thinkingCount": thinking_count,
                    },
                )
            except Exception:
                pass
        await _log_activity(
            db, reminder,
            action="reminder_prep_failed" if new_status == "failed" else "reminder_prep_retry",
            summary=f"Reminder prep produced no file: {label}",
            details={"reminder_id": str(reminder_id), "retry_count": reminder.retry_count},
        )
        await db.commit()
        log.warning("reminder.prep.no_output", id=str(reminder_id), terminal=(new_status == "failed"))
        return reminder

    # Close out any trailing activity segment so the web chat renders the
    # final "1 action · N thinking" badge correctly.
    _flush_activity()

    rel_path = brief.relative_to(claude_runner.get_project_dir(reminder.project_id))
    reminder.prep_output_path = str(rel_path)
    reminder.prepared_at = datetime.now(timezone.utc)
    reminder.status = "prepared"

    agent_reply = ("".join(text_chunks)).strip()
    filename = str(rel_path).rsplit("/", 1)[-1]
    # Agenda reminders go to the Meeting Prep tab — that's the surface
    # built for viewing / editing / emailing full meeting agendas.
    # (Status / notification reminders take different routes above.)
    viewer_url = (
        f"/projects/{reminder.project_id}/chat?tab=meeting&file={filename}"
    )
    chat_content = render_reminder_card(
        state="ready",
        label=label,
        due_local=due_local,
        viewer_url=viewer_url,
        filename=filename,
        agent_reply=agent_reply,
        output_kind="agenda",
    )

    # Structured fields the delivery step rebuilds the card from — keeps
    # rendering centralized in render_reminder_card instead of scraping
    # the content string on delivery.
    card_fields = {
        "reminder_card_state": "ready",
        "reminder_card_label": label,
        "reminder_card_due_local": due_local,
        "reminder_card_viewer_url": viewer_url,
        "reminder_card_filename": filename,
        "reminder_card_agent_reply": agent_reply,
    }

    if placeholder_id:
        try:
            await conversation_store.update_message_by_id(
                db, reminder.project_id, session_id, placeholder_id,
                {
                    "kind": "reminder_prep_done",
                    "content": chat_content,
                    "segments": segments,
                    "toolCalls": tool_calls,
                    "thinkingCount": thinking_count,
                    "prep_output_path": str(rel_path),
                    "_processing": False,
                    **card_fields,
                },
            )
        except Exception as e:
            log.warning("reminder.chat.final.failed", id=str(reminder_id), error=str(e))
    else:
        # Fallback if the placeholder never landed (rare).
        await _post_chat(
            db, reminder,
            kind="reminder_prep_done",
            content=chat_content,
            extra={
                "prep_output_path": str(rel_path),
                "toolCalls": tool_calls,
                "thinkingCount": thinking_count,
                "segments": segments,
                **card_fields,
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
