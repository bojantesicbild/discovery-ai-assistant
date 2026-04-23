"""SlackListener — one Bolt AsyncApp per project, connected via Socket Mode.

Handles app_mention events with the OpenClaw-ported guards:
- dedup on (channel, ts)
- app_mention ↔ message race handling
- channel_type == "im"/"mpim" early-return
- thread_ts fallback resolver
- self-message filter (ignore own bot messages)
- bot mention stripping from prompt text
- emoji ack (eyes) as instant receipt
- placeholder "Working on it..." message + throttled chat.update streaming
- debouncer combining consecutive short messages
- shared Claude Code session via PROJECT_SHARED_USER
- shared conversation persistence (web + slack history merged)
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from typing import Any

import structlog
from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

from sqlalchemy import select

from app.agent.claude_runner import claude_runner
from app.db.session import async_session
from app.models.slack import SlackChannelLink
from app.services.conversation_store import (
    PROJECT_SHARED_USER,
    append_assistant_placeholder,
    append_user_message_slack,
    update_message_by_id,
)
from app.slack.cache import AppMentionRetryCache, DedupeCache
from app.slack.debouncer import (
    DEBOUNCE_WINDOW_MS,
    ChannelInboundDebouncer,
    build_debounce_key,
    combine_messages,
)
from app.slack.thread_resolver import resolve_thread_ts

log = structlog.get_logger()

CHAT_UPDATE_THROTTLE_MS = 1200
DB_UPDATE_THROTTLE_MS = 2500  # how often to flush partial state to the shared conversation
MAX_SLACK_MESSAGE_CHARS = 3900


def _strip_bot_mentions(text: str, bot_user_id: str) -> str:
    """Remove `<@bot_user_id>` literals from the text so Claude doesn't
    hallucinate about which agent the user is addressing."""
    if not text:
        return ""
    pattern = re.compile(rf"<@{re.escape(bot_user_id)}(\|[^>]*)?>")
    return pattern.sub("", text).strip()


class SlackListener:
    """One Bolt AsyncApp + Socket Mode handler per project."""

    def __init__(
        self,
        project_id: uuid.UUID,
        bot_token: str,
        app_token: str,
    ):
        self.project_id = project_id
        self.bot_token = bot_token
        self.app_token = app_token
        self.bot_user_id: str | None = None
        self.team_id: str | None = None
        self.app: AsyncApp | None = None
        self.handler: AsyncSocketModeHandler | None = None

        self._dedupe = DedupeCache()
        self._app_mention_retry = AppMentionRetryCache()
        self._debouncer = ChannelInboundDebouncer(
            window_ms=DEBOUNCE_WINDOW_MS,
            on_flush=self._on_debouncer_flush,
        )
        # Throttle state for chat.update per message_ts:
        # placeholder_ts -> last_update_ms
        self._last_update_ms: dict[str, float] = {}

    async def start(self) -> None:
        """Initialize Bolt, verify tokens, register handlers, connect Socket Mode."""
        self.app = AsyncApp(token=self.bot_token)

        # Fetch bot user id + team id for self-filtering
        try:
            auth = await self.app.client.auth_test()
            self.bot_user_id = auth.get("user_id")
            self.team_id = auth.get("team_id")
        except Exception as e:
            log.error("slack auth_test failed", project=str(self.project_id)[:8], error=str(e))
            raise

        # Register the one event we care about
        self.app.event("app_mention")(self._handle_app_mention)

        # Connect Socket Mode
        self.handler = AsyncSocketModeHandler(self.app, self.app_token)
        await self.handler.connect_async()
        log.info(
            "SlackListener started",
            project=str(self.project_id)[:8],
            bot_user=self.bot_user_id,
            team=self.team_id,
        )

    async def stop(self) -> None:
        try:
            await self._debouncer.shutdown()
        except Exception:
            pass
        if self.handler:
            try:
                await self.handler.close_async()
            except Exception as e:
                log.warning("SocketMode close failed", error=str(e))
        self.app = None
        self.handler = None
        log.info("SlackListener stopped", project=str(self.project_id)[:8])

    # ──────────────────────────────────────────────────────────────────
    # Event handler
    # ──────────────────────────────────────────────────────────────────

    async def _handle_app_mention(self, body: dict, ack: Any) -> None:
        await ack()
        event = body.get("event", {}) or {}
        channel = event.get("channel")
        ts = event.get("ts")
        user = event.get("user")
        channel_type = event.get("channel_type")

        # Self-filter — ignore messages from our own bot
        if user and self.bot_user_id and user == self.bot_user_id:
            return
        if event.get("bot_id") or event.get("subtype") == "bot_message":
            return

        # OpenClaw guard: skip app_mention for DMs (would double-fire with message.im)
        if channel_type in ("im", "mpim"):
            return

        if not channel or not ts:
            return

        # Dedup check on (channel, ts)
        dedupe_key = f"{channel}:{ts}"
        if self._dedupe.check(dedupe_key):
            log.debug("slack event deduped", key=dedupe_key)
            return

        # Thread-ts resolver — enrich message if thread_ts is missing
        enriched = await resolve_thread_ts(self.app.client, event)
        thread_key = enriched.get("thread_ts") or ts

        # Verify this channel is actually linked to our project
        if not await self._channel_is_linked(channel):
            try:
                await self.app.client.chat_postEphemeral(
                    channel=channel,
                    user=user,
                    text=(
                        "This channel isn't linked to any Discovery project. "
                        "Link it via the web app → Directory → Slack."
                    ),
                )
            except Exception:
                pass
            return

        # Strip bot mention from text
        text = _strip_bot_mentions(enriched.get("text") or "", self.bot_user_id or "")
        if not text:
            return

        # Fire-and-forget emoji ack
        asyncio.create_task(self._emoji_ack(channel, ts, "eyes"))

        # Resolve display names for the shared conversation persistence.
        # Both calls are fire-and-forget cached on Slack's side; failures
        # just leave the names as None.
        user_name = await self._fetch_user_name(user)
        channel_name = await self._fetch_channel_name(channel)

        # Enqueue through the debouncer — will flush after DEBOUNCE_WINDOW_MS
        message = {
            **enriched,
            "_thread_key": thread_key,
            "_clean_text": text,
            "_user_name": user_name,
            "_channel_name": channel_name,
        }
        key = build_debounce_key(message, account_id=str(self.project_id))
        self._debouncer.enqueue(key, message)

    async def _on_debouncer_flush(self, key: str, messages: list[dict]) -> None:
        """Called when the debouncer's window expires. Dispatches the
        combined message to Claude Code as a background task."""
        combined = combine_messages(messages)
        if not combined:
            return
        # Rebuild text from the cleaned texts we stashed earlier
        combined_text = "\n".join(m.get("_clean_text", "") for m in messages if m.get("_clean_text"))
        combined["_clean_text"] = combined_text
        # Fire background task — never await Claude Code inside Bolt handlers
        asyncio.create_task(self._process_message(combined))

    # ──────────────────────────────────────────────────────────────────
    # Message processing
    # ──────────────────────────────────────────────────────────────────

    async def _process_message(self, message: dict) -> None:
        channel = message.get("channel")
        ts = message.get("ts")
        thread_key = message.get("_thread_key") or ts
        text = message.get("_clean_text") or ""
        slack_user_id = message.get("user")
        slack_channel_name = message.get("_channel_name")
        slack_user_name = message.get("_user_name")

        if not channel or not thread_key or not text:
            return

        # Persist user message to shared conversation immediately so the web
        # UI sees it within one poll interval, even before Claude responds.
        # Also create an assistant placeholder right away so the web UI can
        # show "Thinking…" instead of a black hole until the run completes.
        assistant_msg_id: str | None = None
        try:
            async with async_session() as db:
                await append_user_message_slack(
                    db, self.project_id,
                    text=text,
                    slack_user_name=slack_user_name,
                    slack_user_id=slack_user_id,
                    slack_channel_id=channel,
                    slack_channel_name=slack_channel_name,
                    slack_thread_ts=thread_key,
                )
                assistant_msg_id = await append_assistant_placeholder(
                    db, self.project_id,
                    source="slack",
                    slack_channel_id=channel,
                    slack_channel_name=slack_channel_name,
                    slack_thread_ts=thread_key,
                )
        except Exception as e:
            log.warning("Failed to persist Slack user/placeholder message", error=str(e))

        placeholder_ts: str | None = None
        last_db_update_ms = 0.0
        try:
            placeholder = await self.app.client.chat_postMessage(
                channel=channel,
                thread_ts=thread_key,
                text="⏳ Working on it…",
            )
            placeholder_ts = placeholder.get("ts")

            # Prime the shared session from the conversation history if it
            # isn't in claude_runner's in-memory map yet (e.g. after a
            # backend restart). This is what makes the cross-channel memory
            # feature actually work — without this, every Slack message
            # starts a fresh session.
            if not claude_runner.get_session_id(self.project_id, PROJECT_SHARED_USER):
                try:
                    from app.services.conversation_store import get_shared
                    async with async_session() as db:
                        conv = await get_shared(db, self.project_id)
                        if conv and conv.messages:
                            for prev in reversed(conv.messages):
                                sid = prev.get("session_id")
                                if sid:
                                    claude_runner.set_session_id(
                                        self.project_id, PROJECT_SHARED_USER, sid,
                                    )
                                    break
                except Exception as e:
                    log.warning("Failed to prime Slack session from DB", error=str(e))

            # Use the project-shared sentinel user so we share the same
            # Claude Code --resume session with the web chat.
            project_lock = claude_runner.get_project_lock(self.project_id)
            accumulated = ""
            captured_session_id: str | None = None
            tool_calls: list[str] = []
            thinking_count = 0
            segments: list[dict] = []
            current_tools: list[str] = []
            current_thinking = 0
            last_phase = "activity"

            async with project_lock:
                async for event in claude_runner.run_stream(
                    project_id=self.project_id,
                    user_id=PROJECT_SHARED_USER,
                    message=text,
                ):
                    et = event.get("type")
                    if et == "session":
                        captured_session_id = event.get("session_id") or captured_session_id
                    elif et == "thinking":
                        thinking_count += 1
                        current_thinking += 1
                        last_phase = "activity"
                    elif et == "tool_use":
                        last_phase = "activity"
                        tname = event.get("tool", "")
                        tool_calls.append(tname)
                        current_tools.append(tname)
                        # Flush partial DB on tool calls so the web UI's
                        # activity panel grows in (near) real-time.
                        now_ms = time.time() * 1000
                        if assistant_msg_id and (now_ms - last_db_update_ms) >= DB_UPDATE_THROTTLE_MS:
                            last_db_update_ms = now_ms
                            # Build a snapshot that includes the current
                            # in-flight tools as a trailing activity segment.
                            snap_segments = list(segments)
                            if current_tools or current_thinking > 0:
                                snap_segments.append({
                                    "type": "activity",
                                    "tools": list(current_tools),
                                    "thinkingCount": current_thinking,
                                })
                            asyncio.create_task(self._partial_db_update(
                                assistant_msg_id, accumulated, snap_segments, tool_calls, thinking_count,
                            ))
                    elif et == "text":
                        if last_phase == "activity" and (current_tools or current_thinking > 0):
                            segments.append({"type": "activity", "tools": list(current_tools), "thinkingCount": current_thinking})
                            current_tools = []
                            current_thinking = 0
                        last_phase = "text"
                        chunk = event.get("content", "")
                        accumulated += chunk
                        if segments and segments[-1]["type"] == "text":
                            segments[-1]["content"] = segments[-1].get("content", "") + chunk
                        else:
                            segments.append({"type": "text", "content": chunk})
                        await self._throttled_update(channel, placeholder_ts, accumulated)
                        # Throttled DB update so the web UI sees streaming
                        # text without thrashing the DB.
                        now_ms = time.time() * 1000
                        if assistant_msg_id and (now_ms - last_db_update_ms) >= DB_UPDATE_THROTTLE_MS:
                            last_db_update_ms = now_ms
                            asyncio.create_task(self._partial_db_update(
                                assistant_msg_id, accumulated, segments, tool_calls, thinking_count,
                            ))
                    elif et == "result":
                        final = event.get("content") or accumulated
                        accumulated = final
                        captured_session_id = event.get("session_id") or captured_session_id
                    elif et == "error":
                        raise RuntimeError(event.get("content", "claude_runner error"))

                if current_tools or current_thinking > 0:
                    segments.append({"type": "activity", "tools": list(current_tools), "thinkingCount": current_thinking})

            # Final Slack update
            await self._final_update(channel, placeholder_ts, accumulated or "(no response)")

            # Final shared-conversation update — replaces the placeholder
            # in place via stable id, marks _processing: false.
            if assistant_msg_id:
                try:
                    async with async_session() as db:
                        await update_message_by_id(
                            db, self.project_id, assistant_msg_id,
                            {
                                "content": accumulated,
                                "segments": segments,
                                "toolCalls": tool_calls,
                                "thinkingCount": thinking_count,
                                "session_id": captured_session_id,
                                "_processing": False,
                            },
                        )
                except Exception as e:
                    log.warning("Failed to finalize Slack assistant message", error=str(e))

            asyncio.create_task(self._emoji_ack(channel, ts, "white_check_mark"))

        except asyncio.CancelledError:
            # Backend shutdown / reload — try to leave a useful message in
            # the Slack placeholder AND mark the shared conversation entry
            # as failed so the web UI doesn't show "thinking…" forever.
            if placeholder_ts:
                try:
                    await asyncio.shield(self.app.client.chat_update(
                        channel=channel,
                        ts=placeholder_ts,
                        text="⚠️ Backend restarted mid-response. Please send the message again.",
                    ))
                except Exception:
                    pass
            if assistant_msg_id:
                try:
                    async with async_session() as db:
                        await update_message_by_id(
                            db, self.project_id, assistant_msg_id,
                            {
                                "content": "⚠️ Backend restarted mid-response.",
                                "_processing": False,
                            },
                        )
                except Exception:
                    pass
            raise
        except Exception as e:
            log.error("Slack process_message failed", channel=channel, ts=ts, error=str(e))
            if placeholder_ts:
                try:
                    await self.app.client.chat_update(
                        channel=channel,
                        ts=placeholder_ts,
                        text=f"❌ Error: {str(e)[:500]}",
                    )
                except Exception:
                    pass
            if assistant_msg_id:
                try:
                    async with async_session() as db:
                        await update_message_by_id(
                            db, self.project_id, assistant_msg_id,
                            {
                                "content": f"❌ Error: {str(e)[:500]}",
                                "_processing": False,
                            },
                        )
                except Exception:
                    pass
            try:
                await self.app.client.reactions_add(channel=channel, timestamp=ts, name="x")
            except Exception:
                pass

    # ──────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────

    async def _partial_db_update(
        self,
        message_id: str,
        content: str,
        segments: list[dict],
        tool_calls: list[str],
        thinking_count: int,
    ) -> None:
        """Throttled DB update during streaming so the web UI sees progressive
        state via polling. Best-effort — failures are logged at debug level
        because the final update will replace whatever partial state landed."""
        try:
            async with async_session() as db:
                await update_message_by_id(
                    db, self.project_id, message_id,
                    {
                        "content": content,
                        "segments": segments,
                        "toolCalls": tool_calls,
                        "thinkingCount": thinking_count,
                        "_processing": True,
                    },
                )
        except Exception as e:
            log.debug("partial db update failed", error=str(e))

    async def _channel_is_linked(self, channel_id: str) -> bool:
        async with async_session() as db:
            result = await db.execute(
                select(SlackChannelLink).where(
                    SlackChannelLink.project_id == self.project_id,
                    SlackChannelLink.channel_id == channel_id,
                )
            )
            return result.scalar_one_or_none() is not None

    async def _fetch_user_name(self, user_id: str | None) -> str | None:
        if not user_id:
            return None
        try:
            resp = await self.app.client.users_info(user=user_id)
            data = resp.data if hasattr(resp, "data") else resp
            user = data.get("user") if isinstance(data, dict) else None
            if user:
                profile = user.get("profile") or {}
                return (
                    profile.get("display_name")
                    or user.get("real_name")
                    or user.get("name")
                )
        except Exception as e:
            log.debug("users_info failed", user=user_id, error=str(e))
        return None

    async def _fetch_channel_name(self, channel_id: str) -> str | None:
        try:
            resp = await self.app.client.conversations_info(channel=channel_id)
            data = resp.data if hasattr(resp, "data") else resp
            channel = data.get("channel") if isinstance(data, dict) else None
            if channel:
                return channel.get("name")
        except Exception as e:
            log.debug("conversations_info failed", channel=channel_id, error=str(e))
        return None

    async def _throttled_update(self, channel: str, placeholder_ts: str | None, text: str) -> None:
        if not placeholder_ts:
            return
        now = time.time() * 1000
        last = self._last_update_ms.get(placeholder_ts, 0)
        if now - last < CHAT_UPDATE_THROTTLE_MS:
            return
        self._last_update_ms[placeholder_ts] = now
        truncated = text[:MAX_SLACK_MESSAGE_CHARS]
        try:
            await self.app.client.chat_update(
                channel=channel, ts=placeholder_ts, text=truncated,
            )
        except Exception as e:
            log.debug("chat_update throttled failed", error=str(e))

    async def _final_update(self, channel: str, placeholder_ts: str | None, text: str) -> None:
        if not placeholder_ts:
            return
        truncated = text[:MAX_SLACK_MESSAGE_CHARS]
        try:
            await self.app.client.chat_update(
                channel=channel, ts=placeholder_ts, text=truncated,
            )
        except Exception as e:
            log.warning("final chat_update failed", error=str(e))
        self._last_update_ms.pop(placeholder_ts, None)

    async def _emoji_ack(self, channel: str, ts: str, name: str) -> None:
        try:
            await self.app.client.reactions_add(channel=channel, timestamp=ts, name=name)
        except Exception as e:
            # already_reacted is fine; everything else is just noise
            log.debug("reactions_add failed", channel=channel, ts=ts, name=name, error=str(e))
