import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.document import Document
from app.models.extraction import Requirement, Constraint, Stakeholder, Contradiction, Gap
from app.models.control import ReadinessHistory
from app.models.operational import ActivityLog
from app.schemas.dashboard import DashboardResponse, ReadinessResponse, ReadinessComponent

router = APIRouter(prefix="/api/projects/{project_id}", tags=["dashboard"])


def _status_band(score: float) -> str:
    return "ready" if score >= 85 else "conditional" if score >= 65 else "not_ready"


def _readiness_from_row(row: ReadinessHistory | None) -> ReadinessResponse:
    if not row:
        return ReadinessResponse(score=0, status="not_ready", components={})

    breakdown = row.breakdown or {}
    components_raw = breakdown.get("components", {}) if isinstance(breakdown, dict) else {}

    # Breakdown is stored as {name: {score, weight}} by the evaluator; the
    # response shape wants {name: ReadinessComponent}. Anything missing
    # (older history rows from before S2.6) gets a neutral default so the
    # frontend can render without null-checking every component.
    components: dict[str, ReadinessComponent] = {}
    for name in ("coverage", "clarity", "alignment", "context"):
        raw = components_raw.get(name) or {}
        components[name] = ReadinessComponent(
            score=float(raw.get("score", 0.0)),
            label=name.capitalize(),
            summary=raw.get("summary", ""),
            details=raw.get("details", {}) or {},
        )

    return ReadinessResponse(
        score=row.score,
        status=_status_band(row.score),
        components=components,
    )


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    readiness_row = await db.scalar(
        select(ReadinessHistory)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )
    readiness = _readiness_from_row(readiness_row)

    req_count = await db.scalar(select(func.count()).where(Requirement.project_id == project_id)) or 0
    req_confirmed = await db.scalar(
        select(func.count()).where(Requirement.project_id == project_id, Requirement.status == "confirmed")
    ) or 0
    con_count = await db.scalar(select(func.count()).where(Constraint.project_id == project_id)) or 0
    stk_count = await db.scalar(select(func.count()).where(Stakeholder.project_id == project_id)) or 0
    gaps_open = await db.scalar(
        select(func.count()).where(Gap.project_id == project_id, Gap.status == "open")
    ) or 0
    contradictions = await db.scalar(
        select(func.count()).where(Contradiction.project_id == project_id, Contradiction.resolved == False)  # noqa: E712
    ) or 0
    doc_count = await db.scalar(select(func.count()).where(Document.project_id == project_id)) or 0
    doc_processing = await db.scalar(
        select(func.count()).where(
            Document.project_id == project_id,
            Document.pipeline_stage.notin_(["completed", "failed", "queued"]),
        )
    ) or 0

    activity_result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(10)
    )
    activities = activity_result.scalars().all()
    recent = [
        {"action": a.action, "summary": a.summary,
         "created_at": a.created_at.isoformat() if a.created_at else None}
        for a in activities
    ]

    return DashboardResponse(
        readiness=readiness,
        requirements_count=req_count,
        requirements_confirmed=req_confirmed,
        constraints_count=con_count,
        stakeholders_count=stk_count,
        gaps_open=gaps_open,
        contradictions_unresolved=contradictions,
        documents_count=doc_count,
        documents_processing=doc_processing,
        recent_activity=recent,
    )


@router.get("/readiness")
async def get_readiness(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ReadinessHistory)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if not row:
        return {"score": 0, "status": "not_ready", "breakdown": {}}
    return {
        "score": row.score,
        "status": _status_band(row.score),
        "breakdown": row.breakdown or {},
        "triggered_by": row.triggered_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/readiness/history")
async def get_readiness_history(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ReadinessHistory)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.asc())
    )
    rows = result.scalars().all()
    return {
        "history": [
            {"score": r.score, "breakdown": r.breakdown,
             "triggered_by": r.triggered_by,
             "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows
        ]
    }


@router.get("/readiness/trajectory")
async def get_readiness_trajectory(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get readiness trajectory — velocity, ETA to 85%, trend."""
    from app.services.evaluator import compute_trajectory

    result = await db.execute(
        select(ReadinessHistory)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.asc())
    )
    rows = result.scalars().all()
    history = [
        {"score": r.score, "created_at": r.created_at.isoformat() if r.created_at else None}
        for r in rows
    ]
    return compute_trajectory(history)


@router.get("/digests")
async def list_digests(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get recent digests."""
    from app.models.operational import Digest
    result = await db.execute(
        select(Digest)
        .where(Digest.project_id == project_id)
        .order_by(Digest.created_at.desc())
        .limit(7)
    )
    return {"digests": [
        {"id": str(d.id), "type": d.digest_type, "data": d.data, "created_at": d.created_at.isoformat()}
        for d in result.scalars().all()
    ]}


@router.get("/digests/latest")
async def get_latest_digest(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recent digest."""
    from app.models.operational import Digest
    result = await db.execute(
        select(Digest)
        .where(Digest.project_id == project_id)
        .order_by(Digest.created_at.desc())
        .limit(1)
    )
    d = result.scalar_one_or_none()
    if not d:
        return {"digest": None}
    return {"digest": {"id": str(d.id), "type": d.digest_type, "data": d.data, "created_at": d.created_at.isoformat()}}


@router.post("/digests/generate")
async def trigger_digest(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
):
    """Manually generate a digest."""
    from app.pipeline.digest import generate_digest
    data = await generate_digest(project_id)
    return {"status": "generated", "data": data}


@router.get("/notifications")
async def list_notifications(
    project_id: uuid.UUID,
    limit: int = 6,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get notifications for current user — paginated.

    Defaults to 6 most recent for the dropdown's collapsed view; the UI
    fetches more on demand via the "Load more" button by bumping `offset`.
    """
    from app.models.operational import Notification

    total_result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.project_id == project_id,
            Notification.user_id == user.id,
        )
    )
    total = total_result.scalar() or 0

    capped_limit = max(1, min(limit, 100))

    result = await db.execute(
        select(Notification)
        .where(Notification.project_id == project_id, Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .offset(max(0, offset))
        .limit(capped_limit)
    )
    return {
        "notifications": [
            {
                "id": str(n.id), "type": n.type, "title": n.title, "body": n.body,
                "read": n.read, "data": n.data,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in result.scalars().all()
        ],
        "total": total,
        "offset": offset,
        "limit": capped_limit,
    }


@router.get("/notifications/count")
async def notification_count(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.operational import Notification
    count = await db.scalar(
        select(func.count()).where(
            Notification.project_id == project_id,
            Notification.user_id == user.id,
            Notification.read == False,  # noqa: E712
        )
    ) or 0
    return {"count": count}


@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    project_id: uuid.UUID,
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.operational import Notification
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.project_id == project_id,
            Notification.user_id == user.id,
        )
    )
    n = result.scalar_one_or_none()
    if n:
        n.read = True
        await db.flush()
    return {"status": "ok"}


@router.post("/gaps")
async def trigger_gap_analysis(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger gap analysis via Claude Code with the discovery-gap-agent."""
    from app.agent.claude_runner import claude_runner

    result_text = ""
    async for event in claude_runner.run_stream(
        project_id=project_id,
        user_id=user.id,
        message="Run a full gap analysis on all control points. Classify each gap as AUTO-RESOLVE, ASK-CLIENT, or ASK-PO.",
        agent="discovery-gap-agent",
    ):
        if event["type"] == "text":
            result_text += event["content"]
        elif event["type"] == "result":
            result_text = event.get("content", result_text)
        elif event["type"] == "error":
            return {"status": "error", "message": event["content"]}

    return {"status": "completed", "analysis": result_text}
