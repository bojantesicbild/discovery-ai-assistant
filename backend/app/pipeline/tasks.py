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
        select(GapModel, Document.filename)
        .outerjoin(Document, GapModel.source_doc_id == Document.id)
        .where(GapModel.project_id == project_id)
        .order_by(GapModel.gap_id)
    )
    gaps_rows = gaps_result.all()

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
        person_reqs = [r for r, _, _ in reqs_rows if r.source_person == s.name]
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
    for g, g_doc_name in gaps_rows:
        payload = _gap_to_payload(g, g_doc_name, today)
        text = render_gap_text(payload)
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
        for g, _ in gaps_rows:
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

    log.info("Markdown export complete",
             project_id=str(project_id),
             requirements=len(reqs_rows),
             path=str(discovery_dir))


def _write_dashboard(vault_root, reqs_rows, constraints, gaps_rows, decisions, stakeholders, readiness: dict):
    """Generate `.memory-bank/dashboard.md` — a Dataview-driven landing
    page that surfaces what needs attention. Requires the Dataview
    plugin (bundled in assistants/.obsidian/community-plugins.json).

    Each section uses a `dataview` code block which Obsidian's Dataview
    plugin renders as a live table. Outside Obsidian (e.g. on GitHub)
    the blocks render as code which is harmless."""
    from datetime import datetime as dt
    now = dt.now().strftime("%Y-%m-%d %H:%M")
    score = readiness.get("score", 0)

    # Static counters that aren't Dataview-dependent — useful when
    # opening the file in plain markdown viewers.
    open_gaps = sum(1 for g, _ in gaps_rows if g.status == "open")
    high_gaps = sum(1 for g, _ in gaps_rows if g.status == "open" and g.severity == "high")
    unconfirmed = sum(1 for r, _, _ in reqs_rows if r.status != "confirmed")
    must_haves = sum(1 for r, _, _ in reqs_rows if r.priority == "must")

    lines = [
        "---",
        "category: dashboard",
        f"updated: {now}",
        f"readiness: {score}",
        "tags: [dashboard]",
        "cssclasses: [dashboard]",
        "---",
        "",
        "# Discovery Dashboard",
        "",
        f"_Last updated: {now}_",
        "",
        "## At a glance",
        "",
        f"- **Readiness:** {score}%",
        f"- **Requirements:** {len(reqs_rows)} total · {must_haves} must-have · **{unconfirmed} unconfirmed**",
        f"- **Gaps:** {len(gaps_rows)} total · **{open_gaps} open** · {high_gaps} high-severity",
        f"- **Constraints:** {len(constraints)}",
        f"- **Decisions:** {len(decisions)}",
        f"- **Stakeholders:** {len(stakeholders)}",
        "",
        "---",
        "",
        "## Open gaps (by severity)",
        "",
        "```dataview",
        "TABLE severity, area, status, blocked_reqs",
        'FROM "docs/discovery/gaps"',
        'WHERE status = "open"',
        "SORT severity DESC, area ASC",
        "```",
        "",
        "## Unconfirmed requirements",
        "",
        "```dataview",
        "TABLE priority, status, confidence, source_person",
        'FROM "docs/discovery/requirements"',
        'WHERE status != "confirmed"',
        "SORT priority ASC, status ASC",
        "```",
        "",
        "## Must-have requirements",
        "",
        "```dataview",
        "TABLE status, confidence, source_doc",
        'FROM "docs/discovery/requirements"',
        'WHERE priority = "must"',
        "SORT status ASC, file.name ASC",
        "```",
        "",
        "## Constraints by type",
        "",
        "```dataview",
        "TABLE type, status",
        'FROM "docs/discovery/constraints"',
        "SORT type ASC, status ASC",
        "```",
        "",
        "## Recently ingested",
        "",
        "```dataview",
        "TABLE source_origin AS source, source_raw AS original, date",
        'FROM "docs/discovery/requirements"',
        "WHERE source_raw",
        "SORT date DESC",
        "LIMIT 15",
        "```",
        "",
        "## Stale unconfirmed (>14 days, still proposed)",
        "",
        "```dataview",
        "TABLE priority, confidence, date",
        'FROM "docs/discovery/requirements"',
        'WHERE status = "proposed" AND date < date(today) - dur(14 days)',
        "SORT date ASC",
        "```",
        "",
        "---",
        "",
        "## Quick links",
        "",
        "- [[index|Discovery wiki index]]",
        "- [[log|Operation log]]",
        "- [Open gaps folder](docs/discovery/gaps/)",
        "- [Requirements folder](docs/discovery/requirements/)",
        "- [Raw sources](.raw/)",
        "",
        "---",
        "",
        "_This file is auto-generated by the discovery pipeline after every ingest._",
        "_Edit the schemas in `assistants/.claude/schemas/` instead of editing this file directly._",
    ]
    (vault_root / "dashboard.md").write_text("\n".join(lines), encoding="utf-8")


