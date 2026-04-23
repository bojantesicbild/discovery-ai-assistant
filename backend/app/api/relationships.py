"""HTTP endpoints for the relationships graph.

Two routes, both thin wrappers over `app.services.relationships`:

  GET  /api/projects/{id}/findings/{display_id}/connections
        → ConnectionsResult serialized to JSON for the Connections UI

  POST /api/projects/{id}/relationships/{rel_id}/retract
        → retract an edge with an optional reason; feeds the
          past-rejections learning loop

Keeping this thin makes the service module re-usable from the MCP,
the pipeline, and tests without pulling FastAPI imports.
"""
from __future__ import annotations

import uuid
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_current_user
from app.models.auth import User
from app.services.relationships import (
    get_connections, retract_relationship, ConnectionsResult,
)
from app.services.sessions import record_event_for_user

router = APIRouter(prefix="/api/projects/{project_id}", tags=["relationships"])


# ── Serialization helpers ─────────────────────────────────────────────
# Dataclasses from the service layer don't carry uuid→str conversion,
# so we project here. Keeping the frontier thin.


def _serialize_connections(result: ConnectionsResult) -> dict[str, Any]:
    return {
        "center": {
            "uuid": str(result.center.uuid),
            "kind": result.center.kind,
            "display_id": result.center.display_id,
            "label": result.center.label,
        },
        "outgoing": [
            {
                "rel_type": e.rel_type,
                "confidence": e.confidence,
                "direction": e.direction,
                "source_doc": e.source_doc,
                "source_quote": e.source_quote,
                "rationale": e.rationale,
                "created_by": e.created_by,
                "neighbor": {
                    "uuid": str(e.neighbor.uuid),
                    "kind": e.neighbor.kind,
                    "display_id": e.neighbor.display_id,
                    "label": e.neighbor.label,
                },
            }
            for e in result.outgoing
        ],
        "incoming": [
            {
                "rel_type": e.rel_type,
                "confidence": e.confidence,
                "direction": e.direction,
                "source_doc": e.source_doc,
                "source_quote": e.source_quote,
                "rationale": e.rationale,
                "created_by": e.created_by,
                "neighbor": {
                    "uuid": str(e.neighbor.uuid),
                    "kind": e.neighbor.kind,
                    "display_id": e.neighbor.display_id,
                    "label": e.neighbor.label,
                },
            }
            for e in result.incoming
        ],
        "derived": [
            {
                "kind": g.kind,
                "key": g.key,
                "members": [
                    {
                        "uuid": str(m.uuid),
                        "kind": m.kind,
                        "display_id": m.display_id,
                        "label": m.label,
                    }
                    for m in g.members
                ],
            }
            for g in result.derived
        ],
    }


# ── Endpoints ─────────────────────────────────────────────────────────


@router.get("/findings/{display_id}/connections")
async def get_finding_connections(
    project_id: uuid.UUID,
    display_id: str,
    rel_types: str | None = Query(
        None,
        description="Comma-separated rel_types to include. Omit for all.",
    ),
    include_derived: bool = Query(True),
    max_edges: int = Query(60, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rt_list = [s.strip() for s in rel_types.split(",")] if rel_types else None
    result = await get_connections(
        db,
        project_id=project_id,
        display_id=display_id,
        rel_types=rt_list,
        include_derived=include_derived,
        max_edges=max_edges,
    )
    if result is None:
        raise HTTPException(404, f"Finding {display_id!r} not found in project")
    return _serialize_connections(result)


class RetractBody(BaseModel):
    # Optional free-text "why". Stored on the row and echoed into the
    # next extraction's PAST REJECTIONS prompt section.
    reason: str | None = None


@router.post("/relationships/{relationship_id}/retract")
async def retract(
    project_id: uuid.UUID,
    relationship_id: uuid.UUID,
    body: RetractBody = RetractBody(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rel = await retract_relationship(
        db, relationship_id=relationship_id,
        user_id=user.id, reason=body.reason,
    )
    if rel is None:
        raise HTTPException(404, "Relationship not found")
    if rel.project_id != project_id:
        raise HTTPException(404, "Relationship not found in project")

    await record_event_for_user(
        db,
        project_id=project_id, user_id=user.id,
        event_type="relationship_retracted",
        payload={
            "relationship_id": str(rel.id),
            "from_type": rel.from_type,
            "from_uuid": str(rel.from_uuid),
            "to_type": rel.to_type,
            "to_uuid": str(rel.to_uuid),
            "rel_type": rel.rel_type,
            "reason": rel.retraction_reason,
        },
    )

    await db.commit()
    return {
        "id": str(rel.id),
        "status": rel.status,
        "retraction_reason": rel.retraction_reason,
    }
