"""Background auto-sync for connector retrievals.

Runs every few minutes via arq cron. For each ProjectIntegration that has
`sync_enabled = True` in its retrieval_settings and is due (according to its
configured interval), pulls new items matching the saved filters and feeds
them through the existing document ingestion pipeline.

This is the same code path as the manual "Import from Gmail/Drive" panels,
just driven by saved filters instead of a UI selection.
"""

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select

from app.db.session import async_session
from app.models.operational import ProjectIntegration, ActivityLog, Notification
from app.models.document import Document
from app.models.project import ProjectMember
from app.services.secrets import decrypt_config

log = structlog.get_logger()


async def _notify_project_members(project_id, source_label: str, count: int, query: str):
    """Create one in-app notification per project member when an auto-sync
    imports new items. Skipped silently if there were no imports."""
    if count <= 0:
        return
    try:
        async with async_session() as db:
            result = await db.execute(
                select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
            )
            user_ids = [r[0] for r in result.fetchall()]
            title = f"{count} new {source_label} item{'s' if count != 1 else ''} synced"
            body = f"Auto-sync imported {count} item{'s' if count != 1 else ''} matching your saved filter."
            for uid in user_ids:
                db.add(Notification(
                    project_id=project_id,
                    user_id=uid,
                    type=f"{source_label.lower().replace(' ', '_')}_sync",
                    title=title,
                    body=body,
                    data={"count": count, "query": query, "source": source_label},
                ))
            await db.commit()
    except Exception as e:
        log.warning("Failed to create sync notifications", error=str(e))


async def run_integration_sync():
    """Cron entry point — invoked by the arq worker every N minutes."""
    async with async_session() as db:
        result = await db.execute(select(ProjectIntegration))
        rows = result.scalars().all()

    log.info("Integration sync tick", total_integrations=len(rows))

    for row in rows:
        meta = row.metadata_public or {}
        retrieval = meta.get("retrieval_settings") or {}
        if not retrieval.get("sync_enabled"):
            continue
        if row.status != "active":
            continue
        if not _is_due(retrieval):
            continue

        try:
            if row.connector_id == "gmail":
                await _sync_gmail(row, retrieval)
            elif row.connector_id == "google_drive":
                await _sync_drive(row, retrieval)
        except Exception as e:
            log.exception("Sync failed", connector=row.connector_id, project=str(row.project_id)[:8], error=str(e))


def _is_due(retrieval: dict) -> bool:
    interval_minutes = int(retrieval.get("sync_interval_minutes") or 60)
    last = retrieval.get("last_synced_at")
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except Exception:
        return True
    return datetime.now(timezone.utc) - last_dt >= timedelta(minutes=interval_minutes)


async def _mark_synced(row: ProjectIntegration, count: int) -> None:
    """Persist last_synced_at on the integration's metadata_public."""
    async with async_session() as db:
        # Re-fetch within this session to safely mutate
        fresh = await db.get(ProjectIntegration, row.id)
        if not fresh:
            return
        meta = dict(fresh.metadata_public or {})
        retrieval = dict(meta.get("retrieval_settings") or {})
        retrieval["last_synced_at"] = datetime.now(timezone.utc).isoformat()
        retrieval["last_sync_imported"] = count
        meta["retrieval_settings"] = retrieval
        fresh.metadata_public = meta
        await db.commit()


async def _sync_gmail(row: ProjectIntegration, retrieval: dict) -> None:
    """Pull recent matching emails for one project and ingest."""
    from app.services import gmail as gmail_service
    from app.agent.claude_runner import claude_runner
    import uuid

    config = decrypt_config(row.config_encrypted)
    refresh_token = config.get("refresh_token")
    if not refresh_token:
        return

    query = _build_gmail_query(retrieval)
    log.info("Gmail auto-sync", project=str(row.project_id)[:8], query=query)

    access_token = await gmail_service.get_access_token(refresh_token)
    messages = await gmail_service.list_messages(access_token, query=query, max_results=25)
    if not messages:
        await _mark_synced(row, 0)
        return

    upload_dir = claude_runner.get_upload_dir(row.project_id)
    imported = 0
    from app.services import raw_store

    async with async_session() as db:
        for m in messages:
            mid = m["id"]
            try:
                full = await gmail_service.get_message_full(access_token, mid)
            except Exception:
                continue
            body_text = gmail_service.extract_body_text(full)
            filename, markdown = gmail_service.format_as_document(full, body_text)

            existing = await db.execute(
                select(Document).where(
                    Document.project_id == row.project_id,
                    Document.filename == filename,
                )
            )
            if existing.scalar_one_or_none():
                continue

            safe_name = f"{uuid.uuid4().hex[:8]}_{filename}"
            file_path = upload_dir / safe_name
            file_path.write_text(markdown, encoding="utf-8")

            # Save raw email payload for backlink resolution
            raw_path = raw_store.save_gmail_raw(row.project_id, full, body_text)

            doc = Document(
                project_id=row.project_id,
                filename=filename,
                file_type="md",
                file_size_bytes=len(markdown.encode("utf-8")),
                pipeline_stage="queued",
                classification={
                    "file_path": str(file_path),
                    "source": "gmail",
                    "gmail_message_id": mid,
                    "auto_synced": True,
                    "source_raw_path": str(raw_path),
                },
            )
            db.add(doc)
            await db.flush()
            imported += 1

            try:
                from arq import create_pool
                from arq.connections import RedisSettings
                from app.config import settings
                pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
                await pool.enqueue_job("process_document", str(doc.id))
                await pool.close()
            except Exception:
                pass

        if imported > 0:
            db.add(ActivityLog(
                project_id=row.project_id,
                user_id=None,
                action="gmail_auto_synced",
                summary=f"Auto-synced {imported} email{'s' if imported != 1 else ''} from Gmail",
                details={"count": imported, "query": query},
            ))
        await db.commit()

    await _mark_synced(row, imported)
    await _notify_project_members(row.project_id, "Gmail", imported, query)
    log.info("Gmail auto-sync done", project=str(row.project_id)[:8], imported=imported)


