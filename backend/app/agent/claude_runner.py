"""
Claude Code Runner — per-project Claude Code environment with native sessions.

Each project gets its own directory with:
- Full assistants/ install (CLAUDE.md, agents, skills, templates)
- Fresh .memory-bank/
- MCP config pointing to our database
- Uploads folder for project documents
- Claude Code sessions that persist across messages

Sessions use --resume for multi-turn conversations (Claude Code native history).
Session IDs are stored in PostgreSQL for web UI ↔ terminal sharing.
"""

import asyncio
import json
import shutil
import uuid
import os
import structlog
from pathlib import Path
from typing import AsyncGenerator, Optional

log = structlog.get_logger()

# Paths
ROOT_DIR = Path(__file__).parent.parent.parent.parent
ASSISTANTS_DIR = ROOT_DIR / "assistants"
RUNTIME_DIR = ROOT_DIR / ".runtime" / "projects"
MCP_SERVER_PATH = ROOT_DIR / "mcp-server" / "db_server.py"
MCP_VENV_PYTHON = ROOT_DIR / "mcp-server" / ".venv" / "bin" / "python"


def _resolve_env_template(
    template: dict[str, str],
    *,
    config: dict,
    account: dict,
    env: dict,
) -> dict[str, str]:
    """Resolve {{config.X}}, {{account.X}}, {{env.X}} placeholders in env_template values."""
    import re
    resolved: dict[str, str] = {}
    pattern = re.compile(r"\{\{(config|account|env)\.([a-zA-Z0-9_]+)\}\}")

    def repl(match: "re.Match") -> str:
        scope, key = match.group(1), match.group(2)
        if scope == "config":
            return str(config.get(key, ""))
        if scope == "account":
            return str(account.get(key, ""))
        if scope == "env":
            return str(env.get(key, ""))
        return ""

    for k, v in template.items():
        resolved_value = pattern.sub(repl, v)
        # Only include if non-empty (MCP servers break on empty required env vars)
        if resolved_value:
            resolved[k] = resolved_value
    return resolved


