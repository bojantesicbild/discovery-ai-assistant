"""Learnings service — record, promote, dismiss, retrieve.

The application contract with the `learnings` table. Keeping the logic
in one place so agent prompts, cron jobs, and promotion UIs all share
the same idempotent API.

Key design choice — dedup by normalized content. Repeat emissions of
"the PM prefers terse commit messages" bump `reference_count` and
`last_relevant_at` rather than creating N rows. That's what makes the
auto-promotion rule (>=3 references → candidate) work without manual
book-keeping.

Part of the session-heartbeat architecture. See
docs/research/2026-04-23-session-heartbeat-plan.md.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update, and_, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import Learning, LEARNING_CATEGORIES, LEARNING_STATUS


# Auto-promotion threshold. Repeat-emitted learnings that cross this
# reference_count become promotion candidates (PM still confirms).
DEFAULT_PROMOTION_THRESHOLD = 3

# How old a transient learning must be, with too few references, to
# auto-dismiss. Keeps the inbox from growing monotonically.
DEFAULT_STALE_DAYS = 90
DEFAULT_STALE_MIN_REFS = 2


_WS_RE = re.compile(r"\s+")


def _content_key(content: str) -> str:
    """Normalize content into the dedup handle.

    Lowercase, collapse whitespace, trim, truncate to the column's
    length. This is the minimum that catches "same insight, trivial
    rewording" without resorting to embeddings. Over-aggressive merge
    is acceptable — the PM can always dismiss.
    """
    if content is None:
        return ""
    s = _WS_RE.sub(" ", content.strip().lower())
    return s[:256]


# ── Record / upsert ───────────────────────────────────────────────────


async def record_learning(
    db: AsyncSession, *,
    category: str,
    content: str,
    project_id: uuid.UUID | None = None,
    origin_session_id: uuid.UUID | None = None,
    evidence_quote: str | None = None,
    evidence_doc_id: uuid.UUID | None = None,
) -> Learning:
    """Insert a learning, or bump reference_count + last_relevant_at
    when an existing row matches (project, category, normalized content).

    Agent-friendly: call it with a bare content string and the service
    handles dedup. Over repeated sessions a pattern accumulates
    references; the promotion rule kicks in once the threshold is met.
    """
    if category not in LEARNING_CATEGORIES:
        raise ValueError(
            f"bad category {category!r}, expected one of {LEARNING_CATEGORIES}"
        )
    content = (content or "").strip()
    if not content:
        raise ValueError("content is required")

    key = _content_key(content)
    now = datetime.now(timezone.utc)

    # Upsert via the UNIQUE (project_id, category, content_key) index.
    # On conflict: bump reference_count + last_relevant_at and reactivate
    # if the row was previously dismissed (PM sees the pattern repeating).
    #
    # SQLAlchemy's ORM layer doesn't re-hydrate entities from RETURNING
    # when pg_insert follows the upsert path — so we RETURNING id only
    # and fetch the fresh row via a plain SELECT. One extra round-trip,
    # but correctness beats cleverness here.
    stmt = pg_insert(Learning).values(
        project_id=project_id,
        origin_session_id=origin_session_id,
        category=category,
        content=content,
        content_key=key,
        evidence_quote=evidence_quote,
        evidence_doc_id=evidence_doc_id,
        status="transient",
        reference_count=1,
        last_relevant_at=now,
    ).on_conflict_do_update(
        constraint="uq_learnings_dedup",
        set_={
            "reference_count": Learning.reference_count + 1,
            "last_relevant_at": now,
            "evidence_quote": pg_insert(Learning).excluded.evidence_quote,
            "evidence_doc_id": pg_insert(Learning).excluded.evidence_doc_id,
            # Reactivate if it was dismissed — repeated signal overrides
            # the old dismissal. Keeps the promoted status stable though.
            "status": _reactivate_expr(),
            "dismissed_at": None,
            "dismissed_by": None,
        },
    ).returning(Learning.id)
    row_id = (await db.execute(stmt)).scalar_one()
    # Fresh fetch — SQLAlchemy's identity map would return stale
    # reference_count / status from any in-memory copy, so we issue an
    # UPDATE-free raw lookup and hydrate from that.
    row = await db.get(Learning, row_id)
    if row is not None:
        await db.refresh(row)
        return row
    # Fallback — shouldn't happen because the UPSERT returns the id
    # of the affected row, but SELECT defensively so a caller never
    # holds a None reference.
    return (await db.execute(
        select(Learning).where(Learning.id == row_id)
    )).scalar_one()


def _reactivate_expr():
    """CASE that preserves promoted state but flips dismissed back to
    transient on re-emission. Keeps PM's explicit promotion sticky.

    The ON CONFLICT context exposes two scopes for column references:
    the pre-existing row AND the EXCLUDED row. Postgres can't tell
    them apart from a bare `status` reference, so we qualify with
    `learnings.status` explicitly."""
    from sqlalchemy import case, literal
    from sqlalchemy import text
    current = text("learnings.status")
    return case(
        (current == literal("promoted"), current),
        else_=literal("transient"),
    )


# ── Promotion / dismissal ─────────────────────────────────────────────


async def promote_learning(
    db: AsyncSession, *,
    learning_id: uuid.UUID,
    user_id: uuid.UUID | None,
) -> Learning | None:
    """Flip status → promoted. Promoted learnings survive the stale
    reaper and are loaded as Tier 1 context on session start."""
    lr = await db.get(Learning, learning_id)
    if lr is None:
        return None
    lr.status = "promoted"
    lr.promoted_at = datetime.now(timezone.utc)
    lr.promoted_by = user_id
    lr.dismissed_at = None
    lr.dismissed_by = None
    await db.flush()
    return lr


async def dismiss_learning(
    db: AsyncSession, *,
    learning_id: uuid.UUID,
    user_id: uuid.UUID | None,
) -> Learning | None:
    """Flip status → dismissed. Re-emission reactivates (see upsert)."""
    lr = await db.get(Learning, learning_id)
    if lr is None:
        return None
    lr.status = "dismissed"
    lr.dismissed_at = datetime.now(timezone.utc)
    lr.dismissed_by = user_id
    await db.flush()
    return lr


async def auto_dismiss_stale(
    db: AsyncSession, *,
    stale_days: int = DEFAULT_STALE_DAYS,
    min_refs: int = DEFAULT_STALE_MIN_REFS,
) -> int:
    """Cron-friendly cleanup. Transient learnings older than the window
    with too few references get auto-dismissed. Promoted rows are
    untouched — once the PM endorses something, we keep it.

    Returns count dismissed."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=stale_days)
    stmt = (
        update(Learning)
        .where(
            Learning.status == "transient",
            Learning.last_relevant_at < cutoff,
            Learning.reference_count < min_refs,
        )
        .values(status="dismissed", dismissed_at=datetime.now(timezone.utc))
        .returning(Learning.id)
    )
    result = await db.execute(stmt)
    return len(result.fetchall())


