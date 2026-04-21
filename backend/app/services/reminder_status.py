"""Status-output renderer for reminders.

Produces a short markdown summary of a BR or gap from the DB — no LLM
spawn, no streaming, no Claude Code subprocess. Fires in ~100ms instead
of ~1min, and doesn't burn a prep run when the user just wants
"remind me about BR-003 tomorrow."

Writes to the same `docs/meeting-prep/` directory so the existing
viewer + Meeting Prep tab deep-link keep working. Future: split into
`docs/reminder-status/` if we want a distinct surface.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.claude_runner import claude_runner
from app.models.extraction import Gap, Requirement
from app.models.reminder import Reminder

log = structlog.get_logger()


def _filename_slug(reminder: Reminder) -> str:
    when = reminder.due_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    subj = (reminder.subject_id or reminder.subject_type).lower()
    short_id = str(reminder.id)[:8]
    return f"{when}-status-{subj}-{short_id}"


async def render_status_brief(
    db: AsyncSession, reminder: Reminder
) -> tuple[Path, str] | None:
    """Compose a short status summary for the reminder's subject. Returns
    (written_path, markdown_body) or None if the subject can't be found.

    Fields surfaced: title, priority, status, description (truncated),
    acceptance criteria count, last updated, blocking gaps. Deliberately
    skinny — PMs scanning a reminder don't want the whole vault dump."""
    if reminder.subject_type == "requirement" and reminder.subject_id:
        payload = await _render_requirement_brief(db, reminder)
    elif reminder.subject_type == "gap" and reminder.subject_id:
        payload = await _render_gap_brief(db, reminder)
    else:
        return None

    if payload is None:
        return None

    prep_dir = (
        claude_runner.get_project_dir(reminder.project_id)
        / ".memory-bank" / "docs" / "meeting-prep"
    )
    prep_dir.mkdir(parents=True, exist_ok=True)
    path = prep_dir / f"{_filename_slug(reminder)}.md"
    path.write_text(payload, encoding="utf-8")
    log.info("reminder.status.written", id=str(reminder.id), path=str(path.name))
    return path, payload


async def _render_requirement_brief(db: AsyncSession, r: Reminder) -> str | None:
    req = await db.scalar(
        select(Requirement).where(
            Requirement.project_id == r.project_id,
            Requirement.req_id == r.subject_id,
        )
    )
    if req is None:
        return None

    # Open gaps blocking this requirement.
    gaps_q = await db.execute(
        select(Gap).where(
            Gap.project_id == r.project_id,
            Gap.status == "open",
        )
    )
    blocking: list[Gap] = []
    for g in gaps_q.scalars().all():
        if r.subject_id in (g.blocked_reqs or []):
            blocking.append(g)

    lines = [
        f"# Status: {req.req_id} — {req.title}",
        "",
        f"**Priority:** {req.priority or 'unset'}  ·  "
        f"**Status:** {req.status or 'unset'}  ·  "
        f"**Confidence:** {req.confidence or 'unset'}",
        "",
    ]
    desc = (req.description or "").strip()
    if desc:
        short = desc if len(desc) <= 400 else desc[:400].rstrip() + "…"
        lines += ["## Description", "", short, ""]

    acs = req.acceptance_criteria or []
    if acs:
        lines.append(f"## Acceptance criteria ({len(acs)})")
        lines.append("")
        for i, ac in enumerate(acs[:5], 1):
            ac_short = ac if len(ac) <= 200 else ac[:200].rstrip() + "…"
            lines.append(f"{i}. {ac_short}")
        if len(acs) > 5:
            lines.append(f"_+ {len(acs) - 5} more…_")
        lines.append("")

    if blocking:
        lines.append(f"## Blocking gaps ({len(blocking)})")
        lines.append("")
        for g in blocking[:5]:
            q = (g.question or "").strip()
            q_short = q if len(q) <= 120 else q[:120] + "…"
            lines.append(f"- **{g.gap_id}** ({g.severity or 'medium'}): {q_short}")
        if len(blocking) > 5:
            lines.append(f"_+ {len(blocking) - 5} more blocking gaps_")
        lines.append("")

    if req.updated_at:
        updated = req.updated_at.astimezone().strftime("%Y-%m-%d %H:%M %Z")
        lines.append(f"*Last updated: {updated}*")

    lines.append("")
    lines.append(f"_Status summary auto-generated from the reminder '{(r.raw_request or '').strip()[:100]}'._")
    return "\n".join(lines)


async def _render_gap_brief(db: AsyncSession, r: Reminder) -> str | None:
    gap = await db.scalar(
        select(Gap).where(
            Gap.project_id == r.project_id,
            Gap.gap_id == r.subject_id,
        )
    )
    if gap is None:
        return None

    lines = [
        f"# Status: {gap.gap_id} — {(gap.question or '').strip()[:80]}",
        "",
        f"**Severity:** {gap.severity or 'medium'}  ·  "
        f"**Area:** {gap.area or 'general'}  ·  "
        f"**Status:** {gap.status or 'open'}",
        "",
    ]
    if gap.question:
        lines += ["## Question", "", gap.question.strip(), ""]
    if gap.suggested_action:
        lines += ["## Suggested action", "", gap.suggested_action.strip(), ""]
    blocked = gap.blocked_reqs or []
    if blocked:
        lines.append(f"## Blocks ({len(blocked)} requirements)")
        lines.append("")
        for rid in blocked[:8]:
            lines.append(f"- {rid}")
        if len(blocked) > 8:
            lines.append(f"_+ {len(blocked) - 8} more_")
        lines.append("")
    if gap.updated_at:
        updated = gap.updated_at.astimezone().strftime("%Y-%m-%d %H:%M %Z")
        lines.append(f"*Last updated: {updated}*")
    lines.append("")
    lines.append(f"_Status summary auto-generated from the reminder '{(r.raw_request or '').strip()[:100]}'._")
    return "\n".join(lines)
