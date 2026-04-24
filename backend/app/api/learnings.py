"""HTTP endpoints for the learnings inbox.

Phase 3 of the session-heartbeat architecture (see
docs/research/2026-04-23-session-heartbeat-plan.md). Thin wrappers over
`app.services.learnings`; the service owns dedup, status transitions,
and the auto-dismiss stale reaper.

Routes:

  GET  /api/projects/{id}/learnings                  — active (transient + promoted)
  GET  /api/projects/{id}/learnings/candidates       — promotion candidates (refs >= threshold)
  POST /api/projects/{id}/learnings/{lid}/promote    — PM blesses the pattern
  POST /api/projects/{id}/learnings/{lid}/dismiss    — PM discards the pattern
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.learning import Learning
from app.services.learnings import (
    DEFAULT_PROMOTION_THRESHOLD,
    dismiss_learning,
    get_active_learnings,
    promote_learning,
    promotion_candidates,
)


router = APIRouter(prefix="/api/projects/{project_id}", tags=["learnings"])


def _learning_to_dict(lr: Learning) -> dict[str, Any]:
    return {
        "id": str(lr.id),
        "project_id": str(lr.project_id) if lr.project_id else None,
        "origin_session_id": str(lr.origin_session_id) if lr.origin_session_id else None,
        "category": lr.category,
        "content": lr.content,
        "evidence_quote": lr.evidence_quote,
        "evidence_doc_id": str(lr.evidence_doc_id) if lr.evidence_doc_id else None,
        "status": lr.status,
        "reference_count": lr.reference_count,
        "last_relevant_at": lr.last_relevant_at.isoformat() if lr.last_relevant_at else None,
        "promoted_at": lr.promoted_at.isoformat() if lr.promoted_at else None,
        "promoted_by": str(lr.promoted_by) if lr.promoted_by else None,
        "dismissed_at": lr.dismissed_at.isoformat() if lr.dismissed_at else None,
        "dismissed_by": str(lr.dismissed_by) if lr.dismissed_by else None,
        "created_at": lr.created_at.isoformat() if lr.created_at else None,
    }


@router.get("/learnings")
async def list_active_learnings(
    project_id: uuid.UUID,
    category: str | None = Query(None),
    min_references: int = Query(1, ge=1),
    include_global: bool = Query(True),
    team_only: bool = Query(False, description="If true, only team-level rows (user_id IS NULL) — used for admin review."),
    limit: int = Query(50, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List active learnings visible to the caller.

    Default scope: caller's personal rows + team-level rows on this
    project (and optionally global cross-project rows). Admins /
    reviewers can pass team_only=true to inspect just the shared tier.
    """
    rows = await get_active_learnings(
        db,
        project_id=project_id,
        user_id=None if team_only else user.id,
        category=category,
        min_references=min_references,
        include_global=include_global,
        limit=limit,
    )
    return {"learnings": [_learning_to_dict(r) for r in rows], "total": len(rows)}


@router.get("/learnings/candidates")
async def list_promotion_candidates(
    project_id: uuid.UUID,
    threshold: int = Query(DEFAULT_PROMOTION_THRESHOLD, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transient learnings whose reference_count crossed the threshold.
    The session-end UX surfaces these as one-click promote/dismiss cards."""
    rows = await promotion_candidates(
        db, project_id=project_id, threshold=threshold, limit=limit,
    )
    return {
        "candidates": [_learning_to_dict(r) for r in rows],
        "total": len(rows),
        "threshold": threshold,
    }


@router.post("/learnings/{learning_id}/promote")
async def post_promote_learning(
    project_id: uuid.UUID,
    learning_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lr = await promote_learning(db, learning_id=learning_id, user_id=user.id)
    if lr is None:
        raise HTTPException(404, "Learning not found")
    # Cross-tenant guardrail — service layer doesn't check project scope
    # since global (NULL project_id) learnings are valid. Here we only
    # need to make sure the PM isn't promoting another project's row.
    if lr.project_id is not None and lr.project_id != project_id:
        raise HTTPException(404, "Learning not found in project")
    await db.commit()
    return _learning_to_dict(lr)


@router.post("/learnings/{learning_id}/dismiss")
async def post_dismiss_learning(
    project_id: uuid.UUID,
    learning_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lr = await dismiss_learning(db, learning_id=learning_id, user_id=user.id)
    if lr is None:
        raise HTTPException(404, "Learning not found")
    if lr.project_id is not None and lr.project_id != project_id:
        raise HTTPException(404, "Learning not found in project")
    await db.commit()
    return _learning_to_dict(lr)
