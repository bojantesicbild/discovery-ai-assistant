"""arq worker — async document processing queue."""

from arq import create_pool
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


class WorkerSettings:
    functions = [process_document]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 5
    job_timeout = 600  # 10 minutes per document
    queue_name = "arq:queue"
