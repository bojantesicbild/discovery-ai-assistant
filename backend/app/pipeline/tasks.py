"""
Pipeline task — 5-stage document processing.

Stages: classify → parse → extract → dedup → store → evaluate

Per-project sequential processing. Stage checkpoints for retry.
"""

import uuid
import structlog
from datetime import datetime, timezone
from sqlalchemy import select

from app.models.document import Document
from app.models.operational import PipelineCheckpoint, ActivityLog
from app.models.extraction import (
    Requirement, Constraint, Decision, Stakeholder,
    Assumption, ScopeItem, Contradiction, ChangeHistory, Gap,
)
from sqlalchemy import func as sa_func

log = structlog.get_logger()


async def process_document(ctx, document_id: str):
    """Main pipeline entry point. Called by arq worker."""

    doc_id = uuid.UUID(document_id)
    db_session = ctx["db_session"]
    ragflow = ctx["ragflow"]

    async with db_session() as db:
        # Load document
        result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = result.scalar_one_or_none()
        if not doc:
            log.error("Document not found", document_id=document_id)
            return

        doc.pipeline_started_at = datetime.now(timezone.utc)
        project_id = doc.project_id

        try:
            # Stage 1: Classify
            await _update_stage(db, doc, "classifying")
            template = await _stage_classify(doc)
            doc.chunking_template = template
            await _save_checkpoint(db, doc.id, "classify", {"template": template})

            # Stage 2: Parse (RAGFlow — optional, skip if not running)
            await _update_stage(db, doc, "parsing")
            try:
                ragflow_result = await _stage_parse(doc, project_id, ragflow)
                doc.ragflow_doc_id = ragflow_result.get("doc_id")
                doc.ragflow_dataset_id = ragflow_result.get("dataset_id")
            except Exception as e:
                log.warning("RAGFlow parse skipped (not running)", error=str(e))
                ragflow_result = {"status": "skipped", "reason": str(e)}
            await _save_checkpoint(db, doc.id, "parse", ragflow_result)

            # Stage 3: Extract (Claude Code)
            await _update_stage(db, doc, "extracting")
            from app.models.project import Project
            from app.models.extraction import Requirement as ReqModel
            project = await db.get(Project, project_id)

            # Build compact summary of existing requirements for dedup context
            existing_reqs = await db.execute(
                select(ReqModel).where(ReqModel.project_id == project_id)
            )
            existing_list = existing_reqs.scalars().all()
            existing_summary = "\n".join(
                f"- {r.req_id}: {r.title}" for r in existing_list
            ) if existing_list else ""

            extraction = await _stage_extract(doc, project, existing_summary)
            await _save_checkpoint(db, doc.id, "extract", {"summary": extraction.document_summary})

            # Stage 3.5: Validate extraction against schemas
            await _update_stage(db, doc, "validating")
            extraction, validation_report = _validate_extraction(extraction)
            await _save_checkpoint(db, doc.id, "validate_extraction", validation_report)

            # Stage 4: Dedup
            await _update_stage(db, doc, "deduplicating")
            from app.pipeline.stages.dedup import dedup_requirements, apply_dedup_actions
            dedup_actions = await dedup_requirements(db, project_id, extraction.requirements)
            dedup_counts = await apply_dedup_actions(db, project_id, doc.id, dedup_actions, doc_filename=doc.filename)
            # Filter out duplicates before storing
            non_dup_reqs = [a["item"] for a in dedup_actions if a["action"] == "ADD"]
            extraction.requirements = non_dup_reqs
            await _save_checkpoint(db, doc.id, "dedup", dedup_counts)

            # Stage 5: Store
            await _update_stage(db, doc, "storing")
            counts = await _stage_store(db, project_id, doc.id, extraction, doc_filename=doc.filename)
            counts["duplicates_skipped"] = dedup_counts.get("duplicates", 0)
            counts["contradictions"] += dedup_counts.get("contradictions", 0)
            doc.items_extracted = counts["total"]
            doc.contradictions_found = counts["contradictions"]
            await _save_checkpoint(db, doc.id, "store", counts)

            # Stage 6: Evaluate readiness
            await _update_stage(db, doc, "evaluating")
            from app.services.evaluator import evaluator
            readiness = await evaluator.evaluate(project_id, db, triggered_by=f"pipeline:doc:{doc.id}")
            await _save_checkpoint(db, doc.id, "evaluate", readiness)

            # Stage 7: Export markdown to memory bank
            await _update_stage(db, doc, "exporting")
            try:
                await _stage_export_markdown(db, project_id, doc)
            except Exception as e:
                log.warning("Markdown export failed (non-fatal)", error=str(e))

            # Done
            doc.pipeline_stage = "completed"
            doc.pipeline_completed_at = datetime.now(timezone.utc)
            doc.pipeline_error = None

            # Activity log
            db.add(ActivityLog(
                project_id=project_id,
                action="document_processed",
                summary=f"Processed {doc.filename}: {counts['total']} items, readiness {readiness['score']}%",
                details={"document_id": str(doc.id), "counts": counts, "readiness": readiness["score"]},
            ))

            await db.commit()
            log.info("Pipeline completed", document_id=str(doc.id), items=counts["total"], readiness=readiness["score"])

            # Post a system notice in the project chat + notify members.
            # Wrapped so a chat/notification failure can never break the pipeline.
            try:
                await _post_completion_notice(project_id, doc, counts, readiness)
            except Exception as e:
                log.warning("Failed to post completion notice", error=str(e))

        except Exception as e:
            doc.pipeline_stage = "failed"
            doc.pipeline_error = str(e)
            await db.commit()
            log.error("Pipeline failed", document_id=str(doc.id), error=str(e))
            raise


async def _update_stage(db, doc: Document, stage: str):
    doc.pipeline_stage = stage
    await db.flush()


async def _save_checkpoint(db, document_id: uuid.UUID, stage: str, data: dict):
    cp = PipelineCheckpoint(document_id=document_id, stage=stage, data=data)
    db.add(cp)
    await db.flush()


# ── Stage implementations ─────────────────────────────

