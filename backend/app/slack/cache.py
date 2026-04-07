"""LRU+TTL caches ported from OpenClaw's extensions/slack/src/monitor/.

Constants come from OpenClaw source:
- DEDUP_CACHE_TTL_MS = 60_000       (context.ts:143)
- DEDUP_CACHE_MAX_SIZE = 500        (context.ts:143)
- APP_MENTION_RETRY_TTL_MS = 60_000 (message-handler.ts:18)
- THREAD_TS_CACHE_TTL_MS = 60_000   (thread-resolution.ts:11)
- THREAD_TS_CACHE_MAX_SIZE = 500    (thread-resolution.ts:12)
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any

DEDUP_CACHE_TTL_MS = 60_000
DEDUP_CACHE_MAX_SIZE = 500
APP_MENTION_RETRY_TTL_MS = 60_000
THREAD_TS_CACHE_TTL_MS = 60_000
THREAD_TS_CACHE_MAX_SIZE = 500


def _now_ms() -> float:
    return time.time() * 1000


class DedupeCache:
    """LRU cache with TTL for (channel:ts) message deduplication.

    Ported from OpenClaw's createDedupeCache (context.ts:143). `check(key)`
    returns True if the key was already present (hit), False on first-seen
    (miss). Hits LRU-bump the key to the end; misses insert it.
    """

    def __init__(self, ttl_ms: int = DEDUP_CACHE_TTL_MS, max_size: int = DEDUP_CACHE_MAX_SIZE):
        self._ttl_ms = ttl_ms
        self._max_size = max_size
        # key -> expiration_ms
        self._items: OrderedDict[str, float] = OrderedDict()

    def check(self, key: str) -> bool:
        """Returns True if already seen (duplicate). Inserts/refreshes otherwise."""
        now = _now_ms()
        self._prune(now)
        if key in self._items:
            expires_at = self._items[key]
            if expires_at > now:
                # LRU-bump and report duplicate
                self._items.move_to_end(key)
                self._items[key] = now + self._ttl_ms
                return True
            # expired, fall through to fresh insert
            del self._items[key]
        self._items[key] = now + self._ttl_ms
        self._items.move_to_end(key)
        # Enforce max size
        while len(self._items) > self._max_size:
            self._items.popitem(last=False)
        return False

    def _prune(self, now: float) -> None:
        # Evict at most a handful of expired entries per call (amortized).
        expired: list[str] = []
        for k, expires in self._items.items():
            if expires <= now:
                expired.append(k)
            else:
                break  # OrderedDict preserves insertion order, roughly by expiry
        for k in expired:
            self._items.pop(k, None)


class AppMentionRetryCache:
    """Two dicts of key -> expiration_ms, ported from OpenClaw's
    appMentionRetryKeys + appMentionDispatchedKeys in message-handler.ts:18-207.

    Solves the Slack race where `message` and `app_mention` events arrive
    for the same post in non-deterministic order. Workflow:
    - On `message` arrival, call `remember_retry(key)` to prime the retry slot.
    - On `app_mention` arrival, if `consume_retry(key)` returns True, allow
      exactly ONE retry through the dedup cache.
    - Once dispatched, call `mark_dispatched(key)`. Subsequent `message`
      events with the same key should then see `was_dispatched == True` and
      be dropped as duplicates.
    """

    def __init__(self, ttl_ms: int = APP_MENTION_RETRY_TTL_MS):
        self._ttl_ms = ttl_ms
        self._retry: dict[str, float] = {}
        self._dispatched: dict[str, float] = {}

    def _prune(self, now: float) -> None:
        for d in (self._retry, self._dispatched):
            expired = [k for k, e in d.items() if e <= now]
            for k in expired:
                d.pop(k, None)

    def remember_retry(self, key: str) -> None:
        now = _now_ms()
        self._prune(now)
        self._retry[key] = now + self._ttl_ms

    def consume_retry(self, key: str) -> bool:
        now = _now_ms()
        self._prune(now)
        expires = self._retry.pop(key, None)
        return expires is not None and expires > now

    def mark_dispatched(self, key: str) -> None:
        now = _now_ms()
        self._prune(now)
        self._dispatched[key] = now + self._ttl_ms

    def was_dispatched(self, key: str) -> bool:
        now = _now_ms()
        self._prune(now)
        expires = self._dispatched.get(key)
        return expires is not None and expires > now


class ThreadTsCache:
    """LRU+TTL cache for thread-ts resolver results, with inflight dedup.

    Ported from OpenClaw's thread-resolution.ts:11-118. Negative caching
    (storing `None` for missing/failed lookups) prevents thrashing the API
    on permanently-broken thread metadata.
    """

    def __init__(
        self,
        ttl_ms: int = THREAD_TS_CACHE_TTL_MS,
        max_size: int = THREAD_TS_CACHE_MAX_SIZE,
    ):
        self._ttl_ms = ttl_ms
        self._max_size = max_size
        # key -> (value_or_None, expires_at_ms)
        self._items: OrderedDict[str, tuple[str | None, float]] = OrderedDict()
        # key -> asyncio.Future (inflight dedup)
        self.inflight: dict[str, Any] = {}

    def get(self, key: str) -> tuple[bool, str | None]:
        """Returns (hit, value). If `hit` is False, value is None (miss).
        If `hit` is True, value may still be None (negative-cached miss)."""
        now = _now_ms()
        entry = self._items.get(key)
        if entry is None:
            return (False, None)
        value, expires_at = entry
        if expires_at <= now:
            del self._items[key]
            return (False, None)
        self._items.move_to_end(key)
        return (True, value)

    def set(self, key: str, value: str | None) -> None:
        now = _now_ms()
        if key in self._items:
            del self._items[key]
        self._items[key] = (value, now + self._ttl_ms)
        self._items.move_to_end(key)
        while len(self._items) > self._max_size:
            self._items.popitem(last=False)
