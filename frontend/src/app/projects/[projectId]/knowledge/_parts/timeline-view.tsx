"use client";

// Vertical-timeline view: nodes grouped by meta.date (most recent
// first), plus an "Undated" bucket at the bottom. Extracted from
// page.tsx; the row markup was duplicated in the original, so I
// pulled it into a local TimelineRow to keep the two buckets in sync.

import { TYPE_COLORS, TYPE_LABELS, type GraphNode } from "./graph-layout";


interface TimelineViewProps {
  filteredNodes: GraphNode[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode) => void;
}


function TimelineRow({
  node, isSelected, onSelect,
}: {
  node: GraphNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = TYPE_COLORS[node.type] || "#6b7280";
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", borderRadius: 8,
        border: `1px solid ${isSelected ? "#00E5A0" : "#e2e8f0"}`,
        background: isSelected ? "#f0fdf8" : "#fff",
        cursor: "pointer", transition: "all 0.15s",
        borderLeft: `3px solid ${color}`,
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f8fafc"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isSelected ? "#f0fdf8" : "#fff"; }}
    >
      <span style={{
        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
        background: `${color}15`, color, textTransform: "uppercase",
      }}>
        {TYPE_LABELS[node.type] || node.type}
      </span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.label}
      </span>
      {node.meta?.status && (
        <span style={{
          fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
          background: node.meta.status === "confirmed" ? "#d1fae5" : "#f1f5f9",
          color: node.meta.status === "confirmed" ? "#00E5A0" : "#64748b",
        }}>
          {node.meta.status}
        </span>
      )}
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{node.connections} links</span>
    </div>
  );
}


export function TimelineView({ filteredNodes, selectedNode, onSelectNode }: TimelineViewProps) {
  const dated = filteredNodes.filter((n) => n.meta?.date);
  const undated = filteredNodes.filter((n) => !n.meta?.date);
  const grouped = new Map<string, GraphNode[]>();
  for (const n of dated) {
    const d = n.meta.date;
    if (!grouped.has(d)) grouped.set(d, []);
    grouped.get(d)!.push(n);
  }
  const sortedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
      <div style={{ position: "relative", paddingLeft: 28 }}>
        <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: "#e2e8f0" }} />

        {sortedDates.map((date) => (
          <div key={date} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginLeft: -28 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", background: "#00E5A0",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "3px solid #fff", boxShadow: "0 0 0 2px #e2e8f0", zIndex: 1,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{date}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {grouped.get(date)!.length} item{grouped.get(date)!.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {grouped.get(date)!.map((n) => (
                <TimelineRow
                  key={n.id}
                  node={n}
                  isSelected={selectedNode?.id === n.id}
                  onSelect={() => onSelectNode(n)}
                />
              ))}
            </div>
          </div>
        ))}

        {undated.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginLeft: -28 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", background: "#94a3b8",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "3px solid #fff", boxShadow: "0 0 0 2px #e2e8f0", zIndex: 1,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>Undated</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {undated.length} item{undated.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {undated.map((n) => (
                <TimelineRow
                  key={n.id}
                  node={n}
                  isSelected={selectedNode?.id === n.id}
                  onSelect={() => onSelectNode(n)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