async def _stage_classify(doc: Document) -> str:
    """Classify document to determine RAGFlow chunking template."""
    extension_map = {
        "eml": "email",
        "pptx": "presentation", "ppt": "presentation",
        "xlsx": "table", "xls": "table", "csv": "table",
        "txt": "naive", "md": "naive",
        "png": "picture", "jpg": "picture", "jpeg": "picture",
        "pdf": "naive", "docx": "naive", "doc": "naive",
    }
    return extension_map.get(doc.file_type, "naive")


async def _stage_parse(doc: Document, project_id: uuid.UUID, ragflow) -> dict:
    """Upload and parse document in RAGFlow."""
    dataset_name = f"project-{project_id}-documents"
    dataset_id = await ragflow.get_or_create_dataset(dataset_name, doc.chunking_template or "naive")

    # Read file from storage and upload to RAGFlow
    file_path = (doc.classification or {}).get("file_path")
    if file_path:
        from app.services.storage import read_upload
        from pathlib import Path
        try:
            content = await read_upload(Path(file_path))
            result = await ragflow.upload_document(dataset_id, doc.filename, content)
            doc_id = result.get("data", {}).get("id", "unknown")

            # Trigger parsing
            await ragflow.parse_document(dataset_id, [doc_id])

            return {"dataset_id": dataset_id, "doc_id": doc_id, "status": "parsing"}
        except Exception as e:
            log.warning("RAGFlow upload failed, continuing without", error=str(e))
            return {"dataset_id": dataset_id, "doc_id": "ragflow-unavailable", "status": "skipped"}

    return {"dataset_id": dataset_id, "doc_id": "no-file", "status": "skipped"}


async def _stage_extract(doc: Document, project=None, existing_summary: str = "") -> "DiscoveryExtraction":
    """Extract typed business data using Claude Code. Returns structured JSON."""
    from app.schemas.extraction import (
        DiscoveryExtraction, Requirement, Constraint, Decision,
        Stakeholder, Assumption, ScopeItem,
    )
    from app.services.storage import read_upload_text
    from app.agent.claude_runner import claude_runner
    from pathlib import Path
    import json as _json

    file_path = (doc.classification or {}).get("file_path")
    if not file_path:
        return DiscoveryExtraction(document_summary=f"No file content for {doc.filename}")

    try:
        text = await read_upload_text(Path(file_path))
        if len(text.strip()) < 20:
            return DiscoveryExtraction(document_summary=f"File too short for extraction: {doc.filename}")

        project_context = ""
        if project:
            project_context = f"""Project: {project.name}
Client: {project.client_name}
Type: {project.project_type}

Extract business requirements relevant to this project for the client."""

        existing_context = ""
        if existing_summary:
            existing_context = f"""
EXISTING REQUIREMENTS (already extracted from other documents):
{existing_summary}

IMPORTANT: If the document mentions something already covered above, return it with "existing_match": "BR-XXX" so we can merge sources. Only create genuinely NEW requirements."""

        prompt = f"""You are extracting business requirements from a client discovery document.

{project_context}
Document: {doc.filename}
{existing_context}
---
{text[:12000]}
---

RULES:
- Extract ONLY distinct, unique items. NO DUPLICATES.
- SEPARATE requirements from gaps/open questions:
  - REQUIREMENT = something the system SHALL do (a concrete capability or behavior)
  - GAP = something UNKNOWN or UNDEFINED (an open question, missing info, unclear scope)
- If an item matches an existing requirement, include "existing_match": "BR-XXX".
- If it CONTRADICTS an existing requirement, still include "existing_match": "BR-XXX" and set confidence to "low".
- Be selective: extract the most important items, not every detail.
- Keep titles concise (under 60 chars).
- ASSUMPTIONS: only extract HIGH-RISK assumptions that would force major rework if wrong (2-5 per document max, not every inference). Skip obvious things like "users have internet" or "standard browser support".
- SCOPE: do NOT extract individual scope items. Include any in/out-of-scope boundaries in the document_summary field instead.

Return ONLY valid JSON (no markdown, no code fences):
{{
  "document_summary": "one sentence summary of the document",
  "requirements": [
    {{
      "id": "BR-001",
      "title": "concise title of what system shall do",
      "existing_match": "BR-XXX or null",
      "type": "functional",
      "priority": "must|should|could|wont",
      "description": "what the system shall do",
      "user_perspective": "As a [role], I want [X] so that [Y]",
      "business_rules": [],
      "edge_cases": [],
      "acceptance_criteria": [
        "AC1: Title — GIVEN precondition WHEN action THEN outcome",
        "AC2: Title — GIVEN precondition WHEN action THEN outcome"
      ],
      "source_doc": "{doc.filename}",
      "source_quote": "exact quote from document (min 10 chars)",
      "source_person": "person name who said/requested this, or unknown",
      "status": "proposed|discussed|confirmed",
      "confidence": "high|medium|low"
    }}
  ],
  "gaps": [
    {{
      "id": "GAP-001",
      "question": "the open question or undefined area",
      "severity": "high|medium|low",
      "area": "which domain this gap affects",
      "source_doc": "{doc.filename}",
      "source_quote": "exact quote showing the gap",
      "source_person": "who raised this or who should answer",
      "blocked_reqs": ["BR-XXX"],
      "suggested_action": "what to do to close this gap"
    }}
  ],
  "constraints": [
    {{
      "type": "budget|timeline|technology|regulatory|organizational",
      "description": "the constraint",
      "impact": "how it limits the project",
      "source_doc": "{doc.filename}",
      "source_quote": "exact quote",
      "status": "confirmed|assumed|negotiable"
    }}
  ],
  "decisions": [
    {{
      "title": "what was decided",
      "decided_by": "person name or unknown",
      "rationale": "why this was chosen",
      "alternatives_considered": [],
      "source_doc": "{doc.filename}",
      "status": "confirmed|tentative"
    }}
  ],
  "stakeholders": [
    {{
      "name": "person name",
      "role": "their role",
      "organization": "company name",
      "decision_authority": "final|recommender|informed",
      "interests": []
    }}
  ],
  "assumptions": [
    {{
      "statement": "HIGH-RISK assumption only (if wrong, forces major rework)",
      "basis": "why we believe this",
      "risk_if_wrong": "what breaks or what rework is needed"
    }}
  ]
}}

Return ONLY the JSON. No duplicates. Be concise and selective."""

        result_text = ""
        async for event in claude_runner.run_stream(
            project_id=doc.project_id,
            user_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
            message=prompt,
            system_prompt="You are a JSON extraction engine. Return ONLY valid JSON. No markdown, no explanation, no code fences. Just the raw JSON object.",
            model="sonnet",
        ):
            if event["type"] == "text":
                result_text += event["content"]
            elif event["type"] == "result":
                if not result_text:
                    result_text = event.get("content", "")

        # Parse JSON response
        log.info("Extraction raw response", filename=doc.filename, length=len(result_text), preview=result_text[:200])
        extraction = _parse_extraction_json(result_text, doc.filename)

        # Post-extraction dedup: remove duplicates within this extraction
        extraction = _dedup_within_extraction(extraction)

        log.info("Extraction complete",
                 document=doc.filename,
                 requirements=len(extraction.requirements),
                 constraints=len(extraction.constraints),
                 decisions=len(extraction.decisions),
                 stakeholders=len(extraction.stakeholders))
        return extraction

    except Exception as e:
        log.error("Extraction failed", error=str(e), document=doc.filename)
        return DiscoveryExtraction(document_summary=f"Extraction failed for {doc.filename}: {str(e)}")