# ── Retrieval ─────────────────────────────────────────────────────────


async def get_active_learnings(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    category: str | None = None,
    min_references: int = 1,
    include_global: bool = True,
    limit: int = 10,
) -> list[Learning]:
    """Top-N active learnings for a project — the session-start context.

    Ordering: reference_count DESC (most-reinforced first), then
    last_relevant_at DESC. `include_global=True` unions NULL-project
    rows (cross-project patterns the PM has explicitly promoted).

    Excludes dismissed status. Callers that want the full history should
    use `list_all` (not exposed yet; add when a history UI needs it).
    """
    conds = [
        Learning.status.in_(("transient", "promoted")),
        Learning.reference_count >= min_references,
    ]
    if include_global:
        conds.append(
            or_(Learning.project_id == project_id,
                Learning.project_id.is_(None))
        )
    else:
        conds.append(Learning.project_id == project_id)
    if category:
        conds.append(Learning.category == category)
    q = (
        select(Learning)
        .where(and_(*conds))
        .order_by(
            Learning.reference_count.desc(),
            Learning.last_relevant_at.desc(),
        )
        .limit(limit)
    )
    return list((await db.execute(q)).scalars().all())


async def promotion_candidates(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    threshold: int = DEFAULT_PROMOTION_THRESHOLD,
    limit: int = 20,
) -> list[Learning]:
    """Transient learnings whose reference_count crossed the threshold.
    Surfaced to the PM at session-end so promotion is one click, not a
    review session."""
    q = (
        select(Learning)
        .where(
            Learning.project_id == project_id,
            Learning.status == "transient",
            Learning.reference_count >= threshold,
        )
        .order_by(Learning.reference_count.desc(),
                  Learning.last_relevant_at.desc())
        .limit(limit)
    )
    return list((await db.execute(q)).scalars().all())
