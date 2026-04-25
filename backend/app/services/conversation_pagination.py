"""Cursor pagination for the chat history endpoint.

Cursor shape is opaque to the client. We pack the (created_at, id) of
the OLDEST message in the page just returned into a base64url JSON blob
so:
  - the next-page query becomes a simple `(created_at, id) < (cursor)`
    seek against ix_conv_msgs_proj_created_id_desc, and
  - the format can change later (e.g. add a partition key) without
    breaking already-issued cursors, because the frontend never reads it.

The N+1 trick: we ask the database for `limit + 1` rows. If we got the
extra row, we know there's a next page; we drop it from the response
and use the previous (still-included) row's (created_at, id) as the
next cursor. If we got `<= limit` rows, there is no next page.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational import ConversationMessage


DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def encode_cursor(created_at: datetime, msg_id: uuid.UUID) -> str:
    blob = json.dumps({"ts": created_at.isoformat(), "id": str(msg_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(blob.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID] | None:
    """Returns (created_at, id) or None if the cursor is malformed.
    Malformed cursors are treated as "start at the newest page" rather
    than 400'd — saves the frontend from having to special-case a bad
    cookie / URL share."""
    if not cursor:
        return None
    try:
        # Re-pad — urlsafe_b64encode strips trailing '=' above.
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
        ts = datetime.fromisoformat(data["ts"])
        mid = uuid.UUID(data["id"])
        return ts, mid
    except (ValueError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
        return None


async def fetch_page(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    cursor: str | None,
    limit: int = DEFAULT_LIMIT,
) -> tuple[list[dict[str, Any]], str | None]:
    """Return one page of messages (oldest-first within the page) plus the
    cursor for the next-older page (or None if there is no more history).

    "Oldest-first within the page" matches the existing JSONB iteration
    order, so the frontend can prepend a page to its flat array without
    reversing.
    """
    limit = max(1, min(limit, MAX_LIMIT))

    stmt = select(ConversationMessage).where(
        ConversationMessage.project_id == project_id
    )

    decoded = decode_cursor(cursor) if cursor else None
    if decoded is not None:
        cur_ts, cur_id = decoded
        # Strictly older than the cursor's (ts, id). Tuple comparison
        # plays nicely with ix_conv_msgs_proj_created_id_desc.
        stmt = stmt.where(
            or_(
                ConversationMessage.created_at < cur_ts,
                and_(
                    ConversationMessage.created_at == cur_ts,
                    ConversationMessage.id < cur_id,
                ),
            )
        )

    stmt = stmt.order_by(
        ConversationMessage.created_at.desc(),
        ConversationMessage.id.desc(),
    ).limit(limit + 1)

    rows = (await db.execute(stmt)).scalars().all()

    has_more = len(rows) > limit
    page_rows = rows[:limit]

    next_cursor: str | None = None
    if has_more and page_rows:
        oldest = page_rows[-1]  # rows are DESC, so last in slice is oldest in page
        next_cursor = encode_cursor(oldest.created_at, oldest.id)

    # Reverse so callers get oldest→newest within the page.
    page_rows = list(reversed(page_rows))
    messages = [r.payload for r in page_rows]
    return messages, next_cursor
