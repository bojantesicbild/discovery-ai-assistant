"""Item change history API.

GET /api/projects/{project_id}/items/{item_type}/{item_id}/history

Returns the ChangeHistory timeline for a single extracted item, joined with
the source documents that triggered each change. Used by the detail panel's
"History" tab to show what changed, when, and from which upload.
"""
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.models.document import Document
from app.models.extraction import ChangeHistory

log = structlog.get_logger()

router = APIRouter(prefix="/api/projects/{project_id}", tags=["history"])

VALID_TYPES = {
    "requirement", "constraint", "stakeholder", "gap", "contradiction",
}


@router.get("/items/{item_type}/{item_id}/history")
async def get_item_history(
    project_id: uuid.UUID,
    item_type: str,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if item_type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid item_type. Must be one of: {sorted(VALID_TYPES)}")

    rows = (
        await db.execute(
            select(ChangeHistory)
            .where(
                ChangeHistory.project_id == project_id,
                ChangeHistory.item_type == item_type,
                ChangeHistory.item_id == item_id,
            )
            .order_by(ChangeHistory.created_at.asc())
        )
    ).scalars().all()

    # Resolve any source doc_ids referenced in new_value to filenames
    doc_ids: set[uuid.UUID] = set()
    for r in rows:
        src = (r.new_value or {}).get("source") if isinstance(r.new_value, dict) else None
        if src:
            try:
                doc_ids.add(uuid.UUID(src))
            except (ValueError, TypeError):
                pass

    doc_map: dict[str, str] = {}
    if doc_ids:
        docs = (
            await db.execute(select(Document).where(Document.id.in_(doc_ids)))
        ).scalars().all()
        doc_map = {str(d.id): d.filename for d in docs}

    entries = []
    for r in rows:
        new_val = r.new_value or {}
        old_val = r.old_value or {}
        source_doc_id = new_val.get("source") if isinstance(new_val, dict) else None
        entries.append({
            "id": str(r.id),
            "action": r.action,  # create | update
            "old_value": old_val,
            "new_value": {k: v for k, v in new_val.items() if k != "source"} if isinstance(new_val, dict) else new_val,
            "source_doc_id": source_doc_id,
            "source_filename": doc_map.get(source_doc_id) if source_doc_id else None,
            "triggered_by": r.triggered_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"item_type": item_type, "item_id": str(item_id), "history": entries}
