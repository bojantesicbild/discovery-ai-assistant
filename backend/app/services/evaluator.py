"""Readiness evaluator — flat checklist scoring."""

import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import Requirement, Constraint, Decision, Stakeholder, Assumption, ScopeItem, Contradiction
from app.models.control import ReadinessHistory


class ControlPointEvaluator:
    """Evaluates discovery readiness via a flat checklist.

    12 checks, equal weight. Each scores 0.0 to 1.0.
    Overall = (sum / 12) * 100

    Thresholds:
        ≥85% → Ready
        65-84% → Conditional
        <65% → Not ready
    """

    async def evaluate(self, project_id: uuid.UUID, db: AsyncSession, triggered_by: str = "system") -> dict:
        """Run readiness evaluation and store result."""
        checks = await self._run_checks(project_id, db)

        total = sum(c["score"] for c in checks)
        overall = round((total / len(checks)) * 100, 1) if checks else 0

        history = ReadinessHistory(
            project_id=project_id,
            score=overall,
            breakdown={"checks": [{"check": c["check"], "score": c["score"], "status": c["status"]} for c in checks]},
            triggered_by=triggered_by,
        )
        db.add(history)
        await db.flush()

        return {
            "score": overall,
            "status": "ready" if overall >= 85 else "conditional" if overall >= 65 else "not_ready",
            "checks": checks,
        }

    async def _run_checks(self, project_id: uuid.UUID, db: AsyncSession) -> list[dict]:
        checks = []

        # 1. Decision-maker identified
        count = await db.scalar(
            select(func.count()).where(
                Stakeholder.project_id == project_id,
                Stakeholder.decision_authority == "final",
            )
        ) or 0
        checks.append({
            "check": "Decision-maker identified",
            "score": 1.0 if count > 0 else 0.0,
            "status": "covered" if count > 0 else "missing",
        })

        # 2. People identified (≥2)
        count = await db.scalar(
            select(func.count()).where(Stakeholder.project_id == project_id)
        ) or 0
        checks.append({
            "check": "People identified (≥2)",
            "score": 1.0 if count >= 2 else 0.5 if count >= 1 else 0.0,
            "status": "covered" if count >= 2 else "partial" if count >= 1 else "missing",
        })

        # 3. Requirements defined (≥5)
        total_reqs = await db.scalar(
            select(func.count()).where(Requirement.project_id == project_id)
        ) or 0
        checks.append({
            "check": "Requirements defined (≥5)",
            "score": 1.0 if total_reqs >= 5 else 0.5 if total_reqs >= 2 else 0.0,
            "status": "covered" if total_reqs >= 5 else "partial" if total_reqs >= 2 else "missing",
        })

        # 4. Requirements confirmed (ratio)
        confirmed_reqs = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.status == "confirmed",
            )
        ) or 0
        ratio = confirmed_reqs / total_reqs if total_reqs > 0 else 0
        checks.append({
            "check": "Requirements confirmed",
            "score": ratio,
            "status": "covered" if ratio >= 0.8 else "partial" if ratio > 0 else "missing",
        })

        # 5. MUST requirements (≥3)
        must_count = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.priority == "must",
            )
        ) or 0
        checks.append({
            "check": "MUST requirements (≥3)",
            "score": 1.0 if must_count >= 3 else 0.5 if must_count >= 1 else 0.0,
            "status": "covered" if must_count >= 3 else "partial" if must_count >= 1 else "missing",
        })

        # 6. Decisions documented (≥2)
        dec_count = await db.scalar(
            select(func.count()).where(Decision.project_id == project_id)
        ) or 0
        checks.append({
            "check": "Decisions documented (≥2)",
            "score": 1.0 if dec_count >= 2 else 0.5 if dec_count >= 1 else 0.0,
            "status": "covered" if dec_count >= 2 else "partial" if dec_count >= 1 else "missing",
        })

        # 7. Decisions confirmed (≥1)
        confirmed_dec = await db.scalar(
            select(func.count()).where(
                Decision.project_id == project_id,
                Decision.status == "confirmed",
            )
        ) or 0
        checks.append({
            "check": "Decisions confirmed (≥1)",
            "score": 1.0 if confirmed_dec >= 1 else 0.0,
            "status": "covered" if confirmed_dec >= 1 else "missing",
        })

        # 8. Scope defined (in-scope ≥3 + out-of-scope ≥1)
        in_scope = await db.scalar(
            select(func.count()).where(
                ScopeItem.project_id == project_id,
                ScopeItem.in_scope == True,
            )
        ) or 0
        out_scope = await db.scalar(
            select(func.count()).where(
                ScopeItem.project_id == project_id,
                ScopeItem.in_scope == False,
            )
        ) or 0
        scope_ok = in_scope >= 3 and out_scope >= 1
        scope_partial = in_scope >= 1 or out_scope >= 1
        checks.append({
            "check": "Scope defined (in + out)",
            "score": 1.0 if scope_ok else 0.5 if scope_partial else 0.0,
            "status": "covered" if scope_ok else "partial" if scope_partial else "missing",
        })

        # 9. No unresolved contradictions
        unresolved = await db.scalar(
            select(func.count()).where(
                Contradiction.project_id == project_id,
                Contradiction.resolved == False,
            )
        ) or 0
        checks.append({
            "check": "No unresolved contradictions",
            "score": 1.0 if unresolved == 0 else 0.0,
            "status": "covered" if unresolved == 0 else "missing",
        })

        # 10. Budget constraint defined
        budget = await db.scalar(
            select(func.count()).where(
                Constraint.project_id == project_id,
                Constraint.type == "budget",
            )
        ) or 0
        checks.append({
            "check": "Budget constraint defined",
            "score": 1.0 if budget > 0 else 0.0,
            "status": "covered" if budget > 0 else "missing",
        })

        # 11. Timeline constraint defined
        timeline = await db.scalar(
            select(func.count()).where(
                Constraint.project_id == project_id,
                Constraint.type == "timeline",
            )
        ) or 0
        checks.append({
            "check": "Timeline constraint defined",
            "score": 1.0 if timeline > 0 else 0.0,
            "status": "covered" if timeline > 0 else "missing",
        })

        # 12. Assumptions validated (ratio)
        total_assumptions = await db.scalar(
            select(func.count()).where(Assumption.project_id == project_id)
        ) or 0
        validated = await db.scalar(
            select(func.count()).where(
                Assumption.project_id == project_id,
                Assumption.validated == True,
            )
        ) or 0
        if total_assumptions > 0:
            a_ratio = validated / total_assumptions
        else:
            a_ratio = 0.5  # No assumptions = neutral
        checks.append({
            "check": "Assumptions validated",
            "score": a_ratio,
            "status": "covered" if a_ratio >= 0.8 else "partial" if a_ratio > 0 else "missing",
        })

        return checks


