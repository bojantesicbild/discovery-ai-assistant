"""Thread-ts fallback resolver ported from OpenClaw thread-resolution.ts.

When a message arrives with `parent_user_id` set but `thread_ts` missing
(a Slack delivery race), we fall back to `conversations.history` with
latest=ts, oldest=ts, inclusive=True, limit=1 to fetch the full message
metadata and extract the correct thread_ts.

Results are cached with a short TTL (60s); negative results (missing or
failed lookups) are also cached to avoid hammering the API for permanently
broken thread metadata. Concurrent calls for the same (channel, ts) share
one in-flight Future.
"""

from __future__ import annotations

import asyncio
import structlog
from typing import Any

from app.slack.cache import ThreadTsCache

log = structlog.get_logger()

_cache = ThreadTsCache()


async def resolve_thread_ts(client: Any, message: dict) -> dict:
    """Enrich a Slack message event with `thread_ts` if it's missing.

    Only runs the fallback when parent_user_id is set AND thread_ts is
    missing AND ts is present. Returns the (possibly enriched) message dict.
    """
    parent_user_id = message.get("parent_user_id")
    thread_ts = message.get("thread_ts")
    ts = message.get("ts")
    channel = message.get("channel")

    if not parent_user_id or thread_ts or not ts or not channel:
        return message

    cache_key = f"{channel}:{ts}"

    # Cache check (positive or negative)
    hit, cached = _cache.get(cache_key)
    if hit:
        if cached:
            return {**message, "thread_ts": cached}
        return message

    # In-flight dedup
    pending = _cache.inflight.get(cache_key)
    if pending is None:
        loop = asyncio.get_event_loop()
        pending = loop.create_future()
        _cache.inflight[cache_key] = pending
        try:
            resolved = await _fetch_thread_ts(client, channel, ts)
        except Exception as e:
            log.warning("thread_ts fallback failed", channel=channel, ts=ts, error=str(e))
            resolved = None
        _cache.set(cache_key, resolved)
        _cache.inflight.pop(cache_key, None)
        pending.set_result(resolved)
    else:
        resolved = await pending

    if resolved:
        return {**message, "thread_ts": resolved}
    return message


async def _fetch_thread_ts(client: Any, channel: str, ts: str) -> str | None:
    """Call conversations.history to fetch the message at `ts` and extract
    its thread_ts. Ported from OpenClaw thread-resolution.ts:25-31."""
    response = await client.conversations_history(
        channel=channel,
        latest=ts,
        oldest=ts,
        inclusive=True,
        limit=1,
    )
    messages = response.get("messages", []) if isinstance(response, dict) else (
        response.data.get("messages", []) if hasattr(response, "data") else []
    )
    if not messages:
        return None
    first = messages[0]
    return first.get("thread_ts") or None
