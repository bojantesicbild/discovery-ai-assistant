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
    <div className="kg-toolbar">
      {LAYOUT_MODES.map((l) => (
        <button
          key={l}
          type="button"
          className={`kg-layout-btn${graphLayout === l ? " active" : ""}`}
          onClick={() => changeLayout(l)}
        >
          {LAYOUT_LABELS[l]}
        </button>
      ))}

      <div className="kg-toolbar-divider" />

      <button type="button" className="kg-reset-btn" onClick={() => changeLayout("force")}>
        Reset
      </button>

      <div className="kg-filter-cluster">
        {Object.entries(TYPE_LABELS).map(([type, label]) => {
          const active = activeFilters.has(type);
          const color = TYPE_COLORS[type];
          const count = filteredNodes.filter((n) => n.type === type).length;
          return (
            <button
              key={type}
              type="button"
              className={`kg-filter-btn${active ? " active" : ""}`}
              style={active ? { color, background: `${color}14` } : undefined}
              onClick={() => toggleFilter(type)}
            >
              <span
                className="kg-filter-dot"
                style={{ background: active ? color : undefined }}
              />
              {label}
              {active && count > 0 && (
                <span className="kg-filter-count">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
