import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class DocumentResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    filename: str
    file_type: str
    file_size_bytes: Optional[int] = None
    chunking_template: Optional[str] = None
    classification: Optional[dict] = None
    pipeline_stage: str
    pipeline_error: Optional[str] = None
    items_extracted: int = 0
    contradictions_found: int = 0
    created_at: datetime
    pipeline_started_at: Optional[datetime] = None
    pipeline_completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int