evaluator = ControlPointEvaluator()


def compute_trajectory(history: list[dict]) -> dict:
    """Compute readiness velocity and ETA from history points.

    Args:
        history: list of {"score": float, "created_at": str (ISO)} sorted by time ASC

    Returns:
        {velocity_per_day, eta_days, eta_date, trend, history}
    """
    from datetime import datetime, timedelta

    if len(history) < 2:
        return {
            "current_score": history[-1]["score"] if history else 0,
            "velocity_per_day": None,
            "eta_days": None,
            "eta_date": None,
            "trend": "insufficient_data",
            "history": history,
        }

    current = history[-1]["score"]

    # Simple least-squares slope over all points
    # x = days since first point, y = score
    t0 = datetime.fromisoformat(history[0]["created_at"].replace("Z", "+00:00"))
    xs = []
    ys = []
    for h in history:
        t = datetime.fromisoformat(h["created_at"].replace("Z", "+00:00"))
        xs.append((t - t0).total_seconds() / 86400)  # days
        ys.append(h["score"])

    n = len(xs)
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_xx = sum(x * x for x in xs)

    denom = n * sum_xx - sum_x * sum_x
    if denom == 0:
        slope = 0
    else:
        slope = (n * sum_xy - sum_x * sum_y) / denom

    velocity = round(slope, 2)

    if current >= 85:
        eta_days = 0
        eta_date = datetime.now().strftime("%Y-%m-%d")
        trend = "ready"
    elif velocity <= 0.1:
        eta_days = None
        eta_date = None
        trend = "stalled" if velocity >= -0.1 else "declining"
    else:
        eta_days = int((85 - current) / velocity) + 1
        eta_date = (datetime.now() + timedelta(days=eta_days)).strftime("%Y-%m-%d")
        trend = "improving"

    return {
        "current_score": current,
        "velocity_per_day": velocity,
        "eta_days": eta_days,
        "eta_date": eta_date,
        "trend": trend,
        "history": history,
    }
