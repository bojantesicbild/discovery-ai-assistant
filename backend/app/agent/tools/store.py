"""Store tools — write new findings to PostgreSQL."""

import json
import uuid
from pydantic_ai import RunContext
from app.agent.deps import AgentDeps
from app.models.extraction import (
    Requirement, Constraint, Decision, Stakeholder,
    Assumption, ScopeItem, Contradiction, ChangeHistory,
)
from sqlalchemy import select, func


async def store_requirement(
    ctx: RunContext[AgentDeps],
    title: str, type: str, priority: str,
    description: str, source_doc: str, source_quote: str,
    user_perspective: str = None,
    business_rules: list[str] = None,
    edge_cases: list[str] = None,
) -> str:
    """Store a newly extracted requirement. Must include source quote (>=10 chars)."""
    # Generate next ID
    count = await ctx.deps.db.scalar(
        select(func.count()).where(Requirement.project_id == ctx.deps.project_id)
    ) or 0
    req_id = f"BR-{count + 1:03d}"

    req = Requirement(
        project_id=ctx.deps.project_id,
        req_id=req_id, title=title, type=type, priority=priority,
        description=description, user_perspective=user_perspective,
        business_rules=business_rules or [], edge_cases=edge_cases or [],
        source_quote=source_quote, status="proposed", confidence="medium",
    )
    ctx.deps.db.add(req)
    ctx.deps.db.add(ChangeHistory(
        project_id=ctx.deps.project_id, item_type="requirement",
        item_id=req.id, action="create",
        new_value={"title": title, "priority": priority},
        triggered_by=f"agent:user:{ctx.deps.user_id}",
    ))
    await ctx.deps.db.flush()
    return f"Requirement stored: {req_id} — {title} (priority: {priority}, status: proposed)"


async def store_constraint(
    ctx: RunContext[AgentDeps],
    type: str, description: str, impact: str,
    source_doc: str, source_quote: str,
) -> str:
    """Store a constraint (budget, timeline, technology, regulatory, organizational)."""
    con = Constraint(
        project_id=ctx.deps.project_id,
        type=type, description=description, impact=impact,
        source_quote=source_quote, status="assumed",
    )
    ctx.deps.db.add(con)
    await ctx.deps.db.flush()
    return f"Constraint stored: {type} — {description[:60]}"


async def store_decision(
    ctx: RunContext[AgentDeps],
    title: str, decided_by: str, rationale: str, source_doc: str,
    alternatives_considered: list[str] = None,
) -> str:
    """Store a decision (who decided what, why, alternatives)."""
    dec = Decision(
        project_id=ctx.deps.project_id,
        title=title, decided_by=decided_by, rationale=rationale,
        alternatives=alternatives_considered or [], status="tentative",
    )
    ctx.deps.db.add(dec)
    await ctx.deps.db.flush()
    return f"Decision stored: {title} — decided by {decided_by}"


async def store_stakeholder(
    ctx: RunContext[AgentDeps],
    name: str, role: str, organization: str,
    decision_authority: str = "informed",
    interests: list[str] = None,
) -> str:
    """Store a stakeholder (person, role, authority)."""
    stk = Stakeholder(
        project_id=ctx.deps.project_id,
        name=name, role=role, organization=organization,
        decision_authority=decision_authority, interests=interests or [],
    )
    ctx.deps.db.add(stk)
    await ctx.deps.db.flush()
    return f"Stakeholder stored: {name} ({role}, {decision_authority})"


async def store_assumption(
    ctx: RunContext[AgentDeps],
    statement: str, basis: str, risk_if_wrong: str,
    needs_validation_by: str = None,
) -> str:
    """Store an assumption (what we believe + risk if wrong)."""
    asm = Assumption(
        project_id=ctx.deps.project_id,
        statement=statement, basis=basis, risk_if_wrong=risk_if_wrong,
        needs_validation_by=needs_validation_by,
    )
    ctx.deps.db.add(asm)
    await ctx.deps.db.flush()
    return f"Assumption stored: {statement[:60]} (pending validation)"


async def store_scope_item(
    ctx: RunContext[AgentDeps],
    description: str, in_scope: bool, rationale: str, source_doc: str,
) -> str:
    """Store a scope decision (in or out of MVP)."""
    scp = ScopeItem(
        project_id=ctx.deps.project_id,
        description=description, in_scope=in_scope, rationale=rationale,
    )
    ctx.deps.db.add(scp)
    await ctx.deps.db.flush()
    scope_label = "IN scope" if in_scope else "OUT of scope"
    return f"Scope item stored: {description[:60]} — {scope_label}"


async def store_contradiction(
    ctx: RunContext[AgentDeps],
    item_a: str, item_b: str, explanation: str,
) -> str:
    """Flag a contradiction between two items that need resolution."""
    con = Contradiction(
        project_id=ctx.deps.project_id,
        item_a_type="general", item_a_id=uuid.uuid4(),
        item_b_type="general", item_b_id=uuid.uuid4(),
        explanation=explanation,
    )
    ctx.deps.db.add(con)
    await ctx.deps.db.flush()
    return f"Contradiction flagged: {item_a[:40]} vs {item_b[:40]}"
