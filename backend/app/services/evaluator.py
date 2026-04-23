"""Readiness evaluator — 4-component weighted score.

After the taxonomy cleanup (migration 027), readiness is computed from four
components that correspond to the kinds users actually see and act on:

    readiness = 0.35 * coverage   # BRs captured AND filled in
              + 0.25 * clarity    # gaps are few relative to BR count
              + 0.20 * alignment  # contradictions are resolved
              + 0.20 * context    # stakeholders + constraints known
    (scaled to 0-100)

Each component is 0.0-1.0. The component breakdown is returned in the
response so the dashboard UI can show *why* the score is where it is,
not just the total. A flat `checks` list is still produced for back-compat
with the existing dashboard renderer.

Status bands:
    ≥85   ready
    65-84 conditional
    <65   not_ready
"""

import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    Requirement,
    Constraint,
    Stakeholder,
    Contradiction,
    Gap,
)
from app.models.control import ReadinessHistory


# Weights sum to 1.0. If you change them, update the docstring above.
_WEIGHTS = {
    "coverage": 0.35,
    "clarity": 0.25,
    "alignment": 0.20,
    "context": 0.20,
}

# Tunable thresholds. Targets ("≥5 BRs", "≥2 stakeholders") are aspirational
# minimums for a useful discovery output, not hard gates.
_TARGETS = {
    "br_count": 5,
    "stakeholder_count": 2,
    "constraint_count": 2,
}

# Fields that make a BR "fully specified". Source_quote is mandatory at
# extraction so it's always present — not counted here. acceptance_criteria
# and rationale are the high-value additions from Session 2.
_BR_FILLED_FIELDS = ("description", "priority", "acceptance_criteria", "rationale")


