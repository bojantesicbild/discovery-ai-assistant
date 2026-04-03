"""Chat endpoint — SSE streaming via Claude Code subprocess."""

import uuid
import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session, get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.operational import Conversation, LLMCall
from app.schemas.chat import ChatMessage
from app.agent.claude_runner import claude_runner

router = APIRouter(prefix="/api/projects/{project_id}", tags=["chat"])


@router.post("/chat")
async def chat(
    project_id: uuid.UUID,
    message: ChatMessage,
    user: User = Depends(get_current_user),
):
    user_id = user.id

    async def event_stream():
        response_text = ""

        # Claude Code has MCP access to the database via db_server.py
        # It can call get_requirements, get_readiness, search, etc.
        # Using haiku for chat during testing to save costs (change to sonnet/opus for production)
        async for event in claude_runner.run_stream(
            project_id=project_id,
            user_id=user_id,
            message=message.text,
            model="haiku",  # Change to "sonnet" or remove for production
        ):
            event_type = event.get("type")

            if event_type == "text":
                response_text += event["content"]
                yield f"data: {json.dumps({'text': event['content']})}\n\n"

            elif event_type == "tool_use":
                yield f"data: {json.dumps({'tool': event['tool'], 'status': 'calling'})}\n\n"

            elif event_type == "error":
                yield f"data: {json.dumps({'error': event['content']})}\n\n"

            elif event_type == "result":
                # Use the full result if we didn't get streaming text
                if not response_text:
                    response_text = event.get("content", "")
                    if response_text:
                        yield f"data: {json.dumps({'text': response_text})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

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

                history = conversation.messages or []
                history.append({"role": "user", "content": message.text})
                history.append({"role": "assistant", "content": response_text})
                conversation.messages = history[-40:]
                await db.commit()
            except Exception:
                pass  # Don't fail the stream if DB save fails

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
