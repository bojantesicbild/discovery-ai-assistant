"""Channel inbound debouncer ported from OpenClaw message-handler.ts:71-248.

Combines consecutive short messages from the same sender in the same thread
into a single LLM dispatch, within a 2000 ms window. Cancels and restarts
the timer on each new message.

Build key algorithm (OpenClaw message-handler.ts:71-88):

    thread_ts present        → "channel:thread_ts"
    parent_user_id + no tts  → "channel:maybe-thread:ts"   (temp unique)
    non-DM top-level         → "channel:ts"                (per-message, NOT per-user!)
    DM top-level             → "channel"                   (batches short msgs)

Plus `:sender_id` suffix. Critical: non-DM top-level messages are scoped
per-message to prevent "concurrent top-level messages from the same sender
sharing a key and getting merged into a single reply on the wrong thread".
"""

from __future__ import annotations

import asyncio
import structlog
from typing import Any, Awaitable, Callable

log = structlog.get_logger()

DEBOUNCE_WINDOW_MS = 2000


def is_slack_direct_message_channel(channel: str | None) -> bool:
    """Slack DM channels start with 'D' (D123...). Group DMs start with 'G'
    or 'C' depending on workspace; we're conservative and only treat 'D' as DM."""
    return bool(channel) and channel.startswith("D")


def build_debounce_key(message: dict, account_id: str) -> str:
    """Port of OpenClaw buildSlackDebounceKey (message-handler.ts:71-88)."""
    channel = message.get("channel") or ""
    thread_ts = message.get("thread_ts")
    parent_user_id = message.get("parent_user_id")
    ts = message.get("ts")
    sender_id = message.get("user") or message.get("bot_id") or "unknown"

    if thread_ts:
        thread_key = f"{channel}:{thread_ts}"
    elif parent_user_id and ts:
        thread_key = f"{channel}:maybe-thread:{ts}"
    elif ts and not is_slack_direct_message_channel(channel):
        thread_key = f"{channel}:{ts}"
    else:
        thread_key = channel

    return f"slack:{account_id}:{thread_key}:{sender_id}"


class ChannelInboundDebouncer:
    """Per-key debouncer with cancel-and-restart semantics.

    Usage:
        debouncer = ChannelInboundDebouncer(window_ms=2000, on_flush=my_handler)
        debouncer.enqueue(key, message)
    """

    def __init__(
        self,
        window_ms: int,
        on_flush: Callable[[str, list[dict]], Awaitable[None]],
    ):
        self.window_ms = window_ms
        self.on_flush = on_flush
        # key -> list of queued messages
        self._queues: dict[str, list[dict]] = {}
        # key -> asyncio.Task (the pending timer)
        self._timers: dict[str, asyncio.Task] = {}

    def enqueue(self, key: str, message: dict) -> None:
        """Add a message to the queue for this key and (re)start the timer."""
        self._queues.setdefault(key, []).append(message)
        # Cancel any pending timer for this key
        existing = self._timers.get(key)
        if existing and not existing.done():
            existing.cancel()
        # Start a fresh timer
        self._timers[key] = asyncio.create_task(self._wait_and_flush(key))

    async def _wait_and_flush(self, key: str) -> None:
        try:
            await asyncio.sleep(self.window_ms / 1000)
        except asyncio.CancelledError:
            return
        await self.flush_key(key)

    async def flush_key(self, key: str) -> None:
        """Synchronously flush a queue for a key (e.g. on shutdown or
        before processing an undebounceable message)."""
        messages = self._queues.pop(key, None)
        self._timers.pop(key, None)
        if not messages:
            return
        try:
            await self.on_flush(key, messages)
        except Exception as e:
            log.error("debouncer on_flush error", key=key, error=str(e))

    async def shutdown(self) -> None:
        """Cancel all pending timers; flush all queued messages."""
        keys = list(self._queues.keys())
        for key in keys:
            t = self._timers.get(key)
            if t and not t.done():
                t.cancel()
        for key in keys:
            await self.flush_key(key)


def combine_messages(messages: list[dict]) -> dict:
    """Combine a list of queued messages into one synthetic message.

    Port of OpenClaw's behaviour: metadata from the last message, text
    joined with newlines from all non-empty texts.
    """
    if not messages:
        return {}
    last = messages[-1]
    combined_text = "\n".join(
        m.get("text", "").strip() for m in messages if (m.get("text") or "").strip()
    )
    return {**last, "text": combined_text}
