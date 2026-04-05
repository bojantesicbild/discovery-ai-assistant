"""Chat endpoint — Claude Code with native sessions and full assistants context."""

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

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}", tags=["chat"])


@router.post("/chat")
async def chat(
    project_id: uuid.UUID,
    message: ChatMessage,
    user: User = Depends(get_current_user),
):
    user_id = user.id

    # Load session ID from DB if we don't have it in memory
    if not claude_runner.get_session_id(project_id, user_id):
        async with async_session() as db:
            result = await db.execute(
                select(Conversation).where(
                    Conversation.project_id == project_id,
                    Conversation.user_id == user_id,
                )
            )
            conv = result.scalar_one_or_none()
            if conv and conv.messages:
                for msg in reversed(conv.messages):
                    if msg.get("session_id"):
                        claude_runner.set_session_id(project_id, user_id, msg["session_id"])
                        break

    async def event_stream():
        response_text = ""
        session_id = None
        tool_calls = []
        thinking_count = 0
        stats = {}
        activity_log = []  # Interleaved timeline of all events

        async for event in claude_runner.run_stream(
            project_id=project_id,
            user_id=user_id,
            message=message.text,
            model="haiku",
        ):
            event_type = event.get("type")

            if event_type == "session":
                session_id = event.get("session_id")

            elif event_type == "thinking":
                thinking_count += 1
                activity_log.append({"type": "thinking"})
                yield f"data: {json.dumps({'thinking': True})}\n\n"

            elif event_type == "text":
                response_text += event["content"]
                # Log meaningful text lines
                for line in event["content"].split("\n"):
                    stripped = line.strip()
                    if stripped and len(stripped) > 10:
                        activity_log.append({"type": "text", "content": stripped[:150]})
                yield f"data: {json.dumps({'text': event['content']})}\n\n"

            elif event_type == "tool_use":
                tool_name = event['tool']
                tool_input = event.get('input', {})
                label = _tool_label(tool_name, tool_input)
                tool_calls.append(label)
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

        # Send final done with stats
        yield f"data: {json.dumps({'done': True, 'stats': stats})}\n\n"

        # Save conversation to DB
        async with async_session() as db:
            try:
                result = await db.execute(
                    select(Conversation).where(
                        Conversation.project_id == project_id,
                        Conversation.user_id == user_id,
                    )
                )
                conversation = result.scalar_one_or_none()
                if not conversation:
                    conversation = Conversation(
                        project_id=project_id,
                        user_id=user_id,
                        messages=[],
                    )
                    db.add(conversation)

                now = datetime.now(timezone.utc).isoformat()
                history = list(conversation.messages or [])
                history.append({
                    "role": "user",
                    "content": message.text,
                    "timestamp": now,
                })
                history.append({
                    "role": "assistant",
                    "content": response_text,
                    "session_id": session_id,
                    "toolCalls": tool_calls,
                    "thinkingCount": thinking_count,
                    "activityLog": activity_log[-50:],  # Keep last 50 entries
                    "stats": stats,
                    "timestamp": now,
                })
                conversation.messages = list(history[-40:])
                await db.commit()
                log.info("Conversation saved", project=str(project_id)[:8], msg_count=len(conversation.messages))
            except Exception as e:
                log.error("Failed to save conversation", error=str(e), project=str(project_id)[:8])
                await db.rollback()

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
    result = await db.execute(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.user_id == user.id,
        )
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        return {"messages": []}
    return {"messages": conversation.messages[-20:]}


@router.delete("/conversation")
async def clear_conversation(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.user_id == user.id,
        )
    )
    conversation = result.scalar_one_or_none()
    if conversation:
        conversation.messages = []
        await db.flush()

    await claude_runner.clear_session(project_id, user.id)
    return {"status": "cleared"}
