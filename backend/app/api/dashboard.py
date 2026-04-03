import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.document import Document
from app.models.extraction import Requirement, Constraint, Decision, Stakeholder, Assumption, ScopeItem, Contradiction
from app.models.control import ReadinessHistory
from app.models.operational import ActivityLog
from app.schemas.dashboard import DashboardResponse, ReadinessResponse, ReadinessBreakdown

router = APIRouter(prefix="/api/projects/{project_id}", tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Readiness
    readiness_row = await db.scalar(
        select(ReadinessHistory)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )

    if readiness_row:
        breakdown = readiness_row.breakdown or {}
        score = readiness_row.score
    else:
        breakdown = {}
        score = 0

    status = "ready" if score >= 85 else "conditional" if score >= 65 else "not_ready"
    readiness = ReadinessResponse(
        score=score,
        status=status,
        breakdown=ReadinessBreakdown(**breakdown) if breakdown else ReadinessBreakdown(),
    )

    # Counts
    req_count = await db.scalar(select(func.count()).where(Requirement.project_id == project_id)) or 0
    req_confirmed = await db.scalar(
        select(func.count()).where(Requirement.project_id == project_id, Requirement.status == "confirmed")
    ) or 0
    con_count = await db.scalar(select(func.count()).where(Constraint.project_id == project_id)) or 0
    dec_count = await db.scalar(select(func.count()).where(Decision.project_id == project_id)) or 0
    stk_count = await db.scalar(select(func.count()).where(Stakeholder.project_id == project_id)) or 0
    asm_count = await db.scalar(select(func.count()).where(Assumption.project_id == project_id)) or 0
    asm_validated = await db.scalar(
        select(func.count()).where(Assumption.project_id == project_id, Assumption.validated == True)
    ) or 0
    scope_in = await db.scalar(
        select(func.count()).where(ScopeItem.project_id == project_id, ScopeItem.in_scope == True)
    ) or 0
    scope_out = await db.scalar(
        select(func.count()).where(ScopeItem.project_id == project_id, ScopeItem.in_scope == False)
    ) or 0
    contradictions = await db.scalar(
        select(func.count()).where(Contradiction.project_id == project_id, Contradiction.resolved == False)
    ) or 0
    doc_count = await db.scalar(select(func.count()).where(Document.project_id == project_id)) or 0
    doc_processing = await db.scalar(
        select(func.count()).where(
            Document.project_id == project_id,
            Document.pipeline_stage.notin_(["completed", "failed", "queued"]),
        )
    ) or 0

    # Recent activity
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
        decisions_count=dec_count,
        stakeholders_count=stk_count,
        assumptions_count=asm_count,
        assumptions_validated=asm_validated,
        scope_in=scope_in,
        scope_out=scope_out,
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
        "status": "ready" if row.score >= 85 else "conditional" if row.score >= 65 else "not_ready",
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
