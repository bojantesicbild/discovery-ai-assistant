"""
Dedup stage — RAGFlow semantic search → LLM judgment → MERGE/ADD/CONTRADICTION.

Two modes:
1. RAGFlow available: hybrid search (BGE-M3 embeddings + BM25) for semantic matching
2. Fallback: SequenceMatcher + compact prompt context (when RAGFlow is down)

Actions: ADD (new), MERGE (update existing), SKIP (duplicate), CONTRADICTION
"""

import uuid
from datetime import datetime, timezone
import structlog
from difflib import SequenceMatcher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import Requirement, Contradiction, ChangeHistory
from app.schemas.extraction import Requirement as ReqSchema

log = structlog.get_logger()

# Thresholds
SIMILARITY_HIGH = 0.85   # Auto-merge (clearly the same)
SIMILARITY_MID = 0.50    # Check more carefully
SIMILARITY_LOW = 0.50    # Below this = new requirement


async def dedup_requirements(
    db: AsyncSession,
    project_id: uuid.UUID,
    new_requirements: list[ReqSchema],
    ragflow=None,
    items_dataset_id: str = None,
) -> list[dict]:
    """Compare new requirements against existing ones.

    Returns list of actions: [{action: ADD|MERGE|SKIP|CONTRADICTION, ...}]
    """
    # Load all existing requirements
    result = await db.execute(
        select(Requirement).where(Requirement.project_id == project_id)
    )
    existing_reqs = result.scalars().all()

    if not existing_reqs:
        # First document — assign IDs and add all
        actions = []
        for i, req in enumerate(new_requirements, 1):
            req.id = f"BR-{i:03d}"
            actions.append({"action": "ADD", "item": req})
        return actions

    # Get next BR number
    max_num = max(
        (int(r.req_id.split("-")[1]) for r in existing_reqs if "-" in r.req_id),
        default=0,
    )
    next_num = max_num + 1

    actions = []

    for req in new_requirements:
        # Check if Claude already flagged an existing_match
        existing_match_id = getattr(req, '_existing_match', None)
        if existing_match_id:
            match = _find_by_req_id(existing_reqs, existing_match_id)
            if match:
                actions.append(_merge_action(req, match))
                continue

        # Try RAGFlow semantic search first
        if ragflow and items_dataset_id:
            action = await _ragflow_dedup(ragflow, items_dataset_id, req, existing_reqs)
            if action:
                if action["action"] == "ADD":
                    req.id = f"BR-{next_num:03d}"
                    next_num += 1
                    action["item"] = req
                actions.append(action)
                continue

        # Fallback: SequenceMatcher
        action = _text_similarity_dedup(req, existing_reqs)
        if action["action"] == "ADD":
            req.id = f"BR-{next_num:03d}"
            next_num += 1
            action["item"] = req
        actions.append(action)

    return actions


async def _ragflow_dedup(ragflow, dataset_id: str, req: ReqSchema, existing_reqs: list) -> dict | None:
    """Use RAGFlow hybrid search to find semantic matches."""
    try:
        query = f"{req.title}. {req.description[:200] if req.description else ''}"
        chunks = await ragflow.search(
            dataset_id=dataset_id,
            query=query,
            top_n=3,
            similarity_threshold=0.3,
        )

        if not chunks:
            return {"action": "ADD", "item": req}

        # Best match
        best = chunks[0]
        score = best.get("similarity", 0)

        # Extract BR ID from chunk content (format: "BR-001: title. description")
        chunk_text = best.get("content", "")
        matched_req_id = chunk_text.split(":")[0].strip() if ":" in chunk_text else None
        match = _find_by_req_id(existing_reqs, matched_req_id) if matched_req_id else None

        if not match:
            return {"action": "ADD", "item": req}

        if score >= SIMILARITY_HIGH:
            return _merge_action(req, match, score)
        elif score >= SIMILARITY_MID:
            # Ambiguous — check if contradictory or just an update
            if _is_contradictory(req, match):
                return _contradiction_action(req, match, score)
            return _merge_action(req, match, score)
        else:
            return {"action": "ADD", "item": req}

    except Exception as e:
        log.warning("RAGFlow dedup failed, using fallback", error=str(e))
        return None  # Fall through to text similarity


