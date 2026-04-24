"""arq worker — async document processing queue + scheduled digests."""

from arq import cron
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


async def run_learnings_reaper(ctx):
    """Dismiss stale transient learnings.

    Phase 3 of the session-heartbeat architecture. Transient learnings
    older than DEFAULT_STALE_DAYS with fewer than DEFAULT_STALE_MIN_REFS
    references get auto-dismissed so the inbox doesn't grow monotonically.
    Promoted learnings are untouched — once the PM endorses one, we keep
    it regardless of age.
    """
    import structlog
    from app.services.learnings import auto_dismiss_stale

    async_session = ctx["db_session"]
    async with async_session() as db:
        dismissed = await auto_dismiss_stale(db)
        await db.commit()
    if dismissed:
        structlog.get_logger().info(
            "learnings.reaper.dismissed", count=dismissed,
        )


async def scan_due_reminders(ctx):
    """Pick up reminders whose prep window has opened, run prep + delivery.

    Three-phase scan:

    1. **Watchdog.** Any row stuck in 'processing' for longer than
       PROCESSING_STUCK_MINUTES is assumed orphaned (worker crash mid-prep,
       LLM hang, etc.) and flipped to 'failed' with an explicit message.
       The retry phase below then re-picks it up on the next tick, as long
       as its retry budget isn't spent.

    2. **Claim.** UPDATE ... RETURNING with FOR UPDATE SKIP LOCKED atomically
       moves rows to 'processing' so concurrent workers can't double-run
       the same reminder. The claim set is both 'pending' rows and 'failed'
       rows that still have retries available.

    3. **Process.** For each claimed row, run prep and (if prep succeeded)
       delivery. On failure prep_reminder/deliver_reminder bump retry_count
       and flip status back to 'pending' if still under budget, else leave
       it 'failed' terminally."""
    from sqlalchemy import text
    from app.services.reminder_prep import prep_reminder
    from app.services.reminder_delivery import deliver_reminder

    PROCESSING_STUCK_MINUTES = 10

    async_session = ctx["db_session"]
    async with async_session() as db:
        # (1) Watchdog — reclaim orphaned 'processing' rows. updated_at is
        # set by the ORM on every UPDATE, so it tracks the last prep-side
        # activity for a given row.
        reclaimed = await db.execute(
            text(
                "UPDATE reminders SET "
                "  status = 'failed', "
                "  error_message = 'prep watchdog: stuck in processing > "
                f"{PROCESSING_STUCK_MINUTES} min', "
                "  updated_at = now() "
                "WHERE status = 'processing' "
                f"  AND updated_at < now() - interval '{PROCESSING_STUCK_MINUTES} minutes' "
                "RETURNING id"
            )
        )
        reclaimed_ids = [row[0] for row in reclaimed.all()]
        await db.commit()
        if reclaimed_ids:
            import structlog
            structlog.get_logger().warning(
                "reminder.watchdog.reclaimed", count=len(reclaimed_ids)
            )

        # (2) Claim — pending rows OR failed rows with retries left, in
        # their prep window, ordered by due_at, limited to a batch.
        result = await db.execute(
            text(
                "UPDATE reminders SET status = 'processing', updated_at = now() "
                "WHERE id IN ("
                "  SELECT id FROM reminders "
                "  WHERE status IN ('pending', 'failed') "
                "    AND retry_count < max_retries "
                "    AND (due_at - prep_lead) <= now() "
                "  ORDER BY due_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED"
                ") RETURNING id"
            )
        )
        claimed = [row[0] for row in result.all()]
        await db.commit()

    # (3) Process each claimed row — prep, then deliver on success.
    for reminder_id in claimed:
        async with async_session() as db:
            r = await prep_reminder(db, reminder_id)
        if r.status == "prepared":
            async with async_session() as db:
                r = await deliver_reminder(db, reminder_id)

        # (4) Recurrence roll-over — if the row delivered successfully
        # AND has recurrence set, reset it to fire again at its next
        # occurrence. Keeps one row per recurring series (audit via
        # activity_log entries per fire).
        if r.status == "delivered" and getattr(r, "recurrence", "none") != "none":
            from sqlalchemy import select
            from datetime import datetime, timezone as _tz
            from app.models.reminder import Reminder
            from app.services.reminder_recurrence import next_occurrence

            nxt = next_occurrence(r.due_at, r.recurrence)
            if nxt is not None and (r.recurrence_end_at is None or nxt <= r.recurrence_end_at):
                async with async_session() as db:
                    reminder = await db.scalar(select(Reminder).where(Reminder.id == reminder_id))
                    if reminder:
                        reminder.due_at = nxt
                        reminder.status = "pending"
                        reminder.prep_output_path = None
                        reminder.delivered_at = None
                        reminder.prepared_at = None
                        reminder.external_ref = None
                        reminder.error_message = None
                        reminder.retry_count = 0
                        reminder.occurrence_count = (reminder.occurrence_count or 0) + 1
                        reminder.updated_at = datetime.now(_tz.utc)
                        await db.commit()


class WorkerSettings:
    functions = [process_document]
    cron_jobs = [
        cron(run_daily_digests, hour=7, minute=0),          # Every day at 7:00 AM
        cron(run_weekly_summaries, weekday=0, hour=7, minute=30),  # Monday 7:30 AM
        cron(run_integration_sync, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),  # Every 5 min
        cron(scan_due_reminders, minute=set(range(0, 60))),  # Every minute — max 1-min reminder lag
        cron(run_learnings_reaper, hour=3, minute=30),       # Daily 3:30 AM — dismiss stale learnings
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 5
    job_timeout = 600  # 10 minutes per document
    queue_name = "arq:queue"
