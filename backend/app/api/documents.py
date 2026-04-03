import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.document import Document
from app.schemas.document import DocumentResponse, DocumentListResponse

router = APIRouter(prefix="/api/projects/{project_id}/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv",
    ".pptx", ".ppt", ".eml", ".txt", ".md", ".png", ".jpg", ".jpeg",
}


@router.post("", response_model=DocumentResponse, status_code=201)
async def upload_document(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate file extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type {ext} not supported. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Validate size
    if file_size > settings.upload_max_size_mb * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max: {settings.upload_max_size_mb}MB")

    # Check for duplicate filename in this project
    existing = await db.execute(
        select(Document).where(
            Document.project_id == project_id,
            Document.filename == file.filename,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"File '{file.filename}' already uploaded. Delete the existing one first."
        )

    # Save file to project's Claude Code directory
    from app.agent.claude_runner import claude_runner
    upload_dir = claude_runner.get_upload_dir(project_id)
    safe_name = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    file_path = upload_dir / safe_name
    file_path.write_bytes(content)

    # Create document record
    doc = Document(
        project_id=project_id,
        filename=file.filename,
        file_type=ext.lstrip("."),
        file_size_bytes=file_size,
        pipeline_stage="queued",
        classification={"file_path": str(file_path)},
    )
    db.add(doc)
    await db.flush()

    # Queue pipeline job
    try:
        from arq import create_pool
        from arq.connections import RedisSettings
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job("process_document", str(doc.id))
        await pool.close()
    except Exception:
        # If Redis isn't running, document stays queued
        pass

    # Activity log
    from app.models.operational import ActivityLog
    db.add(ActivityLog(
        project_id=project_id,
        user_id=user.id,
        action="document_uploaded",
        summary=f"Uploaded {file.filename} ({file_size} bytes)",
        details={"document_id": str(doc.id), "file_type": ext},
    ))
    await db.flush()

    return DocumentResponse.model_validate(doc)


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document)
        .where(Document.project_id == project_id)
        .order_by(Document.created_at.desc())
    )
    docs = result.scalars().all()
    return DocumentListResponse(
        documents=[DocumentResponse.model_validate(d) for d in docs],
        total=len(docs),
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    project_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.project_id == project_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse.model_validate(doc)


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    project_id: uuid.UUID,
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.project_id == project_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete related records first (foreign key constraints)
    from app.models.operational import PipelineCheckpoint
    from app.models.extraction import (
        Requirement, Constraint, Decision, Stakeholder,
        Assumption, ScopeItem, ChangeHistory,
    )
    from sqlalchemy import delete

    await db.execute(delete(PipelineCheckpoint).where(PipelineCheckpoint.document_id == document_id))
    await db.execute(delete(ChangeHistory).where(ChangeHistory.item_type == "requirement", ChangeHistory.project_id == project_id))
    await db.execute(delete(Requirement).where(Requirement.source_doc_id == document_id))
    await db.execute(delete(Constraint).where(Constraint.source_doc_id == document_id))
    await db.execute(delete(Decision).where(Decision.source_doc_id == document_id))
    await db.execute(delete(Stakeholder).where(Stakeholder.source_doc_id == document_id))
    await db.execute(delete(Assumption).where(Assumption.source_doc_id == document_id))
    await db.execute(delete(ScopeItem).where(ScopeItem.source_doc_id == document_id))

    # Delete uploaded file
    from app.services.storage import delete_upload
    from pathlib import Path
    file_path = (doc.classification or {}).get("file_path")
    if file_path:
        await delete_upload(Path(file_path))

    await db.delete(doc)
    await db.flush()
