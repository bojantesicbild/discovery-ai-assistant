"""Relationship service — insert, upsert, retract, traverse, resolve.

This is the single place application code touches the `relationships`
table. Keeping the logic here means:

- MCP handlers, pipeline hooks, API endpoints, and the graph parser
  all share one UPSERT contract (no accidental duplicate rows).
- Identity resolution between display IDs (BR-004) and UUIDs lives in
  one function, so renames don't break edges in ten places.
- Derived connections (same source doc, same stakeholder) have a
  single compute path — the relationships table stores only what can't
  be derived.

Part of the session-heartbeat architecture. See
docs/research/2026-04-23-session-heartbeat-plan.md.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Literal

from sqlalchemy import select, or_, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.relationship import Relationship, CONFIDENCE_VALUES, SOURCE_VALUES
from app.models.extraction import (
    Requirement, Constraint, Stakeholder, Contradiction, Gap,
)
from app.models.document import Document


# ── Inverse relationship types ────────────────────────────────────────
# Directed edges have semantic inverses. Store one direction, compute
# the other at read time so we never drift. Symmetric types map to
# themselves.
INVERSE_REL: dict[str, str] = {
    "blocks": "blocked_by",
    "blocked_by": "blocks",
    "affects": "affected_by",
    "affected_by": "affects",
    "raised_by": "raised",
    "raised": "raised_by",
    "derived_from": "source_of",
    "source_of": "derived_from",
    "proposes_patch": "has_proposal",
    "has_proposal": "proposes_patch",
    # Contradiction-wiring: the contradiction "concerns" a BR/constraint;
    # from the BR's perspective it's "contradicted_by". Stored direction
    # is contradiction → target (emission site in MCP).
    "concerns": "contradicted_by",
    "contradicted_by": "concerns",
    # Symmetric (same in both directions)
    "co_extracted": "co_extracted",
    "contradicts": "contradicts",
    "mentions": "mentions",
}


# ── Identity resolution ───────────────────────────────────────────────
# Display IDs (BR-004, GAP-007) are renderer-friendly but unstable if a
# finding gets renumbered. The relationships table stores UUIDs so
# rename-safe. These resolvers bridge between the two worlds.


@dataclass(frozen=True)
class FindingRef:
    """Resolved identity for a finding — both UUID and display ID."""
    uuid: uuid.UUID
    kind: str           # 'requirement' | 'gap' | 'constraint' | ...
    display_id: str     # BR-004, GAP-007, stakeholder name, etc.
    label: str          # short human label


_MODEL_BY_KIND = {
    "requirement": Requirement,
    "gap": Gap,
    "constraint": Constraint,
    "stakeholder": Stakeholder,
    "contradiction": Contradiction,
    "document": Document,
}


async def resolve_display_id(
    db: AsyncSession, project_id: uuid.UUID, display_id: str,
) -> FindingRef | None:
    """Turn BR-004 / GAP-007 / CON-002 / CTR-005 / doc filename / stakeholder
    name into a FindingRef. Returns None when nothing matches."""
    if not display_id:
        return None

    # Cheap prefix routing — most IDs are typed by their prefix.
    upper = display_id.upper()
    if upper.startswith("BR-"):
        q = select(Requirement).where(
            Requirement.project_id == project_id,
            Requirement.req_id == upper,
        )
        r = (await db.execute(q)).scalar_one_or_none()
        return FindingRef(r.id, "requirement", r.req_id, r.title) if r else None
    if upper.startswith("GAP-"):
        q = select(Gap).where(
            Gap.project_id == project_id, Gap.gap_id == upper,
        )
        r = (await db.execute(q)).scalar_one_or_none()
        return FindingRef(r.id, "gap", r.gap_id, r.question[:80]) if r else None
    if upper.startswith("CON-"):
        # Constraint IDs are positional (CON-NNN = row index). Parse the
        # number and fetch by stable creation order.
        try:
            idx = int(upper.split("-", 1)[1]) - 1
        except (ValueError, IndexError):
            return None
        q = select(Constraint).where(
            Constraint.project_id == project_id,
        ).order_by(Constraint.created_at, Constraint.id).offset(idx).limit(1)
        r = (await db.execute(q)).scalar_one_or_none()
        return FindingRef(r.id, "constraint", upper, r.description[:80]) if r else None
    if upper.startswith("CTR-"):
        try:
            idx = int(upper.split("-", 1)[1]) - 1
        except (ValueError, IndexError):
            return None
        q = select(Contradiction).where(
            Contradiction.project_id == project_id,
        ).order_by(Contradiction.created_at, Contradiction.id).offset(idx).limit(1)
        r = (await db.execute(q)).scalar_one_or_none()
        label = r.title or (r.explanation or "")[:80] if r else ""
        return FindingRef(r.id, "contradiction", upper, label) if r else None

    # No prefix — try stakeholder by name, then document by filename.
    stk = (await db.execute(
        select(Stakeholder).where(
            Stakeholder.project_id == project_id,
            Stakeholder.name == display_id,
        )
    )).scalar_one_or_none()
    if stk:
        return FindingRef(stk.id, "stakeholder", stk.name, f"{stk.role}")
    doc = (await db.execute(
        select(Document).where(
            Document.project_id == project_id,
            Document.filename == display_id,
        )
    )).scalar_one_or_none()
    if doc:
        return FindingRef(doc.id, "document", doc.filename, doc.filename)
    return None


async def resolve_uuids_to_display(
    db: AsyncSession, project_id: uuid.UUID,
    pairs: Iterable[tuple[str, uuid.UUID]],
) -> dict[tuple[str, uuid.UUID], FindingRef]:
    """Batch-resolve many (kind, uuid) pairs back to display IDs.

    Groups lookups per-kind so a typical Connections query runs 5-6
    queries total regardless of how many edges it touches."""
    by_kind: dict[str, list[uuid.UUID]] = {}
    for kind, u in pairs:
        by_kind.setdefault(kind, []).append(u)

    out: dict[tuple[str, uuid.UUID], FindingRef] = {}
    for kind, uuids in by_kind.items():
        Model = _MODEL_BY_KIND.get(kind)
        if Model is None:
            continue
        rows = (await db.execute(
            select(Model).where(Model.id.in_(uuids))
        )).scalars().all()
        for r in rows:
            display, label = _display_for(kind, r)
            out[(kind, r.id)] = FindingRef(r.id, kind, display, label)
    return out


def _display_for(kind: str, row: Any) -> tuple[str, str]:
    """Per-kind display-id + label extraction. One function so all
    callers produce consistent labels."""
    if kind == "requirement":
        return row.req_id, row.title or ""
    if kind == "gap":
        return row.gap_id, (row.question or "")[:80]
    if kind == "constraint":
        return f"CON-{str(row.id)[:8]}", (row.description or "")[:80]
    if kind == "contradiction":
        return f"CTR-{str(row.id)[:8]}", row.title or (row.explanation or "")[:80]
    if kind == "stakeholder":
        return row.name, row.role or ""
    if kind == "document":
        return row.filename, row.filename
    return str(row.id)[:8], str(getattr(row, "title", "") or "")[:80]


# ── Insert / upsert / retract ─────────────────────────────────────────


async def upsert_relationship(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    from_type: str, from_uuid: uuid.UUID,
    to_type: str, to_uuid: uuid.UUID,
    rel_type: str,
    confidence: str,
    created_by: str,
    source_doc_id: uuid.UUID | None = None,
    source_quote: str | None = None,
    rationale: str | None = None,
    created_by_user: uuid.UUID | None = None,
) -> Relationship:
    """Insert a relationship, or bump `last_seen_at` if the exact edge
    already exists from the same source.

    Dedup key: (project_id, from_uuid, to_uuid, rel_type, created_by).
    That lets extraction + graph_parser + human opinions coexist on the
    same edge — disagreement becomes data, not an overwrite."""
    if confidence not in CONFIDENCE_VALUES:
        raise ValueError(f"bad confidence {confidence!r}, expected one of {CONFIDENCE_VALUES}")
    if created_by not in SOURCE_VALUES:
        raise ValueError(f"bad created_by {created_by!r}, expected one of {SOURCE_VALUES}")

    now = datetime.now(timezone.utc)
    stmt = pg_insert(Relationship).values(
        project_id=project_id,
        from_type=from_type, from_uuid=from_uuid,
        to_type=to_type, to_uuid=to_uuid,
        rel_type=rel_type,
        confidence=confidence,
        created_by=created_by,
        source_doc_id=source_doc_id,
        source_quote=source_quote,
        rationale=rationale,
        created_by_user=created_by_user,
        last_seen_at=now,
    ).on_conflict_do_update(
        constraint="uq_relationships_endpoints",
        set_={
            "last_seen_at": now,
            # Upgrade confidence: if we previously stored a 'proposed' or
            # 'derived' edge and now see an 'explicit' claim, promote it.
            # Never downgrade.
            "confidence": _elevated_confidence(stmt_col="confidence", new=confidence),
            "source_quote": source_quote,
            "rationale": rationale,
            "status": "active",   # re-seeing a retracted edge reactivates it
            "retracted_at": None,
            "retracted_by": None,
            "retraction_reason": None,
        },
    ).returning(Relationship)
    result = await db.execute(stmt)
    return result.scalar_one()


def _elevated_confidence(*, stmt_col: str, new: str) -> Any:
    """CASE expression that upgrades confidence but never downgrades.
    explicit > proposed > derived."""
    from sqlalchemy import case, column, literal
    rank = {"derived": 1, "proposed": 2, "explicit": 3}
    existing = column(f"relationships.{stmt_col}")
    new_lit = literal(new)
    return case(
        (existing == literal("explicit"), existing),
        (literal(rank.get(new, 0)) > case(
            (existing == literal("proposed"), literal(2)),
            (existing == literal("derived"), literal(1)),
            else_=literal(0),
         ), new_lit),
        else_=existing,
    )


async def retract_relationship(
    db: AsyncSession, *,
    relationship_id: uuid.UUID,
    user_id: uuid.UUID | None,
    reason: str | None,
) -> Relationship | None:
    """Mark a relationship as retracted and log the reason. Does not
    delete — rejection reasons feed the past-rejections prompt for the
    next extraction run."""
    rel = await db.get(Relationship, relationship_id)
    if rel is None:
        return None
    rel.status = "retracted"
    rel.retracted_at = datetime.now(timezone.utc)
    rel.retracted_by = user_id
    rel.retraction_reason = (reason or "").strip() or None
    await db.flush()
    return rel


# ── Traversal ─────────────────────────────────────────────────────────


@dataclass
class ConnectedEdge:
    """One edge in a get_connections result. Unlike the raw row, this
    is oriented from the perspective of the query's center — `neighbor`
    is always the other end."""
    rel_type: str
    confidence: str
    direction: Literal["outgoing", "incoming"]
    neighbor: FindingRef
    source_doc: str | None
    source_quote: str | None
    rationale: str | None
    created_by: str


@dataclass
class DerivedGroup:
    """Derived connections grouped by kind. Not stored in the DB —
    computed at query time from existing columns (source_doc_id,
    source_person) so we don't explode the relationships table with
    O(N²) co-extraction edges."""
    kind: Literal["shared_source_doc", "shared_stakeholder"]
    key: str                         # doc filename or person name
    members: list[FindingRef]


@dataclass
class ConnectionsResult:
    center: FindingRef
    outgoing: list[ConnectedEdge]
    incoming: list[ConnectedEdge]
    derived: list[DerivedGroup]


async def get_connections(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    display_id: str,
    rel_types: list[str] | None = None,
    include_derived: bool = True,
    max_edges: int = 60,
) -> ConnectionsResult | None:
    """Return explicit edges (rows) + derived groups for one finding.

    Explicit edges come from the relationships table (confidence in
    explicit / proposed). Derived groups come from shared-source-doc
    and shared-stakeholder inference — cheap at small project sizes,
    cached by the caller if needed."""
    center = await resolve_display_id(db, project_id, display_id)
    if center is None:
        return None

    # ── Explicit edges: SELECT both directions, then project into
    # outgoing/incoming arrays from the center's perspective.
    q = select(Relationship).where(
        Relationship.project_id == project_id,
        Relationship.status == "active",
        or_(
            and_(Relationship.from_uuid == center.uuid,
                 Relationship.from_type == center.kind),
            and_(Relationship.to_uuid == center.uuid,
                 Relationship.to_type == center.kind),
        ),
    ).limit(max_edges)
    if rel_types:
        q = q.where(Relationship.rel_type.in_(rel_types))

    rows = (await db.execute(q)).scalars().all()

    # Collect neighbor refs to batch-resolve.
    neighbor_pairs: set[tuple[str, uuid.UUID]] = set()
    for r in rows:
        if r.from_uuid == center.uuid and r.from_type == center.kind:
            neighbor_pairs.add((r.to_type, r.to_uuid))
        else:
            neighbor_pairs.add((r.from_type, r.from_uuid))
    refs = await resolve_uuids_to_display(db, project_id, neighbor_pairs)

    outgoing: list[ConnectedEdge] = []
    incoming: list[ConnectedEdge] = []
    source_doc_name_by_id: dict[uuid.UUID, str] = {}
    if rows:
        doc_ids = [r.source_doc_id for r in rows if r.source_doc_id]
        if doc_ids:
            doc_rows = (await db.execute(
                select(Document.id, Document.filename).where(Document.id.in_(doc_ids))
            )).all()
            source_doc_name_by_id = {row.id: row.filename for row in doc_rows}

    for r in rows:
        if r.from_uuid == center.uuid and r.from_type == center.kind:
            neigh_key = (r.to_type, r.to_uuid)
            direction: Literal["outgoing", "incoming"] = "outgoing"
            rel_type = r.rel_type
        else:
            neigh_key = (r.from_type, r.from_uuid)
            direction = "incoming"
            rel_type = INVERSE_REL.get(r.rel_type, r.rel_type)
        neighbor = refs.get(neigh_key)
        if neighbor is None:
            continue
        edge = ConnectedEdge(
            rel_type=rel_type,
            confidence=r.confidence,
            direction=direction,
            neighbor=neighbor,
            source_doc=source_doc_name_by_id.get(r.source_doc_id) if r.source_doc_id else None,
            source_quote=r.source_quote,
            rationale=r.rationale,
            created_by=r.created_by,
        )
        (outgoing if direction == "outgoing" else incoming).append(edge)

    # ── Derived groups (cheap inference from existing columns) ─────
    derived: list[DerivedGroup] = []
    if include_derived:
        derived = await _derived_groups_for(db, project_id, center)

    return ConnectionsResult(
        center=center, outgoing=outgoing, incoming=incoming, derived=derived,
    )


async def _derived_groups_for(
    db: AsyncSession, project_id: uuid.UUID, center: FindingRef,
) -> list[DerivedGroup]:
    """Compute two cheap derived groups without materializing edges.

    - shared_source_doc: other findings from the same source document.
    - shared_stakeholder: other findings where the same person is named.

    We don't store these as rows — they'd explode to O(N²) on any
    50-finding document. Computing at query time keeps the table small
    and the inference always current.
    """
    groups: list[DerivedGroup] = []

    # Each finding kind exposes source_doc_id and/or source_person.
    # Walk the current finding's row to pull those, then fan out.
    Model = _MODEL_BY_KIND.get(center.kind)
    if Model is None:
        return groups
    row = await db.get(Model, center.uuid)
    if row is None:
        return groups

    source_doc_id = getattr(row, "source_doc_id", None)
    source_person = getattr(row, "source_person", None)

    if source_doc_id:
        siblings: list[FindingRef] = []
        for kind, SiblingModel in _MODEL_BY_KIND.items():
            if kind == "document":
                continue
            attr = getattr(SiblingModel, "source_doc_id", None)
            if attr is None:
                continue
            rows = (await db.execute(
                select(SiblingModel).where(
                    SiblingModel.project_id == project_id,
                    SiblingModel.source_doc_id == source_doc_id,
                    SiblingModel.id != center.uuid,
                ).limit(30)
            )).scalars().all()
            for r in rows:
                disp, lbl = _display_for(kind, r)
                siblings.append(FindingRef(r.id, kind, disp, lbl))
        if siblings:
            doc = await db.get(Document, source_doc_id)
            groups.append(DerivedGroup(
                kind="shared_source_doc",
                key=doc.filename if doc else str(source_doc_id)[:8],
                members=siblings,
            ))

    if source_person:
        siblings = []
        for kind, SiblingModel in _MODEL_BY_KIND.items():
            attr = getattr(SiblingModel, "source_person", None)
            if attr is None:
                continue
            rows = (await db.execute(
                select(SiblingModel).where(
                    SiblingModel.project_id == project_id,
                    SiblingModel.source_person == source_person,
                    SiblingModel.id != center.uuid,
                ).limit(30)
            )).scalars().all()
            for r in rows:
                disp, lbl = _display_for(kind, r)
                siblings.append(FindingRef(r.id, kind, disp, lbl))
        if siblings:
            groups.append(DerivedGroup(
                kind="shared_stakeholder",
                key=source_person,
                members=siblings,
            ))

    return groups


# ── Bulk helpers for store_finding dual-write ─────────────────────────


async def dual_write_from_finding(
    db: AsyncSession, *,
    project_id: uuid.UUID,
    finding_type: str,
    finding_uuid: uuid.UUID,
    blocked_by_ids: list[str] | None = None,   # BR → BR list
    blocks_ids: list[str] | None = None,       # GAP → BR list (blocked_reqs)
    affects_ids: list[str] | None = None,      # CON → BR list (affects_reqs)
    source_doc_id: uuid.UUID | None = None,
    source_person_name: str | None = None,
    source_quote: str | None = None,
    created_by: str = "extraction",
) -> int:
    """Dual-write: when store_finding sets list columns or source_*,
    emit explicit relationships too. Called inline from the MCP /
    pipeline write paths so every authored finding contributes to the
    graph without bolt-on backfills.

    Returns count of rows inserted/upserted."""
    written = 0

    for br_display in blocked_by_ids or []:
        target = await resolve_display_id(db, project_id, br_display)
        if target is None or target.kind != "requirement":
            continue
        await upsert_relationship(
            db,
            project_id=project_id,
            from_type=finding_type, from_uuid=finding_uuid,
            to_type="requirement", to_uuid=target.uuid,
            rel_type="blocked_by",
            confidence="explicit", created_by=created_by,
            source_doc_id=source_doc_id, source_quote=source_quote,
        )
        written += 1

    for br_display in blocks_ids or []:
        target = await resolve_display_id(db, project_id, br_display)
        if target is None or target.kind != "requirement":
            continue
        await upsert_relationship(
            db,
            project_id=project_id,
            from_type=finding_type, from_uuid=finding_uuid,
            to_type="requirement", to_uuid=target.uuid,
            rel_type="blocks",
            confidence="explicit", created_by=created_by,
            source_doc_id=source_doc_id, source_quote=source_quote,
        )
        written += 1

    for br_display in affects_ids or []:
        target = await resolve_display_id(db, project_id, br_display)
        if target is None or target.kind != "requirement":
            continue
        await upsert_relationship(
            db,
            project_id=project_id,
            from_type=finding_type, from_uuid=finding_uuid,
            to_type="requirement", to_uuid=target.uuid,
            rel_type="affects",
            confidence="explicit", created_by=created_by,
            source_doc_id=source_doc_id, source_quote=source_quote,
        )
        written += 1

    if source_doc_id:
        await upsert_relationship(
            db,
            project_id=project_id,
            from_type=finding_type, from_uuid=finding_uuid,
            to_type="document", to_uuid=source_doc_id,
            rel_type="derived_from",
            confidence="explicit", created_by=created_by,
            source_doc_id=source_doc_id,
        )
        written += 1

    if source_person_name:
        stk = (await db.execute(
            select(Stakeholder).where(
                Stakeholder.project_id == project_id,
                Stakeholder.name == source_person_name,
            )
        )).scalar_one_or_none()
        if stk is not None:
            await upsert_relationship(
                db,
                project_id=project_id,
                from_type=finding_type, from_uuid=finding_uuid,
                to_type="stakeholder", to_uuid=stk.id,
                rel_type="raised_by",
                confidence="explicit", created_by=created_by,
                source_doc_id=source_doc_id, source_quote=source_quote,
            )
            written += 1

    return written
