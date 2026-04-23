import uuid
from datetime import datetime
from pydantic import BaseModel


class ChatMessage(BaseModel):
    text: str
    attachments: list[str] = []  # file paths or references
    # Which chat tab this message belongs to. None = the project's default
    # session (set by the API layer). Web clients always pass an explicit id;
    # default fallback keeps legacy clients working during rollout.
    session_id: uuid.UUID | None = None


class ChatResponse(BaseModel):
    response: str
    sources: list[dict] = []
    tool_calls: list[dict] = []


class ChatSessionCreate(BaseModel):
    name: str = "Untitled"


class ChatSessionRename(BaseModel):
    name: str


class ChatSessionOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    is_default: bool
    is_pinned_slack: bool
    position: int
    last_active_at: datetime
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
