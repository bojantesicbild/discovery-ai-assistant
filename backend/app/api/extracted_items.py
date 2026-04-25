"""API endpoints for all 6 typed extraction tables."""

import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.extraction import (
    Requirement, Constraint, Stakeholder,
    Contradiction, Gap,
)
from app.models.document import Document
from app.services.finding_views import get_seen_map
from app.services.sessions import record_event_for_user

router = APIRouter(prefix="/api/projects/{project_id}", tags=["extracted-items"])

import structlog
log = structlog.get_logger()


async def _attach_seen(
    items: list[dict],
    db: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    finding_type: str,
) -> list[dict]:
    """Enrich each item dict with a `seen_at` field from the user's
    finding_views map. Items whose `id` isn't in the map get `seen_at: None`
    (i.e. unread). Mutates and returns the list."""
    if not items:
        return items
    seen_map = await get_seen_map(db, user_id, project_id, finding_type)
    for item in items:
        item_id = item.get("id")
        if not item_id:
            item["seen_at"] = None
            continue
        try:
            uid = uuid.UUID(item_id)
        except (ValueError, TypeError):
            item["seen_at"] = None
            continue
        seen = seen_map.get(uid)
        item["seen_at"] = seen.isoformat() if seen else None
    return items

async def _sync_markdown(project_id: uuid.UUID, db):
    """Re-export all data to markdown files after any write operation.

    Exception handling is deliberately narrow: we catch **transient I/O and
    database errors** (disk full, permission denied, DB connection blip) so
    the user's API request still succeeds when infra blips — but we let
    **programming errors** (NameError, TypeError, AttributeError, ImportError)
    bubble up. A broad `except Exception` used to swallow the latter silently;
    a renamed function whose call site wasn't updated shipped for weeks as a
    "non-fatal" warning, with the vault silently drifting from the DB. Don't
    repeat that.
    """
    from sqlalchemy.exc import OperationalError, DBAPIError
    try:
        from app.pipeline.tasks import _stage_export_markdown
        # Get any doc to pass (needed for function signature but not used for data)
        result = await db.execute(select(Document).where(Document.project_id == project_id).limit(1))
        doc = result.scalar_one_or_none()
        if doc:
            await _stage_export_markdown(db, project_id, doc)
    except (OSError, OperationalError, DBAPIError) as e:
        # Transient infra failure — disk / network / DB. User's write
        # succeeded; the vault export can be re-run later.
        log.warning("Markdown sync failed (transient, non-fatal)", error=str(e))


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
    query = (
        select(Requirement, Document.filename)
        .outerjoin(Document, Requirement.source_doc_id == Document.id)
        .where(Requirement.project_id == project_id)
    )
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
    rows = result.all()
    items = [_req_dict(r, doc_name) for r, doc_name in rows]
    await _attach_seen(items, db, user.id, project_id, "requirement")
    return {"items": items, "total": len(rows)}


@router.get("/requirements/{req_id}")
async def get_requirement(
    project_id: uuid.UUID,
    req_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Requirement, Document.filename)
        .outerjoin(Document, Requirement.source_doc_id == Document.id)
        .where(Requirement.project_id == project_id, Requirement.req_id == req_id)
    )
    row = result.one_or_none()
    if not row:
        return {"error": "Not found"}
    return _req_dict(row[0], row[1])


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

    # Sync markdown files
    await _sync_markdown(project_id, db)

    return _req_dict(item)


# ── Gaps ──────────────────────────────────────────────

@router.get("/gaps")
async def list_gaps(
    project_id: uuid.UUID,
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Gap, Document.filename)
        .outerjoin(Document, Gap.source_doc_id == Document.id)
        .where(Gap.project_id == project_id)
    )
    if status:
        query = query.where(Gap.status == status)
    query = query.order_by(Gap.gap_id)
    result = await db.execute(query)
    rows = result.all()
    items = [{
        "id": str(g.id),
        "gap_id": g.gap_id,
        "question": g.question,
        "kind": getattr(g, "kind", None) or "missing_info",
        "severity": g.severity,
        "area": g.area,
        "source_doc": doc_name,
        "source_doc_id": str(g.source_doc_id) if g.source_doc_id else None,
        "source_quote": g.source_quote,
        "source_person": g.source_person,
        "blocked_reqs": g.blocked_reqs or [],
        "sources": g.sources or [],
        "suggested_action": g.suggested_action,
        # Migration 038 — descriptive context fields. Each fills a gap
        # the structural fields can't answer on their own.
        "impact_summary": getattr(g, "impact_summary", None),
        "validation_plan": getattr(g, "validation_plan", None) or [],
        "assumed_default": getattr(g, "assumed_default", None),
        "options": getattr(g, "options", None) or [],
        "status": g.status,
        "resolution": g.resolution,
        "closed_at": g.closed_at.isoformat() if g.closed_at else None,
        "closed_by": g.closed_by,
        "assignee": g.assignee,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    } for g, doc_name in rows]
    await _attach_seen(items, db, user.id, project_id, "gap")
    return {"items": items, "total": len(rows)}


