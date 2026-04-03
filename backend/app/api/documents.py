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

    # Save file to disk
    from app.services.storage import save_upload
    file_path = await save_upload(project_id, file.filename, content)

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

    # TODO: Delete from RAGFlow, cascade extracted items
    await db.delete(doc)
    await db.flush()