def _requirement_to_payload(
    r,
    doc_name: str | None,
    doc_class: dict | None,
    today: str,
    co_extracted: list[str],
) -> dict:
    """Build the writer-input payload from a Requirement SQLAlchemy row.

    Pure function — no DB access. Co-extracted siblings are pre-computed
    by the caller because they require cross-row knowledge that the
    renderer shouldn't have to query."""
    return {
        "id": r.req_id,
        "title": r.title or "",
        "priority": r.priority or "should",
        "status": r.status or "proposed",
        "confidence": r.confidence or "medium",
        "source_doc": doc_name or "unknown",
        "source_person": r.source_person or "unknown",
        "version": r.version or 1,
        "date": today,
        "description": r.description or "",
        "source_quote": r.source_quote or "",
        "sources": list(r.sources or []),
        "co_extracted": co_extracted,
        # Source raw + origin only set when document was ingested via
        # Gmail / Drive / upload / Slack (Phase 4a).
        "_doc_class": doc_class or {},
    }


def render_requirement_text(
    payload: dict,
    *,
    reqs_dir: "Path | None" = None,
    original_text: str | None = None,
) -> str:
    """Render a single requirement note as markdown.

    Phase 2B step 2: the YAML frontmatter is now produced by
    `schema_lib.render_frontmatter("requirement", payload)` so any
    schema edit (new field, renamed field, dropped field) automatically
    propagates to the on-disk output. Body sections (Source, People,
    Related, Sources) stay hand-built for now — they have per-row
    formatting (wikilinks, custom labels, raw backlinks) that doesn't
    fit cleanly into the simple schema_lib section primitives. Phase
    2B step 3 can refactor those if/when we extend schema_lib's body
    renderer.

    `reqs_dir` is the directory the file lives in (used to compute the
    `source_raw:` relative path). When None, source_raw is left as
    whatever's already in the payload (allows pre-resolved paths from
    the parity test).
    `original_text` is accepted but unused — kept so the parity test
    can pass it without a special-case."""
    from app.services import raw_store, schema_lib
    from pathlib import Path as _P

    rid = payload["id"]
    title = payload.get("title", "")
    source_doc_name = payload.get("source_doc") or "unknown"
    person = payload.get("source_person") or "unknown"
    sources_list = payload.get("sources") or []
    co_extracted = payload.get("co_extracted") or []
    doc_class = payload.get("_doc_class") or {}

    # Resolve source_raw to a relative path (or accept a pre-resolved one
    # from the parity test). The schema declares source_raw and
    # source_origin as frontmatter fields, so we set them in the payload
    # and let render_frontmatter pick them up.
    raw_rel: str | None = None
    if doc_class.get("source_raw_path"):
        raw_path_str = doc_class["source_raw_path"]
        if reqs_dir is not None and _P(raw_path_str).is_absolute():
            try:
                raw_rel = raw_store.relative_source_raw(_P(raw_path_str), reqs_dir)
            except Exception:
                raw_rel = None
        else:
            raw_rel = raw_path_str
    if raw_rel:
        payload["source_raw"] = raw_rel
    if doc_class.get("source"):
        payload["source_origin"] = doc_class["source"]

    # Frontmatter from schema — single source of truth for fields,
    # types, defaults, tags, aliases, cssclasses, category.
    fm_block = schema_lib.render_frontmatter("requirement", payload)

    # Body sections — hand-built for now (Phase 2B step 3 territory)
    lines: list[str] = [
        f"# {rid}: {title}",
        "",
        payload.get("description") or "",
        "",
        "## Source",
        f"> \"{payload.get('source_quote', '')}\"" if payload.get("source_quote") else "> (no quote)",
        "",
        "## People",
    ]
    if person and person != "unknown":
        lines.append(f"- [[{person}]] — requested")
    else:
        lines.append("- (unknown)")

    lines.append("")
    lines.append("## Related")
    for other in co_extracted:
        lines.append(f"- [[{other}]] — co-extracted")

    lines.append("")
    lines.append("## Sources")
    lines.append(f"- [[{source_doc_name}]] — original extraction")
    for src in sources_list:
        fname = src.get("filename", "unknown")
        lines.append(f"- [[{fname}]] — v{payload.get('version', 1)} merge")

    if raw_rel:
        lines.append(f"- [Original source]({raw_rel})")

    lines.append("")
    return fm_block + "\n".join(lines)


