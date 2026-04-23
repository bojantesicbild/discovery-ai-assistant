"""Session service — lifecycle + event emission.

The single place application code touches the sessions + session_events
tables. Keeps the rest of the codebase free of heartbeat bookkeeping:
every existing endpoint calls `record_event(db, ...)` and moves on.

Session lifecycle is intentionally simple:

  start_or_resume_session(project_id, user_id)
    — looks up the existing `active` session for (project, user) or
      creates a new one. Idempotent; safe to call on every user turn.

  record_event(db, session_id, project_id, event_type, payload)
    — appends to session_events and bumps session.last_event_at. Also
      merges any artifacts mentioned in the payload into
      session.artifacts_produced (best-effort, non-fatal on failure).

  end_session(db, session_id, status='archived')
    — sets ended_at + status. Summary generation is a downstream job
      (planned for Phase 3 alongside learnings promotion).

  abandon_stale_sessions(db, idle_minutes=30)
    — scheduler-friendly cleanup. Idle active sessions whose
      last_event_at is older than the threshold get flipped to
      abandoned.

Part of the session-heartbeat architecture. See
docs/research/2026-04-23-session-heartbeat-plan.md.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Session, SessionEvent


# Default idle window before an active session is auto-abandoned.
# Configurable later via project settings; this is the starting value.
DEFAULT_IDLE_MINUTES = 30


# ── Lifecycle ─────────────────────────────────────────────────────────


async def start_or_resume_session(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    user_id: uuid.UUID | None,
    domain: str | None = None,
) -> Session:
    """Return the active session for (project, user) — resumed or new.

    Uses the partial unique index from migration 033 so the insert is
    race-safe: two concurrent user messages that both try to create a
    session will converge to the same row.
    """
    # Fast path: find the already-active session.
    existing_q = select(Session).where(
        Session.project_id == project_id,
        Session.status == "active",
    )
    if user_id is None:
        existing_q = existing_q.where(Session.user_id.is_(None))
    else:
        existing_q = existing_q.where(Session.user_id == user_id)
    existing = (await db.execute(existing_q.limit(1))).scalar_one_or_none()
    if existing is not None:
        # Bump last_event_at so the idle reaper sees this session as live.
        existing.last_event_at = datetime.now(timezone.utc)
        # Upgrade domain on resume if a new one comes in — sessions
        # starting in "discovery" can pivot into "tech-stories" later
        # without forcing a new row.
        if domain and existing.domain != domain:
            existing.domain = domain
        await db.flush()
        return existing

    # Slow path: create. The partial UNIQUE on (project_id, user_id)
    # WHERE status='active' means two concurrent inserts from the same
    # user will collide; catch that and re-select the winner.
    now = datetime.now(timezone.utc)
    new_row = Session(
        project_id=project_id,
        user_id=user_id,
        domain=domain,
        started_at=now,
        last_event_at=now,
        status="active",
        summary=None,
        artifacts_produced={},
    )
    db.add(new_row)
    try:
        await db.flush()
        return new_row
    except Exception:
        await db.rollback()
        # Winner inserted between our SELECT and INSERT — re-fetch.
        winner = (await db.execute(existing_q.limit(1))).scalar_one_or_none()
        if winner is None:
            # Truly unexpected — re-raise for observability.
            raise
        return winner


async def end_session(
    db: AsyncSession, *,
    session_id: uuid.UUID,
    status: str = "archived",
    summary: str | None = None,
) -> Session | None:
    """Mark a session as archived or abandoned. Summary is optional —
    Phase 3 adds auto-summary generation at archive time."""
    if status not in ("archived", "abandoned"):
        raise ValueError(f"bad end status {status!r}")
    session = await db.get(Session, session_id)
    if session is None:
        return None
    if session.status != "active":
        return session  # idempotent
    session.status = status
    session.ended_at = datetime.now(timezone.utc)
    if summary is not None:
        session.summary = summary
    await db.flush()
    return session


async def abandon_stale_sessions(
    db: AsyncSession, *,
    idle_minutes: int = DEFAULT_IDLE_MINUTES,
) -> int:
    """Move active sessions whose last_event_at is older than the idle
    window into status='abandoned'. Intended for a periodic cron.

    Returns the count of sessions closed."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=idle_minutes)
    stmt = (
        update(Session)
        .where(Session.status == "active", Session.last_event_at < cutoff)
        .values(status="abandoned", ended_at=datetime.now(timezone.utc))
        .returning(Session.id)
    )
    res = await db.execute(stmt)
    closed_ids = [row[0] for row in res.fetchall()]
    return len(closed_ids)


