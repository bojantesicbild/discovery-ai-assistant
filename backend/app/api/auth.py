"""Auth endpoints — JWT-based for MVP. OAuth2 integration later."""

import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jose import jwt

from app.config import settings
from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.schemas.auth import TokenResponse, UserResponse, UserCreate

router = APIRouter(prefix="/api/auth", tags=["auth"])


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiration_hours)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


@router.post("/register", response_model=TokenResponse)
async def register(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """Dev/testing registration. Production uses OAuth2."""
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=data.email,
        name=data.name,
        auth_provider=data.auth_provider,
        auth_provider_id=data.auth_provider_id or str(uuid.uuid4()),
    )
    db.add(user)
    await db.flush()

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(
    email: str,
    db: AsyncSession = Depends(get_db),
):
    """Dev login by email. Production uses OAuth2 callback."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)
