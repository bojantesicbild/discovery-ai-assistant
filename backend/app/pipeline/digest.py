"""Morning digest — scheduled readiness report for POs."""

import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.db.session import async_session
from app.models.extraction import Requirement, Constraint, Decision, Stakeholder, Gap
from app.models.control import ReadinessHistory
from app.models.operational import Digest
from app.services.evaluator import compute_trajectory

log = structlog.get_logger()


async def generate_digest(project_id: uuid.UUID) -> dict:
    """Generate a morning digest for a project."""
    async with async_session() as db:
        now = datetime.now(timezone.utc)
        yesterday = now - timedelta(days=1)

        # Current readiness
        current = await db.execute(
            select(ReadinessHistory)
            .where(ReadinessHistory.project_id == project_id)
            .order_by(ReadinessHistory.created_at.desc())
            .limit(1)
        )
        current_row = current.scalar_one_or_none()
        current_score = current_row.score if current_row else 0
        current_checks = (current_row.breakdown or {}).get("checks", []) if current_row else []

        # Yesterday's readiness
        prev = await db.execute(
            select(ReadinessHistory)
            .where(
                ReadinessHistory.project_id == project_id,
                ReadinessHistory.created_at < yesterday,
            )
            .order_by(ReadinessHistory.created_at.desc())
            .limit(1)
        )
        prev_row = prev.scalar_one_or_none()
        prev_score = prev_row.score if prev_row else 0
        prev_checks = (prev_row.breakdown or {}).get("checks", []) if prev_row else []

        score_delta = round(current_score - prev_score, 1)

        # Check changes
        check_changes = []
        prev_map = {c["check"]: c["status"] for c in prev_checks}
        for c in current_checks:
            old_status = prev_map.get(c["check"])
            if old_status and old_status != c["status"]:
                direction = "improved" if c["status"] == "covered" else "regressed"
                check_changes.append({
                    "check": c["check"],
                    "from": old_status,
                    "to": c["status"],
                    "direction": direction,
                })

        # New items since yesterday
        new_reqs = await db.scalar(
            select(func.count()).where(
                Requirement.project_id == project_id,
                Requirement.created_at >= yesterday,
            )
        ) or 0
        new_decisions = await db.scalar(
            select(func.count()).where(
                Decision.project_id == project_id,
                Decision.created_at >= yesterday,
            )
        ) or 0
        new_constraints = await db.scalar(
            select(func.count()).where(
                Constraint.project_id == project_id,
                Constraint.created_at >= yesterday,
            )
        ) or 0

        # Stale gaps (open > 3 days)
        stale_gaps = await db.execute(
            select(Gap.gap_id, Gap.question, Gap.severity, Gap.created_at)
            .where(
                Gap.project_id == project_id,
                Gap.status == "open",
                Gap.created_at < now - timedelta(days=3),
            )
        )
        stale = [{"id": r[0], "question": r[1], "severity": r[2],
                  "days_open": (now - r[3].replace(tzinfo=timezone.utc)).days} for r in stale_gaps.fetchall()]

        # Trajectory
        history_result = await db.execute(
            select(ReadinessHistory.score, ReadinessHistory.created_at)
            .where(ReadinessHistory.project_id == project_id)
            .order_by(ReadinessHistory.created_at.asc())
        )
        history = [{"score": r[0], "created_at": r[1].isoformat()} for r in history_result.fetchall()]
        trajectory = compute_trajectory(history)

        # Missing checks (priorities)
        priorities = [c for c in current_checks if c["status"] != "covered"]

        # Build digest
        digest_data = {
            "generated_at": now.isoformat(),
            "score": current_score,
            "score_delta": score_delta,
            "trend": trajectory["trend"],
            "velocity": trajectory["velocity_per_day"],
            "eta_days": trajectory["eta_days"],
            "eta_date": trajectory["eta_date"],
            "check_changes": check_changes,
            "new_items": {
                "requirements": new_reqs,
                "decisions": new_decisions,
                "constraints": new_constraints,
                "total": new_reqs + new_decisions + new_constraints,
            },
            "stale_gaps": stale,
            "priorities": [{"check": p["check"], "status": p["status"]} for p in priorities],
        }

        # Store
        digest = Digest(
            project_id=project_id,
            digest_type="morning",
            data=digest_data,
        )
        db.add(digest)
        await db.commit()

        log.info("Digest generated", project=str(project_id)[:8], score=current_score, delta=score_delta)
        return digest_data


async def generate_all_digests():
    """Generate morning digests for all active projects."""
    async with async_session() as db:
        result = await db.execute(text("SELECT id FROM projects"))
        project_ids = [r[0] for r in result.fetchall()]

    for pid in project_ids:
        try:
            await generate_digest(pid)
        except Exception as e:
            log.error("Digest generation failed", project=str(pid)[:8], error=str(e))
