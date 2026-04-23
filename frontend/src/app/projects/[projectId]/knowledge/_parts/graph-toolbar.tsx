"use client";

// Graph-view toolbar: layout-mode picker (Force/Circle/Grid/Tree/
// Clusters/Timeline), reset button, and entity-type filter chips with
// live counts. Extracted from page.tsx.

import { TYPE_COLORS, TYPE_LABELS, type GraphNode } from "./graph-layout";


const LAYOUT_MODES = ["force", "circle", "grid", "tree", "clusters", "timeline-layout"] as const;
const LAYOUT_LABELS: Record<string, string> = {
  force: "Force",
  circle: "Circle",
  grid: "Grid",
  tree: "Tree",
  clusters: "Clusters",
  "timeline-layout": "Timeline",
};


interface GraphToolbarProps {
  graphLayout: string;
  changeLayout: (layout: string) => void;
  activeFilters: Set<string>;
  toggleFilter: (type: string) => void;
  filteredNodes: GraphNode[];
}


export function GraphToolbar({
  graphLayout, changeLayout, activeFilters, toggleFilter, filteredNodes,
}: GraphToolbarProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap",
      gap: "4px 0", padding: "6px 12px",
      background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
      zIndex: 2, flexShrink: 0,
    }}>
      {LAYOUT_MODES.map((l) => (
        <button
          key={l}
          onClick={() => changeLayout(l)}
          style={{
            padding: "4px 10px", border: "none", borderRadius: 6,
            background: graphLayout === l ? "var(--green)" : "transparent",
            color: graphLayout === l ? "var(--dark)" : "#64748b",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
            fontFamily: "var(--font)", transition: "all 0.15s",
          }}
        >
          {LAYOUT_LABELS[l]}
        </button>
      ))}

      <div style={{ width: 1, height: 16, background: "#e2e8f0", margin: "0 8px" }} />

      <button
        onClick={() => changeLayout("force")}
        style={{
          padding: "4px 8px", border: "none", borderRadius: 6,
          background: "transparent", color: "#94a3b8",
          fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font)",
        }}
      >
        Reset
      </button>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {Object.entries(TYPE_LABELS).map(([type, label]) => {
          const active = activeFilters.has(type);
          const color = TYPE_COLORS[type];
          const count = filteredNodes.filter((n) => n.type === type).length;
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", border: "none", borderRadius: 4,
                background: active ? `${color}15` : "transparent",
                color: active ? color : "#94a3b8",
                fontSize: 10, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font)", transition: "all 0.15s",
                opacity: active ? 1 : 0.6,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: active ? color : "#cbd5e1",
              }} />
              {label}
              {active && count > 0 && (
                <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 2 }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
