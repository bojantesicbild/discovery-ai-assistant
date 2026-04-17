"""Query tools — read structured data from PostgreSQL."""

import json
from pydantic_ai import RunContext
from sqlalchemy import select
from app.agent.deps import AgentDeps
from app.models.extraction import (
    Requirement, Constraint, Decision, Stakeholder,
    Assumption, ScopeItem, Contradiction,
)
from app.models.control import ReadinessHistory
from app.services.preamble import preamble_builder


async def get_project_context(ctx: RunContext[AgentDeps]) -> str:
    """Get full project context: readiness, contradictions, gaps summary.
    Use at the start of any complex analysis to understand current state."""
    return await preamble_builder.build(ctx.deps.project_id, ctx.deps.db)


async def get_readiness(ctx: RunContext[AgentDeps]) -> str:
    """Get current discovery readiness score and per-area breakdown."""
    result = await ctx.deps.db.scalar(
        select(ReadinessHistory)
        .where(ReadinessHistory.project_id == ctx.deps.project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )
    if not result:
        return json.dumps({"score": 0, "status": "not_ready", "breakdown": {}})
    return json.dumps({
        "score": result.score,
        "status": "ready" if result.score >= 85 else "conditional" if result.score >= 65 else "not_ready",
        "breakdown": result.breakdown or {},
    })


async def get_requirements(ctx: RunContext[AgentDeps], priority: str = None, status: str = None) -> str:
    """Get all extracted requirements. Optionally filter by priority or status."""
    query = select(Requirement).where(Requirement.project_id == ctx.deps.project_id)
    if priority:
        query = query.where(Requirement.priority == priority)
    if status:
        query = query.where(Requirement.status == status)
    result = await ctx.deps.db.execute(query.order_by(Requirement.req_id))
    items = result.scalars().all()
    return json.dumps([{
        "req_id": r.req_id, "title": r.title, "type": r.type,
        "priority": r.priority, "description": r.description,
        "status": r.status, "confidence": r.confidence,
        "source_quote": r.source_quote,
    } for r in items], indent=2)


async def get_contradictions(ctx: RunContext[AgentDeps]) -> str:
    """Get unresolved contradictions between items."""
    result = await ctx.deps.db.execute(
        select(Contradiction).where(
            Contradiction.project_id == ctx.deps.project_id,
            Contradiction.resolved == False,
        )
    )
    items = result.scalars().all()
    if not items:
        return "No unresolved contradictions."
    return json.dumps([{
        "item_a_type": c.item_a_type, "item_b_type": c.item_b_type,
        "explanation": c.explanation,
    } for c in items], indent=2)


async def get_stakeholders(ctx: RunContext[AgentDeps]) -> str:
    """Get all identified stakeholders with roles and authority."""
    result = await ctx.deps.db.execute(
        select(Stakeholder).where(Stakeholder.project_id == ctx.deps.project_id)
    )
    items = result.scalars().all()
    return json.dumps([{
        "name": s.name, "role": s.role, "organization": s.organization,
        "decision_authority": s.decision_authority, "interests": s.interests,
    } for s in items], indent=2)


async def get_decisions(ctx: RunContext[AgentDeps]) -> str:
    """Get all decisions with who, when, why, alternatives."""
    result = await ctx.deps.db.execute(
        select(Decision).where(Decision.project_id == ctx.deps.project_id)
    )
    items = result.scalars().all()
    return json.dumps([{
        "title": d.title, "decided_by": d.decided_by,
        "rationale": d.rationale, "alternatives": d.alternatives,
        "status": d.status,
    } for d in items], indent=2)


async def get_assumptions(ctx: RunContext[AgentDeps]) -> str:
    """Get unvalidated assumptions with risk assessment."""
    result = await ctx.deps.db.execute(
        select(Assumption).where(Assumption.project_id == ctx.deps.project_id)
    )
    items = result.scalars().all()
    return json.dumps([{
        "statement": a.statement, "basis": a.basis,
        "risk_if_wrong": a.risk_if_wrong,
        "needs_validation_by": a.needs_validation_by,
        "validated": a.validated,
    } for a in items], indent=2)


async def get_scope(ctx: RunContext[AgentDeps]) -> str:
    """Get scope items — what's in and out of MVP."""
    result = await ctx.deps.db.execute(
        select(ScopeItem).where(ScopeItem.project_id == ctx.deps.project_id)
    )
    items = result.scalars().all()
    return json.dumps([{
        "description": s.description, "in_scope": s.in_scope,
        "rationale": s.rationale,
    } for s in items], indent=2)


async def get_constraints(ctx: RunContext[AgentDeps]) -> str:
    """Get all constraints (budget, timeline, technology, regulatory)."""
    result = await ctx.deps.db.execute(
        select(Constraint).where(Constraint.project_id == ctx.deps.project_id)
    )
    items = result.scalars().all()
    return json.dumps([{
        "type": c.type, "description": c.description,
        "impact": c.impact, "status": c.status,
    } for c in items], indent=2)
