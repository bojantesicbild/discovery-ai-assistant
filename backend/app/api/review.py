"""Client Review Portal API.

Two groups of endpoints:

1. PM-facing (authenticated): create/list/revoke review tokens, view submissions
2. Client-facing (public, token-gated): view requirements + gaps, submit review

The client endpoints use NO authentication — the review token IS the
credential. Token validation ensures it's not expired, not revoked, and
(for submit) not already used.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.project import Project
from app.models.review import ReviewToken, ReviewSubmission
from app.models.extraction import Requirement, Gap
from app.models.operational import ActivityLog, Notification
from app.schemas.review import (
    ReviewTokenCreate,
    ReviewTokenResponse,
    ReviewTokenListResponse,
    ReviewSubmitRequest,
    ReviewSubmitResponse,
    ClientReviewData,
    ClientRequirementView,
    ClientGapView,
    ReviewSubmissionSummaryResponse,
)

log = structlog.get_logger()

router = APIRouter(tags=["review"])


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _shareable_url(token: str) -> str:
    """Build the full client-facing URL for a review token."""
    base = settings.frontend_url.rstrip("/")
    return f"{base}/review/{token}"


async def _validate_token(
    token_str: str,
    db: AsyncSession,
    *,
    require_unsubmitted: bool = False,
) -> ReviewToken:
    """Look up and validate a review token. Raises 404 with a generic
    message for all failure cases (no information leakage)."""
    result = await db.execute(
        select(ReviewToken).where(ReviewToken.token == token_str)
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=404, detail="This review link is invalid or has expired.")
    if rt.revoked_at is not None:
        raise HTTPException(status_code=404, detail="This review link is invalid or has expired.")
    if rt.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="This review link is invalid or has expired.")
    if require_unsubmitted and rt.submitted_at is not None:
        raise HTTPException(status_code=409, detail="This review has already been submitted.")
    return rt


# ─────────────────────────────────────────────────────────────────────
# PM-facing endpoints (authenticated)
# ─────────────────────────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/review-tokens", response_model=ReviewTokenResponse, status_code=201)
async def create_review_token(
    project_id: uuid.UUID,
    body: ReviewTokenCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new shareable review link for the client."""
    # Compute the next round number
    max_round = await db.scalar(
        select(func.max(ReviewToken.round_number)).where(ReviewToken.project_id == project_id)
    )
    next_round = (max_round or 0) + 1

    token_str = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    rt = ReviewToken(
        project_id=project_id,
        created_by=user.id,
        token=token_str,
        label=body.label or f"Review round {next_round}",
        client_name=body.client_name,
        client_email=body.client_email,
        expires_at=expires_at,
        round_number=next_round,
    )
    db.add(rt)

    db.add(ActivityLog(
        project_id=project_id,
        user_id=user.id,
        action="review_token_created",
        summary=f"Review link created for {body.client_name or 'client'} (round {next_round}, expires {expires_at.date()})",
    ))

    await db.commit()
    await db.refresh(rt)

    log.info("Review token created", project=str(project_id)[:8], round=next_round, expires=str(expires_at))
    return ReviewTokenResponse(
        id=str(rt.id),
        token=rt.token,
        label=rt.label,
        client_name=rt.client_name,
        client_email=rt.client_email,
        expires_at=rt.expires_at,
        revoked_at=rt.revoked_at,
        submitted_at=rt.submitted_at,
        round_number=rt.round_number,
        created_at=rt.created_at,
        shareable_url=_shareable_url(rt.token),
    )


