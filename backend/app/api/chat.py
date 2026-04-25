"""Chat endpoint — Claude Code with native sessions and full assistants context.

Conversations are project-shared (one Conversation row per project with
user_id IS NULL). Both web chat and Slack inbound write to the same row
and use the same Claude Code --resume session via PROJECT_SHARED_USER.
"""

import asyncio
import time
import uuid
import json
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.db.session import async_session, get_db
from app.deps import get_current_user
from app.models.auth import User
from app.schemas.chat import ChatMessage
from app.agent.claude_runner import claude_runner
from app.services.conversation_pagination import DEFAULT_LIMIT, fetch_page
from app.services.conversation_store import (
    PROJECT_SHARED_USER,
    append_message,
    append_user_message_web,
    clear_conversation as clear_shared_conversation,
    get_shared,
    update_message_by_id,
)


# Throttle for in-stream persistence — too tight and we hammer Postgres
# on every token, too loose and refresh-during-stream loses recent text.
# 350ms is a good middle: skeletons stay live, DB sees a write at most
# 3x/sec per project. Mirrors pipeline/tasks._LIVE_UPDATE_THROTTLE_MS.
_LIVE_PERSIST_THROTTLE_MS = 350

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

    # Persist a placeholder assistant message BEFORE streaming so a
    # mid-run refresh still has a real DB row to render the ghost on
    # top of. The stream loop below patches this same row in place via
    # update_message_by_id; nothing else creates a second message.
    placeholder_id: str | None = None
    try:
        async with async_session() as db:
            placeholder_id = await append_message(db, project_id, {
                "role": "assistant",
                "source": "web",
                # Tagged so the startup sweep + migration-style cleanups
                # can target chat placeholders specifically (mirrors the
                # 'extraction_running' / 'reminder_prep' kinds).
                "kind": "chat_running",
                "content": "",
                "segments": [],
                "toolCalls": [],
                "thinkingCount": 0,
                "_processing": True,
            })
    except Exception as e:
        log.warning("chat.placeholder.failed", project=str(project_id)[:8], error=str(e))

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

        # Throttle live persistence — same idea as pipeline/tasks. The
        # last_persist_ms guard lets us call _maybe_live_persist on every
        # event cheaply; only every ~350ms does it actually hit the DB.
        last_persist_ms = 0.0

        async def _snapshot_segments() -> list[dict]:
            """Build the segment list to persist right now, including any
            activity segment still being accumulated."""
            snap = list(segments)
            if _current_activity_tools or _current_activity_thinking > 0:
                snap.append({
                    "type": "activity",
                    "tools": list(_current_activity_tools),
                    "thinkingCount": _current_activity_thinking,
                })
            return snap

        async def _maybe_live_persist() -> None:
            nonlocal last_persist_ms
            if not placeholder_id:
                return
            now_ms = time.time() * 1000
            if now_ms - last_persist_ms < _LIVE_PERSIST_THROTTLE_MS:
                return
            last_persist_ms = now_ms
            try:
                async with async_session() as db_live:
                    await update_message_by_id(
                        db_live, project_id, placeholder_id,
                        {
                            "content": response_text,
                            "segments": await _snapshot_segments(),
                            "toolCalls": list(tool_calls),
                            "thinkingCount": thinking_count,
                        },
                    )
            except Exception as e:
                log.warning("chat.live.persist.failed", project=str(project_id)[:8], error=str(e))

        # Acquire the per-project lock so we don't run concurrently with
        # a Slack-triggered Claude run against the same shared session.
        project_lock = claude_runner.get_project_lock(project_id)
        if project_lock.locked():
            try:
                yield f"data: {json.dumps({'busy': True})}\n\n"
            except (asyncio.CancelledError, GeneratorExit):
                pass

        run_completed = False
        try:
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
                        try:
                            yield f"data: {json.dumps({'thinking': True})}\n\n"
                        except (asyncio.CancelledError, GeneratorExit):
                            pass

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
                        try:
                            yield f"data: {json.dumps({'text': event['content']})}\n\n"
                        except (asyncio.CancelledError, GeneratorExit):
                            pass

                    elif event_type == "tool_use":
                        _last_seg_phase = "activity"
                        tool_name = event['tool']
                        tool_input = event.get('input', {})
                        label = _tool_label(tool_name, tool_input)
                        tool_calls.append(label)
                        _current_activity_tools.append(label)
                        activity_log.append({"type": "tool", "tool": label})
                        try:
                            yield f"data: {json.dumps({'tool': label, 'toolType': _tool_type(tool_name), 'status': 'calling'})}\n\n"
                        except (asyncio.CancelledError, GeneratorExit):
                            pass

                    elif event_type == "tool_result":
                        is_error = event.get("is_error", False)
                        if is_error:
                            activity_log.append({"type": "error", "content": "Tool execution failed"})
                        try:
                            yield f"data: {json.dumps({'toolResult': True, 'isError': is_error})}\n\n"
                        except (asyncio.CancelledError, GeneratorExit):
                            pass

                    elif event_type == "retry":
                        activity_log.append({"type": "retry", "attempt": event.get('attempt', 1)})
                        try:
                            yield f"data: {json.dumps({'retry': True, 'attempt': event.get('attempt', 1), 'maxRetries': event.get('max_retries', 3)})}\n\n"
                        except (asyncio.CancelledError, GeneratorExit):
                            pass

                    elif event_type == "error":
                        activity_log.append({"type": "error", "content": event['content'][:150]})
                        try:
                            yield f"data: {json.dumps({'error': event['content']})}\n\n"
                        except (asyncio.CancelledError, GeneratorExit):
                            pass

                    elif event_type == "result":
                        if not response_text:
                            response_text = event.get("content", "")
                            if response_text:
                                try:
                                    yield f"data: {json.dumps({'text': response_text})}\n\n"
                                except (asyncio.CancelledError, GeneratorExit):
                                    pass
                        session_id = event.get("session_id") or session_id
                        stats = {
                            "numTurns": event.get("num_turns", 0),
                            "durationMs": event.get("duration_ms", 0),
                        }

                    # Throttled persistence after every event the user
                    # would care about. If the client disconnects, the
                    # except handler below still runs — guaranteeing the
                    # placeholder reflects the latest state on disk.
                    await _maybe_live_persist()

                # Flush any remaining activity segment
                if _current_activity_tools or _current_activity_thinking > 0:
                    segments.append({"type": "activity", "tools": list(_current_activity_tools), "thinkingCount": _current_activity_thinking})

            run_completed = True

            # Send final done with stats (outside the lock — the run is complete)
            try:
                yield f"data: {json.dumps({'done': True, 'stats': stats})}\n\n"
            except (asyncio.CancelledError, GeneratorExit):
                pass
        finally:
            # Always finalize the placeholder, whether the run completed
            # normally, errored, or the client disconnected. _processing
            # flips to False so the ghost UI gives way to the rendered
            # message on the next poll/refresh.
            #
            # Cancellation handling: when uvicorn auto-reloads (file save
            # mid-stream) or the client disconnects, this task is
            # cancelled. Inside a cancellation, every fresh `await` raises
            # CancelledError immediately — including `async_session()`'s
            # `__aenter__`. CancelledError is a BaseException, not Exception,
            # so a bare `except Exception` lets it slip through and the
            # placeholder stays _processing=True forever (the bug that
            # produces stuck ghost cards).
            #
            # Fix: shield the whole finalize so the outer cancellation can't
            # tear it down mid-write, and catch BaseException so logging
            # always runs. The startup sweep in app.main is the second
            # safety net for cases where shielding still loses (forced
            # worker restart, etc.).
            if placeholder_id:
                async def _do_finalize() -> None:
                    async with async_session() as db_final:
                        await update_message_by_id(
                            db_final, project_id, placeholder_id,
                            {
                                "content": response_text,
                                "session_id": session_id,
                                "toolCalls": tool_calls,
                                "thinkingCount": thinking_count,
                                "activityLog": activity_log[-50:],
                                "segments": segments,
                                "stats": stats if run_completed else stats or {},
                                "_processing": False,
                            },
                        )
                try:
                    await asyncio.shield(_do_finalize())
                except BaseException as e:
                    log.error(
                        "chat.finalize.failed",
                        error=str(e),
                        project=str(project_id)[:8],
                        cancelled=isinstance(e, asyncio.CancelledError),
                    )
                    if isinstance(e, (KeyboardInterrupt, SystemExit)):
                        raise

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


from app.services.tool_labels import tool_label as _tool_label, tool_type as _tool_type  # noqa: E402, F401


@router.get("/conversation")
async def get_conversation(
    project_id: uuid.UUID,
    cursor: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return one cursor-paginated page of the project's shared conversation
    (web + Slack history merged), oldest-first within the page.

    Calling without a cursor returns the newest page. The polling/reconcile
    loop on the client always calls without a cursor — older history comes
    from explicit "load more on scroll up" calls that pass `cursor`.
    """
    messages, next_cursor = await fetch_page(
        db, project_id, cursor=cursor, limit=limit,
    )
    return {
        "messages": messages,
        "next_cursor": next_cursor,
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
