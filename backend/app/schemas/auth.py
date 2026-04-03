import uuid
from pydantic import BaseModel
from typing import Optional


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    is_admin: bool = False

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: str
    name: str
    auth_provider: str = "local"
    auth_provider_id: Optional[str] = None
    password: Optional[str] = None  # for dev/testing only