def _text_similarity_dedup(req: ReqSchema, existing_reqs: list) -> dict:
    """Fallback dedup using SequenceMatcher on title + description."""
    best_match = None
    best_score = 0.0

    for existing in existing_reqs:
        # Title similarity
        title_score = _similarity(req.title, existing.title)

        # Description similarity (weighted less)
        desc_score = 0.0
        if req.description and existing.description:
            desc_score = _similarity(
                req.description[:150], existing.description[:150]
            )

        # Combined score: 60% title, 40% description
        combined = title_score * 0.6 + desc_score * 0.4

        if combined > best_score:
            best_score = combined
            best_match = existing

    if best_score >= SIMILARITY_HIGH and best_match:
        return _merge_action(req, best_match, best_score)
    elif best_score >= SIMILARITY_MID and best_match:
        if _is_contradictory(req, best_match):
            return _contradiction_action(req, best_match, best_score)
        return _merge_action(req, best_match, best_score)
    else:
        return {"action": "ADD", "item": req}


def _merge_action(req: ReqSchema, existing: Requirement, score: float = 1.0) -> dict:
    return {
        "action": "MERGE",
        "item": req,
        "existing_id": str(existing.id),
        "existing_req_id": existing.req_id,
        "reason": f"Matches {existing.req_id}: {existing.title} ({score:.0%})",
        "similarity": score,
    }


def _contradiction_action(req: ReqSchema, existing: Requirement, score: float) -> dict:
    return {
        "action": "CONTRADICTION",
        "item": req,
        "existing_id": str(existing.id),
        "existing_req_id": existing.req_id,
        "reason": f"Conflicts with {existing.req_id}: {existing.title}",
        "similarity": score,
    }


def _find_by_req_id(existing_reqs: list, req_id: str) -> Requirement | None:
    if not req_id:
        return None
    for r in existing_reqs:
        if r.req_id == req_id:
            return r
    return None


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _is_contradictory(new: ReqSchema, existing: Requirement) -> bool:
    """Check if two similar requirements contradict each other."""
    # Different priority for same confirmed requirement
    if new.priority != existing.priority and existing.status == "confirmed":
        return True

    if not new.description or not existing.description:
        return False

    new_l = new.description.lower()
    exist_l = existing.description.lower()

    # Negation patterns
    negation_words = ["not ", "no ", "without ", "don't ", "doesn't ", "shouldn't ", "optional", "unnecessary"]
    for neg in negation_words:
        if neg in new_l and neg not in exist_l:
            return True
        if neg not in new_l and neg in exist_l:
            return True

    # Quantity conflicts (e.g. "2 documents" vs "3 documents")
    import re
    new_nums = set(re.findall(r'\b(\d+)\b', new_l))
    exist_nums = set(re.findall(r'\b(\d+)\b', exist_l))
    if new_nums and exist_nums and new_nums != exist_nums:
        # Numbers differ on same topic — likely contradiction
        return True

    # Conflicting scope words
    scope_conflicts = [
        ("only", "also"), ("must", "optional"), ("required", "optional"),
        ("mandatory", "nice to have"), ("always", "never"),
    ]
    for a, b in scope_conflicts:
        if (a in new_l and b in exist_l) or (b in new_l and a in exist_l):
            return True

    return False


