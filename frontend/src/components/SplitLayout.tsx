"use client";

import { useRef, useState, useCallback } from "react";
import { usePersistedState } from "@/lib/persistedState";

interface SplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPercent?: number;
  minLeftPercent?: number;
  maxLeftPercent?: number;
  // Optional persistence key. If set, the split position is saved to
  // localStorage and restored on mount. Use a stable key to share the
  // ratio across pages, e.g. "split:chat".
  storageKey?: string;
}

export default function SplitLayout({
  left,
  right,
  defaultLeftPercent = 45,
  minLeftPercent = 25,
  maxLeftPercent = 75,
  storageKey,
}: SplitLayoutProps) {
  // Two state hooks so we don't pay the localStorage tax for callers
  // that don't pass a storageKey. The branch is decided once at mount.
  const [persistedLeftPercent, setPersistedLeftPercent] = usePersistedState<number>(
    storageKey || "__split_unused__",
    defaultLeftPercent,
  );
  const [localLeftPercent, setLocalLeftPercent] = useState(defaultLeftPercent);
  const leftPercent = storageKey ? persistedLeftPercent : localLeftPercent;
  const setLeftPercent = storageKey ? setPersistedLeftPercent : setLocalLeftPercent;
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(maxLeftPercent, Math.max(minLeftPercent, percent));
      // Round to avoid noisy localStorage writes (and to keep the value
      // simple when persisted).
      setLeftPercent(Math.round(clamped * 10) / 10);
    };

    const onMouseUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [minLeftPercent, maxLeftPercent]);

  return (
    <div ref={containerRef} className="content-area">
      <div style={{ flex: `0 0 ${leftPercent}%`, minWidth: 0, display: "flex" }}>
        {left}
      </div>
      <div
        className={`split-divider${dragging ? " dragging" : ""}`}
        onMouseDown={handleMouseDown}
      />
      <div style={{ flex: `0 0 ${100 - leftPercent}%`, minWidth: 0, display: "flex" }}>
        {right}
      </div>
    </div>
  );
}
