import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional


class ProjectCreate(BaseModel):
    name: str
    client_name: str
    project_type: str  # Greenfield, Add-on, Feature Extension, API, Mobile, Custom
    repo_url: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client_name: Optional[str] = None
    project_type: Optional[str] = None
    status: Optional[str] = None
    repo_url: Optional[str] = None


class ProjectMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = "member"  # lead, member, viewer


class ProjectMemberResponse(BaseModel):
    user_id: uuid.UUID
    role: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    client_name: str
    project_type: str
    status: str
    repo_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    members: list[ProjectMemberResponse] = Field(default_factory=list)
    documents_count: int = 0
    readiness_score: Optional[float] = None

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    projects: list[ProjectResponse]
    total: int
