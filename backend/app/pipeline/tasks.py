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
    Assumption, ScopeItem, Contradiction, ChangeHistory,
)

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
            counts = await _stage_store(db, project_id, doc.id, extraction)
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
      "statement": "what we assume",
      "basis": "why",
      "risk_if_wrong": "what breaks"
    }}
  ],
  "scope_items": [
    {{
      "description": "feature or capability",
      "in_scope": true,
      "rationale": "why in or out",
      "source_doc": "{doc.filename}"
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


async def _stage_store(db, project_id: uuid.UUID, doc_id: uuid.UUID, extraction) -> dict:
    """Store extracted items in PostgreSQL typed tables."""
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

    # Store constraints
    for con in extraction.constraints:
        db_con = Constraint(
            project_id=project_id,
            type=con.type,
            description=con.description,
            impact=con.impact,
            source_doc_id=doc_id,
            source_quote=con.source_quote,
            status=con.status,
        )
        db.add(db_con)
        counts["constraints"] += 1

    # Store decisions
    for dec in extraction.decisions:
        db_dec = Decision(
            project_id=project_id,
            title=dec.title,
            decided_by=dec.decided_by,
            rationale=dec.rationale,
            alternatives=dec.alternatives_considered,
            impacts=dec.impacts,
            source_doc_id=doc_id,
            status=dec.status,
        )
        db.add(db_dec)
        counts["decisions"] += 1

    # Store stakeholders
    for stk in extraction.stakeholders:
        db_stk = Stakeholder(
            project_id=project_id,
            name=stk.name,
            role=stk.role,
            organization=stk.organization,
            decision_authority=stk.decision_authority,
            interests=stk.interests,
            source_doc_id=doc_id,
        )
        db.add(db_stk)
        counts["stakeholders"] += 1

    # Store assumptions
    for asm in extraction.assumptions:
        db_asm = Assumption(
            project_id=project_id,
            statement=asm.statement,
            basis=asm.basis,
            risk_if_wrong=asm.risk_if_wrong,
            needs_validation_by=asm.needs_validation_by,
            source_doc_id=doc_id,
        )
        db.add(db_asm)
        counts["assumptions"] += 1

    # Store scope items
    for scp in extraction.scope_items:
        db_scp = ScopeItem(
            project_id=project_id,
            description=scp.description,
            in_scope=scp.in_scope,
            rationale=scp.rationale,
            source_doc_id=doc_id,
        )
        db.add(db_scp)
        counts["scope_items"] += 1

    # Store gaps
    from app.models.extraction import Gap as GapModel
    # Get next GAP number
    from sqlalchemy import func as sql_func
    max_gap = await db.execute(
        select(sql_func.count()).where(GapModel.project_id == project_id)
    )
    next_gap_num = (max_gap.scalar() or 0) + 1

    for gap in extraction.gaps:
        gap_id = f"GAP-{next_gap_num:03d}"
        next_gap_num += 1
        db_gap = GapModel(
            project_id=project_id,
            gap_id=gap_id,
            question=gap.question,
            severity=gap.severity,
            area=gap.area,
            source_doc_id=doc_id,
            source_quote=gap.source_quote,
            source_person=gap.source_person if gap.source_person != "unknown" else None,
            blocked_reqs=gap.blocked_reqs,
            suggested_action=gap.suggested_action,
            status="open",
        )
        db.add(db_gap)
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

    # Load all items for this project
    reqs_result = await db.execute(
        select(Requirement, Document.filename)
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
        select(GapModel, Document.filename)
        .outerjoin(Document, GapModel.source_doc_id == Document.id)
        .where(GapModel.project_id == project_id)
        .order_by(GapModel.gap_id)
    )
    gaps_rows = gaps_result.all()

    # --- Individual requirement files (no separate requirements.md — index.md covers it) ---
    for r, doc_name in reqs_rows:
        source_doc_name = doc_name or "unknown"
        person = r.source_person or "unknown"
        desc_escaped = (r.description or "").replace('"', '\\"')
        sources_list = r.sources or []

        req_lines = [
            "---",
            f"id: {r.req_id}",
            f'title: "{r.title}"',
            f"priority: {r.priority}",
            f"status: {r.status}",
            f"confidence: {r.confidence}",
            f'source_doc: "{source_doc_name}"',
            f"source_person: {person}",
            f"version: {r.version or 1}",
            f"date: {today}",
            "category: requirement",
            f'description: "{desc_escaped}"',
            "---",
            "",
            f"# {r.req_id}: {r.title}",
            "",
            r.description or "",
            "",
            "## Source",
            f"> \"{r.source_quote}\"" if r.source_quote else "> (no quote)",
            "",
            "## People",
        ]
        if person and person != "unknown":
            req_lines.append(f"- [[{person}]] — requested")
        else:
            req_lines.append("- (unknown)")

        req_lines.append("")
        req_lines.append("## Related")

        # Link other requirements from the same source doc
        for other_r, other_doc in reqs_rows:
            if other_r.req_id != r.req_id and other_r.source_doc_id == r.source_doc_id:
                req_lines.append(f"- [[{other_r.req_id}]] — co-extracted")

        req_lines.append("")
        req_lines.append("## Sources")
        req_lines.append(f"- [[{source_doc_name}]] — original extraction")
        for src in sources_list:
            fname = src.get("filename", "unknown")
            req_lines.append(f"- [[{fname}]] — v{r.version or 1} merge")

        req_lines.append("")
        (reqs_dir / f"{r.req_id}.md").write_text("\n".join(req_lines))

    # --- decisions.md (kept as single file — decisions don't have individual IDs like BR/CON/GAP) ---
    dec_lines = [
        "---",
        "category: decisions-index",
        f"date: {today}",
        f"total: {len(decisions)}",
        "---",
        "",
        "# Decisions",
        "",
    ]
    for i, d in enumerate(decisions):
        dec_id = f"DEC-{i+1:03d}"
        dec_lines.append(f"## {dec_id}: {d.title}")
        dec_lines.append(f"- **Decided by**: {d.decided_by or 'unknown'}")
        dec_lines.append(f"- **Status**: {d.status}")
        dec_lines.append(f"- **Rationale**: {d.rationale}")
        if d.alternatives:
            dec_lines.append(f"- **Alternatives**: {', '.join(str(a) for a in d.alternatives)}")
        dec_lines.append("")
    (discovery_dir / "decisions.md").write_text("\n".join(dec_lines))

    # --- people.md ---
    stk_lines = [
        "---",
        "category: stakeholders-index",
        f"date: {today}",
        f"total: {len(stakeholders)}",
        "---",
        "",
        "# People",
        "",
    ]
    for s in stakeholders:
        stk_lines.append(f"## [[{s.name}]]")
        stk_lines.append(f"- **Role**: {s.role}")
        stk_lines.append(f"- **Organization**: {s.organization}")
        stk_lines.append(f"- **Authority**: {s.decision_authority}")
        # Link requirements by this person
        person_reqs = [r for r, _ in reqs_rows if r.source_person == s.name]
        if person_reqs:
            stk_lines.append("- **Requirements**:")
            for pr in person_reqs:
                stk_lines.append(f"  - [[{pr.req_id}]] — {pr.title}")
        stk_lines.append("")
    (discovery_dir / "people.md").write_text("\n".join(stk_lines))

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
        con_lines = [
            "---",
            f"id: {con_id}",
            f'title: "{con.type}: {con.description[:50]}"',
            f"type: {con.type}",
            f"status: {con.status}",
            f"date: {today}",
            "category: constraint",
            "---",
            "",
            f"# {con_id}: {con.type} constraint",
            "",
            con.description,
            "",
            "## Impact",
            con.impact or "Not specified",
            "",
        ]
        if con.source_quote:
            con_lines.append("## Source")
            con_lines.append(f'> "{con.source_quote}"')
            con_lines.append("")
        # Link to requirements that this constraint affects
        con_lines.append("## Affected Requirements")
        for r, _ in reqs_rows:
            if r.source_doc_id == con.source_doc_id:
                con_lines.append(f"- [[{r.req_id}]] — constrained")
        con_lines.append("")
        (constraints_dir / f"{con_id}.md").write_text("\n".join(con_lines))

    # --- gaps/ individual files ---
    gaps_dir = discovery_dir / "gaps"
    gaps_dir.mkdir(parents=True, exist_ok=True)
    for g, g_doc_name in gaps_rows:
        g_doc = g_doc_name or "unknown"
        g_person = g.source_person or "unknown"
        blocked = ", ".join(g.blocked_reqs or [])
        gap_lines = [
            "---",
            f"id: {g.gap_id}",
            f'question: "{g.question}"',
            f"severity: {g.severity}",
            f"area: {g.area}",
            f'source_doc: "{g_doc}"',
            f"source_person: {g_person}",
            f"status: {g.status}",
            f"date: {today}",
            "category: gap",
            "---",
            "",
            f"# {g.gap_id}: {g.question}",
            "",
        ]
        if g.suggested_action:
            gap_lines.append(f"{g.suggested_action}")
            gap_lines.append("")
        if g.source_quote:
            gap_lines.append("## Source")
            gap_lines.append(f'> "{g.source_quote}"')
            gap_lines.append("")
        if g_person and g_person != "unknown":
            gap_lines.append("## Ask")
            gap_lines.append(f"- [[{g_person}]] — ask")
            gap_lines.append("")
        if blocked:
            gap_lines.append("## Blocked Requirements")
            for br in (g.blocked_reqs or []):
                gap_lines.append(f"- [[{br}]] — blocked")
            gap_lines.append("")
        gap_lines.append("## Source Documents")
        gap_lines.append(f"- [[{g_doc}]]")
        gap_lines.append("")
        (gaps_dir / f"{g.gap_id}.md").write_text("\n".join(gap_lines))

    # --- index.md (wiki table of contents) ---
    idx_lines = [
        "---", "category: wiki-index", f"date: {today}", "---", "",
        "# Discovery Wiki Index", "",
    ]
    if reqs_rows:
        idx_lines += [f"## Requirements ({len(reqs_rows)})", "",
            "| ID | Title | Priority | Status |", "|---|---|---|---|"]
        for r, _ in reqs_rows:
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
        for g, _ in gaps_rows:
            idx_lines.append(f"| [[{g.gap_id}]] | {g.question[:60]} | {g.severity} | {g.status} |")
        idx_lines.append("")
    if stakeholders:
        idx_lines += [f"## Stakeholders ({len(stakeholders)})", "",
            "| Name | Role | Authority |", "|---|---|---|"]
        for s in stakeholders:
            idx_lines.append(f"| [[{s.name}]] | {s.role} | {s.decision_authority} |")
        idx_lines.append("")
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

    log.info("Markdown export complete",
             project_id=str(project_id),
             requirements=len(reqs_rows),
             path=str(discovery_dir))