class ClaudeCodeRunner:
    """Runs Claude Code per-project with full assistants context and native sessions."""

    def __init__(self):
        self._sessions: dict[str, str] = {}  # "project:user" -> session_id
        # Per-project lock — prevents concurrent --resume runs against the same
        # shared session (web user typing while Slack inbound is processing).
        self._project_locks: dict[uuid.UUID, asyncio.Lock] = {}

    def get_project_lock(self, project_id: uuid.UUID) -> asyncio.Lock:
        lock = self._project_locks.get(project_id)
        if lock is None:
            lock = asyncio.Lock()
            self._project_locks[project_id] = lock
        return lock

    def is_project_busy(self, project_id: uuid.UUID) -> bool:
        lock = self._project_locks.get(project_id)
        return lock.locked() if lock else False

    def _session_key(self, project_id: uuid.UUID, user_id: uuid.UUID) -> str:
        return f"{project_id}:{user_id}"

    def get_project_dir(self, project_id: uuid.UUID) -> Path:
        """Get or create the per-project Claude Code environment."""
        project_dir = RUNTIME_DIR / str(project_id)

        if not project_dir.exists():
            self._setup_project_dir(project_id, project_dir)
        else:
            # Sync assistant files if template is newer than project's CLAUDE.md
            try:
                template_md = ASSISTANTS_DIR / "CLAUDE.md"
                project_md = project_dir / "CLAUDE.md"
                if (template_md.exists() and project_md.exists() and
                    template_md.stat().st_mtime > project_md.stat().st_mtime):
                    self.sync_assistants(project_id)
            except Exception:
                pass  # Non-fatal

        return project_dir

    def _setup_project_dir(self, project_id: uuid.UUID, project_dir: Path):
        """Create a fresh project directory with full assistants install."""
        log.info("Setting up project directory", project_id=str(project_id), path=str(project_dir))

        # Copy assistants/ to project dir (like running install.sh)
        if ASSISTANTS_DIR.exists():
            shutil.copytree(
                ASSISTANTS_DIR,
                project_dir,
                ignore=shutil.ignore_patterns("__pycache__", ".DS_Store", "*.pyc"),
            )
        else:
            project_dir.mkdir(parents=True, exist_ok=True)

        # Ensure .memory-bank/ exists with fresh structure
        mb = project_dir / ".memory-bank"
        mb.mkdir(exist_ok=True)
        (mb / "active-tasks").mkdir(exist_ok=True)
        (mb / "docs").mkdir(exist_ok=True)
        (mb / "docs" / "discovery").mkdir(exist_ok=True)

        # Ensure uploads dir
        (project_dir / "uploads").mkdir(exist_ok=True)

        # .raw/ inside the vault holds the original payload of every
        # ingested document (Gmail message, Drive file, manual upload,
        # Slack thread). Derived notes get a `source_raw:` frontmatter
        # backlink that resolves here, so opening a requirement in
        # Obsidian and clicking the source link shows the original.
        raw_dir = mb / ".raw"
        raw_dir.mkdir(exist_ok=True)
        for source in ("gmail", "google_drive", "upload", "slack"):
            (raw_dir / source).mkdir(exist_ok=True)
        # Tell Obsidian not to index .raw/ as notes (they're sources, not
        # finds). The README is plain markdown so users can see what's here.
        readme = raw_dir / "README.md"
        if not readme.exists():
            readme.write_text(
                "---\ncategory: raw-sources\n---\n\n"
                "# Raw sources\n\n"
                "Original payload of every ingested document, organized by\n"
                "source connector. Derived notes (`docs/discovery/...`) link\n"
                "back here via `source_raw` frontmatter so you can always see\n"
                "the original alongside the extracted requirements/gaps/etc.\n\n"
                "- `gmail/` — full email JSON envelope per imported message\n"
                "- `google_drive/` — exported markdown / downloaded binaries\n"
                "- `upload/` — copies of files uploaded through the UI\n"
                "- `slack/` — captured thread snapshots\n"
            )

        # Seed Obsidian vault config from the canonical source in
        # assistants/.obsidian/. Templates are generated from schemas (see
        # assistants/.claude/scripts/render-templates.py); the rest of the
        # config (app.json, graph.json, community-plugins.json, snippets,
        # appearance.json) is hand-edited and lives in the repo so PR
        # diffs are reviewable.
        obsidian_seed = ASSISTANTS_DIR / ".obsidian"
        obsidian_dir = mb / ".obsidian"
        if obsidian_seed.exists():
            self._copy_obsidian_seed(obsidian_seed, obsidian_dir)
        else:
            log.warning("assistants/.obsidian/ not found — skipping Obsidian seed",
                        path=str(obsidian_seed))

        # Seed reports directory
        (mb / "docs" / "reports").mkdir(exist_ok=True)
        (mb / "docs" / "reports" / "daily").mkdir(exist_ok=True)
        (mb / "docs" / "reports" / "weekly").mkdir(exist_ok=True)

        # Seed memory bank files
        self._create_seed_files(mb)

        # Write MCP config for this project
        self._write_mcp_config(project_id, project_dir)

        log.info("Project directory ready", project_id=str(project_id))

    def _create_seed_files(self, mb: Path):
        """Create seed memory bank files with template content."""
        # project-brief.md
        if not (mb / "project-brief.md").exists():
            (mb / "project-brief.md").write_text(
                "---\ncategory: project-brief\nstatus: draft\n---\n\n"
                "# Project Brief\n\n"
                "## Overview\n(Populated automatically from discovery pipeline)\n\n"
                "## Goals\n- TBD\n\n"
                "## Success Criteria\n- TBD\n\n"
                "## Timeline\n- TBD\n"
            )

        # system-patterns.md
        if not (mb / "system-patterns.md").exists():
            (mb / "system-patterns.md").write_text(
                "---\ncategory: system-patterns\nstatus: draft\n---\n\n"
                "# System Patterns\n\n"
                "## Architecture\n(Discovered during analysis)\n\n"
                "## Key Design Decisions\n- TBD\n\n"
                "## Integration Points\n- TBD\n"
            )

        # tech-context.md
        if not (mb / "tech-context.md").exists():
            (mb / "tech-context.md").write_text(
                "---\ncategory: tech-context\nstatus: draft\n---\n\n"
                "# Tech Context\n\n"
                "## Stack\n(Populated from discovery)\n\n"
                "## Constraints\n- TBD\n\n"
                "## Dependencies\n- TBD\n"
            )

        # key-decisions.md
        if not (mb / "key-decisions.md").exists():
            (mb / "key-decisions.md").write_text(
                "---\ncategory: key-decisions\nstatus: draft\n---\n\n"
                "# Key Decisions\n\n"
            )

        # gotchas.md
        if not (mb / "gotchas.md").exists():
            (mb / "gotchas.md").write_text(
                "---\ncategory: gotchas\nstatus: draft\n---\n\n"
                "# Gotchas\n\n"
            )

    def _write_mcp_config(self, project_id: uuid.UUID, project_dir: Path):
        """Write .mcp.json with discovery MCP server for this project."""
        python_cmd = str(MCP_VENV_PYTHON) if MCP_VENV_PYTHON.exists() else "python3"

        config = {
            "mcpServers": {
                "discovery": {
                    "command": python_cmd,
                    "args": [str(MCP_SERVER_PATH)],
                    "env": {
                        "DATABASE_URL": os.environ.get(
                            "DATABASE_URL",
                            "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db"
                        ),
                        "DISCOVERY_PROJECT_ID": str(project_id),
                    }
                }
            }
        }

        # Write as .mcp.json (Claude Code auto-discovers this)
        mcp_path = project_dir / ".mcp.json"
        mcp_path.write_text(json.dumps(config, indent=2))

    async def refresh_mcp_config(self, project_id: uuid.UUID, user_id: uuid.UUID | None = None):
        """Rewrite .mcp.json merging the base discovery server with any enabled
        project integrations (Gmail, Drive, Slack, …). Called before each run.

        `user_id` is threaded into the MCP env as DISCOVERY_USER_ID so write
        tools (schedule_reminder, …) can attribute rows without needing a
        project lead fallback when the caller is known."""
        from sqlalchemy import select
        from app.db.session import async_session
        from app.models.operational import ProjectIntegration
        from app.services.connector_catalog import get_connector
        from app.services.secrets import decrypt_config
        from app.config import settings as app_settings

        project_dir = self.get_project_dir(project_id)
        python_cmd = str(MCP_VENV_PYTHON) if MCP_VENV_PYTHON.exists() else "python3"

        discovery_env: dict[str, str] = {
            "DATABASE_URL": os.environ.get(
                "DATABASE_URL",
                "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db",
            ),
            "DISCOVERY_PROJECT_ID": str(project_id),
        }
        if user_id is not None:
            discovery_env["DISCOVERY_USER_ID"] = str(user_id)

        servers: dict = {
            "discovery": {
                "command": python_cmd,
                "args": [str(MCP_SERVER_PATH)],
                "env": discovery_env,
            }
        }

        # Load enabled integrations for this project
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(ProjectIntegration).where(
                        ProjectIntegration.project_id == project_id,
                        ProjectIntegration.status == "active",
                    )
                )
                integrations = result.scalars().all()
        except Exception as e:
            log.warning("Could not load integrations for MCP config", error=str(e))
            integrations = []

        # Shared account cache: {"google": {"refresh_token": "..."}}
        shared_accounts: dict[str, dict] = {}
        for row in integrations:
            try:
                cfg = decrypt_config(row.config_encrypted)
            except Exception:
                log.error("Failed to decrypt integration", connector=row.connector_id)
                continue
            connector = get_connector(row.connector_id)
            if not connector:
                continue
            shared_key = connector["auth"].get("shared_account_key")
            if shared_key and shared_key not in shared_accounts:
                shared_accounts[shared_key] = cfg

        # Build one MCP entry per integration
        for row in integrations:
            connector = get_connector(row.connector_id)
            if not connector:
                continue
            try:
                cfg = decrypt_config(row.config_encrypted)
            except Exception:
                continue

            shared_key = connector["auth"].get("shared_account_key")
            account = shared_accounts.get(shared_key, {}) if shared_key else {}

            env = _resolve_env_template(
                connector["mcp"]["env_template"],
                config=cfg,
                account=account,
                env={
                    "GOOGLE_OAUTH_CLIENT_ID": app_settings.google_oauth_client_id,
                    "GOOGLE_OAUTH_CLIENT_SECRET": app_settings.google_oauth_client_secret,
                },
            )

            servers[row.connector_id] = {
                "command": connector["mcp"]["command"],
                "args": list(connector["mcp"]["args"]),
                "env": env,
            }

        mcp_path = project_dir / ".mcp.json"
        mcp_path.write_text(json.dumps({"mcpServers": servers}, indent=2))
        log.info(
            "MCP config refreshed",
            project=str(project_id)[:8],
            servers=list(servers.keys()),
        )

    async def run_stream(
        self,
        project_id: uuid.UUID,
        user_id: uuid.UUID,
        message: str,
        system_prompt: Optional[str] = None,
        allowed_tools: Optional[list[str]] = None,
        agent: Optional[str] = None,
        model: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream Claude Code response. Resumes session if one exists."""

        project_dir = self.get_project_dir(project_id)
        # Refresh .mcp.json with enabled integrations (Gmail, Slack, ...)
        try:
            await self.refresh_mcp_config(project_id, user_id)
        except Exception as e:
            log.warning("refresh_mcp_config failed, continuing with existing config", error=str(e))

        session_key = self._session_key(project_id, user_id)
        session_id = self._sessions.get(session_key)

        cmd = [
            "claude",
            "-p", message,
            "--output-format", "stream-json",
            "--verbose",
            "--permission-mode", "bypassPermissions",
        ]

        # Resume existing session for multi-turn conversation
        if session_id:
            cmd.extend(["--resume", session_id])

        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])

        if allowed_tools:
            cmd.extend(["--allowedTools", " ".join(allowed_tools)])

        if agent:
            cmd.extend(["--agent", agent])

        if model:
            cmd.extend(["--model", model])

        log.info("Starting Claude Code",
                 project=str(project_id)[:8],
                 session=session_id or "new",
                 cwd=str(project_dir))

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(project_dir),
                env={**os.environ, "NO_COLOR": "1"},
            )

            async for line in process.stdout:
                line_text = line.decode("utf-8").strip()
                if not line_text:
                    continue

                try:
                    event = json.loads(line_text)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")

                # Init event — capture session ID
                if event_type == "system" and event.get("subtype") == "init":
                    new_session_id = event.get("session_id")
                    if new_session_id:
                        self._sessions[session_key] = new_session_id
                        log.info("Session", session_id=new_session_id, resumed=bool(session_id))
                    yield {"type": "session", "session_id": new_session_id}
                    continue

                # Assistant message — stream text, thinking, and tool calls
                if event_type == "assistant":
                    msg = event.get("message", {})
                    for block in msg.get("content", []):
                        block_type = block.get("type")
                        if block_type == "text":
                            yield {"type": "text", "content": block["text"]}
                        elif block_type == "tool_use":
                            yield {
                                "type": "tool_use",
                                "tool": block.get("name", "unknown"),
                                "input": block.get("input", {}),
                            }
                        elif block_type == "thinking":
                            yield {
                                "type": "thinking",
                                "content": block.get("thinking", ""),
                            }
                    continue

                # Tool result — surface tool execution status
                if event_type == "tool_result" or event_type == "user":
                    msg = event.get("message", {})
                    for block in msg.get("content", []):
                        if block.get("type") == "tool_result":
                            yield {
                                "type": "tool_result",
                                "tool_use_id": block.get("tool_use_id", ""),
                                "is_error": block.get("is_error", False),
                            }
                    continue

                # Final result — full stats
                if event_type == "result":
                    result_session = event.get("session_id")
                    if result_session:
                        self._sessions[session_key] = result_session
                    yield {
                        "type": "result",
                        "content": event.get("result", ""),
                        "session_id": result_session,
                        "cost_usd": event.get("total_cost_usd", 0),
                        "duration_ms": event.get("duration_ms", 0),
                        "duration_api_ms": event.get("duration_api_ms", 0),
                        "num_turns": event.get("num_turns", 0),
                    }
                    continue

                # API retry — surface to UI
                if event_type == "system" and event.get("subtype") == "api_retry":
                    yield {
                        "type": "retry",
                        "attempt": event.get("attempt", 1),
                        "max_retries": event.get("max_retries", 3),
                        "error": event.get("error", "unknown"),
                    }
                    continue

                # Rate limit telemetry from Claude Code.
                # `allowed` and `allowed_warning` are INFORMATIONAL — Claude Code
                # emits one for every API call as telemetry, NOT as an error.
                # Only `warning` and `exceeded` indicate a real problem the user
                # needs to know about.
                if event_type == "rate_limit_event":
                    info = event.get("rate_limit_info", {})
                    status = info.get("status")
                    if status in ("allowed", "allowed_warning"):
                        # Informational only — log at debug, don't surface
                        log.debug(
                            "rate_limit telemetry",
                            status=status,
                            resets_at=info.get("resetsAt"),
                        )
                    elif status in ("warning", "exceeded"):
                        yield {
                            "type": "error",
                            "content": f"Rate limit: {status}. Resets at {info.get('resetsAt')}",
                        }
                    else:
                        # Unknown status — log it but don't fail the run
                        log.warning(
                            "Unknown rate_limit_event status",
                            status=status,
                            info=info,
                        )
                    continue

            await process.wait()

            if process.returncode != 0:
                stderr = await process.stderr.read()
                error_msg = stderr.decode("utf-8").strip() if stderr else "Unknown error"
                yield {"type": "error", "content": f"Claude Code exited with code {process.returncode}: {error_msg}"}

        except FileNotFoundError:
            yield {"type": "error", "content": "Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code"}
        except Exception as e:
            yield {"type": "error", "content": f"Runner error: {str(e)}"}

    def get_session_id(self, project_id: uuid.UUID, user_id: uuid.UUID) -> Optional[str]:
        """Get the current session ID for a project/user."""
        return self._sessions.get(self._session_key(project_id, user_id))

    def set_session_id(self, project_id: uuid.UUID, user_id: uuid.UUID, session_id: str):
        """Set session ID (loaded from DB on startup)."""
        self._sessions[self._session_key(project_id, user_id)] = session_id

    async def clear_session(self, project_id: uuid.UUID, user_id: uuid.UUID):
        """Clear session — next message starts a new conversation."""
        self._sessions.pop(self._session_key(project_id, user_id), None)

    @staticmethod
    def _copy_obsidian_seed(seed_dir: Path, dest_dir: Path) -> None:
        """Copy assistants/.obsidian/ into the project's .memory-bank/.obsidian/.

        Idempotent — only writes files that don't already exist OR whose
        seed version is newer than the project copy. workspace.json is
        always preserved (it's the user's pane layout, not part of the
        seed)."""
        import shutil

        dest_dir.mkdir(parents=True, exist_ok=True)
        for src in seed_dir.rglob("*"):
            if src.is_dir():
                continue
            rel = src.relative_to(seed_dir)
            # Never overwrite the user's workspace layout
            if rel.name in ("workspace.json", "workspace-mobile.json"):
                continue
            # Skip macOS / editor cruft
            if rel.name in (".DS_Store", "Thumbs.db") or rel.name.startswith("._"):
                continue
            dest = dest_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            # Overwrite if seed is newer or dest doesn't exist
            if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
                shutil.copy2(src, dest)

    def sync_assistants(self, project_id: uuid.UUID):
        """Sync assistant files (CLAUDE.md, skills, agents, scripts, templates) from template
        to an existing project without touching .memory-bank or project data."""
        project_dir = self.get_project_dir(project_id)
        if not ASSISTANTS_DIR.exists():
            return

        # Files/dirs to sync from assistants/ template
        sync_items = ["CLAUDE.md", ".claude"]
        for item in sync_items:
            src = ASSISTANTS_DIR / item
            dst = project_dir / item
            if not src.exists():
                continue
            if src.is_file():
                shutil.copy2(src, dst)
            else:
                # Merge directory — copy new/updated files, don't delete existing
                for src_file in src.rglob("*"):
                    if src_file.is_file() and not any(p in str(src_file) for p in ["__pycache__", ".DS_Store"]):
                        rel = src_file.relative_to(src)
                        dst_file = dst / rel
                        dst_file.parent.mkdir(parents=True, exist_ok=True)
                        # Only copy if source is newer or destination doesn't exist
                        if not dst_file.exists() or src_file.stat().st_mtime > dst_file.stat().st_mtime:
                            shutil.copy2(src_file, dst_file)

        # Also refresh the Obsidian seed (templates, snippets, plugin lists,
        # graph config) — but never touch workspace.json (the user's pane
        # layout). This is how schema edits + template regenerations
        # propagate to existing projects.
        obsidian_seed = ASSISTANTS_DIR / ".obsidian"
        obsidian_dest = project_dir / ".memory-bank" / ".obsidian"
        if obsidian_seed.exists() and obsidian_dest.parent.exists():
            self._copy_obsidian_seed(obsidian_seed, obsidian_dest)

        log.info("Assistants synced", project_id=str(project_id))

    def get_upload_dir(self, project_id: uuid.UUID) -> Path:
        """Get the uploads directory for a project."""
        upload_dir = self.get_project_dir(project_id) / "uploads"
        upload_dir.mkdir(exist_ok=True)
        return upload_dir

    def get_raw_dir(self, project_id: uuid.UUID, source: str) -> Path:
        """Return the per-source .raw/ directory inside the vault.

        `source` is one of: gmail, google_drive, upload, slack. Created on
        demand if missing (existing projects predating .raw/ get it
        retroactively the first time anything tries to write here)."""
        raw_dir = self.get_project_dir(project_id) / ".memory-bank" / ".raw" / source
        raw_dir.mkdir(parents=True, exist_ok=True)
        return raw_dir


# Singleton
claude_runner = ClaudeCodeRunner()
