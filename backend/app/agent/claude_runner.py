"""
Claude Code Runner — spawns Claude Code as subprocess for chat.
Uses the user's Pro Max subscription for all LLM calls.
Claude Code reads assistants/.claude/ for agent definitions, skills, and MCP config.

Stream-json output format (from Claude Code --output-format stream-json --verbose):
  {"type":"system","subtype":"init","session_id":"...","tools":[...],...}
  {"type":"assistant","message":{"content":[{"type":"text","text":"..."}],...},...}
  {"type":"result","subtype":"success","result":"full text","session_id":"...",...}
"""

import asyncio
import json
import uuid
import os
import structlog
from pathlib import Path
from typing import AsyncGenerator, Optional

log = structlog.get_logger()


class ClaudeCodeRunner:
    """Runs Claude Code CLI as a subprocess. Streams responses."""

    def __init__(self, working_dir: str, mcp_config: Optional[str] = None):
        """
        Args:
            working_dir: Directory where Claude Code runs (should contain .claude/ or CLAUDE.md)
            mcp_config: Path to MCP config JSON file (optional, uses .claude/settings.json if not set)
        """
        self.working_dir = Path(working_dir).resolve()
        self.mcp_config = mcp_config
        self._sessions: dict[str, str] = {}  # "project:user" -> session_id

    def _session_key(self, project_id: uuid.UUID, user_id: uuid.UUID) -> str:
        return f"{project_id}:{user_id}"

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
        """
        Stream Claude Code response as async generator of events.

        Yields dicts with:
          {"type": "text", "content": "..."} — text chunk
          {"type": "tool_use", "tool": "...", "input": {...}} — tool being called
          {"type": "result", "content": "...", "session_id": "..."} — final result
          {"type": "error", "content": "..."} — error
        """
        session_key = self._session_key(project_id, user_id)
        session_id = self._sessions.get(session_key)

        cmd = [
            "claude",
            "-p", message,
            "--output-format", "stream-json",
            "--verbose",
            "--permission-mode", "bypassPermissions",
            "--allowedTools", "mcp__discovery__get_project_context mcp__discovery__get_requirements mcp__discovery__get_constraints mcp__discovery__get_decisions mcp__discovery__get_stakeholders mcp__discovery__get_assumptions mcp__discovery__get_scope mcp__discovery__get_contradictions mcp__discovery__get_readiness mcp__discovery__get_documents mcp__discovery__search mcp__discovery__get_activity WebSearch WebFetch",
        ]

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

        # Generate MCP config with project-specific env vars
        mcp_config_path = self._create_mcp_config(project_id)
        if mcp_config_path:
            cmd.extend(["--mcp-config", str(mcp_config_path)])

        log.info("Starting Claude Code", cmd=" ".join(cmd[:6]) + "...", cwd=str(self.working_dir))

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.working_dir),
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
                        log.info("Session started", session_id=new_session_id)
                    continue

                # Assistant message — stream text content
                if event_type == "assistant":
                    msg = event.get("message", {})
                    content_blocks = msg.get("content", [])
                    for block in content_blocks:
                        if block.get("type") == "text":
                            yield {"type": "text", "content": block["text"]}
                        elif block.get("type") == "tool_use":
                            yield {
                                "type": "tool_use",
                                "tool": block.get("name", "unknown"),
                                "input": block.get("input", {}),
                            }
                    continue

                # Tool result
                if event_type == "tool_result":
                    # Claude Code handles tool execution internally
                    continue

                # Final result
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

            # Wait for process to finish
            await process.wait()

            if process.returncode != 0:
                stderr = await process.stderr.read()
                error_msg = stderr.decode("utf-8").strip() if stderr else "Unknown error"
                yield {"type": "error", "content": f"Claude Code exited with code {process.returncode}: {error_msg}"}

        except FileNotFoundError:
            yield {"type": "error", "content": "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"}
        except Exception as e:
            yield {"type": "error", "content": f"Runner error: {str(e)}"}

    def _create_mcp_config(self, project_id: uuid.UUID) -> Optional[Path]:
        """Create a temporary MCP config file pointing to our db_server.py."""
        mcp_server_path = Path(__file__).parent.parent.parent.parent / "mcp-server" / "db_server.py"
        mcp_venv_python = Path(__file__).parent.parent.parent.parent / "mcp-server" / ".venv" / "bin" / "python"

        if not mcp_server_path.exists():
            log.warning("MCP server not found", path=str(mcp_server_path))
            return None

        python_cmd = str(mcp_venv_python) if mcp_venv_python.exists() else "python"

        config = {
            "mcpServers": {
                "discovery": {
                    "command": python_cmd,
                    "args": [str(mcp_server_path)],
                    "env": {
                        "DATABASE_URL": os.environ.get("DATABASE_URL", "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db"),
                        "DISCOVERY_PROJECT_ID": str(project_id),
                    }
                }
            }
        }

        config_path = self.working_dir / ".mcp-runtime.json"
        config_path.write_text(json.dumps(config, indent=2))
        return config_path

    async def clear_session(self, project_id: uuid.UUID, user_id: uuid.UUID):
        """Clear a session so the next message starts fresh."""
        session_key = self._session_key(project_id, user_id)
        self._sessions.pop(session_key, None)


