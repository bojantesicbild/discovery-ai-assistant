"use client";

import { useRef, useState, useCallback } from "react";

interface SplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPercent?: number;
  minLeftPercent?: number;
  maxLeftPercent?: number;
}

export default function SplitLayout({
  left,
  right,
  defaultLeftPercent = 45,
  minLeftPercent = 25,
  maxLeftPercent = 75,
}: SplitLayoutProps) {
  const [leftPercent, setLeftPercent] = useState(defaultLeftPercent);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPercent(Math.min(maxLeftPercent, Math.max(minLeftPercent, percent)));
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
