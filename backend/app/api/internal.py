"""Internal endpoints — only nginx talks to these, never the browser.

Currently:
  GET /api/internal/auth/verify-vault-access?project_id=...
      Used by the nginx ``auth_request`` directive in front of the
      git-http-backend block. Returns 200 if the Authorization header
      bears a PAT (or JWT) that maps to a project member of the named
      project, 403 otherwise.

The endpoint MUST NOT be exposed to the public internet — set
``allow 127.0.0.1; deny all;`` on this location in nginx, or rely on
service-mesh isolation. We don't enforce that at the FastAPI layer
because the verification logic itself is safe (it just answers
yes/no with no PII echoed back); locking the location is a defence
in depth.
"""

from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.project import ProjectMember


router = APIRouter(prefix="/api/internal", tags=["internal"])


@router.get("/auth/verify-vault-access")
async def verify_vault_access(
    project_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return 200 if the authenticated user has read access to the
    project's vault repo, 403 otherwise. Used by the nginx
    ``auth_request`` directive to gate ``git-http-backend`` calls.

    Auth flows through the existing ``get_current_user`` dep, so both
    web JWTs and ``dsc_…`` PATs work — same identity model as the
    web UI and the HTTP MCP route.
    """
    if user.is_admin:
        return {"ok": True}
    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No vault access")
    return {"ok": True}
