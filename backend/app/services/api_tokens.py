"""Personal Access Token service — issue, verify, revoke.

Multi-user stage 1 of the session-heartbeat architecture. Tokens
authenticate MCP subprocesses and CLI sessions without baking
credentials into .mcp.json.

Security model:
- Plaintext tokens follow the shape `dsc_<44 base64url chars>` (32
  random bytes → 44 chars unpadded). The prefix is human-readable
  and trips secret-scanning tools; the suffix has ~256 bits of
  entropy, so guessing is off the table.
- Only the SHA-256 hash of the full plaintext is stored. If our DB
  leaks, tokens are not directly usable.
- Verification is O(1) by hash — no bcrypt cost because a leaked
  database alone is insufficient to impersonate (attacker needs the
  plaintext, which we never stored).
- `last_used_at` bumped on every verify. A future "prune unused
  tokens" UX reads this.

Not implemented here (deferred to later stages):
- Token scopes (which projects a token may touch). The column
  exists; service reads it through but enforcement lives in the
  MCP verify endpoint when ready.
- Rotation on compromise (revoke + notify user). Manual for now.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import ApiToken, User


# Prefix chosen for log-scanner friendliness. Short enough not to bloat
# env vars, distinct enough that `dsc_` stands out in grep output.
TOKEN_PREFIX = "dsc_"
# 32 random bytes → 44 base64url chars (no padding). 256 bits of
# entropy is comfortably above the "can't be brute-forced" bar.
TOKEN_RANDOM_BYTES = 32


def _hash_token(plaintext: str) -> str:
    """SHA-256 hex digest of the full plaintext (prefix included).

    Hashing the prefix too means a stolen DB leaks no information
    about the format — attacker sees 64-char hex, nothing else.
    """
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _generate_plaintext() -> str:
    """Cryptographically random token of shape `dsc_<44 url-safe chars>`."""
    return TOKEN_PREFIX + secrets.token_urlsafe(TOKEN_RANDOM_BYTES)


# ── Create ────────────────────────────────────────────────────────────


async def create_token(
    db: AsyncSession, *,
    user_id: uuid.UUID,
    name: str,
    expires_at: datetime | None = None,
    scopes: dict[str, Any] | None = None,
) -> tuple[ApiToken, str]:
    """Issue a fresh token. Returns (row, plaintext) — the plaintext is
    shown to the caller ONCE and never again retrievable.

    The row stores only the hash; the plaintext is not persisted. Loss
    → rotate (create a new one, revoke the old).
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("token name is required")

    plaintext = _generate_plaintext()
    token_hash = _hash_token(plaintext)

    row = ApiToken(
        user_id=user_id,
        name=name[:100],
        token_hash=token_hash,
        scopes=scopes,
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()
    return row, plaintext


# ── Verify ────────────────────────────────────────────────────────────


async def verify_token(
    db: AsyncSession, *, plaintext: str,
) -> tuple[ApiToken, User] | None:
    """Resolve a plaintext token to (token_row, user). Returns None if
    the token is unknown, revoked, or expired. Bumps last_used_at on
    success.

    Callers receive both the token row (for scope inspection later)
    and the user (for id + permissions). Never logs or echoes the
    plaintext — handle it like a password.
    """
    if not plaintext or not plaintext.startswith(TOKEN_PREFIX):
        return None
    token_hash = _hash_token(plaintext)
    row = (await db.execute(
        select(ApiToken).where(
            ApiToken.token_hash == token_hash,
            ApiToken.revoked_at.is_(None),
        ).limit(1)
    )).scalar_one_or_none()
    if row is None:
        return None
    now = datetime.now(timezone.utc)
    if row.expires_at is not None and row.expires_at <= now:
        return None
    user = await db.get(User, row.user_id)
    if user is None:
        return None
    # Fire-and-forget last-used bump. A failed flush here should not
    # block auth — the caller will re-fetch on the next request.
    row.last_used_at = now
    try:
        await db.flush()
    except Exception:
        pass
    return row, user


# ── Revoke / list ─────────────────────────────────────────────────────


async def revoke_token(
    db: AsyncSession, *,
    token_id: uuid.UUID,
    user_id: uuid.UUID,
) -> ApiToken | None:
    """Soft-revoke (sets revoked_at). Only the owning user can revoke
    their own tokens — callers enforce the scope."""
    row = await db.get(ApiToken, token_id)
    if row is None or row.user_id != user_id:
        return None
    if row.revoked_at is not None:
        return row
    row.revoked_at = datetime.now(timezone.utc)
    await db.flush()
    return row


async def list_tokens_for_user(
    db: AsyncSession, *, user_id: uuid.UUID, include_revoked: bool = False,
) -> list[ApiToken]:
    """List tokens the user has issued. Never returns plaintext."""
    q = select(ApiToken).where(ApiToken.user_id == user_id)
    if not include_revoked:
        q = q.where(ApiToken.revoked_at.is_(None))
    q = q.order_by(ApiToken.created_at.desc())
    return list((await db.execute(q)).scalars().all())
