"""Reminder delivery — route a prepared reminder to the chosen channel.

v1 supports:
- gmail: create a draft in the project's connected Gmail account with the
  brief as the body. The PM opens the draft in Gmail, tweaks, and sends.
- in_app: no external call. Frontend surfaces status='delivered' rows
  as a badge / dashboard card.
- slack: stub — raises NotImplementedError until the channel is wired.

The caller (scan_due_reminders) is responsible for running prep before
delivery and for transactional persistence of the status change.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.claude_runner import claude_runner
from app.models.operational import ActivityLog, ProjectIntegration
from app.models.reminder import Reminder
from app.services import conversation_store
from app.services.secrets import decrypt_config

log = structlog.get_logger()


def _load_brief(project_id: uuid.UUID, rel_path: str) -> str:
    """Read the brief markdown off disk. Returns the file body or a
    fallback one-liner if the file disappeared between prep and delivery."""
    absolute = claude_runner.get_project_dir(project_id) / rel_path
    if not absolute.exists():
        return f"(brief file missing at {rel_path} — check the vault)"
    return absolute.read_text(encoding="utf-8")


def _subject_line(reminder: Reminder) -> str:
    parts = ["Reminder:"]
    if reminder.subject_id:
        parts.append(reminder.subject_id)
    if reminder.person:
        parts.append(f"with {reminder.person}")
    if len(parts) == 1:
        parts.append(reminder.raw_request[:60])
    return " ".join(parts)


async def _load_google_integration(db: AsyncSession, project_id) -> tuple[str, str]:
    """Return (refresh_token, sender_email) for the project's Google OAuth
    integration. Raises RuntimeError if missing so the delivery branch
    surfaces a clear error. Shared by both Gmail draft + Calendar event
    delivery — one OAuth consent covers both APIs."""
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == "gmail",
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise RuntimeError(
            "Google integration not connected for this project — connect Gmail first "
            "(one OAuth covers Gmail + Calendar)"
        )
    config = decrypt_config(integration.config_encrypted)
    refresh_token = config.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("Google integration has no refresh token — reconnect Gmail")
    sender_email = (integration.metadata_public or {}).get("email", "")
    return refresh_token, sender_email


async def _deliver_gmail(
    db: AsyncSession, reminder: Reminder, brief_md: str
) -> dict:
    """Create a Gmail draft on the project's connected account."""
    from app.services import gmail as gmail_service

    refresh_token, sender_email = await _load_google_integration(db, reminder.project_id)
    access_token = await gmail_service.get_access_token(refresh_token)
    draft = await gmail_service.create_draft(
        access_token,
        to="",  # PM fills in the recipient; body is the brief
        subject=_subject_line(reminder),
        body=brief_md,
        sender_email=sender_email,
    )
    return draft


async def _deliver_calendar(
    db: AsyncSession, reminder: Reminder, brief_md: str
) -> dict:
    """Create a Google Calendar event on the project's connected account."""
    from app.services import gmail as gmail_service
    from app.services import calendar as calendar_service
    from app.services.reminder_recurrence import to_google_rrule

    refresh_token, sender_email = await _load_google_integration(db, reminder.project_id)
    access_token = await gmail_service.get_access_token(refresh_token)

    # Description body: include brief if we have one; otherwise the raw
    # request (free-text reminders don't generate a brief).
    if brief_md:
        body = (
            f"Scheduled via Discovery Assistant.\n\n"
            f"Original request: {reminder.raw_request}\n\n"
            f"---\n\n{brief_md}"
        )
    else:
        body = f"Scheduled via Discovery Assistant.\n\nOriginal request: {reminder.raw_request}"

    # Use native Google recurrence when set — Google owns the next-fire
    # math instead of our worker.
    rrule = to_google_rrule(reminder.recurrence) if reminder.recurrence and reminder.recurrence != "none" else None

    event = await calendar_service.create_event(
        access_token,
        sender_email=sender_email,
        summary=_subject_line(reminder),
        description=body,
        start_at=reminder.due_at,
        recurrence_rrule=rrule,
    )
    # Return in a shape compatible with gmail draft — deliver_reminder
    # reads .get("gmail_url") || .get("draft_id"); calendar uses html_link.
    return {"gmail_url": event.get("html_link"), "draft_id": event.get("event_id")}


