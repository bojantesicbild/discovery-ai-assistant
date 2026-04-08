"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Like `useState` but persists to localStorage. Per-key, per-browser, per-user.
 *
 * SSR-safe: returns `defaultValue` on the server and during the first client
 * render, then hydrates from localStorage in `useEffect`. This avoids hydration
 * mismatches at the cost of a one-frame flicker on first paint — fine for
 * preference toggles but don't use it for content that must match SSR exactly.
 *
 * Use `options.serialize` / `options.deserialize` for non-JSON types like
 * `Set` or `Map`.
 *
 * @example
 *   const [view, setView] = usePersistedState<"graph" | "wiki">(
 *     `knowledge:view:${projectId}`,
 *     "graph"
 *   );
 *
 * @example with a Set
 *   const [filters, setFilters] = usePersistedState<Set<string>>(
 *     `knowledge:filters:${projectId}`,
 *     new Set(["a", "b"]),
 *     {
 *       serialize: (s) => JSON.stringify([...s]),
 *       deserialize: (r) => new Set(JSON.parse(r)),
 *     }
 *   );
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (raw: string) => T;
  },
): [T, Dispatch<SetStateAction<T>>] {
  const serialize = options?.serialize ?? JSON.stringify;
  const deserialize = options?.deserialize ?? JSON.parse;

  const [value, setValue] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount (or when key changes — e.g. switching projects)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        setValue(deserialize(raw));
      } else {
        setValue(defaultValue);
      }
    } catch {
      // localStorage may be disabled (Safari private mode) or the stored
      // value may be malformed — fall back to default and ignore.
    }
    setHydrated(true);
    // We intentionally exclude defaultValue, serialize, deserialize from deps:
    // they're often inline objects/functions and would re-trigger on every render.
    // The key is the only thing that should re-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on change — but only after the first hydration so we don't
  // overwrite a stored value with the default before we've read it.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // QuotaExceededError or storage disabled — silently drop.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, hydrated]);

  return [value, setValue];
}