@router.get("/api/projects/{project_id}/review-tokens", response_model=ReviewTokenListResponse)
async def list_review_tokens(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all review tokens for this project."""
    result = await db.execute(
        select(ReviewToken)
        .where(ReviewToken.project_id == project_id)
        .order_by(ReviewToken.round_number.desc())
    )
    tokens = result.scalars().all()
    return ReviewTokenListResponse(
        tokens=[
            ReviewTokenResponse(
                id=str(rt.id),
                token=rt.token,
                label=rt.label,
                client_name=rt.client_name,
                client_email=rt.client_email,
                expires_at=rt.expires_at,
                revoked_at=rt.revoked_at,
                submitted_at=rt.submitted_at,
                round_number=rt.round_number,
                created_at=rt.created_at,
                shareable_url=_shareable_url(rt.token),
            )
            for rt in tokens
        ]
    )


@router.delete("/api/projects/{project_id}/review-tokens/{token_id}", status_code=204)
async def revoke_review_token(
    project_id: uuid.UUID,
    token_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a review token. The client will see 'link expired'."""
    result = await db.execute(
        select(ReviewToken).where(
            ReviewToken.id == token_id,
            ReviewToken.project_id == project_id,
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=404, detail="Token not found")
    rt.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    log.info("Review token revoked", token_id=str(token_id)[:8])


@router.get("/api/projects/{project_id}/review-submissions")
async def list_review_submissions(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all review submissions for this project."""
    result = await db.execute(
        select(ReviewSubmission, ReviewToken)
        .join(ReviewToken, ReviewSubmission.review_token_id == ReviewToken.id)
        .where(ReviewSubmission.project_id == project_id)
        .order_by(ReviewSubmission.created_at.desc())
    )
    rows = result.all()
    return {
        "submissions": [
            ReviewSubmissionSummaryResponse(
                id=str(sub.id),
                round_number=rt.round_number,
                client_name=rt.client_name,
                submitted_at=sub.created_at,
                confirmed=sum(1 for a in (sub.requirement_actions or []) if a.get("action") == "confirm"),
                discussed=sum(1 for a in (sub.requirement_actions or []) if a.get("action") == "discuss"),
                gaps_answered=sum(1 for a in (sub.gap_actions or []) if a.get("action") == "answer"),
                requirement_actions=sub.requirement_actions or [],
                gap_actions=sub.gap_actions or [],
            )
            for sub, rt in rows
        ]
    }


# ─────────────────────────────────────────────────────────────────────
# Public client-facing endpoints (no auth — token-gated)
# ─────────────────────────────────────────────────────────────────────

@router.get("/api/review/{token}")
async def get_review_data(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: return the project's requirements + gaps for
    client review. No authentication — the token IS the credential."""
    rt = await _validate_token(token, db)

    # Load project name
    project = await db.get(Project, rt.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Load requirements (only proposed + discussed — confirmed ones don't need review)
    reqs_result = await db.execute(
        select(Requirement)
        .where(
            Requirement.project_id == rt.project_id,
            Requirement.status.in_(["proposed", "discussed"]),
        )
        .order_by(Requirement.req_id)
    )
    reqs = reqs_result.scalars().all()

    # Group by priority
    grouped: dict[str, list[ClientRequirementView]] = {"must": [], "should": [], "could": [], "wont": []}
    for r in reqs:
        view = ClientRequirementView(
            req_id=r.req_id,
            title=r.title,
            priority=r.priority,
            description=r.description or "",
            user_perspective=r.user_perspective,
            business_rules=r.business_rules or [],
            status=r.status,
        )
        bucket = grouped.get(r.priority, grouped.get("should"))
        if bucket is not None:
            bucket.append(view)

    # Load open gaps
    gaps_result = await db.execute(
        select(Gap)
        .where(
            Gap.project_id == rt.project_id,
            Gap.status == "open",
        )
        .order_by(Gap.gap_id)
    )
    gaps = [
        ClientGapView(
            gap_id=g.gap_id,
            question=g.question,
            severity=g.severity,
            area=g.area or "general",
            blocked_reqs=g.blocked_reqs or [],
            suggested_action=g.suggested_action,
        )
        for g in gaps_result.scalars().all()
    ]

    return ClientReviewData(
        project_name=project.name,
        client_name=rt.client_name,
        round_number=rt.round_number,
        already_submitted=rt.submitted_at is not None,
        requirements=grouped,
        gaps=gaps,
    )


@router.post("/api/review/{token}/submit", response_model=ReviewSubmitResponse)
async def submit_review(
    token: str,
    body: ReviewSubmitRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: client submits their review. Applies changes
    to requirement statuses and gap resolutions in a single transaction.

    This endpoint is single-use per token — calling it twice returns 409."""
    rt = await _validate_token(token, db, require_unsubmitted=True)

    confirmed = 0
    discussed = 0
    gaps_answered = 0

    # Apply requirement actions
    for action in body.requirement_actions:
        if action.action == "skip":
            continue
        result = await db.execute(
            select(Requirement).where(
                Requirement.project_id == rt.project_id,
                Requirement.req_id == action.req_id,
            )
        )
        req = result.scalar_one_or_none()
        if not req:
            continue

        if action.action == "confirm":
            req.status = "confirmed"
            req.confidence = "high"
            confirmed += 1
        elif action.action == "discuss":
            req.status = "discussed"
            discussed += 1

    # Apply gap actions
    for action in body.gap_actions:
        if action.action == "skip" or not action.answer:
            continue
        result = await db.execute(
            select(Gap).where(
                Gap.project_id == rt.project_id,
                Gap.gap_id == action.gap_id,
            )
        )
        gap = result.scalar_one_or_none()
        if not gap:
            continue

        gap.status = "resolved"
        gap.resolution = action.answer
        gaps_answered += 1

    # Record the submission
    rt.submitted_at = datetime.now(timezone.utc)
    submission = ReviewSubmission(
        review_token_id=rt.id,
        project_id=rt.project_id,
        client_ip=request.client.host if request.client else None,
        client_user_agent=request.headers.get("user-agent"),
        requirement_actions=[a.model_dump() for a in body.requirement_actions],
        gap_actions=[a.model_dump() for a in body.gap_actions],
        summary={"confirmed": confirmed, "discussed": discussed, "gaps_answered": gaps_answered},
    )
    db.add(submission)

    # Activity log
    db.add(ActivityLog(
        project_id=rt.project_id,
        action="client_review_submitted",
        summary=(
            f"Client review round {rt.round_number} submitted"
            f"{' by ' + rt.client_name if rt.client_name else ''}: "
            f"{confirmed} confirmed, {discussed} flagged, {gaps_answered} gaps answered"
        ),
        details={
            "round": rt.round_number,
            "confirmed": confirmed,
            "discussed": discussed,
            "gaps_answered": gaps_answered,
            "token_id": str(rt.id),
        },
    ))

    # Notify all project members
    try:
        from app.models.project import ProjectMember
        members = await db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == rt.project_id)
        )
        for (uid,) in members.fetchall():
            db.add(Notification(
                project_id=rt.project_id,
                user_id=uid,
                type="client_review",
                title=f"Client review submitted (round {rt.round_number})",
                body=f"{confirmed} requirements confirmed, {discussed} flagged for discussion, {gaps_answered} gaps answered",
                data={"submission_id": str(submission.id), "round": rt.round_number},
            ))
    except Exception as e:
        log.warning("Failed to create review notifications", error=str(e))

    await db.commit()

    # Re-evaluate readiness after the status changes
    readiness_score = None
    try:
        from app.services.evaluator import evaluator
        readiness = await evaluator.evaluate(rt.project_id, db, triggered_by=f"client_review:round_{rt.round_number}")
        readiness_score = readiness.get("score")
    except Exception as e:
        log.warning("Readiness re-evaluation failed after review", error=str(e))

    log.info(
        "Client review submitted",
        project=str(rt.project_id)[:8],
        round=rt.round_number,
        confirmed=confirmed,
        discussed=discussed,
        gaps_answered=gaps_answered,
    )

    return ReviewSubmitResponse(
        confirmed=confirmed,
        discussed=discussed,
        gaps_answered=gaps_answered,
        readiness_score=readiness_score,
    )