def _prepare_working_dir() -> str:
    """Create a clean runtime directory for the discovery chat.

    This is NOT the assistants/ directory (which has crnogorchi CLAUDE.md and agents).
    This is a clean environment specifically for the web chat, with:
    - A discovery-focused CLAUDE.md
    - No .memory-bank/ or agent files that confuse the context
    - MCP config is injected per-session by _create_mcp_config()
    """
    runtime_dir = Path(__file__).parent.parent.parent.parent / ".runtime" / "chat-env"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    # Write a focused CLAUDE.md for the web chat context
    claude_md = runtime_dir / "CLAUDE.md"
    claude_md.write_text("""# Discovery AI Assistant — Web Chat

You are the Discovery AI Assistant. You help Product Owners (POs) run structured client discovery for software projects.

## Your Data Access

You have MCP tools to query the project's extracted discovery data:
- `mcp__discovery__get_project_context` — Project overview, readiness score
- `mcp__discovery__get_requirements` — Business requirements (BR-001...) with priority and status
- `mcp__discovery__get_constraints` — Budget, timeline, technology constraints
- `mcp__discovery__get_decisions` — Decisions made during discovery
- `mcp__discovery__get_stakeholders` — People involved with roles and authority
- `mcp__discovery__get_assumptions` — Unvalidated assumptions with risk
- `mcp__discovery__get_scope` — What's in/out of MVP
- `mcp__discovery__get_contradictions` — Conflicts between items
- `mcp__discovery__get_readiness` — Readiness score and breakdown
- `mcp__discovery__get_documents` — Uploaded documents and processing status
- `mcp__discovery__search` — Search across all data
- `mcp__discovery__get_activity` — Recent activity log

## How to Respond

1. ALWAYS use the MCP tools to get current data before answering questions about the project
2. Cite specific items by ID (BR-001, etc.) when discussing requirements
3. When asked about readiness, call get_readiness and explain the breakdown
4. When asked about gaps, check what's missing by reviewing requirements, constraints, and assumptions
5. Be concise and actionable — the PO wants answers, not essays

## What NOT to Do

- Do NOT read local files, git history, or .memory-bank/ — all data is in the MCP tools
- Do NOT guess about project data — always query the MCP tools first
- Do NOT use Bash, Read, Write, or file tools — you are a chat assistant, not a code editor
""")

    log.info("Prepared chat runtime directory", path=str(runtime_dir))
    return str(runtime_dir)


# Singleton
claude_runner = ClaudeCodeRunner(working_dir=_prepare_working_dir())
