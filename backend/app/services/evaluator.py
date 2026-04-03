"""Control point evaluator — readiness scoring via SQL (70%) + limited LLM (30%)."""

import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import Requirement, Constraint, Decision, Stakeholder, Assumption, ScopeItem, Contradiction
from app.models.control import ReadinessHistory


class ControlPointEvaluator:
    """Evaluates discovery readiness using SQL queries on typed tables.

    Readiness = weighted average across 4 areas:
        Business Understanding: 20%
        Functional Requirements: 35%
        Technical Context: 20%
        Scope Freeze: 25%

    Each area score = (covered checks / total checks) * 100
    """

    AREA_WEIGHTS = {
        "business": 0.20,
        "functional": 0.35,
        "technical": 0.20,
        "scope": 0.25,
    }

    async def evaluate(self, project_id: uuid.UUID, db: AsyncSession, triggered_by: str = "system") -> dict:
        """Run readiness evaluation and store result."""

        scores = {}

        # Business Understanding (20%)
        scores["business"] = await self._evaluate_business(project_id, db)

        # Functional Requirements (35%)
        scores["functional"] = await self._evaluate_functional(project_id, db)

        # Technical Context (20%)
        scores["technical"] = await self._evaluate_technical(project_id, db)

        # Scope Freeze (25%)
        scores["scope"] = await self._evaluate_scope(project_id, db)

        # Weighted overall score
        overall = sum(scores[area] * weight for area, weight in self.AREA_WEIGHTS.items())

        # Store
        history = ReadinessHistory(
            project_id=project_id,
            score=round(overall, 1),
            breakdown=scores,
            triggered_by=triggered_by,
        )
        db.add(history)
        await db.flush()

        return {
            "score": round(overall, 1),
            "status": "ready" if overall >= 85 else "conditional" if overall >= 65 else "not_ready",
            "breakdown": scores,
        }

    async def _evaluate_business(self, project_id: uuid.UUID, db: AsyncSession) -> float:
        checks = []

        # Has stakeholders with decision authority?
        count = await db.scalar(
            select(func.count()).where(
                Stakeholder.project_id == project_id,
                Stakeholder.decision_authority == "final",
            )
        )
        checks.append(1.0 if count and count > 0 else 0.0)

        # Has budget constraint confirmed?
        count = await db.scalar(
            select(func.count()).where(
                Constraint.project_id == project_id,
                Constraint.type == "budget",
                Constraint.status == "confirmed",
            )
        )
        checks.append(1.0 if count and count > 0 else 0.0)

        # Has timeline constraint?
        count = await db.scalar(
            select(func.count()).where(
                Constraint.project_id == project_id,
                Constraint.type == "timeline",
            )
        )
        checks.append(1.0 if count and count > 0 else 0.0)

        # Has any stakeholders at all?
        count = await db.scalar(
            select(func.count()).where(Stakeholder.project_id == project_id)
        )
        checks.append(1.0 if count and count >= 2 else 0.5 if count and count >= 1 else 0.0)

        # Has business-related requirements?
        count = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.priority == "must",
            )
        )
        checks.append(1.0 if count and count >= 2 else 0.5 if count and count >= 1 else 0.0)

        return (sum(checks) / len(checks)) * 100 if checks else 0

    async def _evaluate_functional(self, project_id: uuid.UUID, db: AsyncSession) -> float:
        checks = []

        # Has confirmed requirements?
        confirmed = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.status == "confirmed",
            )
        )
        total = await db.scalar(
            select(func.count()).where(Requirement.project_id == project_id)
        )
        total = total or 0
        confirmed = confirmed or 0

        checks.append(1.0 if total >= 5 else 0.5 if total >= 2 else 0.0)
        checks.append(confirmed / total if total > 0 else 0.0)

        # Has MUST requirements?
        must_count = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.priority == "must",
            )
        )
        checks.append(1.0 if must_count and must_count >= 3 else 0.5 if must_count and must_count >= 1 else 0.0)

        # Has non-functional requirements?
        nfr_count = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.type == "non_functional",
            )
        )
        checks.append(1.0 if nfr_count and nfr_count >= 1 else 0.0)

        return (sum(checks) / len(checks)) * 100 if checks else 0

    async def _evaluate_technical(self, project_id: uuid.UUID, db: AsyncSession) -> float:
        checks = []

        # Has technology decisions?
        tech_decisions = await db.scalar(
            select(func.count()).where(Decision.project_id == project_id)
        )
        checks.append(1.0 if tech_decisions and tech_decisions >= 2 else 0.5 if tech_decisions and tech_decisions >= 1 else 0.0)

        # Has technology constraints?
        tech_constraints = await db.scalar(
            select(func.count()).where(
                Constraint.project_id == project_id,
                Constraint.type == "technology",
            )
        )
        checks.append(1.0 if tech_constraints and tech_constraints >= 1 else 0.0)

        # Has confirmed decisions?
        confirmed_decisions = await db.scalar(
            select(func.count()).where(
                Decision.project_id == project_id,
                Decision.status == "confirmed",
            )
        )
        checks.append(1.0 if confirmed_decisions and confirmed_decisions >= 1 else 0.0)

        return (sum(checks) / len(checks)) * 100 if checks else 0

    async def _evaluate_scope(self, project_id: uuid.UUID, db: AsyncSession) -> float:
        checks = []

        # Has in-scope items?
        in_scope = await db.scalar(
            select(func.count()).where(
                ScopeItem.project_id == project_id,
                ScopeItem.in_scope == True,
            )
        )
        checks.append(1.0 if in_scope and in_scope >= 3 else 0.5 if in_scope and in_scope >= 1 else 0.0)

        # Has out-of-scope items (explicit exclusions)?
        out_scope = await db.scalar(
            select(func.count()).where(
                ScopeItem.project_id == project_id,
                ScopeItem.in_scope == False,
            )
        )
        checks.append(1.0 if out_scope and out_scope >= 1 else 0.0)

        # No unresolved contradictions?
        unresolved = await db.scalar(
            select(func.count()).where(
                Contradiction.project_id == project_id,
                Contradiction.resolved == False,
            )
        )
        checks.append(1.0 if not unresolved or unresolved == 0 else 0.0)

        # Assumptions are tracked?
        assumptions = await db.scalar(
            select(func.count()).where(Assumption.project_id == project_id)
        )
        validated = await db.scalar(
            select(func.count()).where(
                Assumption.project_id == project_id,
                Assumption.validated == True,
            )
        )
        assumptions = assumptions or 0
        validated = validated or 0
        if assumptions > 0:
            checks.append(validated / assumptions)
        else:
            checks.append(0.5)  # No assumptions is neutral

        return (sum(checks) / len(checks)) * 100 if checks else 0


evaluator = ControlPointEvaluator()
