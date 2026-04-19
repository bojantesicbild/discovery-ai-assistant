"use client";

// Timeline scrubber bar for the graph view: play/pause button, dot
// track, live stats (entity count + delta since previous step), and
// "Show All" reset. Extracted from page.tsx.

import type { GraphNode } from "./graph-layout";


interface TimelineScrubberProps {
  timelineDates: string[];
  timelineStep: number;
  timelinePlaying: boolean;
  filteredNodes: GraphNode[];
  filteredEdgeCount: number;
  nodes: GraphNode[];
  setStep: (n: number) => void;
  togglePlay: () => void;
  showAll: () => void;
}


export function TimelineScrubber({
  timelineDates, timelineStep, timelinePlaying,
  filteredNodes, filteredEdgeCount, nodes,
  setStep, togglePlay, showAll,
}: TimelineScrubberProps) {
  if (timelineDates.length === 0) return null;
  const nodeDate = (n: GraphNode) => (n.meta?.created_at || n.meta?.date || "").slice(0, 10);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
      background: "#f8fafc", borderTop: "1px solid #e2e8f0", flexShrink: 0,
    }}>
      <button
        onClick={togglePlay}
        style={{
          width: 28, height: 28, borderRadius: "50%", border: "1px solid #e2e8f0",
          background: timelinePlaying ? "#00E5A0" : "#fff",
          color: timelinePlaying ? "#fff" : "#64748b", fontSize: 12, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >
        {timelinePlaying ? "❚❚" : "▶"}
      </button>

      <div style={{ flex: 1, position: "relative", height: 32, display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "#e2e8f0", borderRadius: 1 }} />
        <div style={{
          position: "absolute", left: 0, height: 2, borderRadius: 1,
          background: "#00E5A0", transition: "width 0.3s ease",
          width: timelineStep < 0
            ? "100%"
            : `${(timelineStep / Math.max(timelineDates.length - 1, 1)) * 100}%`,
        }} />
        {timelineDates.map((date, i) => {
          const left = `${(i / Math.max(timelineDates.length - 1, 1)) * 100}%`;
          const isReached = timelineStep < 0 || i <= timelineStep;
          const isActive = i === timelineStep;
          return (
            <div
              key={date}
              onClick={() => setStep(i)}
              title={date}
              style={{
                position: "absolute", left, transform: "translateX(-50%)",
                width: isActive ? 24 : 18, height: isActive ? 24 : 18,
                borderRadius: "50%", cursor: "pointer",
                background: isActive ? "#00E5A0" : isReached ? "#00E5A0" : "#e2e8f0",
                border: isActive ? "2px solid #fff" : "2px solid #f8fafc",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 700, color: isReached ? "#1A1A1A" : "#94a3b8",
                transition: "all 0.3s ease", zIndex: isActive ? 2 : 1,
                boxShadow: isActive ? "0 0 0 3px rgba(0,229,160,0.2)" : "none",
              }}
            >
              {i + 1}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap", minWidth: 120, textAlign: "right" }}>
        {(() => {
          if (timelineStep < 0) {
            return `${filteredNodes.length} entities · ${filteredEdgeCount} edges`;
          }
          const cutoff = timelineDates[timelineStep];
          const visCount = nodes.filter((n) => { const d = nodeDate(n); return !d || d <= cutoff; }).length;
          const prevCutoff = timelineStep > 0 ? timelineDates[timelineStep - 1] : null;
          const prevCount = prevCutoff ? nodes.filter((n) => { const d = nodeDate(n); return !d || d <= prevCutoff; }).length : 0;
          const diff = visCount - prevCount;
          return (
            <>
              {visCount} entities
              {diff > 0 && (
                <span style={{ color: "#00E5A0", marginLeft: 8, fontWeight: 600 }}>+{diff} new</span>
              )}
            </>
          );
        })()}
      </div>

      {timelineStep >= 0 && (
        <button
          onClick={showAll}
          style={{
            padding: "3px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
            background: "#fff", color: "#64748b",
            fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font)",
          }}
        >
          Show All
        </button>
      )}
    </div>
  );
}
