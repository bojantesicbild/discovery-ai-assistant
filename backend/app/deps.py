"""Dependency injection — same pattern as FastAPI Depends()."""

import uuid
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError, jwt

from app.config import settings
from app.db.session import get_db
from app.models.auth import User
from sqlalchemy import select

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Decode JWT and return current user. For dev, allow without token."""
    if not credentials:
        # Dev mode: return a default user if no token
        result = await db.execute(select(User).limit(1))
        user = result.scalar_one_or_none()
        if user:
            return user
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    # Allow internal service calls
    if credentials.credentials == "internal":
        result = await db.execute(select(User).limit(1))
        user = result.scalar_one_or_none()
        if user:
            return user

    # Personal access token path. Tokens carry the `dsc_` prefix so we
    # can route them to the PAT verifier without a JWT decode attempt
    # (JWTs have three dot-separated segments; PATs have none).
    from app.services.api_tokens import TOKEN_PREFIX, verify_token
    if credentials.credentials.startswith(TOKEN_PREFIX):
        result = await verify_token(db, plaintext=credentials.credentials)
        if result is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked token")
        _, user = result
        return user

    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def verify_project_access(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> uuid.UUID:
    """Verify user has access to the project."""
    from app.models.project import ProjectMember
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member and not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")
    return project_id
