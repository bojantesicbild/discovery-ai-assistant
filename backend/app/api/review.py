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
from typing import Any

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
from app.models.review import ReviewToken, ReviewSubmission, ProposedUpdate
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


async def _generate_proposals(
    db: AsyncSession,
    project_id: uuid.UUID,
    round_number: int,
    answered_gaps: list[tuple[Gap, str]],
) -> int:
    """For each (answered_gap, gap_answer), walk gap.blocked_reqs and stage a
    ProposedUpdate per requirement. The LLM is best-effort — on failure we
    fall back to a raw-answer proposal so the PM still gets the signal.

    Returns the number of proposals created. Commits on completion."""
    from app.services.proposal_agent import propose_req_update, fallback_patch

    created = 0
    for gap, answer in answered_gaps:
        blocked_ids = list(gap.blocked_reqs or [])
        if not blocked_ids:
            continue
        reqs_result = await db.execute(
            select(Requirement).where(
                Requirement.project_id == project_id,
                Requirement.req_id.in_(blocked_ids),
            )
        )
        for req in reqs_result.scalars().all():
            try:
                patch = await propose_req_update(gap.question, answer, req)
            except Exception as e:
                log.warning("LLM proposal failed, using fallback", gap=gap.gap_id, req=req.req_id, error=str(e))
                patch = fallback_patch(answer)

            # Snapshot the current field value for the PM's diff view
            current = getattr(req, patch.field, None)
            # JSONB accepts dict/list/str; normalize to a JSON-serialisable value
            proposed_value = patch.new_value if isinstance(patch.new_value, (str, list)) else str(patch.new_value)

            db.add(ProposedUpdate(
                project_id=project_id,
                source_gap_id=gap.gap_id,
                target_req_id=req.req_id,
                proposed_field=patch.field,
                proposed_value=proposed_value,
                current_value=current,
                rationale=patch.rationale,
                client_answer=answer,
                review_round=round_number,
                status="pending",
            ))
            created += 1

    if created:
        await db.commit()
    return created


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