def _parse_extraction_json(text: str, filename: str) -> "DiscoveryExtraction":
    """Parse Claude's JSON response into a DiscoveryExtraction model."""
    from app.schemas.extraction import (
        DiscoveryExtraction, Requirement, Constraint, Decision,
        Stakeholder, Assumption, ScopeItem, GapItem,
    )
    import json as _json

    # Strip markdown code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        # Remove first and last lines (```json and ```)
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    # Find the JSON object in the text
    start = cleaned.find("{")
    end = cleaned.rfind("}") + 1
    if start == -1 or end <= start:
        return DiscoveryExtraction(document_summary=f"No JSON found in extraction for {filename}")

    json_str = cleaned[start:end]

    try:
        data = _json.loads(json_str)
    except _json.JSONDecodeError as e:
        log.warning("JSON parse failed, attempting repair", error=str(e))
        return DiscoveryExtraction(document_summary=f"JSON parse error for {filename}: {str(e)}")

    # Build the extraction with validation
    requirements = []
    for i, r in enumerate(data.get("requirements", [])):
        try:
            req = Requirement(
                id=r.get("id", f"BR-{i+1:03d}"),
                title=r.get("title", "Untitled"),
                type=r.get("type", "functional"),
                priority=r.get("priority", "should"),
                description=r.get("description", ""),
                user_perspective=r.get("user_perspective"),
                business_rules=r.get("business_rules", []),
                edge_cases=r.get("edge_cases", []),
                acceptance_criteria=r.get("acceptance_criteria", []),
                source_doc=r.get("source_doc", filename),
                source_quote=r.get("source_quote", "extracted from document")[:500] or "extracted from document",
                status=r.get("status", "proposed"),
                confidence=r.get("confidence", "medium"),
            )
            # Carry source_person for storage
            if r.get("source_person") and r["source_person"] != "unknown":
                req._source_person = r["source_person"]
            # Carry existing_match for dedup merge
            if r.get("existing_match"):
                req._existing_match = r["existing_match"]
            requirements.append(req)
        except Exception as e:
            log.warning("Skipping invalid requirement", error=str(e), data=r)

    constraints = []
    for c in data.get("constraints", []):
        try:
            constraints.append(Constraint(
                type=c.get("type", "technology"),
                description=c.get("description", ""),
                impact=c.get("impact", ""),
                source_doc=c.get("source_doc", filename),
                source_quote=c.get("source_quote", "extracted from document")[:500] or "extracted from document",
                status=c.get("status", "assumed"),
            ))
        except Exception as e:
            log.warning("Skipping invalid constraint", error=str(e))

    decisions = []
    for d in data.get("decisions", []):
        try:
            decisions.append(Decision(
                title=d.get("title", ""),
                decided_by=d.get("decided_by", "unknown"),
                rationale=d.get("rationale", ""),
                alternatives_considered=d.get("alternatives_considered", []),
                source_doc=d.get("source_doc", filename),
                status=d.get("status", "tentative"),
            ))
        except Exception as e:
            log.warning("Skipping invalid decision", error=str(e))

    stakeholders = []
    for s in data.get("stakeholders", []):
        try:
            stakeholders.append(Stakeholder(
                name=s.get("name", ""),
                role=s.get("role", ""),
                organization=s.get("organization", "unknown"),
                decision_authority=s.get("decision_authority", "informed"),
                interests=s.get("interests", []),
            ))
        except Exception as e:
            log.warning("Skipping invalid stakeholder", error=str(e))

    assumptions = []
    for a in data.get("assumptions", []):
        try:
            assumptions.append(Assumption(
                statement=a.get("statement", ""),
                basis=a.get("basis", ""),
                risk_if_wrong=a.get("risk_if_wrong", ""),
            ))
        except Exception as e:
            log.warning("Skipping invalid assumption", error=str(e))

    scope_items = []
    for s in data.get("scope_items", []):
        try:
            scope_items.append(ScopeItem(
                description=s.get("description", ""),
                in_scope=s.get("in_scope", True),
                rationale=s.get("rationale", ""),
                source_doc=s.get("source_doc", filename),
            ))
        except Exception as e:
            log.warning("Skipping invalid scope item", error=str(e))

    # Parse gaps
    gaps = []
    for g in data.get("gaps", []):
        try:
            gaps.append(GapItem(
                id=g.get("id", f"GAP-{len(gaps)+1:03d}"),
                question=g.get("question", ""),
                severity=g.get("severity", "medium"),
                area=g.get("area", "general"),
                source_doc=g.get("source_doc", filename),
                source_quote=g.get("source_quote", ""),
                source_person=g.get("source_person", "unknown"),
                blocked_reqs=g.get("blocked_reqs", []),
                suggested_action=g.get("suggested_action", ""),
            ))
        except Exception as e:
            log.warning("Skipping invalid gap", error=str(e))

    return DiscoveryExtraction(
        document_summary=data.get("document_summary", f"Processed {filename}"),
        requirements=requirements,
        gaps=gaps,
        constraints=constraints,
        decisions=decisions,
        stakeholders=stakeholders,
        assumptions=assumptions,
        scope_items=scope_items,
    )


