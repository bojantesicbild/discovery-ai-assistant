"""Meeting agenda API — get/save the PM-editable meeting agenda."""

import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.meeting import MeetingAgenda

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}/meeting-agenda", tags=["meeting"])


class AgendaResponse(BaseModel):
    id: str | None = None
    content_md: str
    round_number: int = 1
    created_at: str | None = None
    edited_at: str | None = None


class AgendaSaveRequest(BaseModel):
    content_md: str


@router.get("", response_model=AgendaResponse)
async def get_latest_agenda(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recent meeting agenda for this project."""
    result = await db.execute(
        select(MeetingAgenda)
        .where(MeetingAgenda.project_id == project_id)
        .order_by(MeetingAgenda.created_at.desc())
        .limit(1)
    )
    agenda = result.scalar_one_or_none()
    if not agenda:
        return AgendaResponse(content_md="", round_number=0)
    return AgendaResponse(
        id=str(agenda.id),
        content_md=agenda.content_md,
        round_number=agenda.round_number,
        created_at=agenda.created_at.isoformat() if agenda.created_at else None,
        edited_at=agenda.edited_at.isoformat() if agenda.edited_at else None,
    )


@router.put("")
async def save_agenda(
    project_id: uuid.UUID,
    body: AgendaSaveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save or update the meeting agenda. Called when:
    - The agent generates a new agenda (content_md = agent response)
    - The PM edits the agenda in the markdown editor"""
    # Find latest or create new
    result = await db.execute(
        select(MeetingAgenda)
        .where(MeetingAgenda.project_id == project_id)
        .order_by(MeetingAgenda.created_at.desc())
        .limit(1)
    )
    agenda = result.scalar_one_or_none()

    if agenda:
        agenda.content_md = body.content_md
        agenda.edited_at = datetime.now(timezone.utc)
    else:
        max_round = await db.scalar(
            select(func.max(MeetingAgenda.round_number)).where(MeetingAgenda.project_id == project_id)
        )
        agenda = MeetingAgenda(
            project_id=project_id,
            content_md=body.content_md,
            generated_by=user.id,
            round_number=(max_round or 0) + 1,
        )
        db.add(agenda)

    await db.commit()
    return {"status": "saved"}


@router.post("/new")
async def create_new_agenda(
    project_id: uuid.UUID,
    body: AgendaSaveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a NEW agenda round (preserves the previous one). Called when
    the agent generates a fresh agenda."""
    max_round = await db.scalar(
        select(func.max(MeetingAgenda.round_number)).where(MeetingAgenda.project_id == project_id)
    )
    agenda = MeetingAgenda(
        project_id=project_id,
        content_md=body.content_md,
        generated_by=user.id,
        round_number=(max_round or 0) + 1,
    )
    db.add(agenda)
    await db.commit()
    return {"status": "created", "round_number": agenda.round_number}
