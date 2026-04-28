"""Vault git sync — single owner of vault commits + pushes.

Every backend code path that mutates a project's vault filesystem
(pipeline writes, MCP tool handlers re-rendering markdown, accept-
proposal flows, assistants regen) goes through ``VaultSync.commit()``.
The class serializes commits per project (asyncio lock per pid),
debounces pushes (~10s coalescing window), and handles
``push → rejected → fetch → rebase → push`` automatically when a team
member's clone has commits we haven't seen.

One instance per backend process (see ``vault_sync_singleton``). The
FastAPI lifespan calls ``.start()`` once at boot and ``.stop()`` on
shutdown.

What we deliberately don't do (yet):
- No GitHub mirror. Nginx + git-http-backend is the only remote in v1.
- No per-file commit messages. Each call to commit() lands one commit
  with one summary; callers batch their own writes before calling.
- No three-way merge resolution. Sidecar pattern (PM hand-edits go in
  per-user ``*.notes-{userid}.md`` files) makes file-level conflicts
  impossible by construction; rebase failures are logged and left for
  manual fixup, not auto-merged.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import structlog

from app.services import vault_paths

log = structlog.get_logger()


# Author identity defaults — used when a caller doesn't pass one.
# Pipeline runs and assistants regen always show up under this name;
# user-driven flows (accept_proposal, MCP write tools) override with
# the acting user's email.
DEFAULT_AUTHOR_NAME = "Discovery Pipeline"
DEFAULT_AUTHOR_EMAIL = "pipeline@discovery.local"
COAUTHOR_TRAILER = "Co-Authored-By: Discovery Bot <bot@discovery.local>"


class VaultSync:
    """Manages commit + push for every project's vault repo."""

    PUSH_INTERVAL_S = 10.0

    def __init__(self) -> None:
        self._project_locks: dict[str, asyncio.Lock] = {}
        self._dirty: set[str] = set()
        self._dirty_lock = asyncio.Lock()
        self._push_task: asyncio.Task | None = None
        self._stopped = False

    # ─── Lifecycle ────────────────────────────────────────────────────

    async def start(self) -> None:
        """Spin up the background push debounce loop. Idempotent."""
        if self._push_task is not None and not self._push_task.done():
            return
        self._stopped = False
        self._push_task = asyncio.create_task(self._push_loop())

    async def stop(self) -> None:
        self._stopped = True
        if self._push_task is not None:
            self._push_task.cancel()
            try:
                await self._push_task
            except (asyncio.CancelledError, Exception):
                pass
            self._push_task = None

    # ─── Public commit API ────────────────────────────────────────────

    async def commit(
        self,
        project_id: uuid.UUID | str,
        summary: str,
        *,
        author_name: str | None = None,
        author_email: str | None = None,
        files: list[str] | None = None,
        coauthor: bool = True,
    ) -> bool:
        """Add + commit on the project's worktree. Returns True if a
        commit was created, False if there was nothing to commit.

        ``files`` — list of paths relative to the worktree to stage.
        If omitted, stages everything (``git add -A``). Pass a
        narrow list when you want a clean per-feature commit.

        ``author_name`` / ``author_email`` — git author for the
        commit. Falls back to the pipeline default.

        Schedules an async push at the next debounce tick if anything
        was committed."""
        pid = str(project_id)
        lock = self._lock_for(pid)
        async with lock:
            ok = await self._ensure_repo(pid)
            if not ok:
                return False
            committed = await self._commit_locked(
                pid,
                summary,
                files=files,
                author_name=author_name,
                author_email=author_email,
                coauthor=coauthor,
            )
            if committed:
                async with self._dirty_lock:
                    self._dirty.add(pid)
            return committed

    # ─── Internals ────────────────────────────────────────────────────

    def _lock_for(self, pid: str) -> asyncio.Lock:
        if pid not in self._project_locks:
            self._project_locks[pid] = asyncio.Lock()
        return self._project_locks[pid]

    async def _run(
        self, args: list[str], *, cwd: Path | None = None,
        env: dict | None = None, check: bool = True,
    ) -> tuple[int, str, str]:
        """Run a git/shell command, return (rc, stdout, stderr).
        Raises on non-zero unless check=False."""
        full_env = {**os.environ}
        if env:
            full_env.update(env)
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd) if cwd else None,
            env=full_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        rc = proc.returncode or 0
        out = (stdout or b"").decode("utf-8", errors="replace")
        err = (stderr or b"").decode("utf-8", errors="replace")
        if check and rc != 0:
            raise RuntimeError(
                f"git command failed ({rc}): {' '.join(args)}\n{err.strip()}"
            )
        return rc, out, err

    async def _ensure_repo(self, pid: str) -> bool:
        """Lazy-init the worktree + bare on first commit for a project.

        - Worktree is expected to already exist (claude_runner._setup_project_dir
          creates it + does ``git init`` for the chat-leak fix).
        - Bare gets created here and wired as the worktree's ``origin``.
        - Initial commit + push happens on the first call.

        Returns False (best-effort skip) if the worktree dir doesn't
        even exist — happens during early boot before any project has
        been used; nothing to sync yet."""
        wt = vault_paths.worktree(pid)
        bare = vault_paths.bare(pid)
        if not wt.exists():
            return False
        vault_paths.ensure_dirs()

        # Worktree must have a .git dir. claude_runner adds one on
        # _setup_project_dir; we re-init defensively for older projects.
        if not (wt / ".git").exists():
            await self._run(["git", "init", "--quiet"], cwd=wt)
            # Set a sane default branch name to avoid `master`/`main` drift.
            await self._run(["git", "-C", str(wt), "symbolic-ref", "HEAD", "refs/heads/main"])

        # Bare repo first-time setup.
        if not bare.exists():
            await self._run(["git", "init", "--bare", "--quiet", "--initial-branch=main", str(bare)])

        # Wire origin → bare. Idempotent (ignore failure when remote
        # already exists with the right URL).
        rc, out, _ = await self._run(
            ["git", "-C", str(wt), "remote"], check=False,
        )
        if "origin" not in (out or "").split():
            await self._run(["git", "-C", str(wt), "remote", "add", "origin", str(bare)])
        else:
            # Make sure the URL matches in case the path moved.
            await self._run(["git", "-C", str(wt), "remote", "set-url", "origin", str(bare)], check=False)

        return True

    async def _commit_locked(
        self,
        pid: str,
        summary: str,
        *,
        files: list[str] | None,
        author_name: str | None,
        author_email: str | None,
        coauthor: bool,
    ) -> bool:
        wt = vault_paths.worktree(pid)

        if files:
            await self._run(["git", "-C", str(wt), "add", "--", *files])
        else:
            await self._run(["git", "-C", str(wt), "add", "-A"])

        # Anything staged?
        rc, _, _ = await self._run(
            ["git", "-C", str(wt), "diff", "--cached", "--quiet"],
            check=False,
        )
        if rc == 0:
            return False

        author_name = author_name or DEFAULT_AUTHOR_NAME
        author_email = author_email or DEFAULT_AUTHOR_EMAIL
        env = {
            "GIT_AUTHOR_NAME": author_name,
            "GIT_AUTHOR_EMAIL": author_email,
            # Committer is always the system identity — author is the
            # acting human, committer is "the discovery server did the
            # write on their behalf".
            "GIT_COMMITTER_NAME": DEFAULT_AUTHOR_NAME,
            "GIT_COMMITTER_EMAIL": DEFAULT_AUTHOR_EMAIL,
        }
        msg = summary
        if coauthor and author_email != DEFAULT_AUTHOR_EMAIL:
            msg = f"{summary}\n\n{COAUTHOR_TRAILER}"

        await self._run(
            ["git", "-C", str(wt), "commit", "-m", msg],
            env=env,
        )
        return True

    # ─── Push debounce loop ───────────────────────────────────────────

    async def _push_loop(self) -> None:
        try:
            while not self._stopped:
                await asyncio.sleep(self.PUSH_INTERVAL_S)
                async with self._dirty_lock:
                    pending = list(self._dirty)
                    self._dirty.clear()
                for pid in pending:
                    try:
                        await self._push_with_rebase(pid)
                    except Exception as e:
                        log.warning(
                            "vault.push.failed",
                            project=pid[:8],
                            error=str(e),
                        )
                        # Re-mark dirty so we retry on next tick.
                        async with self._dirty_lock:
                            self._dirty.add(pid)
        except asyncio.CancelledError:
            pass

    async def _push_with_rebase(self, pid: str) -> None:
        """Push to bare; on rejection, fetch + rebase + push again.

        Rejection happens only when another writer (a team-member
        clone, a parallel backend instance) pushed first. Fetch picks
        up their commits, rebase replays ours on top, then push lands
        cleanly. If the rebase itself fails (impossible under the
        sidecar pattern), we abort, log, and leave divergent commits
        for manual triage."""
        wt = vault_paths.worktree(pid)
        lock = self._lock_for(pid)
        async with lock:
            try:
                await self._run(["git", "-C", str(wt), "push", "origin", "main"])
                return
            except RuntimeError:
                pass  # treat as rejection; try rebase path
            # Rebase path.
            await self._run(["git", "-C", str(wt), "fetch", "origin"], check=False)
            try:
                await self._run(["git", "-C", str(wt), "rebase", "origin/main"])
            except RuntimeError as e:
                # Real conflict — abort the rebase and bail out, keep
                # the unpushed commits intact for manual triage.
                await self._run(["git", "-C", str(wt), "rebase", "--abort"], check=False)
                log.error(
                    "vault.rebase.failed",
                    project=pid[:8],
                    error=str(e),
                )
                raise
            await self._run(["git", "-C", str(wt), "push", "origin", "main"])


# Module-level singleton — one per backend process.
vault_sync = VaultSync()
