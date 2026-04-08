"use client";

import { useEffect, useState, useCallback } from "react";
import { getUnreadCounts, type UnreadCounts } from "./api";

const ZERO: UnreadCounts = {
  requirement: 0,
  gap: 0,
  constraint: 0,
  decision: 0,
  contradiction: 0,
  assumption: 0,
  scope: 0,
  stakeholder: 0,
  total: 0,
};

/**
 * Polls /findings/unread every `pollMs` milliseconds and exposes the
 * counts plus a `refresh()` callback for optimistic invalidation after
 * mutations (e.g. clicking "Mark all read" should immediately refresh).
 *
 * Pauses polling while the document is hidden so we don't burn requests
 * on background tabs.
 */
export function useUnreadCounts(projectId: string, pollMs = 15_000) {
  const [counts, setCounts] = useState<UnreadCounts>(ZERO);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await getUnreadCounts(projectId);
      setCounts(data);
    } catch {
      // Silent — leave previous value
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setCounts(ZERO);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try {
        const data = await getUnreadCounts(projectId);
        if (!cancelled) setCounts(data);
      } catch {
        /* ignore */
      }
    };
    tick(); // immediate fetch on mount
    const interval = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, pollMs]);

  return { counts, refresh };
}
