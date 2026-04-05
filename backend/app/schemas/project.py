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


class ProjectRepoCreate(BaseModel):
    name: str
    url: str
    provider: str = "github"
    access_token: Optional[str] = None
    default_branch: str = "main"


class ProjectRepoResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    url: str
    provider: str
    default_branch: str
    last_synced_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}
