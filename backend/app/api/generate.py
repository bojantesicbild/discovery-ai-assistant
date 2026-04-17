"""Handoff document generation endpoint."""

import uuid
import json
import time
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, async_session
from app.deps import get_current_user
from app.models.auth import User
from app.models.control import ReadinessHistory

router = APIRouter(prefix="/api/projects/{project_id}", tags=["generate"])

DOC_FILE_MAP = {
    "discovery_brief": "discovery-brief.md",
    "mvp_scope_freeze": "mvp-scope-freeze.md",
    "functional_requirements": "functional-requirements.md",
}


@router.post("/generate")
async def generate_handoff(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate all 3 handoff documents via discovery-docs-agent. Streams progress via SSE."""
    result = await db.scalar(
        select(ReadinessHistory.score)
        .where(ReadinessHistory.project_id == project_id)
        .order_by(ReadinessHistory.created_at.desc())
        .limit(1)
    )
    readiness_score = result or 0
    warning = None
    if readiness_score < 70:
        warning = f"Readiness is {readiness_score}% (below 70%). Documents may be incomplete."

    # Get next version number
    async with async_session() as db2:
        ver_result = await db2.execute(
            text("SELECT COALESCE(MAX(version), 0) + 1 FROM handoff_generations WHERE project_id = :pid"),
            {"pid": str(project_id)},
        )
        version = ver_result.scalar()

        # Create generation record
        gen_id = uuid.uuid4()
        await db2.execute(
            text("""INSERT INTO handoff_generations (id, project_id, version, status, readiness_score, logs, documents, errors)
                    VALUES (:id, :pid, :ver, 'running', :score, '[]', '[]', '[]')"""),
            {"id": str(gen_id), "pid": str(project_id), "ver": version, "score": readiness_score},
        )
        await db2.commit()

    from app.agent.claude_runner import claude_runner
    start_time = time.time()

    async def event_stream():
        logs = []
        errors = []

        yield f"data: {json.dumps({'status': 'starting', 'readiness': readiness_score, 'warning': warning, 'version': version})}\n\n"
        logs.append(f"[{_ts()}] Generation v{version} started (readiness: {readiness_score}%)")
        if warning:
            logs.append(f"[{_ts()}] WARNING: {warning}")

        result_text = ""
        async for event in claude_runner.run_stream(
            project_id=project_id,
            user_id=user.id,
            message="Generate all 3 handoff documents: Discovery Brief, MVP Scope Freeze, and Functional Requirements. "
                    "Read the templates from .claude/templates/. Read all data from MCP tools or from .memory-bank/docs/discovery/ files. "
                    "Apply source attribution on every claim: [CONFIRMED] or [ASSUMED]. "
                    "Write the documents to .memory-bank/docs/discovery/",
            agent="discovery-docs-agent",
        ):
            event_type = event.get("type")
            if event_type == "text":
                result_text += event["content"]
                # Save meaningful text lines to logs (skip very short fragments)
                for line in event["content"].split("\n"):
                    stripped = line.strip()
                    if stripped and len(stripped) > 10:
                        logs.append(f"[{_ts()}] {stripped[:120]}")
                yield f"data: {json.dumps({'text': event['content']})}\n\n"
            elif event_type == "tool_use":
                tool = event.get("tool", "unknown")
                tool_input = event.get("input", {})
                # Build descriptive tool label
                detail = tool
                if tool == "Read" and tool_input.get("file_path"):
                    detail = f"Read {tool_input['file_path'].rsplit('/', 1)[-1]}"
                elif tool == "Write" and tool_input.get("file_path"):
                    detail = f"Write {tool_input['file_path'].rsplit('/', 1)[-1]}"
                elif tool == "Edit" and tool_input.get("file_path"):
                    detail = f"Edit {tool_input['file_path'].rsplit('/', 1)[-1]}"
                elif tool.startswith("mcp__"):
                    detail = tool.replace("mcp__discovery__", "")
                logs.append(f"[{_ts()}] Tool: {detail}")
                yield f"data: {json.dumps({'tool': detail, 'status': 'calling'})}\n\n"
            elif event_type == "thinking":
                logs.append(f"[{_ts()}] Thinking...")
                yield f"data: {json.dumps({'thinking': True})}\n\n"
            elif event_type == "error":
                err = event["content"]
                errors.append(err)
                logs.append(f"[{_ts()}] ERROR: {err}")
                yield f"data: {json.dumps({'error': err})}\n\n"
            elif event_type == "result":
                if not result_text:
                    result_text = event.get("content", "")

        # Check which documents were generated
        project_dir = claude_runner.get_project_dir(project_id)
        discovery_dir = project_dir / ".memory-bank" / "docs" / "discovery"
        generated = []
        for doc_type, filename in DOC_FILE_MAP.items():
            filepath = discovery_dir / filename
            if filepath.exists() and filepath.stat().st_size > 100:
                generated.append(doc_type)

        duration_ms = int((time.time() - start_time) * 1000)
        status = "completed" if len(generated) == 3 else "partial" if generated else "failed"
        logs.append(f"[{_ts()}] {status.upper()}: Generated {len(generated)}/3 documents in {duration_ms/1000:.1f}s")

        # Save to DB
        async with async_session() as db2:
            await db2.execute(
                text("""UPDATE handoff_generations
                        SET status = :status, logs = :logs, documents = :docs, errors = :errors,
                            duration_ms = :dur, completed_at = now()
                        WHERE id = :id"""),
                {
                    "id": str(gen_id), "status": status,
                    "logs": json.dumps(logs), "docs": json.dumps(generated),
                    "errors": json.dumps(errors), "dur": duration_ms,
                },
            )
            await db2.commit()

        yield f"data: {json.dumps({'done': True, 'generated': generated, 'version': version, 'status': status, 'duration_ms': duration_ms})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/handoff/{doc_type}")
async def get_handoff_document(
    project_id: uuid.UUID,
    doc_type: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a generated handoff document."""
    if doc_type not in DOC_FILE_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be one of: {list(DOC_FILE_MAP.keys())}")

    from app.agent.claude_runner import claude_runner
    project_dir = claude_runner.get_project_dir(project_id)
    filepath = project_dir / ".memory-bank" / "docs" / "discovery" / DOC_FILE_MAP[doc_type]

    if not filepath.exists():
        return {"type": doc_type, "content": None, "generated": False}

    content = filepath.read_text(encoding="utf-8")
    return {"type": doc_type, "content": content, "generated": True, "format": "markdown"}


@router.get("/file")
async def get_project_file(
    project_id: uuid.UUID,
    path: str,
    user: User = Depends(get_current_user),
):
    """Read a file from the project's memory bank."""
    from app.agent.claude_runner import claude_runner
    project_dir = claude_runner.get_project_dir(project_id)
    # Resolve relative to project dir, prevent path traversal
    filepath = (project_dir / path).resolve()
    if not str(filepath).startswith(str(project_dir.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    content = filepath.read_text(encoding="utf-8")
    return {"path": path, "name": filepath.name, "content": content, "format": filepath.suffix.lstrip(".")}


@router.get("/handoff")
async def list_handoff_documents(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List handoff documents and generation history."""
    from app.agent.claude_runner import claude_runner
    project_dir = claude_runner.get_project_dir(project_id)
    discovery_dir = project_dir / ".memory-bank" / "docs" / "discovery"

    docs = []
    for doc_type, filename in DOC_FILE_MAP.items():
        filepath = discovery_dir / filename
        exists = filepath.exists() and filepath.stat().st_size > 100
        docs.append({
            "type": doc_type,
            "label": doc_type.replace("_", " ").title(),
            "generated": exists,
            "size": filepath.stat().st_size if exists else 0,
        })

    # Get generation history
    result = await db.execute(
        text("""SELECT version, status, readiness_score, logs, documents, errors, duration_ms, created_at
                FROM handoff_generations WHERE project_id = :pid ORDER BY version DESC"""),
        {"pid": str(project_id)},
    )
    generations = []
    for row in result.fetchall():
        generations.append({
            "version": row[0],
            "status": row[1],
            "readiness_score": row[2],
            "logs": row[3] or [],
            "documents": row[4] or [],
            "errors": row[5] or [],
            "duration_ms": row[6],
            "created_at": row[7].isoformat() if row[7] else None,
        })

    return {"documents": docs, "generations": generations}


def _ts():
    return datetime.now().strftime("%H:%M:%S")