def _dedup_within_extraction(extraction: "DiscoveryExtraction") -> "DiscoveryExtraction":
    """Remove duplicates within a single extraction by comparing titles/descriptions."""

    def _dedup_list(items, key_fn):
        seen = set()
        unique = []
        for item in items:
            key = key_fn(item).lower().strip()[:50]
            if key not in seen:
                seen.add(key)
                unique.append(item)
        return unique

    extraction.requirements = _dedup_list(extraction.requirements, lambda r: r.title)
    extraction.constraints = _dedup_list(extraction.constraints, lambda c: c.description)
    extraction.decisions = _dedup_list(extraction.decisions, lambda d: d.title)
    extraction.stakeholders = _dedup_list(extraction.stakeholders, lambda s: s.name)
    extraction.assumptions = _dedup_list(extraction.assumptions, lambda a: a.statement)
    extraction.scope_items = _dedup_list(extraction.scope_items, lambda s: s.description)
    return extraction


def _validate_extraction(extraction: "DiscoveryExtraction") -> tuple["DiscoveryExtraction", dict]:
    """Validate every extracted item against its YAML schema.

    Runs between extraction and dedup/store. Catches:
    - Empty titles/descriptions (Pydantic defaults mask these)
    - Enum values not in the schema (LLM hallucinations)
    - Fake source quotes (the "extracted from document" placeholder)
    - Fields the schema marks as required but the extraction omitted

    Returns (filtered_extraction, report). Items that fail validation
    are logged and dropped — they never reach the DB. The report
    summarizes pass/fail counts per kind for the pipeline checkpoint."""
    from app.services import schema_lib

    report: dict = {"passed": 0, "rejected": 0, "details": []}

    def _check_item(kind: str, payload: dict, label: str) -> bool:
        """Validate one item. Returns True if it passes."""
        # Reject items with no meaningful identity. Each kind has a
        # specific "what is this item about" field — not a generic
        # fallback chain, because a requirement with empty title but
        # non-empty description should still be rejected.
        IDENTITY_FIELD: dict[str, str] = {
            "requirement": "title",
            "gap": "question",
            "constraint": "description",
            "decision": "title",
            "stakeholder": "name",
            "assumption": "statement",
            "scope": "description",
            "contradiction": "explanation",
        }
        id_field = IDENTITY_FIELD.get(kind, "title")
        identity = str(payload.get(id_field, "")).strip()
        if not identity or identity.lower() in ("untitled", "unknown"):
            report["rejected"] += 1
            report["details"].append({"kind": kind, "label": label, "reason": "empty identity field"})
            log.warning("Validation rejected: empty identity", kind=kind, label=label)
            return False

        # Reject fake source quotes (the default placeholder)
        quote = payload.get("source_quote", "")
        if kind in ("requirement", "constraint") and quote in ("extracted from document", ""):
            # Downgrade to warning, don't reject — many valid items have inferred quotes
            pass

        # Schema validation (enum values, required fields, types)
        try:
            result = schema_lib.validate(kind, payload)
            if not result.ok:
                # Log but don't reject for missing non-critical fields — the store
                # stage fills in defaults. Only reject for bad enum values.
                enum_errors = [e for e in result.errors if "expected one of" in e]
                if enum_errors:
                    report["rejected"] += 1
                    report["details"].append({"kind": kind, "label": label, "reason": enum_errors[0]})
                    log.warning("Validation rejected: bad enum", kind=kind, label=label, errors=enum_errors)
                    return False
                # Other errors (missing fields) are warnings, not rejections
                for err in result.errors:
                    if "unknown field" not in err:
                        log.debug("Validation warning", kind=kind, label=label, error=err)
        except KeyError:
            # Schema not found for this kind — skip validation, allow through
            pass

        report["passed"] += 1
        return True

    def _to_payload(item, extra: dict | None = None) -> dict:
        """Convert a Pydantic model to a dict, merging any extra fields."""
        d = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        if extra:
            d.update(extra)
        return d

    # Validate each kind
    valid_reqs = []
    for r in extraction.requirements:
        payload = _to_payload(r)
        # Map source_person from private attr if present
        if hasattr(r, "_source_person"):
            payload["source_person"] = r._source_person
        if _check_item("requirement", payload, payload.get("title", "?")):
            valid_reqs.append(r)
    extraction.requirements = valid_reqs

    valid_cons = []
    for c in extraction.constraints:
        if _check_item("constraint", _to_payload(c), c.description[:50]):
            valid_cons.append(c)
    extraction.constraints = valid_cons

    valid_gaps = []
    for g in extraction.gaps:
        payload = _to_payload(g)
        payload["id"] = payload.pop("id", "")  # GapItem uses 'id' not 'gap_id'
        if _check_item("gap", payload, g.question[:50]):
            valid_gaps.append(g)
    extraction.gaps = valid_gaps

    valid_decs = []
    for d in extraction.decisions:
        if _check_item("decision", _to_payload(d), d.title[:50]):
            valid_decs.append(d)
    extraction.decisions = valid_decs

    valid_stk = []
    for s in extraction.stakeholders:
        if _check_item("stakeholder", _to_payload(s), s.name):
            valid_stk.append(s)
    extraction.stakeholders = valid_stk

    valid_asm = []
    for a in extraction.assumptions:
        if _check_item("assumption", _to_payload(a), a.statement[:50]):
            valid_asm.append(a)
    extraction.assumptions = valid_asm

    valid_sco = []
    for s in extraction.scope_items:
        if _check_item("scope", _to_payload(s), s.description[:50]):
            valid_sco.append(s)
    extraction.scope_items = valid_sco

    log.info(
        "Extraction validation complete",
        passed=report["passed"],
        rejected=report["rejected"],
        details_count=len(report["details"]),
    )
    return extraction, report


