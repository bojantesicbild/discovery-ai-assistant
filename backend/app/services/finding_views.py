"""Service layer for per-user finding read state.

Public API:
    mark_seen(db, user_id, project_id, finding_type, finding_id)
    mark_seen_bulk_per_type(db, user_id, project_id, finding_type)
    mark_seen_bulk_per_project(db, user_id, project_id)
    get_seen_map(db, user_id, project_id, finding_type) -> {finding_id: seen_at}
    count_unread_by_type(db, user_id, project_id) -> {type: count}

The "finding_type" string maps to the underlying SQLAlchemy model so we can
do existence checks and bulk operations without hardcoding SQL per type.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    Assumption,
    Constraint,
    Contradiction,
    Decision,
    Gap,
    Requirement,
    ScopeItem,
    Stakeholder,
)
from app.models.finding_view import FindingView

log = structlog.get_logger()

# Map finding_type → SQLAlchemy model class.
# Add new types here when new finding kinds are introduced.
FINDING_MODELS: dict[str, Any] = {
    "requirement": Requirement,
    "gap": Gap,
    "constraint": Constraint,
    "decision": Decision,
    "contradiction": Contradiction,
    "assumption": Assumption,
    "scope": ScopeItem,
    "stakeholder": Stakeholder,
}

ALL_FINDING_TYPES = tuple(FINDING_MODELS.keys())


def is_valid_finding_type(finding_type: str) -> bool:
    return finding_type in FINDING_MODELS


async def mark_seen(
    db: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    finding_type: str,
    finding_id: uuid.UUID,
) -> None:
    """Mark a single finding as seen by this user. Idempotent — ON CONFLICT
    DO UPDATE just bumps seen_at."""
    if not is_valid_finding_type(finding_type):
        log.warning("mark_seen: unknown finding_type", type=finding_type)
        return
    now = datetime.now(timezone.utc)
    stmt = pg_insert(FindingView).values(
        id=uuid.uuid4(),
        user_id=user_id,
        project_id=project_id,
        finding_type=finding_type,
        finding_id=finding_id,
        seen_at=now,
        seen_version=1,
    ).on_conflict_do_update(
        constraint="uq_finding_view",
        set_={"seen_at": now},
    )
    await db.execute(stmt)
    await db.commit()


async def mark_seen_bulk_per_type(
    db: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    finding_type: str,
) -> int:
    """Mark every finding of `finding_type` in this project as seen by the
    user. Returns the number of rows that were newly inserted (already-seen
    rows just update seen_at and aren't counted)."""
    if not is_valid_finding_type(finding_type):
        return 0
    Model = FINDING_MODELS[finding_type]
    # Pull every finding id of this type for the project
    result = await db.execute(
        select(Model.id).where(Model.project_id == project_id)
    )
    finding_ids = [row[0] for row in result.fetchall()]
    if not finding_ids:
        return 0

    now = datetime.now(timezone.utc)
    new_id = uuid.uuid4
    rows = [
        {
            "id": new_id(),
            "user_id": user_id,
            "project_id": project_id,
            "finding_type": finding_type,
            "finding_id": fid,
            "seen_at": now,
            "seen_version": 1,
        }
        for fid in finding_ids
    ]
    stmt = pg_insert(FindingView).values(rows).on_conflict_do_update(
        constraint="uq_finding_view",
        set_={"seen_at": now},
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.rowcount or 0


async def mark_seen_bulk_per_project(
    db: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
) -> int:
    """Mark every finding of every type in the project as seen by the user."""
    total = 0
    for finding_type in ALL_FINDING_TYPES:
        total += await mark_seen_bulk_per_type(db, user_id, project_id, finding_type)
    return total


async def get_seen_map(
    db: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    finding_type: str,
) -> dict[uuid.UUID, datetime]:
    """Return {finding_id: seen_at} for the given user/project/type. Used by
    list endpoints to attach `seen_at` to each row."""
    result = await db.execute(
        select(FindingView.finding_id, FindingView.seen_at).where(
            FindingView.user_id == user_id,
            FindingView.project_id == project_id,
            FindingView.finding_type == finding_type,
        )
    )
    return {row[0]: row[1] for row in result.fetchall()}


async def count_unread_by_type(
    db: AsyncSession,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
) -> dict[str, int]:
    """For each finding type, count how many findings exist that this user
    has NOT yet seen. Returns {type: count, ..., 'total': N}.

    Implementation: for each type, count rows in the source table that
    have no matching row in finding_views for this user.
    """
    counts: dict[str, int] = {}
    total = 0
    for finding_type, Model in FINDING_MODELS.items():
        # Get all finding ids for this project + type
        all_result = await db.execute(
            select(Model.id).where(Model.project_id == project_id)
        )
        all_ids = {row[0] for row in all_result.fetchall()}
        if not all_ids:
            counts[finding_type] = 0
            continue

        # Get the seen ids for this user
        seen_result = await db.execute(
            select(FindingView.finding_id).where(
                FindingView.user_id == user_id,
                FindingView.project_id == project_id,
                FindingView.finding_type == finding_type,
            )
        )
        seen_ids = {row[0] for row in seen_result.fetchall()}
        unread_count = len(all_ids - seen_ids)
        counts[finding_type] = unread_count
        total += unread_count

    counts["total"] = total
    return counts


async def cleanup_orphans(db: AsyncSession) -> int:
    """Remove finding_views rows whose underlying finding no longer exists.
    Run this periodically (daily cron) to keep the table clean. Returns
    the number of rows deleted."""
    deleted = 0
    for finding_type, Model in FINDING_MODELS.items():
        # Find finding_views rows of this type whose finding_id doesn't
        # exist in the source table.
        result = await db.execute(
            select(FindingView.id, FindingView.finding_id).where(
                FindingView.finding_type == finding_type,
            )
        )
        view_rows = result.fetchall()
        if not view_rows:
            continue
        view_ids_by_finding = {row[1]: row[0] for row in view_rows}
        all_finding_ids_result = await db.execute(
            select(Model.id).where(Model.id.in_(list(view_ids_by_finding.keys())))
        )
        existing_finding_ids = {row[0] for row in all_finding_ids_result.fetchall()}
        orphan_view_ids = [
            view_id for fid, view_id in view_ids_by_finding.items()
            if fid not in existing_finding_ids
        ]
        if not orphan_view_ids:
            continue
        from sqlalchemy import delete as sql_delete
        await db.execute(
            sql_delete(FindingView).where(FindingView.id.in_(orphan_view_ids))
        )
        deleted += len(orphan_view_ids)

    if deleted:
        await db.commit()
        log.info("Cleaned up orphan finding_views", count=deleted)
    return deleted
