"""Bootstrap endpoint — single round-trip that returns everything a
team-member's laptop needs to start using Crnogorchi locally.

Called by ``discovery setup <project_id>`` from the shell CLI:

    GET /api/projects/{id}/bootstrap
    Authorization: Bearer <web-JWT>

Returns the vault clone URL, a freshly minted user-scoped PAT, the
``.mcp.json`` template (URL + headers), the linked code repos, and
the project slug. The CLI uses this to:
  - git clone the vault into ~/discovery/<slug>/
  - write ~/discovery/<slug>/.mcp.json
  - prompt the user for code-repo locations (Phase 4)

Each call mints a NEW PAT — the old one stays valid until the user
revokes it from the web UI. We bias toward many short-lived tokens
over one long-lived shared token.

Auth: web JWT (the human in front of the browser). PATs cannot mint
PATs — preventing escalation if a laptop is stolen, the attacker
can't bootstrap a fresh laptop with the stolen token alone.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError, jwt

from app.config import settings
from app.db.session import get_db
from app.models.auth import User
from app.models.project import Project, ProjectMember, ProjectRepo
from app.services.api_tokens import create_token, TOKEN_PREFIX


router = APIRouter(prefix="/api/projects", tags=["bootstrap"])


_security = HTTPBearer(auto_error=True)


async def _require_jwt_user(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """JWT-only auth dep for bootstrap. We deliberately reject PATs
    here — bootstrap mints a PAT, so requiring a fresh JWT for the
    call closes the "PAT mints PAT" escalation hole. The web UI is
    the only place that issues JWTs."""
    raw = credentials.credentials
    if raw.startswith(TOKEN_PREFIX):
        raise HTTPException(401, "Bootstrap requires a web session, not a PAT")
    try:
        payload = jwt.decode(raw, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Invalid token")
    except JWTError:
        raise HTTPException(401, "Invalid token")
    user = (await db.execute(select(User).where(User.id == uuid.UUID(user_id)))).scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "User not found")
    return user


# ─── Response shape ───────────────────────────────────────────────────


class LinkedRepoOut(BaseModel):
    name: str
    url: str
    provider: str
    default_branch: str


class BootstrapResponse(BaseModel):
    project_id: str
    project_slug: str
    project_name: str
    vault_clone_url: str
    user_pat: str
    mcp_config: dict
    linked_repos: list[LinkedRepoOut]
    public_url: str
    min_cli_version: str = "0.1.0"


# ─── Helpers ──────────────────────────────────────────────────────────


def _slugify(name: str, fallback: str) -> str:
    """Make a filesystem-friendly slug from the project name. Falls
    back to a short id if the name is empty or pure non-alphanumerics."""
    s = (name or "").lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s).strip("-")
    s = re.sub(r"-+", "-", s)
    return s or fallback


# ─── Endpoint ─────────────────────────────────────────────────────────


@router.get("/{project_id}/bootstrap", response_model=BootstrapResponse)
async def bootstrap(
    project_id: uuid.UUID,
    user: User = Depends(_require_jwt_user),
    db: AsyncSession = Depends(get_db),
) -> BootstrapResponse:
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if project is None:
        raise HTTPException(404, "Project not found")

    # Membership gate. Admins bypass.
    if not user.is_admin:
        member = (
            await db.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if member is None:
            raise HTTPException(403, "No access to this project")

    # Mint a fresh project-scoped PAT for this laptop. Name carries
    # the user email + timestamp so the user can identify it on the
    # tokens page later. 90-day expiry is a sensible default; users
    # rotate via `discovery refresh-token`.
    expires_at = datetime.now(timezone.utc) + timedelta(days=90)
    token_name = f"discovery cli — {user.email} — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    token_row, plaintext = await create_token(
        db,
        user_id=user.id,
        name=token_name,
        expires_at=expires_at,
        scopes={"project_id": str(project_id), "kind": "discovery-cli"},
    )
    await db.commit()

    # Linked code repos (read-only metadata; team member's laptop
    # uses their own git auth to clone these).
    repos_rows = (
        await db.execute(
            select(ProjectRepo).where(ProjectRepo.project_id == project_id)
        )
    ).scalars().all()
    repos = [
        LinkedRepoOut(
            name=r.name,
            url=r.url,
            provider=r.provider or "github",
            default_branch=r.default_branch or "main",
        )
        for r in repos_rows
    ]

    public = settings.public_url.rstrip("/")
    vault_url = f"{public}/vaults/{project_id}.git"
    mcp_url = f"{public}/mcp/{project_id}"

    mcp_config = {
        "mcpServers": {
            "discovery": {
                "url": mcp_url,
                "headers": {"Authorization": f"Bearer {plaintext}"},
            }
        }
    }

    slug = _slugify(project.name or "", fallback=str(project_id)[:8])

    return BootstrapResponse(
        project_id=str(project_id),
        project_slug=slug,
        project_name=project.name or slug,
        vault_clone_url=vault_url,
        user_pat=plaintext,
        mcp_config=mcp_config,
        linked_repos=repos,
        public_url=public,
    )
