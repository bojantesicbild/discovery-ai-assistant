"""Handoff document generation endpoint."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.control import ReadinessHistory

router = APIRouter(prefix="/api/projects/{project_id}", tags=["generate"])


@router.post("/generate")
async def generate_handoff(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Check readiness
    result = await db.scalar(
        select(ReadinessHistory.score)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )
    readiness_score = result or 0

    warning = None
    if readiness_score < 70:
        warning = f"Readiness is {readiness_score}% (below 70%). Generated documents may be incomplete."

    # Generate via Claude Code with discovery-docs-agent
    from app.agent.claude_runner import claude_runner

    result_text = ""
    async for event in claude_runner.run_stream(
        project_id=project_id,
        user_id=user.id,
        message="Generate all 3 handoff documents: Discovery Brief, MVP Scope Freeze, and Functional Requirements. Use source attribution on every claim.",
        agent="discovery-docs-agent",
    ):
        if event["type"] == "text":
            result_text += event["content"]
        elif event["type"] == "result":
            result_text = event.get("content", result_text)
        elif event["type"] == "error":
            return {"status": "error", "warning": warning, "message": event["content"]}

    return {
        "status": "completed",
        "warning": warning,
        "readiness_score": readiness_score,
        "content": result_text,
    }


@router.get("/handoff/{doc_type}")
async def get_handoff_document(
    project_id: uuid.UUID,
    doc_type: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # TODO: Return generated document content
    valid_types = ["discovery_brief", "mvp_scope_freeze", "functional_requirements"]
    if doc_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be one of: {valid_types}")

    return {
        "type": doc_type,
        "content": f"# {doc_type.replace('_', ' ').title()}\n\nDocument generation not yet implemented.",
        "format": "markdown",
    }
