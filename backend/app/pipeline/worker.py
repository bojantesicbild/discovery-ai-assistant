"""arq worker — async document processing queue + scheduled digests."""

from arq import create_pool, cron
from arq.connections import RedisSettings
from app.config import settings
from app.pipeline.tasks import process_document


async def startup(ctx):
    """Worker startup — init DB pool and HTTP clients."""
    from app.db.session import async_session
    from app.services.ragflow import RAGFlowClient

    ctx["db_session"] = async_session
    ctx["ragflow"] = RAGFlowClient()


async def shutdown(ctx):
    """Worker shutdown — cleanup."""
    if "ragflow" in ctx:
        await ctx["ragflow"].close()


async def run_daily_digests(ctx):
    """Generate morning digests for all active projects."""
    from app.pipeline.digest import generate_all_digests
    await generate_all_digests()


async def run_weekly_summaries(ctx):
    """Generate weekly summaries for all active projects."""
    from app.pipeline.digest import generate_all_weekly_summaries
    await generate_all_weekly_summaries()


async def run_integration_sync(ctx):
    """Auto-sync Gmail/Drive items for projects that have it enabled."""
    from app.pipeline.integration_sync import run_integration_sync as _run
    await _run()


class WorkerSettings:
    functions = [process_document]
    cron_jobs = [
        cron(run_daily_digests, hour=7, minute=0),          # Every day at 7:00 AM
        cron(run_weekly_summaries, weekday=0, hour=7, minute=30),  # Monday 7:30 AM
        cron(run_integration_sync, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),  # Every 5 min
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 5
    job_timeout = 600  # 10 minutes per document
    queue_name = "arq:queue"