class ControlPointEvaluator:
    """Computes weighted readiness across coverage / clarity / alignment / context."""

    async def evaluate(
        self,
        project_id: uuid.UUID,
        db: AsyncSession,
        triggered_by: str = "system",
    ) -> dict:
        components = await self._compute_components(project_id, db)

        overall = sum(
            components[name]["score"] * weight
            for name, weight in _WEIGHTS.items()
        )
        overall = round(overall * 100, 1)

        checks = _components_to_checks(components)

        history = ReadinessHistory(
            project_id=project_id,
            score=overall,
            breakdown={
                "components": {
                    name: {"score": c["score"], "weight": _WEIGHTS[name]}
                    for name, c in components.items()
                },
                "checks": [
                    {"check": c["check"], "score": c["score"], "status": c["status"]}
                    for c in checks
                ],
            },
            triggered_by=triggered_by,
        )
        db.add(history)
        await db.flush()

        return {
            "score": overall,
            "status": _band(overall),
            "components": components,
            "checks": checks,
        }

    async def _compute_components(
        self, project_id: uuid.UUID, db: AsyncSession
    ) -> dict[str, dict]:
        coverage = await self._coverage(project_id, db)
        clarity = await self._clarity(project_id, db)
        alignment = await self._alignment(project_id, db)
        context = await self._context(project_id, db)
        return {
            "coverage": coverage,
            "clarity": clarity,
            "alignment": alignment,
            "context": context,
        }

    async def _coverage(self, project_id: uuid.UUID, db: AsyncSession) -> dict:
        """Are there enough BRs, and are they filled in?"""
        total = await db.scalar(
            select(func.count()).where(Requirement.project_id == project_id)
        ) or 0

        count_signal = min(total / _TARGETS["br_count"], 1.0) if total else 0.0

        fill_signal = 0.0
        fill_detail: dict[str, float] = {}
        if total:
            rows = (
                (
                    await db.execute(
                        select(Requirement).where(Requirement.project_id == project_id)
                    )
                )
                .scalars()
                .all()
            )
            per_br: list[float] = []
            for br in rows:
                filled = sum(1 for f in _BR_FILLED_FIELDS if _is_filled(getattr(br, f, None)))
                per_br.append(filled / len(_BR_FILLED_FIELDS))
            fill_signal = sum(per_br) / len(per_br) if per_br else 0.0
            fill_detail = {"avg_fill": round(fill_signal, 2)}

        score = 0.5 * count_signal + 0.5 * fill_signal
        return {
            "score": round(score, 3),
            "label": "Coverage",
            "summary": (
                f"{total} BR{'s' if total != 1 else ''} captured"
                + (f", avg fill {int(fill_signal * 100)}%" if total else "")
            ),
            "details": {
                "br_count": total,
                "count_signal": round(count_signal, 2),
                "fill_signal": round(fill_signal, 2),
                **fill_detail,
            },
        }

    async def _clarity(self, project_id: uuid.UUID, db: AsyncSession) -> dict:
        """How many open gaps per BR? Fewer = clearer."""
        br_count = await db.scalar(
            select(func.count()).where(Requirement.project_id == project_id)
        ) or 0
        open_gaps = await db.scalar(
            select(func.count()).where(
                Gap.project_id == project_id,
                Gap.status == "open",
            )
        ) or 0

        if br_count == 0:
            # Can't score clarity with no BRs — neutral 0.0 keeps the
            # score honest ("you haven't produced anything to evaluate").
            score = 0.0
            summary = "no BRs to evaluate against"
        else:
            score = max(0.0, 1.0 - (open_gaps / br_count))
            summary = f"{open_gaps} open gap{'s' if open_gaps != 1 else ''} across {br_count} BR{'s' if br_count != 1 else ''}"

        return {
            "score": round(score, 3),
            "label": "Clarity",
            "summary": summary,
            "details": {"open_gaps": open_gaps, "br_count": br_count},
        }

    async def _alignment(self, project_id: uuid.UUID, db: AsyncSession) -> dict:
        """Are contradictions resolved?"""
        total = await db.scalar(
            select(func.count()).where(Contradiction.project_id == project_id)
        ) or 0
        unresolved = await db.scalar(
            select(func.count()).where(
                Contradiction.project_id == project_id,
                Contradiction.resolved == False,  # noqa: E712
            )
        ) or 0

        if total == 0:
            # No contradictions found is itself a signal of alignment
            # (nothing flagged), so this scores 1.0 not 0.0. Matches PM
            # intuition and avoids penalizing small projects.
            score = 1.0
            summary = "no contradictions flagged"
        else:
            score = (total - unresolved) / total
            summary = f"{unresolved} of {total} contradiction{'s' if total != 1 else ''} unresolved"

        return {
            "score": round(score, 3),
            "label": "Alignment",
            "summary": summary,
            "details": {"unresolved": unresolved, "total": total},
        }

    async def _context(self, project_id: uuid.UUID, db: AsyncSession) -> dict:
        """Are the people, authority, and constraints captured?"""
        stakeholder_count = await db.scalar(
            select(func.count()).where(Stakeholder.project_id == project_id)
        ) or 0
        decision_maker = await db.scalar(
            select(func.count()).where(
                Stakeholder.project_id == project_id,
                Stakeholder.decision_authority == "final",
            )
        ) or 0
        constraint_count = await db.scalar(
            select(func.count()).where(Constraint.project_id == project_id)
        ) or 0

        people_signal = min(stakeholder_count / _TARGETS["stakeholder_count"], 1.0)
        authority_signal = 1.0 if decision_maker > 0 else 0.0
        constraint_signal = min(constraint_count / _TARGETS["constraint_count"], 1.0)

        score = (people_signal + authority_signal + constraint_signal) / 3.0
        return {
            "score": round(score, 3),
            "label": "Context",
            "summary": (
                f"{stakeholder_count} stakeholder{'s' if stakeholder_count != 1 else ''}"
                f", {constraint_count} constraint{'s' if constraint_count != 1 else ''}"
                f"{', decision-maker set' if decision_maker else ', no decision-maker'}"
            ),
            "details": {
                "stakeholders": stakeholder_count,
                "decision_maker": decision_maker > 0,
                "constraints": constraint_count,
            },
        }


def _is_filled(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, tuple, dict)):
        return len(value) > 0
    return bool(value)


def _band(score: float) -> str:
    if score >= 85:
        return "ready"
    if score >= 65:
        return "conditional"
    return "not_ready"


def _components_to_checks(components: dict[str, dict]) -> list[dict]:
    """Flatten 4 components into a check list for the dashboard UI.

    The dashboard iterates this list and renders one row per check, so this
    function is the contract between the new formula and the old UI. Order
    matches the weight order (coverage first) for visual priority.
    """
    checks: list[dict] = []
    for name in ("coverage", "clarity", "alignment", "context"):
        c = components[name]
        checks.append({
            "check": f"{c['label']} — {c['summary']}",
            "score": c["score"],
            "status": _status_for(c["score"]),
            "component": name,
        })
    return checks


def _status_for(score: float) -> str:
    if score >= 0.8:
        return "covered"
    if score > 0.0:
        return "partial"
    return "missing"


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

    t0 = datetime.fromisoformat(history[0]["created_at"].replace("Z", "+00:00"))
    xs = []
    ys = []
    for h in history:
        t = datetime.fromisoformat(h["created_at"].replace("Z", "+00:00"))
        xs.append((t - t0).total_seconds() / 86400)
        ys.append(h["score"])

    n = len(xs)
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_xx = sum(x * x for x in xs)

    denom = n * sum_xx - sum_x * sum_x
    slope = 0 if denom == 0 else (n * sum_xy - sum_x * sum_y) / denom

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
