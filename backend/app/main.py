from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import projects, documents, extracted_items, dashboard, chat, generate, auth, knowledge, repos, integrations, slack_channels, finding_views, history, review, meeting, reminders, vault, relationships as api_relationships, sessions as api_sessions, learnings as api_learnings


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
