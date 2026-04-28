"""Vault repo path conventions — single source of truth.

Each project has two on-disk pieces:

  worktree:  <repo>/.runtime/projects/{id}/
             The pipeline + claude_runner write here. Already a git
             working tree (`.git` dir was added in the chat-leak fix
             so per-project `git status` doesn't reach the dev repo).

  bare:      <repo>/.runtime/vaults/{id}.git
             The bare repo nginx serves over HTTPS. Pipeline pushes
             from worktree → bare; team members clone from bare.

Both live under the existing ``.runtime/`` so backups + cleanup target
one path.
"""

from __future__ import annotations

import uuid
from pathlib import Path


# Same anchor the agent runner uses (backend/app/agent/claude_runner.py).
_HERE = Path(__file__).resolve()
ROOT_DIR = _HERE.parent.parent.parent.parent  # → repo root
RUNTIME_DIR = ROOT_DIR / ".runtime"
PROJECTS_DIR = RUNTIME_DIR / "projects"
VAULTS_DIR = RUNTIME_DIR / "vaults"


def worktree(project_id: uuid.UUID | str) -> Path:
    """Working-tree dir — what the pipeline + agents write to."""
    return PROJECTS_DIR / str(project_id)


def bare(project_id: uuid.UUID | str) -> Path:
    """Bare repo path — what nginx serves over HTTPS."""
    return VAULTS_DIR / f"{project_id}.git"


def ensure_dirs() -> None:
    """Idempotently create the per-host parent dirs. Called from
    VaultSync on first use; safe to call from anywhere."""
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    VAULTS_DIR.mkdir(parents=True, exist_ok=True)
