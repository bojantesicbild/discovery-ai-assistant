"use client";

// Sortable table view of the filtered graph. One row per node, click
// to select. Extracted from page.tsx.

import { TYPE_COLORS, TYPE_LABELS, type GraphNode } from "./graph-layout";


const COLS = [
  { key: "type", label: "Type" },
  { key: "id", label: "ID" },
  { key: "label", label: "Name" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "connections", label: "Links" },
  { key: "date", label: "Date" },
] as const;


interface ListViewProps {
  filteredNodes: GraphNode[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode) => void;
  sortCol: string;
  setSortCol: (col: string) => void;
  sortAsc: boolean;
  setSortAsc: (asc: boolean) => void;
}


export function ListView({
  filteredNodes, selectedNode, onSelectNode,
  sortCol, setSortCol, sortAsc, setSortAsc,
}: ListViewProps) {
  const sorted = [...filteredNodes].sort((a, b) => {
    let av: string | number = "", bv: string | number = "";
    if (sortCol === "connections") { av = a.connections; bv = b.connections; }
    else if (sortCol === "status") { av = a.meta?.status || ""; bv = b.meta?.status || ""; }
    else if (sortCol === "priority") { av = a.meta?.priority || ""; bv = b.meta?.priority || ""; }
    else if (sortCol === "date") { av = a.meta?.date || "zzzz"; bv = b.meta?.date || "zzzz"; }
    else { av = (a as unknown as Record<string, string | number>)[sortCol] || ""; bv = (b as unknown as Record<string, string | number>)[sortCol] || ""; }
    if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e2e8f0", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
            {COLS.map((col) => (
              <th
                key={col.key}
                onClick={() => {
                  if (sortCol === col.key) setSortAsc(!sortAsc);
                  else { setSortCol(col.key); setSortAsc(true); }
                }}
                style={{
                  textAlign: "left", padding: "10px 12px", fontWeight: 600,
                  color: sortCol === col.key ? "#00E5A0" : "#64748b",
                  cursor: "pointer", userSelect: "none", fontSize: 11,
                  textTransform: "uppercase", letterSpacing: "0.5px",
                }}
              >
                {col.label}
                {sortCol === col.key && <span style={{ marginLeft: 4 }}>{sortAsc ? "↑" : "↓"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((n) => {
            const color = TYPE_COLORS[n.type] || "#6b7280";
            const isSelected = selectedNode?.id === n.id;
            return (
              <tr
                key={n.id}
                onClick={() => onSelectNode(n)}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  background: isSelected ? "#f0fdf8" : undefined,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f8fafc"; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
              >
                <td style={{ padding: "8px 12px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                    background: `${color}15`, color,
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
                    {TYPE_LABELS[n.type] || n.type}
                  </span>
                </td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#64748b", fontSize: 11 }}>{n.id}</td>
                <td style={{ padding: "8px 12px", fontWeight: 500, color: "#0f172a", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</td>
                <td style={{ padding: "8px 12px" }}>
                  {n.meta?.status && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                      background: n.meta.status === "confirmed" ? "#d1fae5" : n.meta.status === "proposed" ? "#FEF3C7" : "#f1f5f9",
                      color: n.meta.status === "confirmed" ? "#00E5A0" : n.meta.status === "proposed" ? "#D97706" : "#64748b",
                    }}>
                      {n.meta.status}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {n.meta?.priority && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                      background: n.meta.priority === "must" ? "#fee2e2" : n.meta.priority === "should" ? "#FEF3C7" : "#eff6ff",
                      color: n.meta.priority === "must" ? "#EF4444" : n.meta.priority === "should" ? "#D97706" : "#3B82F6",
                    }}>
                      {n.meta.priority.toUpperCase()}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 12px", color: "#64748b", textAlign: "center" }}>{n.connections}</td>
                <td style={{ padding: "8px 12px", color: "#94a3b8", fontSize: 11 }}>{n.meta?.date || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