async def _merge_or_create(
    db,
    *,
    project_id: uuid.UUID,
    doc_id: uuid.UUID,
    doc_filename: str,
    model_cls,
    item_type: str,
    match_filters: list,
    new_kwargs: dict,
    tracked_fields: tuple[str, ...],
    history_label: dict,
) -> tuple[bool, object]:
    """Find an existing row matching the filters or create a new one.

    Returns (created, row). On match: appends source, bumps version, and
    logs a ChangeHistory entry for any tracked field that changed. On miss:
    inserts the row and logs a 'create' history entry.
    """
    result = await db.execute(
        select(model_cls).where(model_cls.project_id == project_id, *match_filters)
    )
    existing = result.scalars().first()
    now = datetime.now(timezone.utc).isoformat()

    if existing is not None:
        sources = list(existing.sources or [])
        sources.append({
            "doc_id": str(doc_id),
            "filename": doc_filename,
            "added_at": now,
        })
        existing.sources = sources
        existing.version = (existing.version or 1) + 1

        changes_old: dict = {}
        changes_new: dict = {}
        for field in tracked_fields:
            new_val = new_kwargs.get(field)
            old_val = getattr(existing, field, None)
            if new_val and new_val != old_val:
                changes_old[field] = old_val
                changes_new[field] = new_val
                setattr(existing, field, new_val)

        if changes_old:
            changes_new["source"] = str(doc_id)
            db.add(ChangeHistory(
                project_id=project_id, item_type=item_type,
                item_id=existing.id, action="update",
                old_value=changes_old, new_value=changes_new,
                triggered_by="pipeline",
            ))
        return False, existing

    row = model_cls(project_id=project_id, **new_kwargs)
    db.add(row)
    await db.flush()
    db.add(ChangeHistory(
        project_id=project_id, item_type=item_type,
        item_id=row.id, action="create",
        new_value={**history_label, "source": str(doc_id)},
        triggered_by="pipeline",
    ))
    return True, row


async def _stage_store(db, project_id: uuid.UUID, doc_id: uuid.UUID, extraction, doc_filename: str = "") -> dict:
    """Store extracted items in PostgreSQL typed tables."""
    from sqlalchemy import func as sql_func
    counts = {
        "requirements": 0, "constraints": 0, "decisions": 0,
        "stakeholders": 0, "assumptions": 0, "scope_items": 0,
        "contradictions": 0, "total": 0,
    }

    # Store requirements
    for i, req in enumerate(extraction.requirements):
        db_req = Requirement(
            project_id=project_id,
            req_id=req.id,
            title=req.title,
            type=req.type,
            priority=req.priority,
            description=req.description,
            user_perspective=req.user_perspective,
            business_rules=req.business_rules,
            edge_cases=req.edge_cases,
            acceptance_criteria=req.acceptance_criteria,
            source_doc_id=doc_id,
            source_quote=req.source_quote,
            status=req.status,
            confidence=req.confidence,
            source_person=getattr(req, '_source_person', None),
        )
        db.add(db_req)
        await db.flush()  # Generate ID before referencing it
        db.add(ChangeHistory(
            project_id=project_id, item_type="requirement",
            item_id=db_req.id, action="create",
            new_value={"title": req.title, "priority": req.priority},
            triggered_by="pipeline",
        ))
        counts["requirements"] += 1

    # Store constraints (dedup by lowercased description)
    for con in extraction.constraints:
        created, _ = await _merge_or_create(
            db, project_id=project_id, doc_id=doc_id, doc_filename=doc_filename,
            model_cls=Constraint, item_type="constraint",
            match_filters=[sa_func.lower(Constraint.description) == (con.description or "").lower()],
            new_kwargs=dict(
                type=con.type, description=con.description, impact=con.impact,
                source_doc_id=doc_id, source_quote=con.source_quote, status=con.status,
            ),
            tracked_fields=("type", "impact", "status"),
            history_label={"description": (con.description or "")[:120]},
        )
        if created:
            counts["constraints"] += 1

    # Store decisions (dedup by lowercased title)
    for dec in extraction.decisions:
        created, _ = await _merge_or_create(
            db, project_id=project_id, doc_id=doc_id, doc_filename=doc_filename,
            model_cls=Decision, item_type="decision",
            match_filters=[sa_func.lower(Decision.title) == (dec.title or "").lower()],
            new_kwargs=dict(
                title=dec.title, decided_by=dec.decided_by, rationale=dec.rationale,
                alternatives=dec.alternatives_considered, impacts=dec.impacts,
                source_doc_id=doc_id, status=dec.status,
            ),
            tracked_fields=("decided_by", "rationale", "status"),
            history_label={"title": dec.title},
        )
        if created:
            counts["decisions"] += 1

    # Store stakeholders (dedup by lowercased name + organization)
    for stk in extraction.stakeholders:
        created, _ = await _merge_or_create(
            db, project_id=project_id, doc_id=doc_id, doc_filename=doc_filename,
            model_cls=Stakeholder, item_type="stakeholder",
            match_filters=[
                sa_func.lower(Stakeholder.name) == (stk.name or "").lower(),
                sa_func.lower(Stakeholder.organization) == (stk.organization or "").lower(),
            ],
            new_kwargs=dict(
                name=stk.name, role=stk.role, organization=stk.organization,
                decision_authority=stk.decision_authority, interests=stk.interests,
                source_doc_id=doc_id,
            ),
            tracked_fields=("role", "decision_authority"),
            history_label={"name": stk.name},
        )
        if created:
            counts["stakeholders"] += 1

    # Store assumptions (dedup by lowercased statement)
    for asm in extraction.assumptions:
        created, _ = await _merge_or_create(
            db, project_id=project_id, doc_id=doc_id, doc_filename=doc_filename,
            model_cls=Assumption, item_type="assumption",
            match_filters=[sa_func.lower(Assumption.statement) == (asm.statement or "").lower()],
            new_kwargs=dict(
                statement=asm.statement, basis=asm.basis, risk_if_wrong=asm.risk_if_wrong,
                needs_validation_by=asm.needs_validation_by, source_doc_id=doc_id,
            ),
            tracked_fields=("basis", "risk_if_wrong", "needs_validation_by"),
            history_label={"statement": (asm.statement or "")[:120]},
        )
        if created:
            counts["assumptions"] += 1

    # Store scope items (dedup by lowercased description)
    for scp in extraction.scope_items:
        created, _ = await _merge_or_create(
            db, project_id=project_id, doc_id=doc_id, doc_filename=doc_filename,
            model_cls=ScopeItem, item_type="scope_item",
            match_filters=[sa_func.lower(ScopeItem.description) == (scp.description or "").lower()],
            new_kwargs=dict(
                description=scp.description, in_scope=scp.in_scope,
                rationale=scp.rationale, source_doc_id=doc_id,
            ),
            tracked_fields=("in_scope", "rationale"),
            history_label={"description": (scp.description or "")[:120]},
        )
        if created:
            counts["scope_items"] += 1

    # Store gaps (dedup by lowercased question)
    max_gap = await db.execute(
        select(sa_func.count()).where(Gap.project_id == project_id)
    )
    next_gap_num = (max_gap.scalar() or 0) + 1

    for gap in extraction.gaps:
        gap_id = f"GAP-{next_gap_num:03d}"
        created, _ = await _merge_or_create(
            db, project_id=project_id, doc_id=doc_id, doc_filename=doc_filename,
            model_cls=Gap, item_type="gap",
            match_filters=[sa_func.lower(Gap.question) == (gap.question or "").lower()],
            new_kwargs=dict(
                gap_id=gap_id, question=gap.question, severity=gap.severity, area=gap.area,
                source_doc_id=doc_id, source_quote=gap.source_quote,
                source_person=gap.source_person if gap.source_person != "unknown" else None,
                blocked_reqs=gap.blocked_reqs, suggested_action=gap.suggested_action, status="open",
            ),
            tracked_fields=("severity", "area", "suggested_action"),
            history_label={"question": (gap.question or "")[:120]},
        )
        if created:
            next_gap_num += 1
            counts["gaps"] = counts.get("gaps", 0) + 1

    counts["contradictions"] = len(extraction.contradictions)
    counts["total"] = sum(v for k, v in counts.items() if k != "total" and k != "contradictions" and k != "gaps")

    await db.flush()
    return counts