async def apply_dedup_actions(
    db: AsyncSession,
    project_id: uuid.UUID,
    doc_id: uuid.UUID,
    actions: list[dict],
    doc_filename: str = "",
) -> dict:
    """Apply dedup decisions: merge, skip, or flag contradictions."""
    counts = {"added": 0, "merged": 0, "duplicates": 0, "contradictions": 0}

    for action in actions:
        if action["action"] == "ADD":
            counts["added"] += 1

        elif action["action"] == "MERGE":
            counts["merged"] += 1
            existing_id = uuid.UUID(action["existing_id"])
            req = action["item"]

            # Update existing requirement
            result = await db.execute(
                select(Requirement).where(Requirement.id == existing_id)
            )
            existing = result.scalar_one_or_none()
            if existing:
                # Append new source with filename
                now = datetime.now(timezone.utc).isoformat()
                sources = list(existing.sources or [])
                sources.append({
                    "doc_id": str(doc_id),
                    "filename": doc_filename,
                    "quote": (req.source_quote or "")[:300],
                    "added_at": now,
                })
                existing.sources = sources
                existing.version = (existing.version or 1) + 1

                # Track all field changes (not just description). Description
                # only updates if the new one adds info; other fields update
                # whenever the new value differs.
                changes_old: dict = {}
                changes_new: dict = {}

                if req.description and len(req.description) > len(existing.description or ""):
                    changes_old["description"] = existing.description
                    changes_new["description"] = req.description
                    existing.description = req.description

                for field in ("title", "priority", "type", "status", "confidence"):
                    new_val = getattr(req, field, None)
                    old_val = getattr(existing, field, None)
                    if new_val and new_val != old_val:
                        changes_old[field] = old_val
                        changes_new[field] = new_val
                        setattr(existing, field, new_val)

                if changes_old:
                    changes_new["source"] = str(doc_id)
                    db.add(ChangeHistory(
                        project_id=project_id,
                        item_type="requirement",
                        item_id=existing.id,
                        action="update",
                        old_value=changes_old,
                        new_value=changes_new,
                        triggered_by="pipeline",
                    ))

                log.info("Merged into existing",
                         existing=action.get("existing_req_id"),
                         new_title=req.title,
                         version=existing.version,
                         similarity=f"{action.get('similarity', 0):.0%}")

        elif action["action"] == "SKIP":
            counts["duplicates"] += 1
            log.info("Skipping duplicate",
                     title=action["item"].title,
                     existing=action.get("existing_req_id"))

        elif action["action"] == "CONTRADICTION":
            counts["contradictions"] += 1
            req = action["item"]
            existing_req_id = action.get("existing_req_id", "")
            con = Contradiction(
                project_id=project_id,
                item_a_type="requirement",
                item_a_id=uuid.UUID(action["existing_id"]),
                item_b_type="requirement",
                item_b_id=uuid.uuid4(),
                explanation=f"{existing_req_id} says: \"{action.get('reason', '')}\" — but new document says: \"{req.title}\". {req.description[:200] if req.description else ''}",
                source_doc_id=doc_id,
            )
            db.add(con)
            log.warning("Contradiction found",
                        new=action["item"].title,
                        existing=action.get("existing_req_id"))

    await db.flush()
    return counts


async def dedup_generic(
    db: AsyncSession,
    project_id: uuid.UUID,
    model_class,
    new_items: list,
    match_field: str = "description",
    threshold: float = 0.6,
) -> list:
    """Generic dedup for constraints, decisions, stakeholders. Returns only non-duplicate items."""
    result = await db.execute(
        select(model_class).where(model_class.project_id == project_id)
    )
    existing = result.scalars().all()

    if not existing:
        return new_items

    non_dups = []
    for item in new_items:
        new_text = getattr(item, match_field, "") or ""
        is_dup = False
        for ex in existing:
            ex_text = getattr(ex, match_field, "") or ""
            if _similarity(new_text[:150], ex_text[:150]) >= threshold:
                log.info("Skipping duplicate item",
                         type=model_class.__tablename__,
                         text=new_text[:50])
                is_dup = True
                break
        if not is_dup:
            non_dups.append(item)

    return non_dups
