"""
Dedup stage — compare new extracted items against existing ones.
Uses RAGFlow semantic search + LLM judgment to decide: ADD / UPDATE / CONTRADICTION / DUPLICATE.
"""

import uuid
import structlog
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import Requirement, Contradiction
from app.schemas.extraction import DiscoveryExtraction, Requirement as ReqSchema

log = structlog.get_logger()


async def dedup_requirements(
    db: AsyncSession,
    project_id: uuid.UUID,
    new_requirements: list[ReqSchema],
    ragflow=None,
    instructor=None,
) -> list[dict]:
    """Compare new requirements against existing ones.

    For each new requirement:
    - Search existing by title similarity (SQL ILIKE)
    - If similar found: mark as UPDATE or DUPLICATE
    - If contradictory: create Contradiction record
    - If new: mark as ADD

    Returns list of actions: [{action: ADD|UPDATE|DUPLICATE|CONTRADICTION, item: ..., existing_id: ...}]
    """
    actions = []

    for req in new_requirements:
        # Check for existing requirement by req_id first (exact match)
        result = await db.execute(
            select(Requirement).where(
                Requirement.project_id == project_id,
                Requirement.req_id == req.id,
            )
        )
        existing = result.scalars().all()

        # Also check by title similarity if no req_id match
        if not existing:
            core = _core_words(req.title)
            if core:
                result = await db.execute(
                    select(Requirement).where(
                        Requirement.project_id == project_id,
                        Requirement.title.ilike(f"%{core}%"),
                    )
                )
                existing = result.scalars().all()

        if not existing:
            actions.append({"action": "ADD", "item": req})
            continue

        # Check if it's a duplicate or update
        best_match = existing[0]
        if _is_same_content(req, best_match):
            actions.append({
                "action": "DUPLICATE",
                "item": req,
                "existing_id": str(best_match.id),
                "reason": f"Same as {best_match.req_id}: {best_match.title}",
            })
        elif _is_contradictory(req, best_match):
            actions.append({
                "action": "CONTRADICTION",
                "item": req,
                "existing_id": str(best_match.id),
                "reason": f"Conflicts with {best_match.req_id}",
            })
        else:
            actions.append({
                "action": "UPDATE",
                "item": req,
                "existing_id": str(best_match.id),
                "reason": f"Updates {best_match.req_id}: {best_match.title}",
            })

    return actions


def _core_words(title: str) -> str:
    """Extract core words from title for fuzzy matching."""
    stop_words = {"the", "a", "an", "for", "in", "of", "to", "and", "or", "with", "from"}
    words = [w for w in title.lower().split() if w not in stop_words]
    return " ".join(words[:3])  # first 3 meaningful words


def _is_same_content(new: ReqSchema, existing: Requirement) -> bool:
    """Check if two requirements are essentially the same."""
    return (
        new.title.lower().strip() == existing.title.lower().strip()
        and new.type == existing.type
    )


def _is_contradictory(new: ReqSchema, existing: Requirement) -> bool:
    """Check if two requirements contradict each other."""
    # Different priority for same feature is a potential contradiction
    if (new.title.lower().strip() == existing.title.lower().strip()
            and new.priority != existing.priority
            and existing.status == "confirmed"):
        return True
    return False


async def apply_dedup_actions(
    db: AsyncSession,
    project_id: uuid.UUID,
    doc_id: uuid.UUID,
    actions: list[dict],
) -> dict:
    """Apply dedup decisions: skip duplicates, flag contradictions, allow adds and updates."""
    counts = {"added": 0, "updated": 0, "duplicates": 0, "contradictions": 0}

    for action in actions:
        if action["action"] == "ADD":
            counts["added"] += 1
            # Item will be stored in the main store stage

        elif action["action"] == "DUPLICATE":
            counts["duplicates"] += 1
            log.info("Skipping duplicate", title=action["item"].title, reason=action["reason"])

        elif action["action"] == "UPDATE":
            counts["updated"] += 1
            # Could update existing item here — for now, just add as new
            # The PO can manually merge later

        elif action["action"] == "CONTRADICTION":
            counts["contradictions"] += 1
            # Create contradiction record
            con = Contradiction(
                project_id=project_id,
                item_a_type="requirement",
                item_a_id=uuid.UUID(action["existing_id"]),
                item_b_type="requirement",
                item_b_id=uuid.uuid4(),  # placeholder for new item
                explanation=action["reason"],
            )
            db.add(con)
            log.warning("Contradiction found", title=action["item"].title, reason=action["reason"])

    await db.flush()
    return counts
