"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * IntersectionObserver wrapper for "load older messages" scroll-up detection.
 *
 * The classic gotcha is the stale-closure trap: a one-shot observer captures
 * `onEnter` from the first render and keeps calling that snapshot. We dodge
 * it by storing the latest callback in a ref and reading it inside the
 * observer fn — the observer outlives renders, the callback always runs the
 * current closure.
 *
 * Returns a ref callback. Attach it to the sentinel <div> at the top of the
 * scrolling list. When the sentinel intersects the viewport (within
 * `rootMargin`), `onEnter` fires once per intersection — debounced via the
 * `enabled` gate, so a fetch in flight won't trigger a second one.
 */
export function useTopSentinel(opts: {
  onEnter: () => void;
  enabled: boolean;
  rootMargin?: string;
}): (el: HTMLDivElement | null) => void {
  const { onEnter, enabled, rootMargin = "200px 0px 0px 0px" } = opts;
  const onEnterRef = useRef(onEnter);
  const enabledRef = useRef(enabled);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { onEnterRef.current = onEnter; }, [onEnter]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current && elRef.current) {
      observerRef.current.unobserve(elRef.current);
    }
    elRef.current = el;
    if (!el) return;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && enabledRef.current) {
              onEnterRef.current();
            }
          }
        },
        { rootMargin },
      );
    }
    observerRef.current.observe(el);
  }, [rootMargin]);

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  return setRef;
}
