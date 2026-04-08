"""Per-user finding read-state API.

Endpoints:
    POST   /api/projects/{id}/findings/{type}/{finding_id}/seen
    POST   /api/projects/{id}/findings/{type}/seen-all
    POST   /api/projects/{id}/findings/seen-all
    GET    /api/projects/{id}/findings/unread

All endpoints are per-user (use the JWT-authenticated user). Idempotent —
calling /seen on an already-seen finding is a no-op (just refreshes seen_at).
"""

import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.services.finding_views import (
    ALL_FINDING_TYPES,
    count_unread_by_type,
    is_valid_finding_type,
    mark_seen,
    mark_seen_bulk_per_project,
    mark_seen_bulk_per_type,
)

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}", tags=["finding-views"])


@router.post("/findings/{finding_type}/{finding_id}/seen")
async def mark_finding_seen(
    project_id: uuid.UUID,
    finding_type: str = Path(..., description="One of: requirement, gap, constraint, decision, contradiction, assumption, scope, stakeholder"),
    finding_id: uuid.UUID = Path(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single finding as seen by the current user."""
    if not is_valid_finding_type(finding_type):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid finding_type. Must be one of: {', '.join(ALL_FINDING_TYPES)}",
        )
    await mark_seen(db, user.id, project_id, finding_type, finding_id)
    return {"status": "ok"}


@router.post("/findings/{finding_type}/seen-all")
async def mark_findings_type_seen_all(
    project_id: uuid.UUID,
    finding_type: str = Path(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark every finding of `finding_type` in this project as seen by the
    current user. Returns the number of rows affected."""
    if not is_valid_finding_type(finding_type):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid finding_type. Must be one of: {', '.join(ALL_FINDING_TYPES)}",
        )
    affected = await mark_seen_bulk_per_type(db, user.id, project_id, finding_type)
    return {"status": "ok", "affected": affected}


@router.post("/findings/seen-all")
async def mark_findings_project_seen_all(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark every finding of every type in this project as seen by the
    current user. Used by the global "Mark all read" action."""
    affected = await mark_seen_bulk_per_project(db, user.id, project_id)
    return {"status": "ok", "affected": affected}


@router.get("/findings/unread")
async def get_unread_counts(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return per-type unread counts plus the total. Polled by the
    DataPanel tab badges and Sidebar Discovery counter."""
    counts = await count_unread_by_type(db, user.id, project_id)
    return counts
