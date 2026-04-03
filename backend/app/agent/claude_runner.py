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
        ]

        if session_id:
            cmd.extend(["--resume", session_id])

        if system_prompt:
            cmd.extend(["--system-prompt", system_prompt])

        if allowed_tools:
            cmd.extend(["--allowedTools", " ".join(allowed_tools)])

        if agent:
            cmd.extend(["--agent", agent])

        if self.mcp_config:
            cmd.extend(["--mcp-config", self.mcp_config])

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

    async def clear_session(self, project_id: uuid.UUID, user_id: uuid.UUID):
        """Clear a session so the next message starts fresh."""
        session_key = self._session_key(project_id, user_id)
        self._sessions.pop(session_key, None)


def _prepare_working_dir() -> str:
    """Clone assistants/ to a runtime working directory.

    assistants/ is the clean source (version-controlled).
    We copy it to a runtime dir so Claude Code sessions, .memory-bank/ state,
    and temp files don't pollute the source.
    """
    import shutil

    source_dir = Path(__file__).parent.parent.parent.parent / "assistants"
    runtime_dir = Path(__file__).parent.parent.parent.parent / ".runtime" / "assistants"

    if not source_dir.exists():
        log.warning("Assistants source directory not found", path=str(source_dir))
        return str(source_dir)

    # Copy source to runtime (fresh each startup)
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)

    shutil.copytree(
        source_dir,
        runtime_dir,
        ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"),
    )

    log.info("Prepared runtime working directory",
             source=str(source_dir), runtime=str(runtime_dir))
    return str(runtime_dir)


# Singleton — uses a cloned runtime copy of assistants/
claude_runner = ClaudeCodeRunner(working_dir=_prepare_working_dir())
