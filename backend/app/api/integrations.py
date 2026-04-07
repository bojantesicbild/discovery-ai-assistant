"""Connector / integration management API.

Endpoints:
    GET    /api/integrations/catalog                          — public connector catalog
    GET    /api/projects/{project_id}/integrations            — list enabled for project
    POST   /api/projects/{project_id}/integrations            — add token-based connector
    DELETE /api/projects/{project_id}/integrations/{conn_id}  — remove connector
    GET    /api/projects/{project_id}/integrations/google/authorize — start Google OAuth
    GET    /api/integrations/google/callback                  — OAuth callback
"""

import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.operational import ProjectIntegration
from app.services.connector_catalog import (
    CONNECTORS,
    GOOGLE_SCOPES,
    get_connector,
    list_catalog,
)
from app.services.secrets import decrypt_config, encrypt_config

log = structlog.get_logger()

router = APIRouter(tags=["integrations"])

# In-memory OAuth state store: state_token -> {project_id, user_id, created_at}
# For production, move this to Redis with a TTL.
_oauth_states: dict[str, dict] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Catalog
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/integrations/catalog")
async def get_catalog(user: User = Depends(get_current_user)):
    """Return the full public connector catalog."""
    return {"connectors": list_catalog()}


# ─────────────────────────────────────────────────────────────────────────────
# List / Add / Remove (project-scoped)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/integrations")
async def list_integrations(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List enabled connectors for a project (without decrypting secrets)."""
    result = await db.execute(
        select(ProjectIntegration).where(ProjectIntegration.project_id == project_id)
    )
    rows = result.scalars().all()
    return {
        "integrations": [
            {
                "id": str(r.id),
                "connector_id": r.connector_id,
                "status": r.status,
                "error_message": r.error_message,
                "metadata": r.metadata_public or {},
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "last_verified_at": r.last_verified_at.isoformat() if r.last_verified_at else None,
            }
            for r in rows
        ]
    }


class AddIntegrationRequest(BaseModel):
    connector_id: str
    config: dict[str, Any]


@router.post("/api/projects/{project_id}/integrations")
async def add_integration(
    project_id: uuid.UUID,
    body: AddIntegrationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a token-paste connector (e.g. Slack). OAuth connectors use the
    /authorize + /callback flow instead."""
    connector = get_connector(body.connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Unknown connector: {body.connector_id}")

    auth_type = connector["auth"]["type"]
    if auth_type != "token_paste":
        raise HTTPException(
            status_code=400,
            detail=f"Connector '{body.connector_id}' requires OAuth. Use /authorize endpoint.",
        )

    # Validate required fields
    required_keys = [f["key"] for f in connector["auth"]["fields"] if f.get("required")]
    missing = [k for k in required_keys if not body.config.get(k)]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Missing required fields: {', '.join(missing)}"
        )

    # Slack-specific: auto-fetch team_id via auth.test if missing.
    # @modelcontextprotocol/server-slack requires SLACK_TEAM_ID at startup,
    # so we must ensure it's stored in the config regardless of whether
    # the user entered it manually.
    if body.connector_id == "slack":
        bot_token = body.config.get("slack_bot_token")
        if bot_token and not body.config.get("slack_team_id"):
            try:
                from slack_sdk.web.async_client import AsyncWebClient
                client = AsyncWebClient(token=bot_token)
                auth = await client.auth_test()
                data = auth.data if hasattr(auth, "data") else auth
                team_id = data.get("team_id") if isinstance(data, dict) else None
                if team_id:
                    body.config["slack_team_id"] = team_id
                    log.info("Auto-fetched Slack team_id", team_id=team_id)
            except Exception as e:
                log.warning("auth.test failed during Slack add", error=str(e))
                raise HTTPException(
                    status_code=400,
                    detail=f"Slack auth.test failed — token may be invalid: {e}",
                )

    # Upsert
    existing = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == body.connector_id,
        )
    )
    row = existing.scalar_one_or_none()

    metadata_public = _build_metadata_public(connector, body.config)

    if row:
        row.config_encrypted = encrypt_config(body.config)
        row.metadata_public = metadata_public
        row.status = "active"
        row.error_message = None
        row.last_verified_at = datetime.now(timezone.utc)
    else:
        row = ProjectIntegration(
            project_id=project_id,
            connector_id=body.connector_id,
            config_encrypted=encrypt_config(body.config),
            metadata_public=metadata_public,
            status="active",
            last_verified_at=datetime.now(timezone.utc),
        )
        db.add(row)

    await db.commit()
    log.info("Integration added", connector=body.connector_id, project=str(project_id)[:8])
    return {"status": "ok", "id": str(row.id)}


