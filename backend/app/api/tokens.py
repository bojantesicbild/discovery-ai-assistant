"""HTTP endpoints for Personal Access Tokens.

Multi-user stage 1. All routes here are authenticated via the existing
session cookie / JWT — tokens are a secondary auth mechanism, not a
bootstrap one. PAT-via-Bearer is handled by the extended get_current_user
dependency.

Routes:

  POST   /api/tokens                — create; returns plaintext ONCE
  GET    /api/tokens                — list the current user's tokens (no plaintext)
  POST   /api/tokens/{id}/revoke    — soft-revoke
  POST   /api/auth/mcp-verify       — MCP subprocess swaps plaintext for identity

Rate limiting + audit logging are not implemented here; keep the
surface small until a second real user exists to motivate them.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import ApiToken, User
from app.services.api_tokens import (
    create_token, list_tokens_for_user, revoke_token, verify_token,
)


router = APIRouter(tags=["tokens"])


# ── Request / response shapes ─────────────────────────────────────────


class CreateTokenBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    expires_at: datetime | None = None
    scopes: dict[str, Any] | None = None


class VerifyBody(BaseModel):
    token: str = Field(..., min_length=10)


def _token_to_dict(row: ApiToken) -> dict[str, Any]:
    """Serialize an ApiToken for list/create responses.
    Never includes token_hash or the plaintext."""
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "name": row.name,
        "scopes": row.scopes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


# ── Management (session-authed) ───────────────────────────────────────


@router.post("/api/tokens")
async def post_create_token(
    body: CreateTokenBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new PAT for the current user. Plaintext is returned
    ONCE in the response — the client must store it immediately."""
    try:
        row, plaintext = await create_token(
            db, user_id=user.id,
            name=body.name,
            expires_at=body.expires_at,
            scopes=body.scopes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return {
        **_token_to_dict(row),
        "token": plaintext,
        "note": "Store this token now — it will not be shown again.",
    }


@router.get("/api/tokens")
async def get_list_tokens(
    include_revoked: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_tokens_for_user(
        db, user_id=user.id, include_revoked=include_revoked,
    )
    return {"tokens": [_token_to_dict(r) for r in rows], "total": len(rows)}


@router.post("/api/tokens/{token_id}/revoke")
async def post_revoke_token(
    token_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await revoke_token(db, token_id=token_id, user_id=user.id)
    if row is None:
        raise HTTPException(404, "Token not found")
    await db.commit()
    return _token_to_dict(row)


# ── MCP verify (token-authed) ─────────────────────────────────────────


@router.post("/api/auth/mcp-verify")
async def post_mcp_verify(
    body: VerifyBody = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """MCP subprocess calls this at startup with its PAT. Returns the
    user identity + the projects the user can touch.

    This endpoint is intentionally unauthenticated at the FastAPI
    layer — the token in the body IS the auth. We never echo the
    token back; the client already has it.
    """
    from app.models.project import ProjectMember
    from sqlalchemy import select as _select

    result = await verify_token(db, plaintext=body.token)
    if result is None:
        raise HTTPException(401, "Invalid or revoked token")
    token_row, user = result
    await db.commit()

    # Which projects can this user touch? The MCP caches this at
    # startup so per-call permission checks don't round-trip the DB.
    member_rows = (await db.execute(
        _select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
    )).all()
    allowed = [str(r[0]) for r in member_rows]

    return {
        "user_id": str(user.id),
        "email": user.email,
        "name": user.name,
        "is_admin": user.is_admin,
        "allowed_project_ids": allowed,
        "token_id": str(token_row.id),
    }