@router.patch("/gaps/{gap_id}/resolve")
async def resolve_gap(
    project_id: uuid.UUID,
    gap_id: str,
    resolution: str = Query(...),
    status: str = Query("resolved"),  # "resolved" | "dismissed" | "open" (for reopen)
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    result = await db.execute(
        select(Gap).where(Gap.project_id == project_id, Gap.gap_id == gap_id)
    )
    gap = result.scalar_one_or_none()
    if not gap:
        return {"error": "Not found"}
    # Validate status — allowed values are open/resolved/dismissed.
    # Empty resolution (via the reopen flow) signals to clear closure fields.
    if status not in ("resolved", "dismissed", "open"):
        status = "resolved"
    gap.status = status
    gap.resolution = resolution
    if status in ("resolved", "dismissed"):
        gap.closed_at = datetime.now(timezone.utc)
        gap.closed_by = user.email
    else:
        # Reopen: clear the closure stamp.
        gap.closed_at = None
        gap.closed_by = None
    await db.flush()

    event_type = "gap_resolved" if status == "resolved" else ("gap_dismissed" if status == "dismissed" else "gap_reopened")
    await record_event_for_user(
        db,
        project_id=project_id, user_id=user.id,
        event_type=event_type,
        payload={
            "gap_id": gap_id,
            "resolution": resolution,
            "closed_by": gap.closed_by,
        },
        artifact_updates={"gaps_touched": [gap_id]},
        domain="discovery",
    )

    await _sync_markdown(project_id, db)
    return {"id": str(gap.id), "status": gap.status, "closed_at": gap.closed_at.isoformat() if gap.closed_at else None}


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

    await record_event_for_user(
        db,
        project_id=project_id, user_id=user.id,
        event_type="contradiction_resolved",
        payload={
            "contradiction_id": str(item.id),
            "resolution_note": resolution_note,
            "title": item.title,
        },
        artifact_updates={"contradictions_resolved": [str(item.id)]},
        domain="discovery",
    )

    await _sync_markdown(project_id, db)
    return {"id": str(item.id), "resolved": True}


@router.post("/sync-markdown")
async def sync_markdown(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger markdown export sync."""
    await _sync_markdown(project_id, db)
    return {"status": "synced"}


def _req_dict(r: Requirement, source_doc_name: str = None) -> dict:
    return {
        "id": str(r.id), "req_id": r.req_id, "title": r.title,
        "type": r.type, "priority": r.priority, "description": r.description,
        "user_perspective": r.user_perspective, "business_rules": r.business_rules,
        "edge_cases": r.edge_cases,
        "acceptance_criteria": r.acceptance_criteria or [],
        # Session-2 fields: absorb decision/scope signals into BR.
        "rationale": r.rationale,
        "alternatives_considered": r.alternatives_considered or [],
        "scope_note": r.scope_note,
        "blocked_by": r.blocked_by or [],
        "source_doc": source_doc_name,
        "source_doc_id": str(r.source_doc_id) if r.source_doc_id else None,
        "source_quote": r.source_quote,
        "source_person": r.source_person,
        "sources": r.sources or [],
        "version": r.version or 1,
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
    query = (
        select(Constraint, Document.filename)
        .outerjoin(Document, Constraint.source_doc_id == Document.id)
        .where(Constraint.project_id == project_id)
    )
    if type:
        query = query.where(Constraint.type == type)
    # Stable order so the UI can assign CON-001, CON-002, … at render time
    # in a way that matches the markdown vault's sequence.
    query = query.order_by(Constraint.created_at, Constraint.id)
    result = await db.execute(query)
    rows = result.all()
    out = [{
        "id": str(c.id),
        "type": c.type,
        "description": c.description,
        "impact": c.impact,
        "status": c.status,
        "source_quote": c.source_quote,
        "source_person": c.source_person,
        "affects_reqs": c.affects_reqs or [],
        "workaround": c.workaround,
        "source_doc": doc_name,
        "source_doc_id": str(c.source_doc_id) if c.source_doc_id else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    } for c, doc_name in rows]
    await _attach_seen(out, db, user.id, project_id, "constraint")
    return {"items": out, "total": len(rows)}


@router.patch("/constraints/{constraint_id}/status")
async def update_constraint_status(
    project_id: uuid.UUID,
    constraint_id: uuid.UUID,
    status: str = Query(...),  # "confirmed" | "assumed" | "negotiable"
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if status not in ("confirmed", "assumed", "negotiable"):
        return {"error": f"Invalid status: {status}. Expected confirmed | assumed | negotiable."}
    result = await db.execute(
        select(Constraint).where(
            Constraint.project_id == project_id,
            Constraint.id == constraint_id,
        )
    )
    con = result.scalar_one_or_none()
    if not con:
        return {"error": "Not found"}
    con.status = status
    await db.flush()
    await _sync_markdown(project_id, db)
    return {"id": str(con.id), "status": con.status}


# ── Stakeholders ──────────────────────────────────────

@router.get("/stakeholders")
async def list_stakeholders(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Pull stakeholders + per-person finding counts in 5 grouped
    # queries so the People tab can render badges without N round-trips.
    # Counts are keyed by lower(name) since the same person can be
    # extracted from multiple documents under slightly different
    # capitalisations.
    from sqlalchemy import func

    stk_result = await db.execute(
        select(Stakeholder).where(Stakeholder.project_id == project_id)
    )
    items = stk_result.scalars().all()

    async def _counts_by_person(Model, person_col):
        rows = (await db.execute(
            select(func.lower(person_col), func.count())
            .where(Model.project_id == project_id, person_col.is_not(None))
            .group_by(func.lower(person_col))
        )).all()
        return {name: count for name, count in rows if name}

    req_counts = await _counts_by_person(Requirement, Requirement.source_person)
    gap_counts = await _counts_by_person(Gap, Gap.source_person)
    con_counts = await _counts_by_person(Constraint, Constraint.source_person)

    # Contradictions name people on either side — sum both.
    side_a = await _counts_by_person(Contradiction, Contradiction.side_a_person)
    side_b = await _counts_by_person(Contradiction, Contradiction.side_b_person)
    ctr_counts: dict[str, int] = {}
    for d in (side_a, side_b):
        for k, v in d.items():
            ctr_counts[k] = ctr_counts.get(k, 0) + v

    out = []
    for s in items:
        key = (s.name or "").lower()
        out.append({
            "id": str(s.id), "name": s.name,
            "role_title": getattr(s, "role_title", None),
            "role": s.role,
            "organization": s.organization,
            "decision_authority": s.decision_authority,
            "decisions": getattr(s, "decisions", None) or [],
            "interests": s.interests,
            "finding_counts": {
                "requirements": req_counts.get(key, 0),
                "gaps": gap_counts.get(key, 0),
                "constraints": con_counts.get(key, 0),
                "contradictions": ctr_counts.get(key, 0),
            },
        })
    await _attach_seen(out, db, user.id, project_id, "stakeholder")
    return {"items": out, "total": len(items)}


@router.get("/stakeholders/by-name/{name}")
async def get_stakeholder_by_name(
    project_id: uuid.UUID,
    name: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Look up a stakeholder by their display name and return them
    along with every finding that names them as source_person.

    Powers the right-pane Person detail view in the discovery panel.
    Findings are grouped by kind so the UI can render them in
    sections (Requirements / Gaps / Constraints / Contradictions).

    The name is matched case-insensitively. Returns 404 only when no
    stakeholder row AND no source_person matches exist — a "ghost"
    person referenced only on findings still resolves to a partial
    record with name + empty role/org."""
    # Multiple Stakeholder rows can share the same name when the same
    # person is extracted from several documents — pick the most
    # complete record (longest role+org+authority+interests) so the
    # detail header shows whatever the agent has gathered cumulatively.
    stk_rows = (await db.execute(
        select(Stakeholder).where(
            Stakeholder.project_id == project_id,
            Stakeholder.name.ilike(name),
        )
    )).scalars().all()
    def _completeness(s: Stakeholder) -> int:
        return sum(len(getattr(s, f, "") or "") for f in ("role", "organization", "decision_authority", "interests"))
    stk_row = max(stk_rows, key=_completeness) if stk_rows else None

    # Pull every finding kind that has a source_person column.
    reqs = (await db.execute(
        select(Requirement).where(
            Requirement.project_id == project_id,
            Requirement.source_person.ilike(name),
        ).order_by(Requirement.created_at)
    )).scalars().all()

    gaps = (await db.execute(
        select(Gap).where(
            Gap.project_id == project_id,
            Gap.source_person.ilike(name),
        ).order_by(Gap.created_at)
    )).scalars().all()

    cons = (await db.execute(
        select(Constraint).where(
            Constraint.project_id == project_id,
            Constraint.source_person.ilike(name),
        ).order_by(Constraint.created_at)
    )).scalars().all()

    # Contradictions name people on each side — count a hit on either.
    # Note: the DB columns are side_a_person / side_b_person; the API
    # serializer elsewhere renames them to item_a/b_person for legacy
    # frontend compat, but here we query the model directly.
    contras = (await db.execute(
        select(Contradiction).where(
            Contradiction.project_id == project_id,
            (Contradiction.side_a_person.ilike(name) | Contradiction.side_b_person.ilike(name)),
        ).order_by(Contradiction.created_at)
    )).scalars().all()

    if not stk_row and not (reqs or gaps or cons or contras):
        return {"stakeholder": None, "findings": {"requirements": [], "gaps": [], "constraints": [], "contradictions": []}}

    stakeholder = (
        {
            "id": str(stk_row.id),
            "name": stk_row.name,
            "role_title": getattr(stk_row, "role_title", None),
            "role": stk_row.role,
            "organization": stk_row.organization,
            "decision_authority": stk_row.decision_authority,
            "decisions": getattr(stk_row, "decisions", None) or [],
            "interests": stk_row.interests,
        }
        if stk_row else
        # Ghost stakeholder — referenced as source_person but never
        # extracted as a Stakeholder row. UI should still render
        # something so the deep-link works.
        {"id": None, "name": name, "role_title": None, "role": None,
         "organization": None, "decision_authority": None,
         "decisions": [], "interests": None}
    )

    # Same positional ordering used elsewhere for CON/CTR.
    all_cons = (await db.execute(
        select(Constraint.id).where(Constraint.project_id == project_id)
        .order_by(Constraint.created_at, Constraint.id)
    )).scalars().all()
    con_idx = {uid: i + 1 for i, uid in enumerate(all_cons)}

    all_ctrs = (await db.execute(
        select(Contradiction.id).where(Contradiction.project_id == project_id)
        .order_by(Contradiction.created_at, Contradiction.id)
    )).scalars().all()
    ctr_idx = {uid: i + 1 for i, uid in enumerate(all_ctrs)}

    return {
        "stakeholder": stakeholder,
        "findings": {
            "requirements": [{
                "id": str(r.id), "req_id": r.req_id, "title": r.title,
                "priority": r.priority, "status": r.status,
            } for r in reqs],
            "gaps": [{
                "id": str(g.id), "gap_id": g.gap_id,
                "question": g.question, "severity": g.severity,
                "status": g.status,
            } for g in gaps],
            "constraints": [{
                "id": str(c.id),
                "display_id": f"CON-{con_idx.get(c.id, 0):03d}" if con_idx.get(c.id) else None,
                "type": c.type, "description": c.description,
                "status": c.status,
            } for c in cons],
            "contradictions": [{
                "id": str(c.id),
                "display_id": f"CTR-{ctr_idx.get(c.id, 0):03d}" if ctr_idx.get(c.id) else None,
                "title": c.title or (c.explanation or "")[:80],
                "resolved": c.resolved,
            } for c in contras],
        },
    }


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

    # Shape the response to carry first-class fields (title / side_a /
    # side_b / area — the agent's native output) alongside the legacy
    # ref fields (only populated when the agent explicitly maps to DB
    # rows, which is rare in practice). Consumers read title first and
    # fall back to item_a_ref / explanation for historical rows.
    contra_list = []
    for c in items:
        # Legacy refs still resolved when item_a_type/id are real.
        item_a_ref = (
            await _lookup_item_ref(db, c.item_a_type, c.item_a_id)
            if c.item_a_type and c.item_a_id else None
        )
        item_b_ref = (
            await _lookup_item_ref(db, c.item_b_type, c.item_b_id)
            if c.item_b_type and c.item_b_id else None
        )

        source_a_doc = None
        if c.item_a_type == "requirement" and c.item_a_id:
            r = await db.execute(
                select(Requirement, Document.filename)
                .outerjoin(Document, Requirement.source_doc_id == Document.id)
                .where(Requirement.id == c.item_a_id)
            )
            row = r.one_or_none()
            if row:
                source_a_doc = row[1]

        source_b_doc = None
        if c.source_doc_id:
            r = await db.execute(select(Document.filename).where(Document.id == c.source_doc_id))
            row = r.one_or_none()
            if row:
                source_b_doc = row[0]

        contra_list.append({
            "id": str(c.id),
            # First-class agent-authored fields.
            "title": c.title,
            "side_a": c.side_a,
            "side_b": c.side_b,
            "area": c.area,
            # Per-side provenance — what the UI renders as source/person
            # chips. Preferred over the legacy item_a_source lookups.
            "side_a_source": c.side_a_source,
            "side_a_person": c.side_a_person,
            "side_b_source": c.side_b_source,
            "side_b_person": c.side_b_person,
            # Legacy fields — optional; nullable since 025. Null when
            # the agent didn't map to specific DB rows.
            "item_a_type": c.item_a_type,
            "item_a_id": str(c.item_a_id) if c.item_a_id else None,
            "item_a_ref": item_a_ref,
            # For back-compat, prefer side_a_source (agent-authored)
            # over source_a_doc (computed from item_a FK). If both are
            # null, the UI simply won't render a source chip.
            "item_a_source": c.side_a_source or source_a_doc,
            "item_a_person": c.side_a_person,
            "item_b_type": c.item_b_type,
            "item_b_id": str(c.item_b_id) if c.item_b_id else None,
            "item_b_ref": item_b_ref,
            "item_b_source": c.side_b_source or source_b_doc,
            "item_b_person": c.side_b_person,
            # Explanation kept for legacy readers (agent-level search) —
            # UI prefers the structured fields above.
            "explanation": c.explanation,
            "resolved": c.resolved,
            "resolution_note": c.resolution_note,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    await _attach_seen(contra_list, db, user.id, project_id, "contradiction")
    return {"items": contra_list, "total": len(contra_list)}


async def _lookup_item_ref(db: AsyncSession, item_type: str, item_id: uuid.UUID) -> str:
    """Look up a referenced item to get its title/quote for display."""
    try:
        if item_type == "requirement":
            r = await db.execute(select(Requirement).where(Requirement.id == item_id))
            req = r.scalar_one_or_none()
            if req:
                return f"{req.req_id}: {req.title}"
        elif item_type == "constraint":
            r = await db.execute(select(Constraint).where(Constraint.id == item_id))
            con = r.scalar_one_or_none()
            if con:
                return f"{con.type}: {con.description[:60]}"
    except Exception:
        pass
    return f"New {item_type} (from uploaded document)"


# ── Search across all types ──────────────────────────

@router.get("/search")
async def search_all(
    project_id: uuid.UUID,
    q: str = Query(..., min_length=2),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search across all extracted data types by title, description, or ID."""
    results = []
    pattern = f"%{q}%"

    # Requirements — match on req_id, title, or description
    reqs = await db.execute(
        select(Requirement).where(
            Requirement.project_id == project_id,
            (
                Requirement.req_id.ilike(pattern)
                | Requirement.title.ilike(pattern)
                | Requirement.description.ilike(pattern)
            ),
        ).limit(10)
    )
    for r in reqs.scalars():
        results.append({"type": "requirement", "id": r.req_id, "title": r.title, "priority": r.priority, "status": r.status})

    # Gaps — match on gap_id or question
    gaps = await db.execute(
        select(Gap).where(
            Gap.project_id == project_id,
            (
                Gap.gap_id.ilike(pattern)
                | Gap.question.ilike(pattern)
            ),
        ).limit(5)
    )
    for g in gaps.scalars():
        results.append({"type": "gap", "id": g.gap_id, "title": g.question[:80], "status": g.status})

    # Constraints — match on type or description
    cons = await db.execute(
        select(Constraint).where(
            Constraint.project_id == project_id,
            (
                Constraint.type.ilike(pattern)
                | Constraint.description.ilike(pattern)
            ),
        ).limit(5)
    )
    for c in cons.scalars():
        results.append({"type": "constraint", "id": str(c.id)[:8], "title": f"{c.type}: {c.description[:80]}", "status": c.status})

    # Contradictions — match on explanation
    contras = await db.execute(
        select(Contradiction).where(
            Contradiction.project_id == project_id,
            Contradiction.explanation.ilike(pattern),
        ).limit(5)
    )
    for ct in contras.scalars():
        results.append({"type": "contradiction", "id": str(ct.id)[:8], "title": ct.explanation[:80], "status": "resolved" if ct.resolved else "open"})

    # Stakeholders — match on name or role
    stks = await db.execute(
        select(Stakeholder).where(
            Stakeholder.project_id == project_id,
            (Stakeholder.name.ilike(pattern) | Stakeholder.role.ilike(pattern)),
        ).limit(5)
    )
    for s in stks.scalars():
        results.append({"type": "stakeholder", "id": str(s.id)[:8], "title": f"{s.name} ({s.role})", "status": s.decision_authority})

    return {"results": results, "total": len(results), "query": q}
