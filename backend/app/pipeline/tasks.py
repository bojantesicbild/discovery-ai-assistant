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
            extraction = await _stage_extract(doc)
            await _save_checkpoint(db, doc.id, "extract", {"summary": extraction.document_summary})

            # Stage 4: Dedup
            await _update_stage(db, doc, "deduplicating")
            from app.pipeline.stages.dedup import dedup_requirements, apply_dedup_actions
            dedup_actions = await dedup_requirements(db, project_id, extraction.requirements)
            dedup_counts = await apply_dedup_actions(db, project_id, doc.id, dedup_actions)
            # Filter out duplicates before storing
            non_dup_reqs = [a["item"] for a in dedup_actions if a["action"] != "DUPLICATE"]
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


async def _stage_extract(doc: Document) -> "DiscoveryExtraction":
    """Extract typed business data using Claude Code."""
    from app.schemas.extraction import DiscoveryExtraction
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

        # Use Claude Code to extract — same engine as chat
        prompt = (
            f"Extract all structured business data from this client document.\n"
            f"Document: {doc.filename}\n\n"
            f"Extract:\n"
            f"- Requirements (FR-001, NFR-001 with MoSCoW priority, source quotes)\n"
            f"- Constraints (budget, timeline, technology)\n"
            f"- Decisions (who decided what, why)\n"
            f"- Stakeholders (name, role, authority)\n"
            f"- Assumptions (what we believe, risk if wrong)\n"
            f"- Scope items (in/out of MVP)\n\n"
            f"Document content:\n{text[:15000]}\n\n"
            f"Return a brief summary of what was found."
        )

        result_text = ""
        async for event in claude_runner.run_stream(
            project_id=doc.project_id,
            user_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),  # system user
            message=prompt,
            model="sonnet",  # Use cheaper model for extraction pipeline
        ):
            if event["type"] == "text":
                result_text += event["content"]
            elif event["type"] == "result":
                result_text = event.get("content", result_text)

        return DiscoveryExtraction(document_summary=result_text[:500] or f"Processed {doc.filename}")

    except Exception as e:
        log.error("Extraction failed", error=str(e), document=doc.filename)
        return DiscoveryExtraction(document_summary=f"Extraction failed for {doc.filename}: {str(e)}")


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
        )
        db.add(db_req)
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

    counts["contradictions"] = len(extraction.contradictions)
    counts["total"] = sum(v for k, v in counts.items() if k != "total" and k != "contradictions")

    await db.flush()
    return counts
