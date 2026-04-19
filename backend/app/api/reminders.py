"""Reminders API — schedule prep + delivery for a future moment.

The PM types "remind me to check BR-003 with Sara tomorrow, prep me insights"
in chat. The orchestrator parses it and calls the `schedule_reminder` MCP
tool, which POSTs here. A periodic worker (see `worker.py:scan_due_reminders`)
wakes up, runs discovery-prep-agent, and delivers the brief via the chosen
channel."""

import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.extraction import Requirement, Gap
from app.models.reminder import Reminder, SUBJECT_TYPES, CHANNELS, STATUSES

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}/reminders", tags=["reminders"])

# v1: slack channel is reserved but not yet wired end-to-end. Requests
# targeting it are rejected at create time so the orchestrator can ask
# the PM to pick a different channel instead of queuing a dead row.
SUPPORTED_CHANNELS = {"gmail", "in_app"}


class ReminderCreate(BaseModel):
    subject_type: str = Field(..., description="requirement | gap | free")
    subject_id: str | None = Field(None, description="BR-003 / GAP-012 / null for free-text")
    person: str | None = None
    raw_request: str = Field(..., description="Original PM phrasing — audit trail")
    due_at: datetime
    prep_lead_hours: float = Field(6.0, ge=0, le=168)
    channel: str
    prep_agent: str = "discovery-prep-agent"


class ReminderOut(BaseModel):
    id: str
    project_id: str
    subject_type: str
    subject_id: str | None
    person: str | None
    raw_request: str
    due_at: str
    prep_lead_hours: float
    channel: str
    prep_agent: str
    status: str
    prepared_at: str | None
    delivered_at: str | None
    prep_output_path: str | None
    external_ref: str | None
    error_message: str | None
    created_at: str


def _serialize(r: Reminder) -> ReminderOut:
    return ReminderOut(
        id=str(r.id),
        project_id=str(r.project_id),
        subject_type=r.subject_type,
        subject_id=r.subject_id,
        person=r.person,
        raw_request=r.raw_request,
        due_at=r.due_at.isoformat(),
        prep_lead_hours=r.prep_lead.total_seconds() / 3600,
        channel=r.channel,
        prep_agent=r.prep_agent,
        status=r.status,
        prepared_at=r.prepared_at.isoformat() if r.prepared_at else None,
        delivered_at=r.delivered_at.isoformat() if r.delivered_at else None,
        prep_output_path=r.prep_output_path,
        external_ref=r.external_ref,
        error_message=r.error_message,
        created_at=r.created_at.isoformat() if r.created_at else "",
    )


async def _validate_subject(
    db: AsyncSession, project_id: uuid.UUID, subject_type: str, subject_id: str | None
) -> None:
    """Verify the subject exists in this project at create time so the
    orchestrator can ask the PM to clarify instead of silently delivering
    a brief about a non-existent BR."""
    if subject_type == "free":
        return
    if subject_type not in {"requirement", "gap"}:
        raise HTTPException(400, f"subject_type must be one of {sorted(SUBJECT_TYPES)}")
    if not subject_id:
        raise HTTPException(400, f"subject_id is required when subject_type='{subject_type}'")

    if subject_type == "requirement":
        hit = await db.scalar(
            select(Requirement.id).where(
                Requirement.project_id == project_id,
                Requirement.req_id == subject_id,
            )
        )
    else:  # gap
        hit = await db.scalar(
            select(Gap.id).where(
                Gap.project_id == project_id,
                Gap.gap_id == subject_id,
            )
        )
    if not hit:
        raise HTTPException(404, f"{subject_id} not found in this project")


@router.post("", response_model=ReminderOut)
async def create_reminder(
    project_id: uuid.UUID,
    body: ReminderCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.channel not in SUPPORTED_CHANNELS:
        raise HTTPException(
            400,
            f"channel '{body.channel}' not supported in v1. Pick one of {sorted(SUPPORTED_CHANNELS)}",
        )
    if body.due_at <= datetime.now(timezone.utc):
        raise HTTPException(400, "due_at must be in the future")

    await _validate_subject(db, project_id, body.subject_type, body.subject_id)

    reminder = Reminder(
        project_id=project_id,
        created_by_user_id=user.id,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        person=body.person,
        raw_request=body.raw_request,
        due_at=body.due_at,
        prep_lead=timedelta(hours=body.prep_lead_hours),
        channel=body.channel,
        prep_agent=body.prep_agent,
        status="pending",
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    log.info("reminder.created", id=str(reminder.id), due_at=reminder.due_at.isoformat(), channel=reminder.channel)
    return _serialize(reminder)


@router.get("", response_model=list[ReminderOut])
async def list_reminders(
    project_id: uuid.UUID,
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Reminder).where(Reminder.project_id == project_id).order_by(Reminder.due_at.asc())
    if status:
        if status not in STATUSES:
            raise HTTPException(400, f"status must be one of {sorted(STATUSES)}")
        q = q.where(Reminder.status == status)
    result = await db.execute(q)
    return [_serialize(r) for r in result.scalars().all()]


@router.delete("/{reminder_id}")
async def cancel_reminder(
    project_id: uuid.UUID,
    reminder_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    reminder = await db.scalar(
        select(Reminder).where(
            Reminder.id == reminder_id,
            Reminder.project_id == project_id,
        )
    )
    if not reminder:
        raise HTTPException(404, "reminder not found")
    if reminder.status in {"delivered", "canceled"}:
        return {"status": reminder.status, "noop": True}
    reminder.status = "canceled"
    await db.commit()
    log.info("reminder.canceled", id=str(reminder_id))
    return {"status": "canceled"}
