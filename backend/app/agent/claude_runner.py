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


class ClaudeCodeRunner:
    """Runs Claude Code per-project with full assistants context and native sessions."""

    def __init__(self):
        self._sessions: dict[str, str] = {}  # "project:user" -> session_id

    def _session_key(self, project_id: uuid.UUID, user_id: uuid.UUID) -> str:
        return f"{project_id}:{user_id}"

    def get_project_dir(self, project_id: uuid.UUID) -> Path:
        """Get or create the per-project Claude Code environment."""
        project_dir = RUNTIME_DIR / str(project_id)

        if not project_dir.exists():
            self._setup_project_dir(project_id, project_dir)

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

                # Rate limit warning
                if event_type == "rate_limit_event":
                    info = event.get("rate_limit_info", {})
                    if info.get("status") != "allowed_warning":
                        yield {
                            "type": "error",
                            "content": f"Rate limit: {info.get('status')}. Resets at {info.get('resetsAt')}",
                        }
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

    def get_upload_dir(self, project_id: uuid.UUID) -> Path:
        """Get the uploads directory for a project."""
        upload_dir = self.get_project_dir(project_id) / "uploads"
        upload_dir.mkdir(exist_ok=True)
        return upload_dir


# Singleton
claude_runner = ClaudeCodeRunner()
