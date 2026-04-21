"""Minimal Google Calendar REST API client.

Shares the Google OAuth access-token flow with `services.gmail` —
whichever service gets the refresh_token first mints the token.
No google-api-python-client dependency (same rationale as gmail.py).
"""

from __future__ import annotations

from datetime import datetime, timedelta

import httpx
import structlog

log = structlog.get_logger()

CALENDAR_API = "https://www.googleapis.com/calendar/v3"


async def create_event(
    access_token: str,
    *,
    sender_email: str,
    summary: str,
    description: str,
    start_at: datetime,
    end_at: datetime | None = None,
    timezone_name: str | None = None,
    recurrence_rrule: str | None = None,
    attendees: list[str] | None = None,
    calendar_id: str = "primary",
) -> dict:
    """Create a Google Calendar event and return the public fields.

    Returns `{event_id, html_link}` — the html_link is the clickable URL
    we surface in the reminder chat card.
    """
    if end_at is None:
        # Default 30-min slot — enough for a quick check-in; user can
        # resize in Calendar if needed.
        end_at = start_at + timedelta(minutes=30)

    # RFC3339 with offset; Calendar also accepts the separate timeZone
    # field, but for scheduled reminders we already carry the offset.
    body: dict = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start_at.isoformat()},
        "end": {"dateTime": end_at.isoformat()},
    }
    if timezone_name:
        body["start"]["timeZone"] = timezone_name
        body["end"]["timeZone"] = timezone_name
    if recurrence_rrule:
        # Google expects a list of RRULE/EXRULE strings.
        body["recurrence"] = [recurrence_rrule]
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees if "@" in a]
    body["reminders"] = {
        "useDefault": False,
        "overrides": [
            {"method": "popup", "minutes": 10},
            {"method": "email", "minutes": 60},
        ],
    }

    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{CALENDAR_API}/calendars/{calendar_id}/events",
            json=body,
            headers=headers,
        )
        if resp.status_code >= 400:
            # Surface the Google error body — it usually carries a clear
            # reason ("insufficient permissions", "invalid timezone", ...)
            # that we want in the reminder.error_message.
            raise httpx.HTTPStatusError(
                f"Calendar API {resp.status_code}: {resp.text[:400]}",
                request=resp.request,
                response=resp,
            )
        data = resp.json()

    log.info(
        "calendar.event.created",
        event_id=data.get("id"),
        summary=summary[:60],
        sender=sender_email[:30] if sender_email else "",
    )
    return {
        "event_id": data.get("id"),
        "html_link": data.get("htmlLink"),
    }
