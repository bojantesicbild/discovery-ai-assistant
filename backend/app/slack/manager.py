"""SlackListenerManager — singleton that spawns one SlackListener per
project that has both a Slack integration AND at least one channel link.

Started from FastAPI lifespan. Exposes restart_for_project so the
Directory UI can trigger a listener reload after link changes.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import structlog
from sqlalchemy import distinct, select

from app.db.session import async_session
from app.models.operational import ProjectIntegration
from app.models.slack import SlackChannelLink
from app.services.secrets import decrypt_config
from app.slack.listener import SlackListener

log = structlog.get_logger()


class SlackListenerManager:
    def __init__(self):
        self._listeners: dict[uuid.UUID, SlackListener] = {}
        self._lock = asyncio.Lock()

    async def start_all(self) -> None:
        """Spawn a listener for every project that qualifies."""
        async with self._lock:
            project_ids = await self._list_active_project_ids()
            log.info("SlackListenerManager starting", count=len(project_ids))
            for pid in project_ids:
                try:
                    await self._start_one(pid)
                except Exception as e:
                    log.error("Failed to start Slack listener", project=str(pid)[:8], error=str(e))

    async def stop_all(self) -> None:
        async with self._lock:
            for pid, listener in list(self._listeners.items()):
                try:
                    await listener.stop()
                except Exception as e:
                    log.warning("Stop listener failed", project=str(pid)[:8], error=str(e))
            self._listeners.clear()

    async def restart_for_project(self, project_id: uuid.UUID) -> None:
        """Called after channel link or integration changes."""
        async with self._lock:
            existing = self._listeners.pop(project_id, None)
            if existing:
                try:
                    await existing.stop()
                except Exception:
                    pass
            # Check if the project still qualifies (has integration + channel links)
            active_ids = await self._list_active_project_ids()
            if project_id in active_ids:
                try:
                    await self._start_one(project_id)
                except Exception as e:
                    log.error("Restart listener failed", project=str(project_id)[:8], error=str(e))

    async def _list_active_project_ids(self) -> set[uuid.UUID]:
        """Projects with an active Slack integration AND ≥1 channel link."""
        async with async_session() as db:
            # Integrations
            integ_result = await db.execute(
                select(ProjectIntegration).where(
                    ProjectIntegration.connector_id == "slack",
                    ProjectIntegration.status == "active",
                )
            )
            integs = {r.project_id: r for r in integ_result.scalars().all()}
            if not integs:
                return set()

            # Channel links
            link_result = await db.execute(
                select(distinct(SlackChannelLink.project_id)).where(
                    SlackChannelLink.project_id.in_(list(integs.keys()))
                )
            )
            linked = {r[0] for r in link_result.fetchall()}
            return linked

    async def _start_one(self, project_id: uuid.UUID) -> None:
        # Fetch + decrypt integration config
        async with async_session() as db:
            result = await db.execute(
                select(ProjectIntegration).where(
                    ProjectIntegration.project_id == project_id,
                    ProjectIntegration.connector_id == "slack",
                    ProjectIntegration.status == "active",
                )
            )
            integ = result.scalar_one_or_none()
        if not integ:
            return

        try:
            config = decrypt_config(integ.config_encrypted)
        except Exception as e:
            log.error("Could not decrypt Slack config", project=str(project_id)[:8], error=str(e))
            return

        bot_token = config.get("slack_bot_token")
        app_token = config.get("slack_app_token")
        if not bot_token or not app_token:
            log.info(
                "Project lacks Slack app_token (Socket Mode not enabled)",
                project=str(project_id)[:8],
            )
            return

        listener = SlackListener(project_id=project_id, bot_token=bot_token, app_token=app_token)
        await listener.start()
        self._listeners[project_id] = listener


# Module-level singleton
manager = SlackListenerManager()
