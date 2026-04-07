"""Slack channel link management API.

Endpoints:
    GET    /api/projects/{id}/slack/channels            — linked channels
    GET    /api/projects/{id}/slack/channels/available  — channels from Slack
    POST   /api/projects/{id}/slack/channels            — add link
    DELETE /api/projects/{id}/slack/channels/{chan_id}  — remove link

All mutating endpoints trigger manager.restart_for_project.
"""

import uuid
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from slack_sdk.web.async_client import AsyncWebClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.operational import ProjectIntegration
from app.models.slack import SlackChannelLink
from app.services.secrets import decrypt_config
from app.slack.manager import manager

log = structlog.get_logger()

router = APIRouter(tags=["slack-channels"])


class AddChannelRequest(BaseModel):
    channel_id: str
    channel_name: str | None = None


async def _get_slack_bot_token(
    db: AsyncSession, project_id: uuid.UUID,
) -> tuple[str, str]:
    """Returns (bot_token, team_id) for the project's Slack integration, or raises 400."""
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == "slack",
            ProjectIntegration.status == "active",
        )
    )
    integ = result.scalar_one_or_none()
    if not integ:
        raise HTTPException(status_code=400, detail="Slack is not connected for this project.")
    try:
        config = decrypt_config(integ.config_encrypted)
    except Exception:
        raise HTTPException(status_code=500, detail="Could not decrypt Slack config.")
    bot_token = config.get("slack_bot_token")
    if not bot_token:
        raise HTTPException(status_code=400, detail="No Slack bot token stored.")
    team_id = (integ.metadata_public or {}).get("team_id") or config.get("slack_team_id") or ""
    return bot_token, team_id


@router.get("/api/projects/{project_id}/slack/channels")
async def list_linked_channels(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SlackChannelLink).where(SlackChannelLink.project_id == project_id)
    )
    rows = result.scalars().all()
    return {
        "channels": [
            {
                "id": str(r.id),
                "channel_id": r.channel_id,
                "channel_name": r.channel_name,
                "team_id": r.team_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.get("/api/projects/{project_id}/slack/channels/available")
async def list_available_channels(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Call Slack's conversations.list to fetch all channels the bot can see."""
    bot_token, _ = await _get_slack_bot_token(db, project_id)
    client = AsyncWebClient(token=bot_token)

    try:
        # conversations.list with channel types; limit 200 is a reasonable page
        resp = await client.conversations_list(
            types="public_channel,private_channel",
            limit=200,
            exclude_archived=True,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Slack API error: {e}")

    channels_raw: list[dict] = []
    if hasattr(resp, "data") and isinstance(resp.data, dict):
        channels_raw = resp.data.get("channels", []) or []
    elif isinstance(resp, dict):
        channels_raw = resp.get("channels", []) or []

    channels = [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "is_private": c.get("is_private", False),
            "is_member": c.get("is_member", False),
            "num_members": c.get("num_members"),
        }
        for c in channels_raw
        if c.get("id")
    ]
    return {"channels": channels}


@router.post("/api/projects/{project_id}/slack/channels")
async def add_linked_channel(
    project_id: uuid.UUID,
    body: AddChannelRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    bot_token, team_id = await _get_slack_bot_token(db, project_id)
    if not team_id:
        # Fetch from auth.test
        client = AsyncWebClient(token=bot_token)
        try:
            auth = await client.auth_test()
            team_id = (auth.data if hasattr(auth, "data") else auth).get("team_id", "")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Slack auth.test failed: {e}")

    # Upsert
    existing = await db.execute(
        select(SlackChannelLink).where(
            SlackChannelLink.team_id == team_id,
            SlackChannelLink.channel_id == body.channel_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        if row.project_id != project_id:
            raise HTTPException(
                status_code=409,
                detail="This channel is already linked to a different project.",
            )
        row.channel_name = body.channel_name or row.channel_name
    else:
        row = SlackChannelLink(
            project_id=project_id,
            team_id=team_id,
            channel_id=body.channel_id,
            channel_name=body.channel_name,
        )
        db.add(row)
    await db.commit()

    # Restart listener so the new channel is picked up
    try:
        await manager.restart_for_project(project_id)
    except Exception as e:
        log.warning("restart_for_project failed", error=str(e))

    return {"status": "ok", "id": str(row.id)}


@router.delete("/api/projects/{project_id}/slack/channels/{channel_id}")
async def remove_linked_channel(
    project_id: uuid.UUID,
    channel_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SlackChannelLink).where(
            SlackChannelLink.project_id == project_id,
            SlackChannelLink.channel_id == channel_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Channel link not found.")
    await db.delete(row)
    await db.commit()

    try:
        await manager.restart_for_project(project_id)
    except Exception as e:
        log.warning("restart_for_project failed", error=str(e))

    return {"status": "ok"}