@router.get("/api/projects/{project_id}/proposed-updates")
async def list_proposed_updates(
    project_id: uuid.UUID,
    status: str = "pending",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List staged proposals for this project. Default filter = pending."""
    q = select(ProposedUpdate).where(ProposedUpdate.project_id == project_id)
    if status and status != "all":
        q = q.where(ProposedUpdate.status == status)
    q = q.order_by(ProposedUpdate.created_at.desc())
    result = await db.execute(q)
    proposals = result.scalars().all()

    # Enrich with gap question + target req title for the UI
    gap_ids = list({p.source_gap_id for p in proposals})
    req_ids = list({p.target_req_id for p in proposals})
    gap_map: dict[str, Gap] = {}
    req_map: dict[str, Requirement] = {}
    if gap_ids:
        gr = await db.execute(select(Gap).where(Gap.project_id == project_id, Gap.gap_id.in_(gap_ids)))
        for g in gr.scalars().all():
            gap_map[g.gap_id] = g
    if req_ids:
        rr = await db.execute(select(Requirement).where(Requirement.project_id == project_id, Requirement.req_id.in_(req_ids)))
        for r in rr.scalars().all():
            req_map[r.req_id] = r

    items = []
    for p in proposals:
        g = gap_map.get(p.source_gap_id)
        r = req_map.get(p.target_req_id)
        items.append({
            "id": str(p.id),
            "source_gap_id": p.source_gap_id,
            "gap_question": g.question if g else None,
            "target_req_id": p.target_req_id,
            "req_title": r.title if r else None,
            "proposed_field": p.proposed_field,
            "proposed_value": p.proposed_value,
            "current_value": p.current_value,
            "rationale": p.rationale,
            "client_answer": p.client_answer,
            "review_round": p.review_round,
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "reviewed_at": p.reviewed_at.isoformat() if p.reviewed_at else None,
        })
    return {"items": items, "total": len(items)}


class ProposalDecision(BaseModel):
    override_value: Any | None = None


def _apply_patch(req: Requirement, field: str, new_value: Any) -> None:
    """Apply a proposed patch to a Requirement.
    - description: replace the whole string
    - acceptance_criteria / business_rules: append new items (dedup)
    """
    if field == "description":
        req.description = str(new_value)
    elif field in ("acceptance_criteria", "business_rules"):
        existing = list(getattr(req, field) or [])
        additions = new_value if isinstance(new_value, list) else [new_value]
        for item in additions:
            if isinstance(item, str) and item.strip() and item not in existing:
                existing.append(item)
        setattr(req, field, existing)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown field: {field}")


@router.post("/api/projects/{project_id}/proposed-updates/{proposal_id}/accept")
async def accept_proposal(
    project_id: uuid.UUID,
    proposal_id: uuid.UUID,
    body: ProposalDecision = ProposalDecision(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply the proposed patch to the target requirement and mark accepted."""
    p = await db.get(ProposedUpdate, proposal_id)
    if not p or p.project_id != project_id:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if p.status != "pending":
        raise HTTPException(status_code=409, detail=f"Proposal already {p.status}")

    req_result = await db.execute(
        select(Requirement).where(
            Requirement.project_id == project_id,
            Requirement.req_id == p.target_req_id,
        )
    )
    req = req_result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Target requirement not found")

    value_to_apply = body.override_value if body.override_value is not None else p.proposed_value
    _apply_patch(req, p.proposed_field, value_to_apply)

    p.status = "edited" if body.override_value is not None else "accepted"
    p.reviewed_at = datetime.now(timezone.utc)
    p.reviewed_by = user.id

    db.add(ActivityLog(
        project_id=project_id,
        user_id=user.id,
        action="proposal_accepted",
        summary=f"Applied client-driven update to {req.req_id} ({p.proposed_field}) — from {p.source_gap_id}",
        details={"proposal_id": str(p.id), "req_id": req.req_id, "field": p.proposed_field, "edited": body.override_value is not None},
    ))

    await db.commit()
    return {"id": str(p.id), "status": p.status, "req_id": req.req_id}


@router.post("/api/projects/{project_id}/proposed-updates/{proposal_id}/reject")
async def reject_proposal(
    project_id: uuid.UUID,
    proposal_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark proposal rejected. Does not modify the target requirement."""
    p = await db.get(ProposedUpdate, proposal_id)
    if not p or p.project_id != project_id:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if p.status != "pending":
        raise HTTPException(status_code=409, detail=f"Proposal already {p.status}")

    p.status = "rejected"
    p.reviewed_at = datetime.now(timezone.utc)
    p.reviewed_by = user.id

    db.add(ActivityLog(
        project_id=project_id,
        user_id=user.id,
        action="proposal_rejected",
        summary=f"Rejected proposed update to {p.target_req_id} from {p.source_gap_id}",
        details={"proposal_id": str(p.id), "req_id": p.target_req_id, "field": p.proposed_field},
    ))

    await db.commit()
    return {"id": str(p.id), "status": p.status}


@router.get("/api/projects/{project_id}/client-feedback")
async def get_client_feedback(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-item aggregated client feedback across all review submissions.

    Walks submissions newest-first and returns, for each req_id / gap_id,
    the latest non-skip action with round_number, submitted_at, client_name.
    Used to overlay client-feedback badges on the discovery view."""
    result = await db.execute(
        select(ReviewSubmission, ReviewToken)
        .join(ReviewToken, ReviewSubmission.review_token_id == ReviewToken.id)
        .where(ReviewSubmission.project_id == project_id)
        .order_by(ReviewSubmission.created_at.desc())
    )
    rows = result.all()

    reqs: dict[str, dict] = {}
    gaps: dict[str, dict] = {}

    for sub, rt in rows:
        submitted_at = sub.created_at.isoformat() if sub.created_at else None
        for a in (sub.requirement_actions or []):
            req_id = a.get("req_id")
            action = a.get("action")
            if not req_id or action == "skip" or req_id in reqs:
                continue
            reqs[req_id] = {
                "action": action,
                "note": a.get("note"),
                "round": rt.round_number,
                "submitted_at": submitted_at,
                "client_name": rt.client_name,
            }
        for a in (sub.gap_actions or []):
            gap_id = a.get("gap_id")
            action = a.get("action")
            if not gap_id or action == "skip" or gap_id in gaps:
                continue
            gaps[gap_id] = {
                "action": action,
                "answer": a.get("answer"),
                "round": rt.round_number,
                "submitted_at": submitted_at,
                "client_name": rt.client_name,
            }

    return {"requirements": reqs, "gaps": gaps}


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
    # Join the source document to expose its filename without leaking the ID.
    from app.models.document import Document
    reqs_result = await db.execute(
        select(Requirement, Document.filename)
        .outerjoin(Document, Requirement.source_doc_id == Document.id)
        .where(
            Requirement.project_id == rt.project_id,
            Requirement.status.in_(["proposed", "discussed"]),
        )
        .order_by(Requirement.req_id)
    )
    reqs_rows = reqs_result.all()

    # Group by priority
    grouped: dict[str, list[ClientRequirementView]] = {"must": [], "should": [], "could": [], "wont": []}
    for r, doc_name in reqs_rows:
        view = ClientRequirementView(
            req_id=r.req_id,
            title=r.title,
            priority=r.priority,
            description=r.description or "",
            user_perspective=r.user_perspective,
            business_rules=r.business_rules or [],
            acceptance_criteria=r.acceptance_criteria or [],
            edge_cases=r.edge_cases or [],
            source_quote=r.source_quote,
            source_doc=doc_name,
            status=r.status,
        )
        bucket = grouped.get(r.priority, grouped.get("should"))
        if bucket is not None:
            bucket.append(view)

    # Load open gaps
    gaps_result = await db.execute(
        select(Gap, Document.filename)
        .outerjoin(Document, Gap.source_doc_id == Document.id)
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
            source_quote=g.source_quote,
            source_doc=doc_name,
        )
        for g, doc_name in gaps_result.all()
    ]

    return ClientReviewData(
        project_name=project.name,
        client_name=rt.client_name,
        round_number=rt.round_number,
        already_submitted=rt.submitted_at is not None,
        requirements=grouped,
        gaps=gaps,
    )


@router.get("/api/review/{token}/handoff")
async def list_review_handoff_docs(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: list handoff docs available to the client for this
    review. Only returns docs that have been generated (non-empty). Uses
    the same DOC_FILE_MAP as the PM-facing generate API."""
    rt = await _validate_token(token, db)
    from app.api.generate import DOC_FILE_MAP
    from app.agent.claude_runner import claude_runner

    project_dir = claude_runner.get_project_dir(rt.project_id)
    discovery_dir = project_dir / ".memory-bank" / "docs" / "discovery"

    docs = []
    for doc_type, filename in DOC_FILE_MAP.items():
        filepath = discovery_dir / filename
        if filepath.exists() and filepath.stat().st_size > 100:
            docs.append({
                "type": doc_type,
                "label": doc_type.replace("_", " ").title(),
                "size": filepath.stat().st_size,
            })
    return {"docs": docs}


@router.get("/api/review/{token}/handoff/{doc_type}")
async def get_review_handoff_doc(
    token: str,
    doc_type: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: return the markdown content of a handoff doc for
    this review. Token-gated — no authentication required."""
    rt = await _validate_token(token, db)
    from app.api.generate import DOC_FILE_MAP
    from app.agent.claude_runner import claude_runner

    if doc_type not in DOC_FILE_MAP:
        raise HTTPException(status_code=404, detail="Document type not available.")

    project_dir = claude_runner.get_project_dir(rt.project_id)
    filepath = project_dir / ".memory-bank" / "docs" / "discovery" / DOC_FILE_MAP[doc_type]

    if not filepath.exists():
        return {"type": doc_type, "content": None, "generated": False}

    content = filepath.read_text(encoding="utf-8")
    return {
        "type": doc_type,
        "label": doc_type.replace("_", " ").title(),
        "content": content,
        "generated": True,
        "format": "markdown",
    }


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
            req.source_person = rt.client_name or req.source_person or "client"
            confirmed += 1
        elif action.action == "discuss":
            req.status = "discussed"
            discussed += 1

    # Apply gap actions — track answered gaps so we can generate proposals
    # after the main commit.
    answered_gaps: list[tuple[Gap, str]] = []  # (gap, answer)
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
        attribution = f"Client review round {rt.round_number}"
        if rt.client_name:
            attribution += f" ({rt.client_name})"
        gap.resolution = f"{action.answer}\n\n— Answered via {attribution}"
        gaps_answered += 1
        answered_gaps.append((gap, action.answer))

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

    # Stage agent-generated update proposals for each answered gap.
    # Best-effort — proposal failures must not affect the submit response.
    if answered_gaps:
        try:
            proposals_created = await _generate_proposals(
                db, rt.project_id, rt.round_number, answered_gaps
            )
            if proposals_created:
                log.info("Staged update proposals", project=str(rt.project_id)[:8], count=proposals_created)
        except Exception as e:
            log.warning("Proposal generation failed — continuing", error=str(e))

    # Re-evaluate readiness after the status changes
    readiness_score = None
    try:
        from app.services.evaluator import evaluator
        readiness = await evaluator.evaluate(rt.project_id, db, triggered_by=f"client_review:round_{rt.round_number}")
        readiness_score = readiness.get("score")
    except Exception as e:
        log.warning("Readiness re-evaluation failed after review", error=str(e))

    # Post system message in the chat (same pattern as document_ingested)
    try:
        from app.services.conversation_store import append_system_message
        client_label = rt.client_name or "Client"
        notice = (
            f"{client_label} submitted review round {rt.round_number}: "
            f"{confirmed} confirmed, {discussed} flagged, {gaps_answered} gaps answered"
        )
        if readiness_score is not None:
            notice += f" — readiness now {readiness_score}%"
        await append_system_message(
            db, rt.project_id, notice,
            kind="client_review_submitted",
            data={
                "round": rt.round_number,
                "client_name": rt.client_name,
                "confirmed": confirmed,
                "discussed": discussed,
                "gaps_answered": gaps_answered,
                "readiness": readiness_score,
                "submission_id": str(submission.id),
            },
        )
    except Exception as e:
        log.warning("Failed to post review chat message", error=str(e))

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
