"""Vault file viewer — serve a single markdown file from the project's vault.

Read-only endpoint for the web UI. Used today by the reminders panel so
the brief path in a `reminder_prep_done` message becomes a clickable
deep-link rather than opaque text. General enough to support any future
'preview this vault file' use case.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.agent.claude_runner import claude_runner
from app.deps import get_current_user
from app.models.auth import User

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}/vault", tags=["vault"])


class VaultFileOut(BaseModel):
    path: str
    content: str
    size: int
    modified: str | None


def _resolve_inside_project(project_id: uuid.UUID, rel_path: str) -> Path:
    """Turn a user-supplied relative path into an absolute path that is
    guaranteed to live under the project's vault root. Any attempt to
    escape via '..' or absolute paths is rejected.

    Accepted inputs:
    - `.memory-bank/docs/meeting-prep/foo.md`  (as stored on Reminder.prep_output_path)
    - `docs/meeting-prep/foo.md`               (same thing without the leading .memory-bank)
    """
    if not rel_path:
        raise HTTPException(400, "path is required")
    candidate = rel_path.replace("\\", "/").lstrip("/")
    project_root = claude_runner.get_project_dir(project_id).resolve()
    vault_root = (project_root / ".memory-bank").resolve()

    # Allow callers to pass either a vault-relative path or a project-relative one.
    if candidate.startswith(".memory-bank/"):
        full = (project_root / candidate).resolve()
    else:
        full = (vault_root / candidate).resolve()

    try:
        full.relative_to(vault_root)
    except ValueError:
        raise HTTPException(403, "path escapes vault root")
    return full


@router.get("/file", response_model=VaultFileOut)
async def read_vault_file(
    project_id: uuid.UUID,
    path: str = Query(..., description="Path relative to the project or the vault root"),
    user: User = Depends(get_current_user),
):
    """Read a single markdown (or other text) file from the project vault.
    Binary files are rejected on size / extension."""
    abs_path = _resolve_inside_project(project_id, path)

    if not abs_path.exists():
        raise HTTPException(404, f"file not found: {path}")
    if not abs_path.is_file():
        raise HTTPException(400, f"not a file: {path}")
    suffix = abs_path.suffix.lower()
    if suffix not in {".md", ".txt", ".yaml", ".yml", ".json"}:
        raise HTTPException(415, f"unsupported file type: {suffix}")

    stat = abs_path.stat()
    if stat.st_size > 2_000_000:
        raise HTTPException(413, f"file too large ({stat.st_size} bytes)")

    try:
        content = abs_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "file is not valid UTF-8 text")

    return VaultFileOut(
        path=path,
        content=content,
        size=stat.st_size,
        modified=None if not stat.st_mtime else __import__("datetime").datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(),
    )
