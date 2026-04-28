"""HTTP MCP proxy — exposes the existing Discovery MCP tool registry
(``mcp-server/db_server.py``) over streamable-HTTP so a remote (laptop)
Claude Code can use it without installing the stdio binary or holding
DB credentials.

Wire shape::

    Claude Code on laptop
       │ POST /mcp/{project_id}/  Authorization: Bearer dsc_…
       ▼
    nginx → uvicorn → this file
       │ verify PAT (or JWT) via existing get_current_user dep
       │ verify project membership
       │ set HTTP_PROJECT_ID + HTTP_TOKEN_IDENTITY ContextVars
       │ ASGI-delegate to StreamableHTTPSessionManager
       ▼
    same Server instance + same tools as stdio MCP
       │ tools read HTTP_PROJECT_ID / HTTP_TOKEN_IDENTITY first,
       │ env vars second — see db_server.get_project_id +
       │ _resolve_token_identity for the fallback chain
       ▼
    Postgres

The manager is constructed once at app startup (inside ``init_mcp_manager``
— a context manager wired into the FastAPI lifespan) since the SDK
documents that exactly ONE manager instance per process is supported,
and ``handle_request`` requires the manager's task group to be alive.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user_strict
from app.models.auth import User
from app.models.project import ProjectMember


# Make the sibling ``mcp-server/`` package importable from this process.
# The repo layout has ``mcp-server`` as a peer of ``backend``, not a
# Python sub-package, so it isn't on the import path by default. The
# stdio entry point (running mcp-server/db_server.py directly) is
# unaffected — only this module touches sys.path.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MCP_SERVER_DIR = _REPO_ROOT / "mcp-server"
if str(_MCP_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_MCP_SERVER_DIR))

# Imports below depend on the sys.path tweak above.
import http_server as _mcp_http  # noqa: E402

router = APIRouter(prefix="/mcp", tags=["mcp"])


# ─────────────────────────────────────────────────────────────────────
# Lifespan integration
# ─────────────────────────────────────────────────────────────────────

# One manager for the lifetime of the FastAPI app. The lifespan context
# manager below holds the manager's run() open; the route handlers
# read it from ``app.state.mcp_manager``.
@asynccontextmanager
async def init_mcp_manager(app):
    """Construct + run the streamable-HTTP MCP manager for the duration
    of the FastAPI app. Used from app/main.py's lifespan handler."""
    manager = _mcp_http.make_streamable_manager(stateless=True)
    async with manager.run():
        app.state.mcp_manager = manager
        try:
            yield
        finally:
            app.state.mcp_manager = None


# ─────────────────────────────────────────────────────────────────────
# ASGI delegation route
# ─────────────────────────────────────────────────────────────────────

# We accept both POST (JSON-RPC requests / initialization) and GET (SSE
# stream). Some clients also send DELETE for session termination, but
# in stateless mode that's a no-op — the SDK handles it gracefully. The
# {rest:path} catch-all lets the manager see requests at the same
# logical URL it would in a Mount.
@router.api_route(
    "/{project_id}/{rest:path}",
    methods=["GET", "POST", "DELETE"],
    include_in_schema=False,
)
@router.api_route(
    "/{project_id}",
    methods=["GET", "POST", "DELETE"],
    include_in_schema=False,
)
async def mcp_endpoint(
    project_id: uuid.UUID,
    request: Request,
    rest: str = "",
    user: User = Depends(get_current_user_strict),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    # Project membership gate. Admins bypass; everyone else must be
    # a ProjectMember (any role).
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

    manager = getattr(request.app.state, "mcp_manager", None)
    if manager is None:
        raise HTTPException(503, "MCP manager not initialized")

    # Build a fresh ASGI scope with the /mcp/{project_id} prefix
    # stripped. The streamable manager doesn't care about the path
    # itself, but a clean root_path is what its internal routing
    # expects.
    new_path = "/" + rest if rest else "/"
    scope: dict[str, Any] = dict(request.scope)
    scope["path"] = new_path
    scope["raw_path"] = new_path.encode()
    scope["root_path"] = ""

    # ASGI bridge: capture the manager's response messages and forward
    # them through a StreamingResponse so FastAPI handles the wire
    # framing. We intentionally DROP the manager's content-length /
    # transfer-encoding headers — Starlette computes correct ones from
    # the streamed body.
    response_started = asyncio.Event()
    response_status: int = 200
    response_headers: list[tuple[bytes, bytes]] = []
    body_queue: asyncio.Queue = asyncio.Queue()
    sentinel = object()

    async def send(message: dict) -> None:
        nonlocal response_status, response_headers
        mtype = message.get("type")
        if mtype == "http.response.start":
            response_status = message.get("status", 200)
            response_headers = list(message.get("headers", []))
            response_started.set()
        elif mtype == "http.response.body":
            await body_queue.put(message)
            if not message.get("more_body", False):
                await body_queue.put(sentinel)

    # Per-request context. We set the ContextVars INSIDE the handler
    # task (not the route's outer task) so they live and die with the
    # task that runs ``manager.handle_request`` — avoids the
    # "Token created in a different Context" ValueError that fires
    # when reset() is called from StreamingResponse's body_iter task.
    identity = {
        "user_id": str(user.id),
        "email": user.email,
        "allowed_project_ids": {str(project_id)},
        "source": "http_pat",
    }

    async def run_handler() -> None:
        _mcp_http.HTTP_PROJECT_ID.set(str(project_id))
        _mcp_http.HTTP_TOKEN_IDENTITY.set(identity)
        try:
            await manager.handle_request(scope, request.receive, send)
        except Exception:
            # Best-effort: surface any unhandled error as a 500-ish
            # frame so the streaming response doesn't hang.
            if not response_started.is_set():
                response_status_local = 500
                response_started.set()
            await body_queue.put(sentinel)

    handler_task = asyncio.create_task(run_handler())

    # Wait for response.start so we know the status + headers before
    # building the StreamingResponse. If the handler errors before
    # this, the event will be set by the except branch above.
    await response_started.wait()

    async def body_iter():
        try:
            while True:
                msg = await body_queue.get()
                if msg is sentinel:
                    break
                chunk = msg.get("body", b"")
                if chunk:
                    yield chunk
        finally:
            # No ContextVar reset() here — the handler task that set
            # them dies after the request, and starlette runs body_iter
            # in a different task whose Context never had the tokens.
            try:
                await handler_task
            except Exception:
                pass

    # Filter out hop-by-hop framing headers Starlette will recompute.
    skip = {b"content-length", b"transfer-encoding", b"connection"}
    headers_dict = {
        k.decode("latin-1"): v.decode("latin-1")
        for k, v in response_headers
        if k.lower() not in skip
    }

    media_type = headers_dict.pop("content-type", None) or headers_dict.pop("Content-Type", None)
    return StreamingResponse(
        body_iter(),
        status_code=response_status,
        headers=headers_dict,
        media_type=media_type,
    )
