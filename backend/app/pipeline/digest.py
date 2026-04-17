"""Scheduled digests — daily and weekly reports for POs."""

import uuid
from datetime import datetime, timedelta, timezone, date
from sqlalchemy import select, func, text
import structlog

from app.db.session import async_session
from app.models.extraction import Requirement, Constraint, Decision, Gap
from app.models.control import ReadinessHistory
from app.models.operational import Digest, ActivityLog
from app.services.evaluator import compute_trajectory

log = structlog.get_logger()


def _write_digest_to_vault(project_id: uuid.UUID, digest_type: str, digest_data: dict, content_md: str):
    """Write digest as markdown to .memory-bank/docs/reports/."""
    try:
        from app.agent.claude_runner import claude_runner
        project_dir = claude_runner.get_project_dir(project_id)
        reports_dir = project_dir / ".memory-bank" / "docs" / "reports" / digest_type
        reports_dir.mkdir(parents=True, exist_ok=True)

        today = date.today().isoformat()
        if digest_type == "daily":
            filename = f"{today}-morning-digest.md"
        else:
            week_num = date.today().isocalendar()[1]
            filename = f"{today[:4]}-W{week_num:02d}-weekly-summary.md"

        (reports_dir / filename).write_text(content_md)
        log.info("Digest written to vault", project=str(project_id)[:8], file=filename)
    except Exception as e:
        log.warning("Failed to write digest to vault", error=str(e))


async def _create_notifications(project_id: uuid.UUID, digest_type: str, title: str, body: str, data: dict):
    """Create in-app notifications for all project members."""
    try:
        from app.models.operational import Notification
        from app.models.project import ProjectMember
        async with async_session() as db:
            result = await db.execute(
                select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
            )
            user_ids = [r[0] for r in result.fetchall()]
            for uid in user_ids:
                db.add(Notification(
                    project_id=project_id,
                    user_id=uid,
                    type=digest_type,
                    title=title,
                    body=body,
                    data=data,
                ))
            await db.commit()
    except Exception as e:
        log.warning("Failed to create notifications", error=str(e))


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

        # Write to Obsidian vault
        delta_str = f"+{score_delta}" if score_delta >= 0 else str(score_delta)
        md = f"""---
type: daily-digest
date: {now.strftime('%Y-%m-%d')}
score: {current_score}
delta: {score_delta}
tags: [digest, daily, readiness]
---

# Morning Digest — {now.strftime('%b %d, %Y')}

## Readiness: {current_score}% ({delta_str}%)

**Trend**: {trajectory['trend']} | **Velocity**: {trajectory['velocity_per_day']:.1f}%/day | **ETA**: {trajectory.get('eta_date', 'unknown')}

"""
        if digest_data["new_items"]["total"] > 0:
            ni = digest_data["new_items"]
            md += f"## New Items ({ni['total']})\n"
            if ni["requirements"]: md += f"- {ni['requirements']} requirements\n"
            if ni["decisions"]: md += f"- {ni['decisions']} decisions\n"
            if ni["constraints"]: md += f"- {ni['constraints']} constraints\n"
            md += "\n"
        if check_changes:
            md += "## Status Changes\n"
            for cc in check_changes:
                icon = "↑" if cc["direction"] == "improved" else "↓"
                md += f"- {icon} **{cc['check']}**: {cc['from']} → {cc['to']}\n"
            md += "\n"
        if stale:
            md += f"## Stale Gaps ({len(stale)})\n"
            for sg in stale:
                md += f"- **{sg['id']}**: {sg['question']} ({sg['days_open']}d open)\n"
            md += "\n"
        if priorities:
            md += f"## Priority Actions ({len(priorities)})\n"
            for p in priorities:
                md += f"- {p['check']} — {p['status']}\n"

        _write_digest_to_vault(project_id, "daily", digest_data, md)

        # Create notifications
        await _create_notifications(
            project_id, "daily-digest",
            f"Morning Digest — {current_score}% ({delta_str}%)",
            f"Readiness {current_score}%, {digest_data['new_items']['total']} new items, {len(stale)} stale gaps",
            {"digest_type": "morning", "score": current_score, "delta": score_delta},
        )

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