async def deliver_reminder(db: AsyncSession, reminder_id: uuid.UUID) -> Reminder:
    """Dispatch a prepared reminder to its channel. Idempotent via status guard."""
    reminder = await db.scalar(select(Reminder).where(Reminder.id == reminder_id))
    if reminder is None:
        raise LookupError(f"reminder {reminder_id} not found")
    if reminder.status != "prepared":
        log.info("reminder.deliver.skipped", id=str(reminder_id), status=reminder.status)
        return reminder

    brief_md = ""
    if reminder.prep_output_path:
        brief_md = _load_brief(reminder.project_id, reminder.prep_output_path)

    try:
        if reminder.channel == "gmail":
            draft = await _deliver_gmail(db, reminder, brief_md)
            reminder.external_ref = draft.get("gmail_url") or draft.get("draft_id")
        elif reminder.channel == "calendar":
            event = await _deliver_calendar(db, reminder, brief_md)
            reminder.external_ref = event.get("gmail_url") or event.get("draft_id")
        elif reminder.channel == "in_app":
            # No external call — frontend surfaces status=delivered.
            reminder.external_ref = None
        elif reminder.channel == "slack":
            raise NotImplementedError("slack delivery not wired yet")
        else:
            raise RuntimeError(f"unsupported channel: {reminder.channel}")
    except (httpx.HTTPError, RuntimeError, NotImplementedError) as e:
        # Delivery failures are terminal in v1 — the brief already exists,
        # so the user can re-deliver manually or reschedule. Unlike prep
        # failures (LLM timeouts etc.), delivery errors tend to be config
        # issues (broken Gmail token, slack disconnect) that an automatic
        # retry won't fix until the human intervenes.
        reminder.status = "failed"
        reminder.error_message = f"deliver_error: {e}"
        await db.commit()
        log.exception("reminder.deliver.failed", id=str(reminder_id), channel=reminder.channel)
        return reminder

    reminder.status = "delivered"
    reminder.delivered_at = datetime.now(timezone.utc)

    # Patch the EXISTING prep card in place rather than appending a second
    # message. One card per reminder lifecycle — the delivery info shows
    # as " · delivered via <channel>" on the same card the user already
    # saw prep on.
    label_parts = []
    if reminder.subject_id:
        label_parts.append(reminder.subject_id)
    if reminder.person:
        label_parts.append(f"with {reminder.person}")
    label = " ".join(label_parts) or reminder.raw_request[:60]

    try:
        from app.services.reminder_prep import render_reminder_card, _resolve_session_id
        # Where the prep card was originally posted — same session is the
        # only place we should look for it (and patch back into).
        session_id = await _resolve_session_id(db, reminder)
        prep_msg_id = await conversation_store.find_latest_message_by(
            db, reminder.project_id, session_id,
            lambda m: (
                m.get("reminder_id") == str(reminder.id)
                and m.get("kind") in {"reminder_prep", "reminder_prep_done"}
            ),
        )
        if prep_msg_id:
            # Prefer the structured fields we stamped on the message; fall
            # back to recomputed defaults if they're missing (older rows).
            existing_messages = await conversation_store.get_messages(
                db, reminder.project_id, session_id, limit=200,
            )
            existing = next(
                (m for m in existing_messages if isinstance(m, dict) and m.get("id") == prep_msg_id),
                {},
            )
            new_content = render_reminder_card(
                state="delivered",
                channel=reminder.channel,
                label=existing.get("reminder_card_label") or label,
                due_local=existing.get("reminder_card_due_local")
                    or reminder.due_at.astimezone().strftime("%a %Y-%m-%d %H:%M %Z"),
                viewer_url=existing.get("reminder_card_viewer_url"),
                filename=existing.get("reminder_card_filename"),
                agent_reply=existing.get("reminder_card_agent_reply"),
                output_kind=reminder.output_kind or "agenda",
            )
            await conversation_store.update_message_by_id(
                db, reminder.project_id, session_id, prep_msg_id,
                {
                    "kind": "reminder_delivered",
                    "content": new_content,
                    "reminder_card_state": "delivered",
                    "external_ref": reminder.external_ref,
                },
            )
        else:
            # Edge case: no prep card (e.g., prep was skipped or pre-dates
            # streaming). Post a compact standalone delivery note.
            ref_link = f" ([open draft]({reminder.external_ref}))" if reminder.external_ref else ""
            await conversation_store.append_message(db, reminder.project_id, session_id, {
                "role": "assistant",
                "source": "reminder",
                "kind": "reminder_delivered",
                "reminder_id": str(reminder.id),
                "content": f"Reminder delivered via {reminder.channel.replace('_', '-')} — {label}.{ref_link}",
            })
    except Exception as e:
        log.warning("reminder.chat.post.failed", id=str(reminder_id), kind="reminder_delivered", error=str(e))
    try:
        db.add(ActivityLog(
            project_id=reminder.project_id,
            user_id=reminder.created_by_user_id,
            action="reminder_deliver_done",
            summary=f"Reminder delivered via {reminder.channel}: {label}",
            details={
                "reminder_id": str(reminder.id),
                "channel": reminder.channel,
                "external_ref": reminder.external_ref,
            },
        ))
    except Exception as e:
        log.warning("reminder.activity.failed", id=str(reminder_id), action="reminder_deliver_done", error=str(e))

    await db.commit()
    log.info("reminder.deliver.done", id=str(reminder_id), channel=reminder.channel, ref=reminder.external_ref)
    return reminder
