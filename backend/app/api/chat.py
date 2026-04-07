"""Chat endpoint — Claude Code with native sessions and full assistants context.

Conversations are project-shared (one Conversation row per project with
user_id IS NULL). Both web chat and Slack inbound write to the same row
and use the same Claude Code --resume session via PROJECT_SHARED_USER.
"""

import uuid
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.db.session import async_session, get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.operational import Conversation
from app.schemas.chat import ChatMessage
from app.agent.claude_runner import claude_runner
from app.services.conversation_store import (
    PROJECT_SHARED_USER,
    append_assistant_message,
    append_user_message_web,
    clear_conversation as clear_shared_conversation,
    get_messages,
    get_shared,
)

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}", tags=["chat"])


@router.post("/chat")
async def chat(
    project_id: uuid.UUID,
    message: ChatMessage,
    user: User = Depends(get_current_user),
):
    # All web chat traffic uses the project-shared sentinel user so that
    # the Claude Code session is shared with Slack inbound.
    user_id = PROJECT_SHARED_USER

    # Load session ID from the shared conversation if we don't have it in memory
    if not claude_runner.get_session_id(project_id, user_id):
        async with async_session() as db:
            conv = await get_shared(db, project_id)
            if conv and conv.messages:
                for msg in reversed(conv.messages):
                    if msg.get("session_id"):
                        claude_runner.set_session_id(project_id, user_id, msg["session_id"])
                        break

    # Persist the user's message immediately so polling clients (and Slack)
    # see it before the long Claude run completes.
    async with async_session() as db:
        await append_user_message_web(db, project_id, message.text)

    # Pull any unread pipeline notices and prepend them as hidden context for
    # the agent. This is how Option-A "context injection" works: docs that
    # finished processing since the user's last turn become visible to the
    # agent without firing an unprompted agent run on each ingest.
    async with async_session() as db:
        from app.services.conversation_store import consume_unseen_system_messages
        unseen_systems = await consume_unseen_system_messages(db, project_id)

    if unseen_systems:
        ctx_lines = ["[System updates since your last reply — reference these if relevant:]"]
        for s in unseen_systems:
            ctx_lines.append(f"- {s.get('content', '')}")
        agent_message = "\n".join(ctx_lines) + "\n\n" + message.text
    else:
        agent_message = message.text

    async def event_stream():
        response_text = ""
        session_id = None
        tool_calls = []
        thinking_count = 0
        stats = {}
        activity_log = []  # Interleaved timeline of all events
        # Segments: interleaved text/activity blocks for timeline view
        segments = []  # list of {"type": "text"|"activity", ...}
        _current_activity_tools = []
        _current_activity_thinking = 0
        _last_seg_phase = "activity"  # start expecting tools/thinking

        # Acquire the per-project lock so we don't run concurrently with
        # a Slack-triggered Claude run against the same shared session.
        project_lock = claude_runner.get_project_lock(project_id)
        if project_lock.locked():
            yield f"data: {json.dumps({'busy': True})}\n\n"

        async with project_lock:
            async for event in claude_runner.run_stream(
                project_id=project_id,
                user_id=user_id,
                message=agent_message,
                model="haiku",
            ):
                event_type = event.get("type")

                if event_type == "session":
                    session_id = event.get("session_id")

                elif event_type == "thinking":
                    thinking_count += 1
                    _current_activity_thinking += 1
                    _last_seg_phase = "activity"
                    activity_log.append({"type": "thinking"})
                    yield f"data: {json.dumps({'thinking': True})}\n\n"

                elif event_type == "text":
                    if _last_seg_phase == "activity" and (_current_activity_tools or _current_activity_thinking > 0):
                        segments.append({"type": "activity", "tools": list(_current_activity_tools), "thinkingCount": _current_activity_thinking})
                        _current_activity_tools = []
                        _current_activity_thinking = 0
                    _last_seg_phase = "text"
                    response_text += event["content"]
                    if segments and segments[-1]["type"] == "text":
                        segments[-1]["content"] = segments[-1].get("content", "") + event["content"]
                    else:
                        segments.append({"type": "text", "content": event["content"]})
                    for line in event["content"].split("\n"):
                        stripped = line.strip()
                        if stripped and len(stripped) > 10:
                            activity_log.append({"type": "text", "content": stripped[:150]})
                    yield f"data: {json.dumps({'text': event['content']})}\n\n"

                elif event_type == "tool_use":
                    _last_seg_phase = "activity"
                    tool_name = event['tool']
                    tool_input = event.get('input', {})
                    label = _tool_label(tool_name, tool_input)
                    tool_calls.append(label)
                    _current_activity_tools.append(label)
                    activity_log.append({"type": "tool", "tool": label})
                    yield f"data: {json.dumps({'tool': label, 'toolType': _tool_type(tool_name), 'status': 'calling'})}\n\n"

                elif event_type == "tool_result":
                    is_error = event.get("is_error", False)
                    if is_error:
                        activity_log.append({"type": "error", "content": "Tool execution failed"})
                    yield f"data: {json.dumps({'toolResult': True, 'isError': is_error})}\n\n"

                elif event_type == "retry":
                    activity_log.append({"type": "retry", "attempt": event.get('attempt', 1)})
                    yield f"data: {json.dumps({'retry': True, 'attempt': event.get('attempt', 1), 'maxRetries': event.get('max_retries', 3)})}\n\n"

                elif event_type == "error":
                    activity_log.append({"type": "error", "content": event['content'][:150]})
                    yield f"data: {json.dumps({'error': event['content']})}\n\n"

                elif event_type == "result":
                    if not response_text:
                        response_text = event.get("content", "")
                        if response_text:
                            yield f"data: {json.dumps({'text': response_text})}\n\n"
                    session_id = event.get("session_id") or session_id
                    stats = {
                        "numTurns": event.get("num_turns", 0),
                        "durationMs": event.get("duration_ms", 0),
                    }

            # Flush any remaining activity segment
            if _current_activity_tools or _current_activity_thinking > 0:
                segments.append({"type": "activity", "tools": list(_current_activity_tools), "thinkingCount": _current_activity_thinking})

        # Send final done with stats (outside the lock — the run is complete)
        yield f"data: {json.dumps({'done': True, 'stats': stats})}\n\n"

        # Persist the assistant message to the shared conversation.
        try:
            async with async_session() as db:
                await append_assistant_message(
                    db, project_id,
                    content=response_text,
                    source="web",
                    session_id=session_id,
                    tool_calls=tool_calls,
                    thinking_count=thinking_count,
                    activity_log=activity_log[-50:],
                    segments=segments,
                    stats=stats,
                )
        except Exception as e:
            log.error("Failed to save assistant message", error=str(e), project=str(project_id)[:8])

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _tool_label(tool_name: str, tool_input: dict) -> str:
    """Build a human-friendly tool label like Claude Code shows."""
    name = tool_name.replace("mcp__discovery__", "")

    if tool_name == "Read":
        path = tool_input.get("file_path", "")
        short = path.rsplit("/", 1)[-1] if "/" in path else path
        return f"Read {short}" if short else "Read file"
    elif tool_name == "Grep":
        pattern = tool_input.get("pattern", "")
        return f"Grep '{pattern[:30]}'" if pattern else "Grep"
    elif tool_name == "Glob":
        pattern = tool_input.get("pattern", "")
        return f"Glob {pattern[:30]}" if pattern else "Glob"
    elif tool_name == "Bash":
        cmd = tool_input.get("command", "")
        return f"Bash: {cmd[:35]}" if cmd else "Bash"
    elif tool_name == "Edit":
        path = tool_input.get("file_path", "")
        short = path.rsplit("/", 1)[-1] if "/" in path else path
        return f"Edit {short}" if short else "Edit file"
    elif tool_name == "Write":
        path = tool_input.get("file_path", "")
        short = path.rsplit("/", 1)[-1] if "/" in path else path
        return f"Write {short}" if short else "Write file"
    elif tool_name == "ToolSearch":
        return "searching tools"
    else:
        return name.replace("_", " ")


def _tool_type(tool_name: str) -> str:
    """Classify tool into a type for UI badge coloring."""
    if tool_name.startswith("mcp__"):
        return "mcp"
    elif tool_name in ("Read", "Grep", "Glob"):
        return "read"
    elif tool_name in ("Edit", "Write"):
        return "write"
    elif tool_name == "Bash":
        return "bash"
    elif tool_name == "ToolSearch":
        return "search"
    else:
        return "other"


@router.get("/conversation")
async def get_conversation(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the project-shared conversation (web + Slack history merged)."""
    messages = await get_messages(db, project_id, limit=40)
    return {
        "messages": messages,
        "busy": claude_runner.is_project_busy(project_id),
    }


@router.delete("/conversation")
async def clear_conversation(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear the shared conversation and reset the shared Claude session."""
    await clear_shared_conversation(db, project_id)
    await claude_runner.clear_session(project_id, PROJECT_SHARED_USER)
    return {"status": "cleared"}
