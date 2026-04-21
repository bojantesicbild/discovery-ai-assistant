"""Recurrence arithmetic for reminders.

v1 is a small closed set — 'daily', 'weekdays', 'weekly', 'monthly' —
matching how PMs actually ask ('every Monday 9am', 'every weekday
morning'). If the product ever needs arbitrary iCal-style patterns we
can swap this for `dateutil.rrule`, but the closed set keeps the MCP
tool surface narrow and the agent's job clear.
"""

from __future__ import annotations

from datetime import datetime, timedelta


def next_occurrence(current_due_at: datetime, recurrence: str) -> datetime | None:
    """Advance `current_due_at` by one period of `recurrence`.

    Returns None if `recurrence` is 'none' or unknown — the caller
    treats that as "this reminder is a one-shot, don't re-arm."
    """
    if recurrence == "daily":
        return current_due_at + timedelta(days=1)

    if recurrence == "weekdays":
        # Step forward one day at a time until we land on Mon–Fri.
        nxt = current_due_at + timedelta(days=1)
        while nxt.weekday() >= 5:  # 5 = Sat, 6 = Sun
            nxt += timedelta(days=1)
        return nxt

    if recurrence == "weekly":
        return current_due_at + timedelta(days=7)

    if recurrence == "monthly":
        # Calendar-month add. Python's stdlib doesn't do this; roll
        # manually, snapping day-of-month to the last valid day when the
        # target month is shorter (Jan 31 → Feb 28/29 → Mar 28, not 31).
        year = current_due_at.year
        month = current_due_at.month + 1
        if month > 12:
            year += 1
            month = 1
        import calendar
        last_dom = calendar.monthrange(year, month)[1]
        day = min(current_due_at.day, last_dom)
        return current_due_at.replace(year=year, month=month, day=day)

    return None


def to_google_rrule(recurrence: str) -> str | None:
    """Translate our enum to an RFC 5545 RRULE for Google Calendar. Only
    used by the calendar delivery adapter — Google understands RRULE
    natively so native recurrence is nicer than our worker doing a
    per-occurrence sync."""
    return {
        "daily":    "RRULE:FREQ=DAILY",
        "weekdays": "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "weekly":   "RRULE:FREQ=WEEKLY",
        "monthly":  "RRULE:FREQ=MONTHLY",
    }.get(recurrence)
