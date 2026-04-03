"""API endpoints for all 6 typed extraction tables."""

import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.extraction import (
    Requirement, Constraint, Decision, Stakeholder,
    Assumption, ScopeItem, Contradiction,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["extracted-items"])


# ── Requirements ──────────────────────────────────────

@router.get("/requirements")
async def list_requirements(
    project_id: uuid.UUID,
    priority: Optional[str] = Query(None, description="must, should, could, wont"),
    status: Optional[str] = Query(None, description="proposed, discussed, confirmed, changed, dropped"),
    type: Optional[str] = Query(None, description="functional, non_functional"),
    search: Optional[str] = Query(None, description="Search in title and description"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Requirement).where(Requirement.project_id == project_id)
    if priority:
        query = query.where(Requirement.priority == priority)
    if status:
        query = query.where(Requirement.status == status)
    if type:
        query = query.where(Requirement.type == type)
    if search:
        query = query.where(
            Requirement.title.ilike(f"%{search}%") | Requirement.description.ilike(f"%{search}%")
        )
    query = query.order_by(Requirement.req_id)
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [_req_dict(r) for r in items], "total": len(items)}


@router.get("/requirements/{req_id}")
async def get_requirement(
    project_id: uuid.UUID,
    req_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Requirement).where(Requirement.project_id == project_id, Requirement.req_id == req_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        return {"error": "Not found"}
    return _req_dict(item)


@router.patch("/requirements/{req_id}")
async def update_requirement(
    project_id: uuid.UUID,
    req_id: str,
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Requirement).where(Requirement.project_id == project_id, Requirement.req_id == req_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        return {"error": "Not found"}

    old_status = item.status
    old_priority = item.priority

    if status and status in ("proposed", "discussed", "confirmed", "changed", "dropped"):
        item.status = status
    if priority and priority in ("must", "should", "could", "wont"):
        item.priority = priority

    await db.flush()

    # Log activity
    from app.models.operational import ActivityLog
    changes = []
    if status and status != old_status:
        changes.append(f"status: {old_status} → {status}")
    if priority and priority != old_priority:
        changes.append(f"priority: {old_priority} → {priority}")

    if changes:
        db.add(ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="requirement_updated",
            summary=f"Updated {req_id}: {', '.join(changes)}",
            details={"req_id": req_id, "changes": changes},
        ))

    # Re-evaluate readiness
    from app.services.evaluator import evaluator
    await evaluator.evaluate(project_id, db, triggered_by=f"user:{user.id}")

    return _req_dict(item)


@router.patch("/assumptions/{assumption_id}/validate")
async def validate_assumption(
    project_id: uuid.UUID,
    assumption_id: uuid.UUID,
    validated: bool = Query(True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Assumption).where(Assumption.id == assumption_id, Assumption.project_id == project_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        return {"error": "Not found"}
    item.validated = validated
    await db.flush()

    from app.services.evaluator import evaluator
    await evaluator.evaluate(project_id, db, triggered_by=f"user:{user.id}")
    return {"id": str(item.id), "validated": item.validated}


@router.patch("/contradictions/{contradiction_id}/resolve")
async def resolve_contradiction(
    project_id: uuid.UUID,
    contradiction_id: uuid.UUID,
    resolution_note: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contradiction).where(Contradiction.id == contradiction_id, Contradiction.project_id == project_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        return {"error": "Not found"}
    item.resolved = True
    item.resolution_note = resolution_note
    await db.flush()
    return {"id": str(item.id), "resolved": True}


def _req_dict(r: Requirement) -> dict:
    return {
        "id": str(r.id), "req_id": r.req_id, "title": r.title,
        "type": r.type, "priority": r.priority, "description": r.description,
        "user_perspective": r.user_perspective, "business_rules": r.business_rules,
        "edge_cases": r.edge_cases, "source_quote": r.source_quote,
        "status": r.status, "confidence": r.confidence,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Constraints ───────────────────────────────────────

@router.get("/constraints")
async def list_constraints(
    project_id: uuid.UUID,
    type: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Constraint).where(Constraint.project_id == project_id)
    if type:
        query = query.where(Constraint.type == type)
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [{"id": str(c.id), "type": c.type, "description": c.description,
                        "impact": c.impact, "status": c.status, "source_quote": c.source_quote}
                       for c in items], "total": len(items)}


# ── Decisions ─────────────────────────────────────────

@router.get("/decisions")
async def list_decisions(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Decision).where(Decision.project_id == project_id).order_by(Decision.created_at.desc())
    )
    items = result.scalars().all()
    return {"items": [{"id": str(d.id), "title": d.title, "decided_by": d.decided_by,
                        "date": str(d.decided_date) if d.decided_date else None,
                        "rationale": d.rationale, "alternatives": d.alternatives,
                        "impacts": d.impacts, "status": d.status}
                       for d in items], "total": len(items)}


# ── Stakeholders ──────────────────────────────────────

@router.get("/stakeholders")
async def list_stakeholders(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Stakeholder).where(Stakeholder.project_id == project_id)
    )
    items = result.scalars().all()
    return {"items": [{"id": str(s.id), "name": s.name, "role": s.role,
                        "organization": s.organization,
                        "decision_authority": s.decision_authority,
                        "interests": s.interests}
                       for s in items], "total": len(items)}


# ── Assumptions ───────────────────────────────────────

@router.get("/assumptions")
async def list_assumptions(
    project_id: uuid.UUID,
    validated: Optional[bool] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Assumption).where(Assumption.project_id == project_id)
    if validated is not None:
        query = query.where(Assumption.validated == validated)
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [{"id": str(a.id), "statement": a.statement, "basis": a.basis,
                        "risk_if_wrong": a.risk_if_wrong,
                        "needs_validation_by": a.needs_validation_by,
                        "validated": a.validated}
                       for a in items], "total": len(items)}


# ── Scope Items ───────────────────────────────────────

@router.get("/scope")
async def list_scope_items(
    project_id: uuid.UUID,
    in_scope: Optional[bool] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(ScopeItem).where(ScopeItem.project_id == project_id)
    if in_scope is not None:
        query = query.where(ScopeItem.in_scope == in_scope)
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [{"id": str(s.id), "description": s.description,
                        "in_scope": s.in_scope, "rationale": s.rationale}
                       for s in items], "total": len(items)}


# ── Contradictions ────────────────────────────────────

@router.get("/contradictions")
async def list_contradictions(
    project_id: uuid.UUID,
    resolved: Optional[bool] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Contradiction).where(Contradiction.project_id == project_id)
    if resolved is not None:
        query = query.where(Contradiction.resolved == resolved)
    result = await db.execute(query)
    items = result.scalars().all()
    return {"items": [{"id": str(c.id), "item_a_type": c.item_a_type,
                        "item_b_type": c.item_b_type,
                        "explanation": c.explanation,
                        "resolved": c.resolved,
                        "resolution_note": c.resolution_note}
                       for c in items], "total": len(items)}


# ── Search across all types ──────────────────────────

@router.get("/search")
async def search_all(
    project_id: uuid.UUID,
    q: str = Query(..., min_length=2),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search across all extracted data types."""
    results = []
    pattern = f"%{q}%"

    # Requirements
    reqs = await db.execute(
        select(Requirement).where(
            Requirement.project_id == project_id,
            (Requirement.title.ilike(pattern) | Requirement.description.ilike(pattern)),
        ).limit(10)
    )
    for r in reqs.scalars():
        results.append({"type": "requirement", "id": r.req_id, "title": r.title, "priority": r.priority, "status": r.status})

    # Constraints
    cons = await db.execute(
        select(Constraint).where(
            Constraint.project_id == project_id,
            Constraint.description.ilike(pattern),
        ).limit(5)
    )
    for c in cons.scalars():
        results.append({"type": "constraint", "id": str(c.id)[:8], "title": f"{c.type}: {c.description[:50]}", "status": c.status})

    # Decisions
    decs = await db.execute(
        select(Decision).where(
            Decision.project_id == project_id,
            (Decision.title.ilike(pattern) | Decision.rationale.ilike(pattern)),
        ).limit(5)
    )
    for d in decs.scalars():
        results.append({"type": "decision", "id": str(d.id)[:8], "title": d.title, "status": d.status})

    # Stakeholders
    stks = await db.execute(
        select(Stakeholder).where(
            Stakeholder.project_id == project_id,
            (Stakeholder.name.ilike(pattern) | Stakeholder.role.ilike(pattern)),
        ).limit(5)
    )
    for s in stks.scalars():
        results.append({"type": "stakeholder", "id": str(s.id)[:8], "title": f"{s.name} ({s.role})", "status": s.decision_authority})

    return {"results": results, "total": len(results), "query": q}