async def _sync_drive(row: ProjectIntegration, retrieval: dict) -> None:
    from app.services import google_drive
    from app.agent.claude_runner import claude_runner
    import uuid

    config = decrypt_config(row.config_encrypted)
    refresh_token = config.get("refresh_token")
    if not refresh_token:
        return

    query = _build_drive_query(retrieval)
    log.info("Drive auto-sync", project=str(row.project_id)[:8], query=query)

    access_token = await google_drive.get_access_token(refresh_token)
    files = await google_drive.list_files(access_token, query=query, page_size=25)
    if not files:
        await _mark_synced(row, 0)
        return

    upload_dir = claude_runner.get_upload_dir(row.project_id)
    imported = 0

    async with async_session() as db:
        for f in files:
            mime = f.get("mimeType", "")
            if not google_drive.is_supported(mime):
                continue
            try:
                content, ext, _ = await google_drive.fetch_file_content(access_token, f["id"], mime)
            except Exception:
                continue

            filename = google_drive.safe_filename(f.get("name", "drive_file"), ext)

            existing = await db.execute(
                select(Document).where(
                    Document.project_id == row.project_id,
                    Document.filename == filename,
                )
            )
            if existing.scalar_one_or_none():
                continue

            safe_name = f"{uuid.uuid4().hex[:8]}_{filename}"
            file_path = upload_dir / safe_name
            file_path.write_bytes(content)

            from app.services import raw_store
            raw_path = raw_store.save_binary_raw(
                row.project_id, "google_drive", filename, content, extra_id=f["id"],
            )

            doc = Document(
                project_id=row.project_id,
                filename=filename,
                file_type=ext,
                file_size_bytes=len(content),
                pipeline_stage="queued",
                classification={
                    "file_path": str(file_path),
                    "source": "google_drive",
                    "drive_file_id": f["id"],
                    "drive_url": f.get("webViewLink"),
                    "auto_synced": True,
                    "source_raw_path": str(raw_path),
                },
            )
            db.add(doc)
            await db.flush()
            imported += 1

            try:
                from arq import create_pool
                from arq.connections import RedisSettings
                from app.config import settings
                pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
                await pool.enqueue_job("process_document", str(doc.id))
                await pool.close()
            except Exception:
                pass

        if imported > 0:
            db.add(ActivityLog(
                project_id=row.project_id,
                user_id=None,
                action="drive_auto_synced",
                summary=f"Auto-synced {imported} file{'s' if imported != 1 else ''} from Google Drive",
                details={"count": imported, "query": query},
            ))
        await db.commit()

    await _mark_synced(row, imported)
    await _notify_project_members(row.project_id, "Google Drive", imported, query)
    log.info("Drive auto-sync done", project=str(row.project_id)[:8], imported=imported)


def _build_gmail_query(retrieval: dict) -> str:
    parts: list[str] = []
    if retrieval.get("from"):
        parts.append(f"from:{retrieval['from']}")
    if retrieval.get("to"):
        parts.append(f"to:{retrieval['to']}")
    if retrieval.get("subject"):
        s = retrieval["subject"]
        parts.append(f'subject:"{s}"' if " " in s else f"subject:{s}")
    date_range = retrieval.get("dateRange") or "30d"
    if date_range != "any":
        parts.append(f"newer_than:{date_range}")
    folder = retrieval.get("folder") or "any"
    if folder != "any":
        parts.append(f"in:{folder}")
    if retrieval.get("hasAttachment"):
        parts.append("has:attachment")
    if retrieval.get("unreadOnly"):
        parts.append("is:unread")
    return " ".join(parts)


def _build_drive_query(retrieval: dict) -> str:
    import re
    parts: list[str] = ["trashed = false"]
    if retrieval.get("name"):
        n = retrieval["name"].replace("'", "\\'")
        parts.append(f"name contains '{n}'")
    type_to_mime = {
        "doc": ["application/vnd.google-apps.document"],
        "sheet": ["application/vnd.google-apps.spreadsheet"],
        "slide": ["application/vnd.google-apps.presentation"],
        "pdf": ["application/pdf"],
        "office": [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
    }
    t = retrieval.get("type") or "any"
    if t in type_to_mime:
        mimes = type_to_mime[t]
        parts.append("(" + " or ".join(f"mimeType = '{m}'" for m in mimes) + ")")
    date_range = retrieval.get("dateRange") or "30d"
    if date_range != "any":
        days = int(date_range.rstrip("d"))
        from datetime import datetime, timedelta, timezone
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")
        parts.append(f"modifiedTime > '{since}'")
    folder_url = retrieval.get("folderUrl") or ""
    m = re.search(r"folders/([a-zA-Z0-9_-]+)", folder_url)
    folder_id = m.group(1) if m else (folder_url.strip() if re.fullmatch(r"[a-zA-Z0-9_-]{10,}", folder_url.strip()) else None)
    if folder_id:
        parts.append(f"'{folder_id}' in parents")
    return " and ".join(parts)