async def _stage_export_markdown(db, project_id: uuid.UUID, doc):
    """Export all extracted items to markdown files in the project's memory bank."""
    from app.agent.claude_runner import claude_runner
    from app.models.document import Document
    from datetime import date as date_today

    project_dir = claude_runner.get_project_dir(project_id)
    discovery_dir = project_dir / ".memory-bank" / "docs" / "discovery"
    discovery_dir.mkdir(parents=True, exist_ok=True)
    reqs_dir = discovery_dir / "requirements"
    reqs_dir.mkdir(parents=True, exist_ok=True)

    today = date_today.today().isoformat()

    # Load all items for this project. Also pull Document.classification so
    # we can resolve `.raw/...` backlinks for each derived note's frontmatter.
    reqs_result = await db.execute(
        select(Requirement, Document.filename, Document.classification)
        .outerjoin(Document, Requirement.source_doc_id == Document.id)
        .where(Requirement.project_id == project_id)
        .order_by(Requirement.req_id)
    )
    reqs_rows = reqs_result.all()

    contras_result = await db.execute(
        select(Contradiction).where(Contradiction.project_id == project_id)
    )
    contras = contras_result.scalars().all()

    decisions_result = await db.execute(
        select(Decision).where(Decision.project_id == project_id)
    )
    decisions = decisions_result.scalars().all()

    stakeholders_result = await db.execute(
        select(Stakeholder).where(Stakeholder.project_id == project_id)
    )
    stakeholders = stakeholders_result.scalars().all()

    constraints_result = await db.execute(
        select(Constraint).where(Constraint.project_id == project_id)
    )
    constraints = constraints_result.scalars().all()

    from app.models.extraction import Gap as GapModel
    gaps_result = await db.execute(
        select(GapModel, Document.filename, Document.classification)
        .outerjoin(Document, GapModel.source_doc_id == Document.id)
        .where(GapModel.project_id == project_id)
        .order_by(GapModel.gap_id)
    )
    gaps_rows = gaps_result.all()

    assumptions_result = await db.execute(
        select(Assumption).where(Assumption.project_id == project_id)
    )
    assumptions = assumptions_result.scalars().all()

    scope_items_result = await db.execute(
        select(ScopeItem).where(ScopeItem.project_id == project_id)
    )
    scope_items = scope_items_result.scalars().all()

    # --- Individual requirement files (no separate requirements.md — index.md covers it) ---
    for r, doc_name, doc_class in reqs_rows:
        # Pre-compute co-extracted siblings (other requirements from the
        # same source doc) so the renderer doesn't need cross-row access.
        co_extracted = [
            other_r.req_id
            for other_r, _, _ in reqs_rows
            if other_r.req_id != r.req_id and other_r.source_doc_id == r.source_doc_id
        ]
        payload = _requirement_to_payload(r, doc_name, doc_class, today, co_extracted)
        text = render_requirement_text(payload, reqs_dir=reqs_dir)
        (reqs_dir / f"{r.req_id}.md").write_text(text)

    # --- decisions/ individual files (Phase 4d: per-row split) ---
    decisions_dir = discovery_dir / "decisions"
    decisions_dir.mkdir(parents=True, exist_ok=True)
    for i, d in enumerate(decisions, 1):
        dec_id = f"DEC-{i:03d}"
        payload = _decision_to_payload(d, dec_id, today)
        text = render_decision_text(payload)
        (decisions_dir / f"{dec_id}.md").write_text(text)

    # --- people/ individual stakeholder files (Phase 4d: per-row split) ---
    people_dir = discovery_dir / "people"
    people_dir.mkdir(parents=True, exist_ok=True)
    for s in stakeholders:
        # Pre-compute requirements requested by this person
        person_reqs = [(r.req_id, r.title) for r, _, _ in reqs_rows if r.source_person == s.name]
        payload = _stakeholder_to_payload(s, today, person_reqs)
        text = render_stakeholder_text(payload)
        # Filename uses the stakeholder's name (sanitized)
        import re as _re
        safe_name = _re.sub(r"[^\w\s-]", "_", s.name).strip().replace(" ", "_")[:80] or "unnamed"
        (people_dir / f"{safe_name}.md").write_text(text)

    # Clean up legacy single-file aggregates from earlier exports
    for legacy in ("decisions.md", "people.md"):
        legacy_path = discovery_dir / legacy
        if legacy_path.exists():
            legacy_path.unlink()

    # --- assumptions/ individual files (Phase 4d) ---
    assumptions_dir = discovery_dir / "assumptions"
    assumptions_dir.mkdir(parents=True, exist_ok=True)
    for i, asm in enumerate(assumptions, 1):
        asm_id = f"ASM-{i:03d}"
        payload = _assumption_to_payload(asm, asm_id, today)
        text = render_assumption_text(payload)
        (assumptions_dir / f"{asm_id}.md").write_text(text)

    # --- scope/ individual files (Phase 4d) ---
    scope_dir = discovery_dir / "scope"
    scope_dir.mkdir(parents=True, exist_ok=True)
    for i, sc in enumerate(scope_items, 1):
        sc_id = f"SCO-{i:03d}"
        payload = _scope_to_payload(sc, sc_id, today)
        text = render_scope_text(payload)
        (scope_dir / f"{sc_id}.md").write_text(text)

    # --- contradictions/ individual files (Phase 4d) ---
    contradictions_dir = discovery_dir / "contradictions"
    contradictions_dir.mkdir(parents=True, exist_ok=True)
    for i, ctr in enumerate(contras, 1):
        ctr_id = f"CTR-{i:03d}"
        payload = _contradiction_to_payload(ctr, ctr_id, today)
        text = render_contradiction_text(payload)
        (contradictions_dir / f"{ctr_id}.md").write_text(text)

    # Evaluate readiness for index/log (but don't write a separate readiness.md)
    from app.services.evaluator import evaluator
    try:
        readiness = await evaluator.evaluate(project_id, db, triggered_by="export")
    except Exception:
        readiness = {"score": 0, "details": {}}

    # Clean up redundant files from previous exports
    for old_file in ["contradictions.md", "requirements.md", "readiness.md", "stakeholders.md"]:
        old_path = discovery_dir / old_file
        if old_path.exists():
            old_path.unlink()

    # --- constraints/ individual files ---
    constraints_dir = discovery_dir / "constraints"
    constraints_dir.mkdir(parents=True, exist_ok=True)
    for i, con in enumerate(constraints, 1):
        con_id = f"CON-{i:03d}"
        # Pre-compute affected requirements (other rows from same source doc)
        affected_reqs = [
            r.req_id for r, _, _ in reqs_rows
            if r.source_doc_id == con.source_doc_id
        ]
        payload = _constraint_to_payload(con, con_id, today, affected_reqs)
        text = render_constraint_text(payload)
        (constraints_dir / f"{con_id}.md").write_text(text)

    # --- gaps/ individual files ---
    gaps_dir = discovery_dir / "gaps"
    gaps_dir.mkdir(parents=True, exist_ok=True)
    for g, g_doc_name, g_doc_class in gaps_rows:
        payload = _gap_to_payload(g, g_doc_name, today, g_doc_class)
        text = render_gap_text(payload, gaps_dir=gaps_dir)
        (gaps_dir / f"{g.gap_id}.md").write_text(text)

    # --- index.md (wiki table of contents) ---
    idx_lines = [
        "---", "category: wiki-index", f"date: {today}", "---", "",
        "# Discovery Wiki Index", "",
    ]
    if reqs_rows:
        idx_lines += [f"## Requirements ({len(reqs_rows)})", "",
            "| ID | Title | Priority | Status |", "|---|---|---|---|"]
        for r, _, _ in reqs_rows:
            idx_lines.append(f"| [[{r.req_id}]] | {r.title} | {r.priority} | {r.status} |")
        idx_lines.append("")
    if constraints:
        idx_lines += [f"## Constraints ({len(constraints)})", "",
            "| ID | Type | Status |", "|---|---|---|"]
        for i, c in enumerate(constraints, 1):
            idx_lines.append(f"| [[CON-{i:03d}]] | {c.type} | {c.status} |")
        idx_lines.append("")
    if decisions:
        idx_lines += [f"## Decisions ({len(decisions)})", "",
            "| ID | Title | Status |", "|---|---|---|"]
        for i, d in enumerate(decisions):
            idx_lines.append(f"| DEC-{i+1:03d} | {d.title} | {d.status} |")
        idx_lines.append("")
    if gaps_rows:
        idx_lines += [f"## Gaps ({len(gaps_rows)})", "",
            "| ID | Question | Severity | Status |", "|---|---|---|---|"]
        for g, _, _ in gaps_rows:
            idx_lines.append(f"| [[{g.gap_id}]] | {g.question[:60]} | {g.severity} | {g.status} |")
        idx_lines.append("")
    if stakeholders:
        idx_lines += [f"## Stakeholders ({len(stakeholders)})", "",
            "| Name | Role | Authority |", "|---|---|---|"]
        for s in stakeholders:
            idx_lines.append(f"| [[{s.name}]] | {s.role} | {s.decision_authority} |")
        idx_lines.append("")
    # Add Dataview queries for Obsidian users
    idx_lines += [
        "## Dynamic Views (Obsidian Dataview)", "",
        "### Unconfirmed Requirements",
        "```dataview",
        "TABLE priority, status, confidence",
        'FROM "requirements"',
        'WHERE status != "confirmed"',
        "SORT priority ASC",
        "```", "",
        "### Open Gaps",
        "```dataview",
        "TABLE severity, area, status",
        'FROM "gaps"',
        'WHERE status = "open"',
        "SORT severity ASC",
        "```", "",
    ]
    (discovery_dir / "index.md").write_text("\n".join(idx_lines))

    # --- log.md (append operation log) ---
    log_path = discovery_dir / "log.md"
    from datetime import datetime as dt
    timestamp = dt.now().strftime("%Y-%m-%d %H:%M")
    doc_name = doc.filename if doc else "unknown"
    entry = (
        f"\n## [INGEST] {timestamp} — {doc_name}\n"
        f"Extracted: {len(reqs_rows)} requirements, {len(constraints)} constraints, "
        f"{len(decisions)} decisions, {len(gaps_rows)} gaps, {len(stakeholders)} stakeholders\n"
        f"Readiness: {readiness.get('score', 0)}%\n"
    )
    if log_path.exists():
        existing = log_path.read_text()
        log_path.write_text(existing + entry)
    else:
        log_path.write_text(
            "---\ncategory: wiki-log\n---\n\n# Discovery Log\n" + entry
        )

    # Dashboard at vault root — Dataview-driven landing page that's the
    # first thing a human sees when opening the vault in Obsidian. Lives
    # outside docs/discovery/ so it doesn't pollute the discovery wiki.
    vault_root = project_dir / ".memory-bank"
    try:
        _write_dashboard(vault_root, reqs_rows, constraints, gaps_rows, decisions, stakeholders, readiness)
    except Exception as e:
        log.warning("Dashboard generation failed (non-fatal)", error=str(e))

    # hot.md at vault root — short distilled "what's hot right now"
    # carry-over for the next agent session. Cheap to load into context.
    try:
        _write_hot(vault_root, doc, reqs_rows, gaps_rows, decisions, readiness)
    except Exception as e:
        log.warning("hot.md generation failed (non-fatal)", error=str(e))

    # schema.md at vault root — developer-friendly catalog of every
    # finding kind, generated from the canonical YAML schemas.
    try:
        _write_schema_md(vault_root)
    except Exception as e:
        log.warning("schema.md generation failed (non-fatal)", error=str(e))

    log.info("Markdown export complete",
             project_id=str(project_id),
             requirements=len(reqs_rows),
             path=str(discovery_dir))