@router.delete("/api/projects/{project_id}/integrations/{connector_id}")
async def remove_integration(
    project_id: uuid.UUID,
    connector_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == connector_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    await db.delete(row)
    await db.commit()
    log.info("Integration removed", connector=connector_id, project=str(project_id)[:8])
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# Google OAuth flow (shared by Gmail + Drive)
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


@router.get("/api/projects/{project_id}/integrations/google/authorize")
async def google_authorize(
    project_id: uuid.UUID,
    connector_id: str = Query(..., description="gmail or google_drive (triggers shared flow)"),
    user: User = Depends(get_current_user),
):
    """Start Google OAuth flow. Returns a redirect URL the frontend opens."""
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth not configured on the server. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in backend/.env",
        )

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "project_id": str(project_id),
        "user_id": str(user.id),
        "connector_id": connector_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # force refresh_token on every run
        "state": state,
    }
    return {"authorize_url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}


@router.get("/api/integrations/google/callback")
async def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth callback. Exchanges code -> tokens, persists, and
    redirects the browser back to the frontend."""
    state_data = _oauth_states.pop(state, None)
    if not state_data:
        return _frontend_redirect(error="invalid_state")

    project_id = uuid.UUID(state_data["project_id"])
    connector_id = state_data["connector_id"]

    # Exchange code for tokens
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            token_resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_oauth_client_id,
                    "client_secret": settings.google_oauth_client_secret,
                    "redirect_uri": settings.google_oauth_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()
        except httpx.HTTPError as e:
            log.error("Google token exchange failed", error=str(e))
            return _frontend_redirect(error="token_exchange_failed")

        refresh_token = tokens.get("refresh_token")
        access_token = tokens.get("access_token")
        if not refresh_token:
            log.error("Google OAuth returned no refresh_token", tokens=tokens)
            return _frontend_redirect(error="no_refresh_token")

        # Fetch user info for display
        user_email = None
        try:
            info_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if info_resp.status_code == 200:
                user_email = info_resp.json().get("email")
        except httpx.HTTPError:
            pass  # non-fatal

    config = {"refresh_token": refresh_token}
    metadata_public = {"email": user_email, "provider": "google", "scopes": GOOGLE_SCOPES}

    # Persist for BOTH gmail and google_drive — they share Google credentials.
    # This gives a true one-click experience: consent once → both active.
    for cid in ("gmail", "google_drive"):
        existing = await db.execute(
            select(ProjectIntegration).where(
                ProjectIntegration.project_id == project_id,
                ProjectIntegration.connector_id == cid,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.config_encrypted = encrypt_config(config)
            row.metadata_public = metadata_public
            row.status = "active"
            row.error_message = None
            row.last_verified_at = datetime.now(timezone.utc)
        else:
            db.add(ProjectIntegration(
                project_id=project_id,
                connector_id=cid,
                config_encrypted=encrypt_config(config),
                metadata_public=metadata_public,
                status="active",
                last_verified_at=datetime.now(timezone.utc),
            ))

    await db.commit()
    log.info("Google integration connected", project=str(project_id)[:8], email=user_email)
    return _frontend_redirect(success=True, project_id=str(project_id))


# ─────────────────────────────────────────────────────────────────────────────
# Gmail — list & import messages as Documents
# ─────────────────────────────────────────────────────────────────────────────

async def _get_gmail_refresh_token(
    project_id: uuid.UUID,
    db: AsyncSession,
) -> str:
    """Look up the stored Gmail refresh token for this project."""
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == "gmail",
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Gmail integration not connected for this project")
    config = decrypt_config(row.config_encrypted)
    refresh_token = config.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Gmail integration has no refresh token — reconnect")
    return refresh_token


@router.get("/api/projects/{project_id}/integrations/gmail/messages")
async def list_gmail_messages(
    project_id: uuid.UUID,
    q: str | None = Query(None, description="Gmail search query, e.g. 'from:acme.com newer_than:30d'"),
    max_results: int = Query(25, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List recent messages from the connected Gmail account."""
    from app.services import gmail as gmail_service

    refresh_token = await _get_gmail_refresh_token(project_id, db)
    try:
        access_token = await gmail_service.get_access_token(refresh_token)
        messages = await gmail_service.list_messages(access_token, query=q, max_results=max_results)
    except httpx.HTTPError as e:
        log.error("Gmail list failed", error=str(e))
        raise HTTPException(status_code=502, detail=f"Gmail API error: {e}")

    return {"messages": messages, "query": q}


class GmailImportRequest(BaseModel):
    message_ids: list[str]


@router.post("/api/projects/{project_id}/integrations/gmail/import")
async def import_gmail_messages(
    project_id: uuid.UUID,
    body: GmailImportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import the selected Gmail messages as Documents and queue them for
    extraction. Each message becomes a markdown document with frontmatter."""
    from app.services import gmail as gmail_service
    from app.agent.claude_runner import claude_runner
    from app.models.document import Document
    from app.models.operational import ActivityLog

    if not body.message_ids:
        raise HTTPException(status_code=400, detail="No message_ids provided")

    refresh_token = await _get_gmail_refresh_token(project_id, db)
    try:
        access_token = await gmail_service.get_access_token(refresh_token)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Gmail token refresh failed: {e}")

    upload_dir = claude_runner.get_upload_dir(project_id)
    imported: list[dict] = []
    skipped: list[dict] = []

    for mid in body.message_ids:
        try:
            message = await gmail_service.get_message_full(access_token, mid)
        except httpx.HTTPError as e:
            skipped.append({"id": mid, "reason": f"fetch failed: {e}"})
            continue

        body_text = gmail_service.extract_body_text(message)
        filename, markdown = gmail_service.format_as_document(message, body_text)

        # Avoid re-importing the same message
        existing = await db.execute(
            select(Document).where(
                Document.project_id == project_id,
                Document.filename == filename,
            )
        )
        if existing.scalar_one_or_none():
            skipped.append({"id": mid, "reason": "already imported"})
            continue

        safe_name = f"{uuid.uuid4().hex[:8]}_{filename}"
        file_path = upload_dir / safe_name
        file_path.write_text(markdown, encoding="utf-8")

        doc = Document(
            project_id=project_id,
            filename=filename,
            file_type="md",
            file_size_bytes=len(markdown.encode("utf-8")),
            pipeline_stage="queued",
            classification={
                "file_path": str(file_path),
                "source": "gmail",
                "gmail_message_id": mid,
            },
        )
        db.add(doc)
        await db.flush()

        # Queue extraction
        try:
            from arq import create_pool
            from arq.connections import RedisSettings
            pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
            await pool.enqueue_job("process_document", str(doc.id))
            await pool.close()
        except Exception:
            pass

        imported.append({"id": mid, "document_id": str(doc.id), "filename": filename})

    if imported:
        db.add(ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="gmail_messages_imported",
            summary=f"Imported {len(imported)} email{'s' if len(imported) != 1 else ''} from Gmail",
            details={"count": len(imported), "skipped": len(skipped)},
        ))

    await db.commit()
    log.info("Gmail import done", project=str(project_id)[:8], imported=len(imported), skipped=len(skipped))
    return {"imported": imported, "skipped": skipped}


# ─────────────────────────────────────────────────────────────────────────────
# Google Drive — list & import files as Documents
# ─────────────────────────────────────────────────────────────────────────────

async def _get_drive_refresh_token(project_id: uuid.UUID, db: AsyncSession) -> str:
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == "google_drive",
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Google Drive integration not connected for this project")
    config = decrypt_config(row.config_encrypted)
    refresh_token = config.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Google Drive integration has no refresh token — reconnect")
    return refresh_token


@router.get("/api/projects/{project_id}/integrations/google_drive/files")
async def list_drive_files(
    project_id: uuid.UUID,
    q: str | None = Query(None, description="Drive `q` query"),
    max_results: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import google_drive

    refresh_token = await _get_drive_refresh_token(project_id, db)
    try:
        access_token = await google_drive.get_access_token(refresh_token)
        files = await google_drive.list_files(access_token, query=q, page_size=max_results)
    except httpx.HTTPError as e:
        log.error("Drive list failed", error=str(e))
        raise HTTPException(status_code=502, detail=f"Google Drive API error: {e}")

    # Mark each file as supported / unsupported so the UI can disable rows it
    # can't actually ingest.
    for f in files:
        f["supported"] = google_drive.is_supported(f.get("mimeType", ""))
    return {"files": files, "query": q}


class DriveImportRequest(BaseModel):
    file_ids: list[str]


@router.post("/api/projects/{project_id}/integrations/google_drive/import")
async def import_drive_files(
    project_id: uuid.UUID,
    body: DriveImportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import google_drive
    from app.agent.claude_runner import claude_runner
    from app.models.document import Document
    from app.models.operational import ActivityLog

    if not body.file_ids:
        raise HTTPException(status_code=400, detail="No file_ids provided")

    refresh_token = await _get_drive_refresh_token(project_id, db)
    try:
        access_token = await google_drive.get_access_token(refresh_token)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Drive token refresh failed: {e}")

    upload_dir = claude_runner.get_upload_dir(project_id)
    imported: list[dict] = []
    skipped: list[dict] = []

    for fid in body.file_ids:
        try:
            meta = await google_drive.get_file_metadata(access_token, fid)
        except httpx.HTTPError as e:
            skipped.append({"id": fid, "reason": f"metadata fetch failed: {e}"})
            continue

        mime = meta.get("mimeType", "")
        if not google_drive.is_supported(mime):
            skipped.append({"id": fid, "reason": f"unsupported type: {mime}"})
            continue

        try:
            content, ext, _ = await google_drive.fetch_file_content(access_token, fid, mime)
        except httpx.HTTPError as e:
            skipped.append({"id": fid, "reason": f"download failed: {e}"})
            continue

        filename = google_drive.safe_filename(meta.get("name", "drive_file"), ext)

        existing = await db.execute(
            select(Document).where(
                Document.project_id == project_id,
                Document.filename == filename,
            )
        )
        if existing.scalar_one_or_none():
            skipped.append({"id": fid, "reason": "already imported"})
            continue

        safe_name = f"{uuid.uuid4().hex[:8]}_{filename}"
        file_path = upload_dir / safe_name
        file_path.write_bytes(content)

        doc = Document(
            project_id=project_id,
            filename=filename,
            file_type=ext,
            file_size_bytes=len(content),
            pipeline_stage="queued",
            classification={
                "file_path": str(file_path),
                "source": "google_drive",
                "drive_file_id": fid,
                "drive_url": meta.get("webViewLink"),
            },
        )
        db.add(doc)
        await db.flush()

        try:
            from arq import create_pool
            from arq.connections import RedisSettings
            pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
            await pool.enqueue_job("process_document", str(doc.id))
            await pool.close()
        except Exception:
            pass

        imported.append({"id": fid, "document_id": str(doc.id), "filename": filename})

    if imported:
        db.add(ActivityLog(
            project_id=project_id,
            user_id=user.id,
            action="drive_files_imported",
            summary=f"Imported {len(imported)} file{'s' if len(imported) != 1 else ''} from Google Drive",
            details={"count": len(imported), "skipped": len(skipped)},
        ))

    await db.commit()
    log.info("Drive import done", project=str(project_id)[:8], imported=len(imported), skipped=len(skipped))
    return {"imported": imported, "skipped": skipped}


# ─────────────────────────────────────────────────────────────────────────────
# Per-connector settings (defaults for retrieval forms)
# ─────────────────────────────────────────────────────────────────────────────

class IntegrationSettingsRequest(BaseModel):
    settings: dict[str, Any]


@router.get("/api/projects/{project_id}/integrations/{connector_id}/settings")
async def get_integration_settings(
    project_id: uuid.UUID,
    connector_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return user-configurable retrieval defaults for a connector. These are
    saved separately from the OAuth secrets so the UI can preload search
    forms (e.g. default sender domain, default Drive folder, default date
    range)."""
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == connector_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    meta = row.metadata_public or {}
    return {"settings": meta.get("retrieval_settings", {})}


@router.patch("/api/projects/{project_id}/integrations/{connector_id}/settings")
async def update_integration_settings(
    project_id: uuid.UUID,
    connector_id: str,
    body: IntegrationSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.connector_id == connector_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    meta = dict(row.metadata_public or {})
    meta["retrieval_settings"] = body.settings
    row.metadata_public = meta
    await db.commit()
    log.info("Integration settings updated", connector=connector_id, project=str(project_id)[:8])
    return {"status": "ok", "settings": body.settings}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _frontend_redirect(success: bool = False, error: str | None = None, project_id: str | None = None) -> RedirectResponse:
    """Redirect the browser back to the frontend after OAuth."""
    base = settings.frontend_url.rstrip("/")
    if project_id:
        url = f"{base}/projects/{project_id}/chat"
    else:
        url = base
    params = {}
    if success:
        params["integration_connected"] = "google"
    if error:
        params["integration_error"] = error
    if params:
        url += "?" + urlencode(params)
    return RedirectResponse(url=url)


def _build_metadata_public(connector: dict, config: dict) -> dict:
    """Extract non-secret metadata from a token-paste config for display."""
    meta: dict = {"provider": connector["provider"]}
    # For Slack, expose team_id if present
    if connector["id"] == "slack" and config.get("slack_team_id"):
        meta["team_id"] = config["slack_team_id"]
    return meta
