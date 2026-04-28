"""Smart-HTTP git serving for vault repos, in-process.

In production we recommend the nginx + ``fcgiwrap`` + ``git-http-backend``
stack documented in ``infra/nginx/discovery-vaults.conf`` — that's the
performant path for many concurrent clones. But for dev (single-host
backend, no nginx) we serve the same protocol directly from FastAPI
so ``discovery setup`` works straight through with zero infra setup.

Implementation: subprocess ``git http-backend`` (a CGI binary that
ships with git itself), pipe the request body in, parse the CGI-style
response headers + body out. Same auth + membership check we use
elsewhere — PAT or JWT, both via ``get_current_user``.

Mounted at ``/vaults/{project_id}.git/{path:path}``. The bare repos
live at ``vault_paths.bare(project_id)`` (lazy-init'd by VaultSync on
first commit; until then a clone returns 404).

Path convention CGI uses:
  GIT_PROJECT_ROOT  →  .../runtime/vaults
  PATH_INFO         →  /{project_id}.git/info/refs (or git-upload-pack etc.)
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user_strict
from app.models.auth import User
from app.models.project import ProjectMember
from app.services import vault_paths


router = APIRouter(tags=["vault-git"])


# Resolve git-http-backend once at module import. ``git --exec-path``
# returns the dir holding the plumbing binaries (.../git-core/). On
# Linux this is /usr/lib/git-core, on macOS /Library/Developer/.../
# git-core. None of the deploy targets are missing it (the binary
# ships with git itself), so a hard error here is fine — surfaces
# as 500 with a clear message.
def _locate_http_backend() -> Path | None:
    try:
        out = subprocess.run(
            ["git", "--exec-path"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        candidate = Path(out) / "git-http-backend"
        return candidate if candidate.exists() else None
    except Exception:
        return None


_GIT_HTTP_BACKEND = _locate_http_backend()


@router.api_route(
    "/vaults/{project_id}.git/{path:path}",
    methods=["GET", "POST"],
    include_in_schema=False,
)
async def vault_git(
    project_id: uuid.UUID,
    path: str,
    request: Request,
    user: User = Depends(get_current_user_strict),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    if _GIT_HTTP_BACKEND is None:
        raise HTTPException(
            500,
            "git-http-backend not found on this host. Install git-core "
            "(Linux) or Apple's command line tools (macOS).",
        )

    # Auth gate. PAT or JWT — same as the MCP route. Membership check
    # mirrors mcp_proxy + the nginx auth_request endpoint.
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
            raise HTTPException(403, "No vault access")

    # Bare repo must exist before clones can succeed. VaultSync
    # lazy-creates it on first commit; pre-commit projects 404 here
    # rather than returning an empty git response.
    if not vault_paths.bare(project_id).exists():
        raise HTTPException(
            404,
            f"Vault not initialized for project {project_id}. "
            "Trigger any pipeline write (e.g. upload a doc) to create the bare repo.",
        )

    # CGI env. git-http-backend reads PATH_INFO, joins it onto
    # GIT_PROJECT_ROOT, and serves the repo it finds there.
    cgi_env = {
        "GIT_PROJECT_ROOT": str(vault_paths.VAULTS_DIR),
        "GIT_HTTP_EXPORT_ALL": "1",
        "PATH_INFO": f"/{project_id}.git/{path}",
        "REQUEST_METHOD": request.method,
        "QUERY_STRING": request.url.query or "",
        "CONTENT_TYPE": request.headers.get("content-type", ""),
        "CONTENT_LENGTH": request.headers.get("content-length", ""),
        "REMOTE_USER": str(user.id),
        # PATH so the subprocess can find git itself (smart-HTTP
        # invokes git-upload-pack / git-receive-pack as children).
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        # Forward the content-encoding so git-http-backend can
        # transparently gunzip a request body if the client used it.
        "HTTP_CONTENT_ENCODING": request.headers.get("content-encoding", ""),
        # Server software identity — git embeds this in some logs.
        "SERVER_SOFTWARE": "discovery-vault-git/1.0",
        "SERVER_PROTOCOL": "HTTP/1.1",
    }

    proc = await asyncio.create_subprocess_exec(
        str(_GIT_HTTP_BACKEND),
        env=cgi_env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Pipe request body → subprocess stdin in a background task so
    # streaming uploads (push of a big pack file) don't load into RAM.
    async def feed_stdin() -> None:
        try:
            async for chunk in request.stream():
                if not chunk:
                    continue
                proc.stdin.write(chunk)
                await proc.stdin.drain()
        except Exception:
            # Client disconnected mid-upload, etc. — let the
            # subprocess error out naturally on EOF.
            pass
        finally:
            try:
                proc.stdin.close()
            except Exception:
                pass

    feed_task = asyncio.create_task(feed_stdin())

    # Parse CGI response headers (one per line, blank line ends the
    # header block). git-http-backend emits at least Content-Type and
    # often a "Status: NNN ..." pseudo-header for non-200 responses.
    response_headers: list[tuple[str, str]] = []
    status_code = 200
    while True:
        line = await proc.stdout.readline()
        if not line:
            # Subprocess closed before sending headers — likely a
            # subprocess crash. Drain stderr for diagnostics.
            try:
                err = await asyncio.wait_for(proc.stderr.read(), timeout=0.5)
                err_text = (err or b"").decode("utf-8", errors="replace")[:400]
            except Exception:
                err_text = ""
            try:
                feed_task.cancel()
            except Exception:
                pass
            raise HTTPException(502, f"git-http-backend produced no headers. stderr: {err_text}")
        stripped = line.rstrip(b"\r\n")
        if not stripped:
            break  # end of headers
        if b":" not in stripped:
            continue
        key_b, _, val_b = stripped.partition(b":")
        key = key_b.strip().decode("latin-1")
        val = val_b.strip().decode("latin-1")
        if key.lower() == "status":
            # "Status: 200 OK" → just the code
            try:
                status_code = int(val.split()[0])
            except (ValueError, IndexError):
                status_code = 200
            continue
        response_headers.append((key, val))

    async def stream_body():
        try:
            while True:
                chunk = await proc.stdout.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                feed_task.cancel()
            except Exception:
                pass
            try:
                await proc.wait()
            except Exception:
                pass

    headers_dict = {k: v for k, v in response_headers}
    media_type = headers_dict.pop("Content-Type", None) or headers_dict.pop("content-type", None)

    return StreamingResponse(
        stream_body(),
        status_code=status_code,
        headers=headers_dict,
        media_type=media_type,
    )