async def generate_weekly_summary(project_id: uuid.UUID) -> dict:
    """Generate a weekly summary for a project — last 7 days aggregated."""
    async with async_session() as db:
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)

        # Readiness start/end
        start_row = await db.execute(
            select(ReadinessHistory.score)
            .where(ReadinessHistory.project_id == project_id, ReadinessHistory.created_at >= week_ago)
            .order_by(ReadinessHistory.created_at.asc()).limit(1)
        )
        start_score = (start_row.scalar_one_or_none() or 0)

        end_row = await db.execute(
            select(ReadinessHistory.score)
            .where(ReadinessHistory.project_id == project_id)
            .order_by(ReadinessHistory.created_at.desc()).limit(1)
        )
        end_score = (end_row.scalar_one_or_none() or 0)

        # Items added this week
        new_reqs = await db.scalar(select(func.count()).where(Requirement.project_id == project_id, Requirement.created_at >= week_ago)) or 0
        new_decisions = await db.scalar(select(func.count()).where(Decision.project_id == project_id, Decision.created_at >= week_ago)) or 0
        new_constraints = await db.scalar(select(func.count()).where(Constraint.project_id == project_id, Constraint.created_at >= week_ago)) or 0
        new_gaps = await db.scalar(select(func.count()).where(Gap.project_id == project_id, Gap.created_at >= week_ago)) or 0

        # Totals
        total_reqs = await db.scalar(select(func.count()).where(Requirement.project_id == project_id)) or 0
        confirmed_reqs = await db.scalar(select(func.count()).where(Requirement.project_id == project_id, Requirement.status == "confirmed")) or 0
        open_gaps = await db.scalar(select(func.count()).where(Gap.project_id == project_id, Gap.status == "open")) or 0

        # Activity this week
        activities = await db.execute(
            select(ActivityLog.action, ActivityLog.summary, ActivityLog.created_at)
            .where(ActivityLog.project_id == project_id, ActivityLog.created_at >= week_ago)
            .order_by(ActivityLog.created_at.desc()).limit(20)
        )
        activity_list = [{"action": r[0], "summary": r[1], "date": r[2].strftime("%b %d")} for r in activities.fetchall()]

        summary_data = {
            "generated_at": now.isoformat(),
            "period": f"{week_ago.strftime('%b %d')} — {now.strftime('%b %d, %Y')}",
            "score_start": start_score,
            "score_end": end_score,
            "score_delta": round(end_score - start_score, 1),
            "new_items": {"requirements": new_reqs, "decisions": new_decisions, "constraints": new_constraints, "gaps": new_gaps},
            "totals": {"requirements": total_reqs, "confirmed": confirmed_reqs, "open_gaps": open_gaps},
            "activity": activity_list,
        }

        # Store
        digest = Digest(project_id=project_id, digest_type="weekly", data=summary_data)
        db.add(digest)
        await db.commit()

        # Write to vault
        delta_str = f"+{summary_data['score_delta']}" if summary_data['score_delta'] >= 0 else str(summary_data['score_delta'])
        md = f"""---
type: weekly-summary
date: {now.strftime('%Y-%m-%d')}
period: "{summary_data['period']}"
score: {end_score}
delta: {summary_data['score_delta']}
tags: [digest, weekly, readiness]
---

# Weekly Summary — {summary_data['period']}

## Readiness: {start_score}% → {end_score}% ({delta_str}%)

## This Week
- **{new_reqs}** new requirements ({confirmed_reqs}/{total_reqs} confirmed)
- **{new_decisions}** new decisions
- **{new_constraints}** new constraints
- **{new_gaps}** new gaps ({open_gaps} still open)

## Key Activity
"""
        for a in activity_list[:10]:
            md += f"- **{a['date']}** — {a['summary']}\n"

        _write_digest_to_vault(project_id, "weekly", summary_data, md)

        await _create_notifications(
            project_id, "weekly-summary",
            f"Weekly Summary — {end_score}% ({delta_str}%)",
            f"This week: {new_reqs} reqs, {new_decisions} decisions, {new_gaps} gaps. Readiness {start_score}% → {end_score}%",
            {"digest_type": "weekly", "score": end_score, "delta": summary_data['score_delta']},
        )

        log.info("Weekly summary generated", project=str(project_id)[:8], score=end_score)
        return summary_data


async def generate_all_weekly_summaries():
    """Generate weekly summaries for all active projects."""
    async with async_session() as db:
        result = await db.execute(text("SELECT id FROM projects"))
        project_ids = [r[0] for r in result.fetchall()]

    for pid in project_ids:
        try:
            await generate_weekly_summary(pid)
        except Exception as e:
            log.error("Weekly summary failed", project=str(pid)[:8], error=str(e))