def _constraint_to_payload(
    con,
    con_id: str,
    today: str,
    affected_reqs: list[str],
) -> dict:
    """Build the writer-input payload from a Constraint SQLAlchemy row."""
    return {
        "id": con_id,
        "title": f"{con.type}: {(con.description or '')[:50]}",
        "type": con.type,
        "description": con.description or "",
        "impact": con.impact or "",
        "status": con.status or "assumed",
        "source_quote": con.source_quote or "",
        "date": today,
        "affected_reqs": affected_reqs,
    }


def render_constraint_text(
    payload: dict,
    *,
    original_text: str | None = None,
) -> str:
    """Render a single constraint note as markdown.

    Frontmatter comes from `schema_lib.render_frontmatter("constraint",
    payload)` so any schema edit propagates automatically. Body sections
    (## Impact, ## Source, ## Affected Requirements) are hand-built —
    they have per-row formatting that doesn't fit schema_lib's section
    primitives yet.

    `original_text` is unused — kept for parity-test API compatibility."""
    from app.services import schema_lib

    cid = payload["id"]
    con_type = payload.get("type", "")
    description = payload.get("description") or ""
    impact = payload.get("impact") or "Not specified"
    source_quote = payload.get("source_quote") or ""
    affected = payload.get("affected_reqs") or []

    fm_block = schema_lib.render_frontmatter("constraint", payload)

    lines: list[str] = [
        f"# {cid}: {con_type} constraint",
        "",
        description,
        "",
        "## Impact",
        impact,
        "",
    ]
    if source_quote:
        lines.append("## Source")
        lines.append(f'> "{source_quote}"')
        lines.append("")
    lines.append("## Affected Requirements")
    for rid in affected:
        lines.append(f"- [[{rid}]] — constrained")
    lines.append("")

    return fm_block + "\n".join(lines)


def _gap_to_payload(g, doc_name: str | None, today: str) -> dict:
    """Build the writer-input payload from a Gap SQLAlchemy row."""
    return {
        "id": g.gap_id,
        "question": g.question or "",
        "severity": g.severity or "medium",
        "area": g.area or "general",
        "status": g.status or "open",
        "source_doc": doc_name or "unknown",
        "source_person": g.source_person or "unknown",
        "blocked_reqs": list(g.blocked_reqs or []),
        "suggested_action": g.suggested_action or "",
        "source_quote": g.source_quote or "",
        "resolution": g.resolution or "",
        "date": today,
    }


