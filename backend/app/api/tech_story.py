"""Read-only API for the Phase 2 tech-story chain.

The DB rows are an index over agent-owned vault files. Content is fetched
through the existing wiki/vault APIs using `file_path`; these endpoints
only return the metadata the list view needs (display id, title, status,
source BRs) plus child stories nested under a tech doc.

Writes are not exposed yet — they land when generation (story-tech-agent
/ story-story-agent) is wired into the chat path.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import Text, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.tech_story import TechDoc, Story
from app.services.tech_story_sync import sync_tech_docs_from_vault


router = APIRouter(prefix="/api/projects/{project_id}", tags=["tech-story"])


def _td_dict(td: TechDoc, stories: Optional[list[Story]] = None) -> dict:
    out = {
        "id": str(td.id),
        "td_id": td.td_id,
        "title": td.title,
        "file_path": td.file_path,
        "source_brs": td.source_brs or [],
        "status": td.status,
        "summary": td.summary,
        "created_at": td.created_at.isoformat() if td.created_at else None,
        "updated_at": td.updated_at.isoformat() if td.updated_at else None,
    }
    if stories is not None:
        out["stories"] = [_story_dict(s) for s in stories]
        out["story_count"] = len(stories)
    return out


def _story_dict(s: Story) -> dict:
    return {
        "id": str(s.id),
        "us_id": s.us_id,
        "tech_doc_id": str(s.tech_doc_id),
        "title": s.title,
        "file_path": s.file_path,
        "source_brs": s.source_brs or [],
        "acceptance_criteria": s.acceptance_criteria or [],
        "status": s.status,
        "summary": s.summary,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ── Tech Docs ─────────────────────────────────────────


@router.get("/tech-docs")
async def list_tech_docs(
    project_id: uuid.UUID,
    status: Optional[str] = Query(None, description="draft, reviewed, approved, superseded"),
    search: Optional[str] = Query(
        None,
        description="Substring match on td_id, title, summary, or any source BR id",
    ),
    include_stories: bool = Query(
        False, description="When true, nest each TD's child stories under `stories`"
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(TechDoc).where(TechDoc.project_id == project_id)
    if status:
        query = query.where(TechDoc.status == status)
    if search:
        s = f"%{search}%"
        # source_brs is JSONB — cast to text for cheap substring match.
        # Good enough for "BR-005" lookups; a GIN index can be added
        # later if the project grows past a few hundred TDs.
        query = query.where(
            or_(
                TechDoc.td_id.ilike(s),
                TechDoc.title.ilike(s),
                TechDoc.summary.ilike(s),
                cast(TechDoc.source_brs, Text).ilike(s),
            )
        )
    query = query.order_by(TechDoc.td_id)
    result = await db.execute(query)
    tds = list(result.scalars().all())

    # When children are requested, fetch all stories for this project in
    # one query and group by parent — avoids N+1.
    stories_by_td: dict[uuid.UUID, list[Story]] = {}
    if include_stories and tds:
        s_result = await db.execute(
            select(Story)
            .where(Story.project_id == project_id)
            .order_by(Story.us_id)
        )
        for s in s_result.scalars().all():
            stories_by_td.setdefault(s.tech_doc_id, []).append(s)

    items = [
        _td_dict(td, stories_by_td.get(td.id, []) if include_stories else None)
        for td in tds
    ]
    return {"items": items, "total": len(items)}


@router.get("/tech-docs/{td_id}")
async def get_tech_doc(
    project_id: uuid.UUID,
    td_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TechDoc).where(
            TechDoc.project_id == project_id, TechDoc.td_id == td_id
        )
    )
    td = result.scalar_one_or_none()
    if not td:
        raise HTTPException(status_code=404, detail=f"Tech doc {td_id} not found")

    s_result = await db.execute(
        select(Story)
        .where(Story.tech_doc_id == td.id)
        .order_by(Story.us_id)
    )
    stories = list(s_result.scalars().all())
    return _td_dict(td, stories)


# ── Stories ───────────────────────────────────────────


@router.get("/stories")
async def list_stories(
    project_id: uuid.UUID,
    tech_doc_id: Optional[uuid.UUID] = Query(
        None, description="Filter to stories under this TD's UUID"
    ),
    status: Optional[str] = Query(None, description="todo, in_progress, done, dropped"),
    search: Optional[str] = Query(
        None,
        description="Substring match on us_id, title, summary, or any source BR id",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Story).where(Story.project_id == project_id)
    if tech_doc_id:
        query = query.where(Story.tech_doc_id == tech_doc_id)
    if status:
        query = query.where(Story.status == status)
    if search:
        s = f"%{search}%"
        query = query.where(
            or_(
                Story.us_id.ilike(s),
                Story.title.ilike(s),
                Story.summary.ilike(s),
                cast(Story.source_brs, Text).ilike(s),
            )
        )
    query = query.order_by(Story.us_id)
    result = await db.execute(query)
    items = [_story_dict(s) for s in result.scalars().all()]
    return {"items": items, "total": len(items)}


@router.get("/stories/{us_id}")
async def get_story(
    project_id: uuid.UUID,
    us_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Story).where(
            Story.project_id == project_id, Story.us_id == us_id
        )
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail=f"Story {us_id} not found")
    return _story_dict(s)


# ── Status writes ─────────────────────────────────────────────────────
#
# Tight allowlists per kind — anything else is a 422 so a typo in chat
# can't silently land an unknown status that the UI then can't render.
TD_STATUSES = {"draft", "reviewed", "approved", "superseded"}
US_STATUSES = {"todo", "in_progress", "done", "dropped"}


@router.patch("/tech-docs/{td_id}")
async def update_tech_doc(
    project_id: uuid.UUID,
    td_id: str,
    payload: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if "status" not in payload:
        raise HTTPException(422, "only `status` is editable for now")
    new_status = str(payload["status"])
    if new_status not in TD_STATUSES:
        raise HTTPException(
            422, f"status must be one of {sorted(TD_STATUSES)}; got {new_status!r}"
        )
    result = await db.execute(
        select(TechDoc).where(
            TechDoc.project_id == project_id, TechDoc.td_id == td_id
        )
    )
    td = result.scalar_one_or_none()
    if not td:
        raise HTTPException(404, f"Tech doc {td_id} not found")
    td.status = new_status
    await db.commit()
    await db.refresh(td)
    return _td_dict(td)


@router.patch("/stories/{us_id}")
async def update_story(
    project_id: uuid.UUID,
    us_id: str,
    payload: dict = Body(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if "status" not in payload:
        raise HTTPException(422, "only `status` is editable for now")
    new_status = str(payload["status"])
    if new_status not in US_STATUSES:
        raise HTTPException(
            422, f"status must be one of {sorted(US_STATUSES)}; got {new_status!r}"
        )
    result = await db.execute(
        select(Story).where(
            Story.project_id == project_id, Story.us_id == us_id
        )
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, f"Story {us_id} not found")
    s.status = new_status
    await db.commit()
    await db.refresh(s)
    return _story_dict(s)


# ── Sync from vault ───────────────────────────────────────────────────


@router.post("/tech-docs/sync")
async def sync_tech_docs(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reconcile tech_docs + stories index with the markdown files the
    agents have written under .memory-bank/docs/tech-docs/. Idempotent —
    safe to call on every page mount.
    """
    return await sync_tech_docs_from_vault(db, project_id)

