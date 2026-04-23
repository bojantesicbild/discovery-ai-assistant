"""HTTP endpoints for the session heartbeat.

Three routes exposing the heartbeat log to the frontend:

  GET  /api/projects/{id}/sessions             — list recent sessions
  GET  /api/projects/{id}/sessions/{sid}/events — full event stream for one session
  GET  /api/projects/{id}/activity             — flat cross-session event feed

Kept thin: serialization + filters only. All the lifecycle logic lives
in `app.services.sessions`.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.session import Session, SessionEvent
from app.services.sessions import (
    list_sessions, get_session_events, recent_events_for_project,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["sessions"])


def _session_to_dict(s: Session) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "project_id": str(s.project_id),
        "user_id": str(s.user_id) if s.user_id else None,
        "domain": s.domain,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        "last_event_at": s.last_event_at.isoformat() if s.last_event_at else None,
        "status": s.status,
        "summary": s.summary,
        "artifacts_produced": s.artifacts_produced or {},
    }


def _event_to_dict(e: SessionEvent) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "session_id": str(e.session_id),
        "project_id": str(e.project_id),
        "ts": e.ts.isoformat() if e.ts else None,
        "event_type": e.event_type,
        "payload": e.payload or {},
    }


@router.get("/sessions")
async def get_sessions(
    project_id: uuid.UUID,
    status: str | None = Query(None, description="active | archived | abandoned"),
    limit: int = Query(50, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_sessions(
        db, project_id=project_id, status=status, limit=limit,
    )
    return {
        "sessions": [_session_to_dict(s) for s in rows],
        "total": len(rows),
    }


@router.get("/sessions/{session_id}/events")
async def get_events_for_session(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    event_types: str | None = Query(None, description="Comma-separated list"),
    limit: int = Query(500, ge=1, le=2000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Sanity: make sure the session belongs to the project. Prevents
    # accidental cross-tenant reads when ids get swapped around.
    session = await db.get(Session, session_id)
    if session is None or session.project_id != project_id:
        raise HTTPException(404, "Session not found in project")
    et_list = [s.strip() for s in event_types.split(",")] if event_types else None
    rows = await get_session_events(
        db, session_id=session_id, event_types=et_list, limit=limit,
    )
    return {
        "session": _session_to_dict(session),
        "events": [_event_to_dict(e) for e in rows],
        "total": len(rows),
    }


@router.get("/activity")
async def get_recent_activity(
    project_id: uuid.UUID,
    event_types: str | None = Query(None),
    since_hours: int | None = Query(None, description="Only events from the last N hours"),
    limit: int = Query(200, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cross-session activity feed — drives the future 'recent activity'
    dashboard and the Obsidian session-timeline dataview."""
    et_list = [s.strip() for s in event_types.split(",")] if event_types else None
    since = None
    if since_hours is not None:
        since = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    rows = await recent_events_for_project(
        db, project_id=project_id, event_types=et_list, since=since, limit=limit,
    )
    return {
        "events": [_event_to_dict(e) for e in rows],
        "total": len(rows),
    }
