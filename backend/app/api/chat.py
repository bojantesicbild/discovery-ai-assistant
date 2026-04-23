"""Chat endpoint — Claude Code with native sessions, multi-tab per project.

Each project has one or more chat_sessions (the tabs in the chat panel).
Slack inbound is permanently pinned to the project's default session.
Web chat targets whichever session_id the request provides (defaults to
the project's default session if omitted)."""

import uuid
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.db.session import async_session, get_db
from app.deps import get_current_user
from app.models.auth import User
from app.schemas.chat import (
    ChatMessage, ChatSessionCreate, ChatSessionRename, ChatSessionOut,
)
from app.agent.claude_runner import claude_runner
from app.services.conversation_store import (
    append_assistant_message,
    append_user_message_web,
    clear_conversation as clear_session_messages,
    consume_unseen_system_messages,
    create_session,
    delete_session,
    get_default_session,
    get_messages,
    get_session,
    list_sessions,
    rename_session,
)

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}", tags=["chat"])


async def _resolve_session_id(
    db: AsyncSession, project_id: uuid.UUID, requested: uuid.UUID | None,
) -> uuid.UUID:
    """Return the requested session id if it belongs to the project, else
    fall back to default. Defends against cross-project session id."""
    if requested is not None:
        cs = await get_session(db, requested)
        if cs and cs.project_id == project_id:
            return cs.id
    default = await get_default_session(db, project_id)
    return default.id


@router.post("/chat")
async def chat(
    project_id: uuid.UUID,
    message: ChatMessage,
    user: User = Depends(get_current_user),
):
    # Resolve which tab this message lives in.
    async with async_session() as db:
        session_id = await _resolve_session_id(db, project_id, message.session_id)

    # Persist the user's message immediately so polling clients (and Slack)
    # see it before the long Claude run completes.
    async with async_session() as db:
        await append_user_message_web(db, project_id, session_id, message.text)

    # Pull any unread pipeline notices from the default session and inject
    # them as hidden context for the agent. Notices live on the default
    # session's timeline regardless of which tab the user is in — see
    # conversation_store.append_system_message.
    async with async_session() as db:
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
        captured_session_id = None
        tool_calls = []
        thinking_count = 0
        stats = {}
        activity_log = []
        segments = []
        _current_activity_tools = []
        _current_activity_thinking = 0
        _last_seg_phase = "activity"

        # Acquire the per-project lock so concurrent runs (web + Slack +
        # other tabs) serialize against the same project CWD.
        project_lock = claude_runner.get_project_lock(project_id)
        if project_lock.locked():
            yield f"data: {json.dumps({'busy': True})}\n\n"

        async with project_lock:
            async for event in claude_runner.run_stream(
                project_id=project_id,
                chat_session_id=session_id,
                mcp_user_id=user.id,
                message=agent_message,
                model="haiku",
            ):
                event_type = event.get("type")

                if event_type == "session":
                    captured_session_id = event.get("session_id")

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
                    captured_session_id = event.get("session_id") or captured_session_id
                    stats = {
                        "numTurns": event.get("num_turns", 0),
                        "durationMs": event.get("duration_ms", 0),
                    }

            # Flush any remaining activity segment
            if _current_activity_tools or _current_activity_thinking > 0:
                segments.append({"type": "activity", "tools": list(_current_activity_tools), "thinkingCount": _current_activity_thinking})

        # Send final done with stats (outside the lock — the run is complete)
        yield f"data: {json.dumps({'done': True, 'stats': stats})}\n\n"

        # Persist the assistant message to the session's conversation.
        try:
            async with async_session() as db:
                await append_assistant_message(
                    db, project_id, session_id,
                    content=response_text,
                    source="web",
                    session_id_claude=captured_session_id,
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


from app.services.tool_labels import tool_label as _tool_label, tool_type as _tool_type  # noqa: E402, F401


@router.get("/conversation")
async def get_conversation(
    project_id: uuid.UUID,
    session_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return one chat session's messages. Omitting session_id returns the
    default session (used by clients that haven't been updated to pass it)."""
    resolved = await _resolve_session_id(db, project_id, session_id)
    messages = await get_messages(db, project_id, resolved, limit=40)
    return {
        "session_id": str(resolved),
        "messages": messages,
        "busy": claude_runner.is_project_busy(project_id),
    }


@router.delete("/conversation")
async def clear_conversation(
    project_id: uuid.UUID,
    session_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Empty a session's messages and reset its Claude --resume thread.
    For non-default sessions, the recommended path is DELETE /chat-sessions/{id}
    instead — this endpoint preserves the row + identity."""
    resolved = await _resolve_session_id(db, project_id, session_id)
    await clear_session_messages(db, project_id, resolved)
    await claude_runner.clear_chat_session(resolved)
    return {"status": "cleared", "session_id": str(resolved)}


# ──────────────────────────────────────────────────────────────────
# Chat session CRUD
# ──────────────────────────────────────────────────────────────────


@router.get("/chat-sessions", response_model=list[ChatSessionOut])
async def list_chat_sessions(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Ensure default exists (covers projects created before the chat tab
    # ever opened) — a single round-trip on cold projects.
    await get_default_session(db, project_id)
    return await list_sessions(db, project_id)


@router.post("/chat-sessions", response_model=ChatSessionOut)
async def create_chat_session(
    project_id: uuid.UUID,
    body: ChatSessionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await create_session(db, project_id, name=body.name or "Untitled")


@router.patch("/chat-sessions/{session_id}", response_model=ChatSessionOut)
async def rename_chat_session(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    body: ChatSessionRename,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cs = await get_session(db, session_id)
    if cs is None or cs.project_id != project_id:
        raise HTTPException(status_code=404, detail="session not found")
    updated = await rename_session(db, session_id, body.name)
    return updated


@router.delete("/chat-sessions/{session_id}")
async def delete_chat_session(
    project_id: uuid.UUID,
    session_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cs = await get_session(db, session_id)
    if cs is None or cs.project_id != project_id:
        raise HTTPException(status_code=404, detail="session not found")
    if cs.is_default:
        raise HTTPException(status_code=400, detail="cannot delete the default session")
    # Don't yank the rug from under a streaming run. v1 uses a project
    # lock that's shared across sessions, so a busy project means the
    # delete request is colliding with some chat run.
    if claude_runner.is_project_busy(project_id):
        raise HTTPException(
            status_code=409,
            detail="project is busy with another chat run — try again in a moment",
        )
    ok = await delete_session(db, session_id)
    if not ok:
        raise HTTPException(status_code=400, detail="cannot delete this session")
    await claude_runner.clear_chat_session(session_id)
    return {"status": "deleted", "session_id": str(session_id)}