# ── Event emission ────────────────────────────────────────────────────


async def record_event(
    db: AsyncSession, *,
    session_id: uuid.UUID,
    project_id: uuid.UUID,
    event_type: str,
    payload: dict[str, Any] | None = None,
    artifact_updates: dict[str, Any] | None = None,
) -> SessionEvent:
    """Append one event + bump the session's last_event_at.

    `artifact_updates`, if supplied, is merged into
    session.artifacts_produced. Keys that already exist are extended
    for list values, replaced for scalars. Non-fatal on merge error.

    NOT fire-and-forget from a transaction perspective — the event is
    part of the caller's transaction. That's intentional: if the
    caller rolls back, the event doesn't land either (no phantom
    trail). Callers that want true async emission should enqueue via
    arq.
    """
    now = datetime.now(timezone.utc)
    event = SessionEvent(
        session_id=session_id,
        project_id=project_id,
        ts=now,
        event_type=event_type,
        payload=payload or {},
    )
    db.add(event)

    # Keep the session's heartbeat fresh. The idle reaper watches this
    # column; not bumping it on every event would falsely flag busy
    # sessions as abandoned.
    session = await db.get(Session, session_id)
    if session is not None:
        session.last_event_at = now
        if artifact_updates:
            try:
                current = dict(session.artifacts_produced or {})
                for key, value in artifact_updates.items():
                    if isinstance(value, list):
                        existing = current.get(key) or []
                        if not isinstance(existing, list):
                            existing = [existing]
                        for item in value:
                            if item not in existing:
                                existing.append(item)
                        current[key] = existing
                    else:
                        current[key] = value
                session.artifacts_produced = current
            except Exception:
                # Artifact accounting is a nice-to-have — never let a
                # bad merge take down the event write.
                pass
    await db.flush()
    return event


# Convenience emitter for callers that haven't resolved a session yet.
# Looks up / creates an active session, then emits. Handy in endpoints
# that need to log but don't care about session plumbing.
async def record_event_for_user(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    user_id: uuid.UUID | None,
    event_type: str,
    payload: dict[str, Any] | None = None,
    artifact_updates: dict[str, Any] | None = None,
    domain: str | None = None,
) -> SessionEvent:
    session = await start_or_resume_session(
        db, project_id=project_id, user_id=user_id, domain=domain,
    )
    return await record_event(
        db,
        session_id=session.id, project_id=project_id,
        event_type=event_type, payload=payload,
        artifact_updates=artifact_updates,
    )


# ── Read helpers for the API / future UI ──────────────────────────────


async def list_sessions(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    status: str | None = None,
    limit: int = 50,
) -> list[Session]:
    q = select(Session).where(Session.project_id == project_id)
    if status:
        q = q.where(Session.status == status)
    q = q.order_by(Session.started_at.desc()).limit(limit)
    return list((await db.execute(q)).scalars().all())


async def get_session_events(
    db: AsyncSession, *,
    session_id: uuid.UUID,
    event_types: list[str] | None = None,
    limit: int = 500,
) -> list[SessionEvent]:
    q = select(SessionEvent).where(SessionEvent.session_id == session_id)
    if event_types:
        q = q.where(SessionEvent.event_type.in_(event_types))
    q = q.order_by(SessionEvent.ts.asc()).limit(limit)
    return list((await db.execute(q)).scalars().all())


async def recent_events_for_project(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    event_types: list[str] | None = None,
    since: datetime | None = None,
    limit: int = 200,
) -> list[SessionEvent]:
    """Cross-session event stream for a project — drives the future
    'recent activity' feed + session-timeline views in Obsidian."""
    q = select(SessionEvent).where(SessionEvent.project_id == project_id)
    if event_types:
        q = q.where(SessionEvent.event_type.in_(event_types))
    if since:
        q = q.where(SessionEvent.ts >= since)
    q = q.order_by(SessionEvent.ts.desc()).limit(limit)
    return list((await db.execute(q)).scalars().all())
