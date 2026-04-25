from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import projects, documents, extracted_items, dashboard, chat, generate, auth, knowledge, repos, integrations, slack_channels, finding_views, history, review, meeting, reminders, vault, relationships as api_relationships, sessions as api_sessions, learnings as api_learnings, tokens as api_tokens


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — seed control point templates
    from app.db.session import async_session
    from app.db.seed import seed_control_points
    async with async_session() as db:
        try:
            await seed_control_points(db)
        except Exception:
            pass  # DB might not exist yet during initial setup

    # Re-queue stuck documents (queued or mid-processing from previous crash)
    await _requeue_stuck_documents()

    # Heal stuck "_processing": True chat / pipeline / reminder placeholders
    # left by the previous worker generation. Without this they render as
    # the ghost UI forever — see chat.py finally-block notes.
    await _heal_stuck_processing_messages()

    # Start Slack inbound listeners (one per project with Slack + ≥1 channel link)
    try:
        from app.slack.manager import manager as slack_manager
        await slack_manager.start_all()
    except Exception as e:
        import structlog
        structlog.get_logger().warning("Slack listeners failed to start", error=str(e))

    yield

    # Shutdown Slack listeners first
    try:
        from app.slack.manager import manager as slack_manager
        await slack_manager.stop_all()
    except Exception:
        pass

    # Shutdown
    from app.db.session import engine
    await engine.dispose()


async def _requeue_stuck_documents():
    """Find documents stuck in queued/processing state and re-queue them."""
    import structlog
    log = structlog.get_logger()

    try:
        from app.db.session import async_session
        from app.models.document import Document
        from sqlalchemy import select

        stuck_stages = ["queued", "classifying", "parsing", "extracting", "deduplicating", "storing", "evaluating"]

        async with async_session() as db:
            result = await db.execute(
                select(Document).where(Document.pipeline_stage.in_(stuck_stages))
            )
            stuck_docs = result.scalars().all()

            if not stuck_docs:
                return

            log.info("Found stuck documents", count=len(stuck_docs))

            # Try to queue them via Redis
            try:
                from arq import create_pool
                from arq.connections import RedisSettings
                pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))

                for doc in stuck_docs:
                    # Reset to queued so pipeline starts fresh
                    doc.pipeline_stage = "queued"
                    doc.pipeline_error = None
                    await pool.enqueue_job("process_document", str(doc.id))
                    log.info("Re-queued document", doc_id=str(doc.id), filename=doc.filename)

                await db.commit()
                await pool.aclose()
            except Exception as e:
                log.warning("Could not re-queue documents (Redis may be down)", error=str(e))

    except Exception as e:
        import structlog
        structlog.get_logger().warning("Startup re-queue check failed", error=str(e))


async def _heal_stuck_processing_messages():
    """Mark every in-flight chat / extraction / reminder placeholder as
    interrupted on boot.

    Background: the chat (and earlier the pipeline + reminder) flows write
    a placeholder message with ``_processing: True`` before kicking off
    the agent run, then patch it in place when the run completes. If
    uvicorn is reloaded mid-stream (file save, OOM kill, manual restart)
    the finally-block update never lands and the row stays stuck —
    rendered forever as the ghost UI on the next mount.

    This sweep runs once at startup. Anything still marked
    ``_processing: True`` from a previous worker generation is, by
    definition, no longer being worked on by anyone, so we patch both
    the rolling JSONB list and the conversation_messages rows to flip
    the flag and surface a short interrupted-content marker.

    The sweep is intentionally generous (any ``_processing: True``,
    regardless of ``kind``) so older placeholders that predate the
    ``kind: 'chat_running'`` tag get healed too."""
    import structlog
    log = structlog.get_logger()

    INTERRUPTED_TEXT = "⚠️ Backend restarted mid-response. Send the message again."

    try:
        from app.db.session import async_session
        from sqlalchemy import text

        async with async_session() as db:
            # 1) Flip the typed rows. content overwrite happens only when
            #    the existing content is empty — for an in-flight run that
            #    streamed some text before the crash, we keep what we have
            #    so the user sees their partial answer rather than the
            #    interrupted marker.
            row_result = await db.execute(text(
                """
                UPDATE conversation_messages
                SET
                    content = CASE
                        WHEN COALESCE(content, '') = '' THEN :interrupted
                        ELSE content
                    END,
                    payload = jsonb_set(
                        jsonb_set(
                            payload,
                            '{_processing}',
                            'false'::jsonb,
                            true
                        ),
                        '{content}',
                        to_jsonb(
                            CASE
                                WHEN COALESCE(payload->>'content', '') = ''
                                    THEN :interrupted
                                ELSE payload->>'content'
                            END
                        ),
                        true
                    )
                WHERE COALESCE((payload->>'_processing')::boolean, false) = true
                """
            ), {"interrupted": INTERRUPTED_TEXT})

            # 2) Same patch on the rolling JSONB list. We rebuild the
            #    array with the in-flight elements healed; everything
            #    else stays bit-for-bit identical.
            await db.execute(text(
                """
                UPDATE conversations c
                SET messages = (
                    SELECT COALESCE(jsonb_agg(
                        CASE
                            WHEN COALESCE((msg->>'_processing')::boolean, false) = true
                            THEN jsonb_set(
                                    jsonb_set(msg, '{_processing}', 'false'::jsonb, true),
                                    '{content}',
                                    to_jsonb(
                                        CASE
                                            WHEN COALESCE(msg->>'content', '') = ''
                                                THEN :interrupted
                                            ELSE msg->>'content'
                                        END
                                    ),
                                    true
                                )
                            ELSE msg
                        END
                        ORDER BY ord
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(c.messages) WITH ORDINALITY AS t(msg, ord)
                )
                WHERE jsonb_typeof(c.messages) = 'array'
                  AND EXISTS (
                      SELECT 1 FROM jsonb_array_elements(c.messages) AS m(msg)
                      WHERE COALESCE((m.msg->>'_processing')::boolean, false) = true
                  )
                """
            ), {"interrupted": INTERRUPTED_TEXT})

            await db.commit()
            healed = row_result.rowcount if row_result.rowcount is not None else 0
            if healed:
                log.info("Healed stuck _processing messages", count=healed)

    except Exception as e:
        log.warning("Stuck-message sweep failed", error=str(e))


app = FastAPI(
    title="Discovery AI Assistant",
    description="AI-powered tool for structured client discovery",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(extracted_items.router)
app.include_router(dashboard.router)
app.include_router(chat.router)
app.include_router(generate.router)
app.include_router(knowledge.router)
app.include_router(repos.router)
app.include_router(integrations.router)
app.include_router(slack_channels.router)
app.include_router(finding_views.router)
app.include_router(history.router)
app.include_router(review.router)
app.include_router(meeting.router)
app.include_router(reminders.router)
app.include_router(vault.router)
app.include_router(api_relationships.router)
app.include_router(api_sessions.router)
app.include_router(api_learnings.router)
app.include_router(api_tokens.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/")
async def root():
    return {
        "name": "Discovery AI Assistant",
        "version": "0.1.0",
        "docs": "/docs",
    }