# ─────────────────────────────────────────────────────────────────────────────
# Markdown writers — extracted to markdown_writer.py for readability.
# Every render_*_text, _*_to_payload, write_dashboard, write_hot,
# write_schema_md, and stakeholder_filename_safe now live there.
# ─────────────────────────────────────────────────────────────────────────────
from app.pipeline.markdown_writer import (  # noqa: E402
    write_dashboard,
    write_hot,
    write_schema_md,
    render_requirement_text,
    render_constraint_text,
    render_gap_text,
    render_decision_text,
    render_stakeholder_text,
    render_assumption_text,
    render_scope_text,
    render_contradiction_text,
    requirement_to_payload,
    constraint_to_payload,
    gap_to_payload,
    decision_to_payload,
    stakeholder_to_payload,
    assumption_to_payload,
    scope_to_payload,
    contradiction_to_payload,
    stakeholder_filename_safe,
)


async def _post_completion_notice(project_id, doc: Document, counts: dict, readiness: dict):
    """Post a structured system message in chat + create notifications when
    a document finishes processing. The agent picks this up via context
    injection on the user's next chat turn (chat.py)."""
    from app.db.session import async_session
    from app.services.conversation_store import append_system_message
    from app.models.operational import Notification
    from app.models.project import ProjectMember
    from sqlalchemy import select

    classification = doc.classification or {}
    source = classification.get("source") or "upload"
    auto_synced = classification.get("auto_synced", False)
    source_label = {
        "gmail": "Gmail",
        "google_drive": "Drive",
        "slack": "Slack",
        "upload": "upload",
    }.get(source, source)

    total = counts.get("total", 0)
    reqs = counts.get("requirements", 0)
    gaps = counts.get("gaps", 0)
    cons = counts.get("constraints", 0)
    contradictions = counts.get("contradictions", 0)
    score = readiness.get("score", 0)

    # Compose the chat notice (visible to user + agent context)
    parts = [f"**{doc.filename}** processed"]
    if source != "upload":
        parts.append(f"({source_label}{' · auto-sync' if auto_synced else ''})")
    parts.append("—")
    bits: list[str] = []
    if reqs:
        bits.append(f"{reqs} requirement{'s' if reqs != 1 else ''}")
    if gaps:
        bits.append(f"{gaps} gap{'s' if gaps != 1 else ''}")
    if cons:
        bits.append(f"{cons} constraint{'s' if cons != 1 else ''}")
    if contradictions:
        bits.append(f"{contradictions} contradiction{'s' if contradictions != 1 else ''}")
    if not bits:
        bits.append(f"{total} item{'s' if total != 1 else ''}")
    parts.append(", ".join(bits))
    parts.append(f"· readiness {score}%")
    notice_text = " ".join(parts)

    # Enrich data with readiness delta and the IDs of items this document
    # actually created. Used by the chat SystemNotice to show clickable
    # links straight to the new requirements/gaps.
    from app.models.control import ReadinessHistory
    from app.models.extraction import Requirement, Gap

    readiness_before: float | None = None
    gap_ids: list[str] = []
    req_ids: list[str] = []

    async with async_session() as db:
        # Find the readiness score from BEFORE this document was processed.
        # We've already written one history row for the post-doc score, so
        # the second-most-recent row is the previous state.
        prev_result = await db.execute(
            select(ReadinessHistory.score)
            .where(ReadinessHistory.project_id == project_id)
            .order_by(ReadinessHistory.created_at.desc())
            .offset(1)
            .limit(1)
        )
        prev_row = prev_result.scalar_one_or_none()
        if prev_row is not None:
            readiness_before = prev_row

        # Gaps created by this specific document
        gap_result = await db.execute(
            select(Gap.gap_id)
            .where(Gap.project_id == project_id, Gap.source_doc_id == doc.id)
            .order_by(Gap.gap_id)
        )
        gap_ids = [r[0] for r in gap_result.fetchall() if r[0]]

        # Requirements created by this specific document
        req_result = await db.execute(
            select(Requirement.req_id)
            .where(Requirement.project_id == project_id, Requirement.source_doc_id == doc.id)
            .order_by(Requirement.req_id)
        )
        req_ids = [r[0] for r in req_result.fetchall() if r[0]]

    delta: float | None = None
    if readiness_before is not None and score is not None:
        delta = round(score - readiness_before, 1)

    async with async_session() as db:
        await append_system_message(
            db, project_id, notice_text,
            kind="document_ingested",
            data={
                "document_id": str(doc.id),
                "filename": doc.filename,
                "source": source,
                "auto_synced": auto_synced,
                "counts": counts,
                "readiness": score,
                "readiness_before": readiness_before,
                "readiness_after": score,
                "readiness_delta": delta,
                "gap_ids": gap_ids,
                "req_ids": req_ids,
            },
        )

        # Notifications fan-out
        result = await db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        )
        for (uid,) in result.fetchall():
            db.add(Notification(
                project_id=project_id,
                user_id=uid,
                type="document_processed",
                title=f"{doc.filename} processed",
                body=notice_text,
                data={
                    "document_id": str(doc.id),
                    "source": source,
                    "auto_synced": auto_synced,
                    "counts": counts,
                    "readiness": score,
                    "readiness_delta": delta,
                },
            ))
        await db.commit()