def render_gap_text(payload: dict, *, original_text: str | None = None) -> str:
    """Render a single gap note as markdown.

    Frontmatter from `schema_lib.render_frontmatter("gap", payload)`.
    Body sections (## Source, ## Ask, ## Blocked Requirements,
    ## Source Documents) hand-built since they have per-row formatting
    that doesn't fit the schema_lib section primitives yet.

    `original_text` is unused — kept for parity-test API compatibility."""
    from app.services import schema_lib

    gid = payload["id"]
    question = payload.get("question", "")
    g_doc = payload.get("source_doc") or "unknown"
    g_person = payload.get("source_person") or "unknown"
    blocked = payload.get("blocked_reqs") or []
    suggested = payload.get("suggested_action") or ""
    source_quote = payload.get("source_quote") or ""

    fm_block = schema_lib.render_frontmatter("gap", payload)

    lines: list[str] = [
        f"# {gid}: {question}",
        "",
    ]
    if suggested:
        lines.append(suggested)
        lines.append("")
    if source_quote:
        lines.append("## Source")
        lines.append(f'> "{source_quote}"')
        lines.append("")
    if g_person and g_person != "unknown":
        lines.append("## Ask")
        lines.append(f"- [[{g_person}]] — ask")
        lines.append("")
    if blocked:
        lines.append("## Blocked Requirements")
        for br in blocked:
            lines.append(f"- [[{br}]] — blocked")
        lines.append("")
    lines.append("## Source Documents")
    lines.append(f"- [[{g_doc}]]")
    lines.append("")

    return fm_block + "\n".join(lines)


def _write_hot(vault_root, doc: Document, reqs_rows, gaps_rows, decisions, readiness: dict):
    """Generate `.memory-bank/hot.md` — the warm-context carry-over file
    that the next agent session loads on startup.

    Distilled, short, cheap to read. Answers: "if I had 30 seconds to
    catch up before this agent session, what should I know?"

    Pulled into the agent's startup context via SKILL.md / CLAUDE.md so
    fresh sessions don't have to re-derive what's currently in flux."""
    from datetime import datetime as dt
    now = dt.now().strftime("%Y-%m-%d %H:%M")
    score = readiness.get("score", 0)

    # The most recently ingested document (this run)
    last_doc = doc.filename if doc else "unknown"
    last_source = (doc.classification or {}).get("source", "upload") if doc else "unknown"

    # Top 3 high-severity open gaps
    high_gaps = [g for g, _ in gaps_rows if g.status == "open" and g.severity == "high"]
    high_gaps.sort(key=lambda g: g.gap_id)
    top_gaps = high_gaps[:3]

    # Top 3 unconfirmed must-have requirements
    must_unconfirmed = [r for r, _, _ in reqs_rows if r.priority == "must" and r.status != "confirmed"]
    must_unconfirmed.sort(key=lambda r: r.req_id)
    top_must = must_unconfirmed[:3]

    # Top 3 most recent confirmed decisions (sorted by decided_date desc, fall back to id)
    recent_decisions = sorted(
        decisions,
        key=lambda d: (d.decided_date or "", d.title),
        reverse=True,
    )[:3]

    lines = [
        "---",
        "category: hot-context",
        f"updated: {now}",
        f"readiness: {score}",
        "tags: [hot, context]",
        "---",
        "",
        "# What's Hot",
        "",
        f"_Snapshot at {now} · readiness **{score}%**_",
        "",
        "## Just ingested",
        "",
        f"- **{last_doc}** ({last_source})",
        "",
    ]

    if top_gaps:
        lines.append("## High-severity open gaps (top 3)")
        lines.append("")
        for g in top_gaps:
            q = (g.question or "")[:90]
            lines.append(f"- [[{g.gap_id}]] — {q}")
            if g.blocked_reqs:
                blocked = ", ".join(f"[[{rid}]]" for rid in g.blocked_reqs[:3])
                lines.append(f"  - blocks: {blocked}")
        lines.append("")

    if top_must:
        lines.append("## Unconfirmed must-haves (top 3)")
        lines.append("")
        for r in top_must:
            lines.append(f"- [[{r.req_id}]] — {r.title} _({r.status}, {r.confidence})_")
        lines.append("")

    if recent_decisions:
        lines.append("## Recent decisions")
        lines.append("")
        for d in recent_decisions:
            who = f" — {d.decided_by}" if d.decided_by else ""
            when = f" ({d.decided_date})" if d.decided_date else ""
            lines.append(f"- **{d.title}**{who}{when}")
        lines.append("")

    lines.extend([
        "---",
        "",
        "## Context links",
        "",
        "- [[dashboard|Project dashboard]]",
        "- [[docs/discovery/index|Discovery wiki index]]",
        "- [[docs/discovery/log|Operation log]]",
        "",
        "_Auto-generated after every ingest. Read by the agent on session start._",
    ])

    (vault_root / "hot.md").write_text("\n".join(lines), encoding="utf-8")


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
