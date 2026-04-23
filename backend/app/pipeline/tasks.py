"""
Pipeline task — agent-driven document processing.

Stages: classify → parse → extract (agent) → evaluate → export_markdown

The extract stage invokes `discovery-extraction-agent` (in `assistants/.claude/agents/`)
which reads the document and calls `store_finding` via the Discovery MCP for
each finding it identifies. Dedup + storage live inside `store_finding`, so
the pipeline no longer has its own parse/dedup/store stages — those were
duplicate logic the agent now owns.

Per-project sequential processing. Stage checkpoints for retry.
"""

import uuid
import time
import structlog
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.models.document import Document
from app.models.operational import PipelineCheckpoint, ActivityLog
from app.models.extraction import (
    Requirement, Constraint, Stakeholder,
    Contradiction, Gap,
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

        # Idempotency guard: arq occasionally re-delivers the same job
        # (retry after transient failure, duplicate enqueue during a flaky
        # upload burst). Without this, a "completed" doc gets re-extracted —
        # BR versions churn upward and the chat shows one
        # `document_ingested` notice per re-run. Terminal states mean we're
        # done; an explicit DB flip back to "queued" is required to
        # re-process (e.g. via a future re-ingest endpoint).
        if doc.pipeline_stage in ("completed", "failed"):
            log.info(
                "Skipping already-processed document",
                document_id=document_id,
                stage=doc.pipeline_stage,
            )
            return

        doc.pipeline_started_at = datetime.now(timezone.utc)
        project_id = doc.project_id

        try:
            # Stage 1: Classify — decide the chunking template.
            await _update_stage(db, doc, "classifying")
            template = await _stage_classify(doc)
            doc.chunking_template = template
            await _save_checkpoint(db, doc.id, "classify", {"template": template})

            # Stage 2: Parse with RAGFlow (optional — skip if RAGFlow down).
            await _update_stage(db, doc, "parsing")
            try:
                ragflow_result = await _stage_parse(doc, project_id, ragflow)
                doc.ragflow_doc_id = ragflow_result.get("doc_id")
                doc.ragflow_dataset_id = ragflow_result.get("dataset_id")
            except Exception as e:
                log.warning("RAGFlow parse skipped (not running)", error=str(e))
                ragflow_result = {"status": "skipped", "reason": str(e)}
            await _save_checkpoint(db, doc.id, "parse", ragflow_result)

            # Stage 3: Extract via discovery-extraction-agent. Agent reads
            # the document, calls store_finding for each finding it
            # identifies, and posts live progress into the project's chat.
            # No separate validate / dedup / store stages — they're absorbed
            # into the agent + MCP layer now.
            await _update_stage(db, doc, "extracting")
            from app.models.project import Project
            project = await db.get(Project, project_id)
            extract_result = await _stage_extract(db, doc, project)
            await _save_checkpoint(db, doc.id, "extract", extract_result)

            # Stage 4: Evaluate readiness.
            await _update_stage(db, doc, "evaluating")
            from app.services.evaluator import evaluator
            readiness = await evaluator.evaluate(project_id, db, triggered_by=f"pipeline:doc:{doc.id}")
            await _save_checkpoint(db, doc.id, "evaluate", readiness)

            # Stage 5: Export per-item markdown files to the vault.
            await _update_stage(db, doc, "exporting")
            try:
                await _stage_export_markdown(db, project_id, doc)
            except Exception as e:
                log.warning("Markdown export failed (non-fatal)", error=str(e))

            # Done.
            doc.pipeline_stage = "completed"
            doc.pipeline_completed_at = datetime.now(timezone.utc)
            doc.pipeline_error = None

            # Activity log entry. The per-kind counts aren't tracked here
            # anymore (the agent did the storing) — readiness is the
            # portable summary the dashboard listens for.
            db.add(ActivityLog(
                project_id=project_id,
                action="document_processed",
                summary=f"Processed {doc.filename}: readiness {readiness['score']}%",
                details={
                    "document_id": str(doc.id),
                    "tool_calls": extract_result.get("tool_calls", 0),
                    "readiness": readiness["score"],
                },
            ))

            await db.commit()
            log.info(
                "Pipeline completed",
                document_id=str(doc.id),
                tool_calls=extract_result.get("tool_calls", 0),
                readiness=readiness["score"],
            )

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

    file_path = (doc.classification or {}).get("file_path")
    if file_path:
        from app.services.storage import read_upload
        try:
            content = await read_upload(Path(file_path))
            result = await ragflow.upload_document(dataset_id, doc.filename, content)
            rf_doc_id = result.get("data", {}).get("id", "unknown")
            await ragflow.parse_document(dataset_id, [rf_doc_id])
            return {"dataset_id": dataset_id, "doc_id": rf_doc_id, "status": "parsing"}
        except Exception as e:
            log.warning("RAGFlow upload failed, continuing without", error=str(e))
            return {"dataset_id": dataset_id, "doc_id": "ragflow-unavailable", "status": "skipped"}

    return {"dataset_id": dataset_id, "doc_id": "no-file", "status": "skipped"}


# ── Extraction stage — invokes discovery-extraction-agent ─────────────

# Max frequency of in-flight conversation updates while the agent streams.
# Mirrors the reminder_prep throttle; lower = more real-time in chat but
# more DB traffic.
_LIVE_UPDATE_THROTTLE_MS = 700


async def _stage_extract(db, doc: Document, project=None) -> dict:
    """Invoke discovery-extraction-agent on the document.

    The agent reads the parsed document text, calls `store_finding` via the
    Discovery MCP for each finding, and produces a short chat summary at
    the end. This function drains the agent's event stream, persists a
    live chat card into the project's shared conversation (so the PM sees
    extraction happen in real time), and returns aggregate counters for
    the pipeline checkpoint.

    Returns {summary, tool_calls, thinking_count, status}.
    """
    from app.services.storage import read_upload_text
    from app.agent.claude_runner import claude_runner
    from app.services import conversation_store
    from app.services.conversation_store import get_default_session
    from app.services.tool_labels import tool_label as _tool_label

    # Extraction is a project-level event — its streaming card lives on
    # the default session's timeline (the same place doc-ingestion notices
    # land). Resolve once up front and thread through every chat write.
    default = await get_default_session(db, doc.project_id)
    default_session_id = default.id

    file_path = (doc.classification or {}).get("file_path")
    if not file_path:
        log.warning("extraction.no_file", document_id=str(doc.id), filename=doc.filename)
        return {"status": "skipped", "reason": "no file content", "tool_calls": 0}

    text = await read_upload_text(Path(file_path))
    if len(text.strip()) < 20:
        log.info("extraction.too_short", document_id=str(doc.id), filename=doc.filename)
        return {"status": "skipped", "reason": "document too short", "tool_calls": 0}

    # Build the extraction message. The agent's own frontmatter carries
    # the extraction rules (source_quote law, dedup guidance, 5 kinds);
    # we just hand it the document + light project context and let it run.
    project_context = ""
    if project:
        project_context = (
            f"Project: {project.name}\n"
            f"Client: {project.client_name}\n"
            f"Type: {project.project_type}\n"
        )

    message = (
        "You have a document to extract findings from. Follow your extraction "
        "process: dedup-check first (get_requirements, get_gaps), then call "
        "store_finding per finding, then close with a 2-3 sentence chat summary.\n\n"
        f"{project_context}"
        f"Filename: {doc.filename}\n"
        f"Document ID: {doc.id}\n"
        "IMPORTANT: pass `source_doc_id` = \"" + str(doc.id) + "\" on EVERY "
        "store_finding call so the Source column in the UI links back to this "
        "document. This is non-optional for pipeline extractions.\n\n"
        "DOCUMENT CONTENT:\n"
        "---\n"
        f"{text[:12000]}\n"
        "---\n"
    )

    # Post a streaming placeholder to chat so the PM sees extraction live.
    # Same pattern as reminder_prep — one evolving card vs. two messages.
    placeholder_id: str | None = None
    try:
        placeholder_id = await conversation_store.append_message(
            db, doc.project_id, default_session_id,
            {
                "role": "assistant",
                "source": "pipeline",
                "kind": "extraction_running",
                "document_id": str(doc.id),
                "content": f"📄 Extracting findings from **{doc.filename}**…",
                "segments": [],
                "toolCalls": [],
                "thinkingCount": 0,
                "_processing": True,
            },
        )
        await db.commit()
    except Exception as e:
        log.warning("extraction.chat.placeholder.failed", id=str(doc.id), error=str(e))

    text_chunks: list[str] = []
    tool_calls: list[str] = []
    thinking_count = 0
    segments: list[dict] = []
    activity_tools: list[str] = []
    activity_thinking = 0
    last_phase: str | None = None
    last_update_ms = 0.0

    def _flush_activity() -> None:
        nonlocal activity_tools, activity_thinking
        if activity_tools or activity_thinking > 0:
            segments.append({
                "type": "activity",
                "tools": list(activity_tools),
                "thinkingCount": activity_thinking,
            })
            activity_tools = []
            activity_thinking = 0

    def _snapshot_segments() -> list[dict]:
        snap = list(segments)
        if activity_tools or activity_thinking > 0:
            snap.append({
                "type": "activity",
                "tools": list(activity_tools),
                "thinkingCount": activity_thinking,
            })
        return snap

    async def _maybe_live_update() -> None:
        nonlocal last_update_ms
        if not placeholder_id:
            return
        now_ms = time.time() * 1000
        if now_ms - last_update_ms < _LIVE_UPDATE_THROTTLE_MS:
            return
        last_update_ms = now_ms
        try:
            await conversation_store.update_message_by_id(
                db, doc.project_id, default_session_id, placeholder_id,
                {
                    "segments": _snapshot_segments(),
                    "toolCalls": list(tool_calls),
                    "thinkingCount": thinking_count,
                },
            )
        except Exception as e:
            log.warning("extraction.chat.live.failed", id=str(doc.id), error=str(e))

    try:
        async for event in claude_runner.run_stream(
            project_id=doc.project_id,
            chat_session_id=default_session_id,
            mcp_user_id=None,  # pipeline run — MCP attribution falls back to project lead
            message=message,
            agent="discovery-extraction-agent",
            model="sonnet",  # extraction benefits from the stronger model
        ):
            etype = event.get("type")
            if etype == "thinking":
                thinking_count += 1
                activity_thinking += 1
                last_phase = "activity"
                await _maybe_live_update()
            elif etype == "text":
                if last_phase == "activity":
                    _flush_activity()
                last_phase = "text"
                chunk = event.get("content", "")
                text_chunks.append(chunk)
                if segments and segments[-1]["type"] == "text":
                    segments[-1]["content"] = segments[-1].get("content", "") + chunk
                else:
                    segments.append({"type": "text", "content": chunk})
                await _maybe_live_update()
            elif etype == "tool_use":
                last_phase = "activity"
                tlabel = _tool_label(event.get("tool", "unknown"), event.get("input", {}) or {})
                tool_calls.append(tlabel)
                activity_tools.append(tlabel)
                await _maybe_live_update()
    except Exception as e:
        log.exception("extraction.agent.failed", id=str(doc.id))
        if placeholder_id:
            try:
                await conversation_store.update_message_by_id(
                    db, doc.project_id, default_session_id, placeholder_id,
                    {
                        "kind": "extraction_failed",
                        "content": f"⚠️ Extraction failed for **{doc.filename}**: `{e}`",
                        "_processing": False,
                        "segments": _snapshot_segments(),
                        "toolCalls": list(tool_calls),
                        "thinkingCount": thinking_count,
                    },
                )
                await db.commit()
            except Exception:
                pass
        raise

    _flush_activity()
    summary = ("".join(text_chunks)).strip() or f"Extracted from {doc.filename}."

    # Finalize the chat card with the agent's summary + final activity state.
    if placeholder_id:
        try:
            await conversation_store.update_message_by_id(
                db, doc.project_id, default_session_id, placeholder_id,
                {
                    "kind": "extraction_done",
                    "content": f"📄 **{doc.filename}**\n\n{summary}",
                    "segments": segments,
                    "toolCalls": tool_calls,
                    "thinkingCount": thinking_count,
                    "_processing": False,
                },
            )
            await db.commit()
        except Exception as e:
            log.warning("extraction.chat.final.failed", id=str(doc.id), error=str(e))

    log.info(
        "extraction.done",
        document=doc.filename,
        tool_calls=len(tool_calls),
        thinking=thinking_count,
    )
    return {
        "status": "done",
        "summary": summary,
        "tool_calls": len(tool_calls),
        "thinking_count": thinking_count,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Markdown writers — extracted to markdown_writer.py for readability.
# Every render_*_text, _*_to_payload, write_dashboard, write_hot,
# write_schema_md, and stakeholder_filename_safe now live there.
# Session 2 will trim the decision/scope/assumption renderers when those
# kinds are formally dropped.
# ─────────────────────────────────────────────────────────────────────────────
from app.pipeline.markdown_writer import (  # noqa: E402
    write_dashboard,
    write_hot,
    write_schema_md,
    render_requirement_text,
    render_constraint_text,
    render_gap_text,
    render_stakeholder_text,
    render_contradiction_text,
    requirement_to_payload,
    constraint_to_payload,
    gap_to_payload,
    stakeholder_to_payload,
    contradiction_to_payload,
    write_with_hand_edits,
)


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

    # --- Individual requirement files (no separate requirements.md — index.md covers it) ---
    for r, doc_name, doc_class in reqs_rows:
        # Pre-compute co-extracted siblings (other requirements from the
        # same source doc) so the renderer doesn't need cross-row access.
        co_extracted = [
            other_r.req_id
            for other_r, _, _ in reqs_rows
            if other_r.req_id != r.req_id and other_r.source_doc_id == r.source_doc_id
        ]
        payload = requirement_to_payload(r, doc_name, doc_class, today, co_extracted)
        text = render_requirement_text(payload, reqs_dir=reqs_dir)
        write_with_hand_edits(reqs_dir / f"{r.req_id}.md", text)

    # --- people/ individual stakeholder files (Phase 4d: per-row split) ---
    people_dir = discovery_dir / "people"
    people_dir.mkdir(parents=True, exist_ok=True)
    for s in stakeholders:
        # Pre-compute requirements requested by this person
        person_reqs = [(r.req_id, r.title) for r, _, _ in reqs_rows if r.source_person == s.name]
        payload = stakeholder_to_payload(s, today, person_reqs)
        text = render_stakeholder_text(payload)
        # Filename uses the stakeholder's name (sanitized)
        import re as _re
        safe_name = _re.sub(r"[^\w\s-]", "_", s.name).strip().replace(" ", "_")[:80] or "unnamed"
        write_with_hand_edits(people_dir / f"{safe_name}.md", text)

    # Clean up legacy single-file aggregates AND the three dropped-kind
    # directories from earlier exports (decisions/assumptions/scope were
    # removed in Session 2 — migration 027 drops the underlying tables).
    import shutil as _shutil
    for legacy in ("decisions.md", "people.md"):
        legacy_path = discovery_dir / legacy
        if legacy_path.exists():
            legacy_path.unlink()
    for legacy_dir in ("decisions", "assumptions", "scope"):
        legacy_dir_path = discovery_dir / legacy_dir
        if legacy_dir_path.exists():
            _shutil.rmtree(legacy_dir_path, ignore_errors=True)

    # --- contradictions/ individual files (Phase 4d) ---
    contradictions_dir = discovery_dir / "contradictions"
    contradictions_dir.mkdir(parents=True, exist_ok=True)
    for i, ctr in enumerate(contras, 1):
        ctr_id = f"CTR-{i:03d}"
        payload = contradiction_to_payload(ctr, ctr_id, today)
        text = render_contradiction_text(payload)
        write_with_hand_edits(contradictions_dir / f"{ctr_id}.md", text)

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
        payload = constraint_to_payload(con, con_id, today, affected_reqs)
        text = render_constraint_text(payload)
        write_with_hand_edits(constraints_dir / f"{con_id}.md", text)

    # --- gaps/ individual files ---
    gaps_dir = discovery_dir / "gaps"
    gaps_dir.mkdir(parents=True, exist_ok=True)
    for g, g_doc_name, g_doc_class in gaps_rows:
        payload = gap_to_payload(g, g_doc_name, today, g_doc_class)
        text = render_gap_text(payload, gaps_dir=gaps_dir)
        write_with_hand_edits(gaps_dir / f"{g.gap_id}.md", text)

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

    # --- lint the freshly written vault so the PM sees drift without
    # running the CLI. Failures here are advisory — bad data in vault
    # shouldn't block the ingest that produced the rest of it.
    vault_root = project_dir / ".memory-bank"
    lint_summary: dict | None = None
    try:
        from app.services.vault_lint import lint_vault as run_vault_lint, format_log_entry
        lint_report = run_vault_lint(vault_root)
        lint_summary = lint_report.summary()
    except Exception as e:
        log.warning("Vault lint failed (non-fatal)", error=str(e))

    # --- log.md (append operation log) ---
    log_path = discovery_dir / "log.md"
    from datetime import datetime as dt
    timestamp = dt.now().strftime("%Y-%m-%d %H:%M")
    doc_name = doc.filename if doc else "unknown"
    entry = (
        f"\n## [INGEST] {timestamp} — {doc_name}\n"
        f"Extracted: {len(reqs_rows)} requirements, {len(constraints)} constraints, "
        f"{len(gaps_rows)} gaps, {len(stakeholders)} stakeholders\n"
        f"Readiness: {readiness.get('score', 0)}%\n"
    )
    if lint_summary is not None:
        lint_line = format_log_entry(lint_summary)
        if lint_line:
            entry += f"{lint_line}\n"
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
    try:
        write_dashboard(
            vault_root, reqs_rows, constraints, gaps_rows,
            stakeholders, readiness, lint_summary=lint_summary,
        )
    except Exception as e:
        log.warning("Dashboard generation failed (non-fatal)", error=str(e))

    # hot.md at vault root — short distilled "what's hot right now"
    # carry-over for the next agent session. Cheap to load into context.
    try:
        write_hot(vault_root, doc, reqs_rows, gaps_rows, readiness)
    except Exception as e:
        log.warning("hot.md generation failed (non-fatal)", error=str(e))

    # schema.md at vault root — developer-friendly catalog of every
    # finding kind, generated from the canonical YAML schemas.
    try:
        write_schema_md(vault_root)
    except Exception as e:
        log.warning("schema.md generation failed (non-fatal)", error=str(e))

    log.info("Markdown export complete",
             project_id=str(project_id),
             requirements=len(reqs_rows),
             path=str(discovery_dir))
