"use client";

// Slide-in detail panel for the knowledge graph. Renders the selected
// node's meta, description, source quote, connected nodes, and edge
// labels. Extracted from page.tsx so the canvas orchestration file
// stays focused on layout + render-loop.

import { useMemo } from "react";
import { TYPE_COLORS, TYPE_LABELS, type GraphNode, type GraphEdge } from "./graph-layout";


interface NodeDetailPanelProps {
  node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  projectId: string;
  onClose: () => void;
  onSelect: (node: GraphNode) => void;
}


export function NodeDetailPanel({
  node, nodes, edges, projectId, onClose, onSelect,
}: NodeDetailPanelProps) {
  const selectedEdges = useMemo(
    () => edges.filter((e) => e.source === node.id || e.target === node.id),
    [edges, node.id],
  );
  const connectedNodes = useMemo(
    () => [...new Map<string, GraphNode>(selectedEdges.map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const found = nodes.find((n) => n.id === otherId);
      return [otherId, found] as [string, GraphNode];
    }).filter((entry): entry is [string, GraphNode] => entry[1] != null)).values()],
    [selectedEdges, nodes, node.id],
  );

  return (
    <>
      {/* Panel header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--gray-100)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: TYPE_COLORS[node.type] || "#6b7280",
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: TYPE_COLORS[node.type] || "#64748b" }}>
            {TYPE_LABELS[node.type] || node.type}
          </span>
          {(node.meta?.confidence === "low" || node.meta?.status === "pending") && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#FEF3C7", color: "#D97706", marginLeft: 4 }}>
              GAP
            </span>
          )}
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", fontSize: 16, color: "#94a3b8", cursor: "pointer", padding: "2px 6px",
        }}>
          x
        </button>
      </div>

      {/* minWidth:0 lets this flex child shrink below its content's
          intrinsic width so long words/URLs wrap instead of forcing
          the panel wider. overflowWrap covers the same for text. */}
      <div style={{ padding: 16, flex: 1, overflow: "auto", minWidth: 0, overflowWrap: "break-word" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--dark)", margin: "0 0 8px", lineHeight: 1.3, overflowWrap: "break-word" }}>
          {node.label}
        </h2>

        {/* Link to document/requirement */}
        {node.id.match(/^BR-\d+/) && (
          <a
            href={`/projects/${projectId}/chat`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 600, color: "#00E5A0",
              textDecoration: "none", padding: "3px 8px",
              background: "#d1fae5", borderRadius: 6, marginBottom: 12,
            }}
          >
            View in Requirements
          </a>
        )}
        {node.id.match(/^GAP-\d+/) && (
          <a
            href={`/projects/${projectId}/chat`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 600, color: "#D97706",
              textDecoration: "none", padding: "3px 8px",
              background: "#FEF3C7", borderRadius: 6, marginBottom: 12,
            }}
          >
            View in Gaps
          </a>
        )}
        {node.id.match(/^CON-\d+/) && (
          <a
            href={`/projects/${projectId}/chat`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 600, color: "#F97316",
              textDecoration: "none", padding: "3px 8px",
              background: "#FFF7ED", borderRadius: 6, marginBottom: 12,
            }}
          >
            View in Constraints
          </a>
        )}

        {/* Meta chips */}
        {Object.keys(node.meta).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
            {Object.entries(node.meta).map(([key, value]) => {
              if (!value) return null;
              const chipColor = key === "priority" ? (value === "must" ? "#EF4444" : value === "should" ? "#F59E0B" : "#3B82F6")
                : key === "status" ? (value === "confirmed" ? "#00E5A0" : value === "proposed" ? "#F59E0B" : "#6b7280")
                : key === "confidence" ? (value === "high" ? "#00E5A0" : value === "low" ? "#EF4444" : "#F59E0B")
                : "#6b7280";
              return (
                <span key={key} style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                  background: `${chipColor}15`, color: chipColor,
                  // Prevent long values (e.g., "date: 2026-04-22T09:13:42Z")
                  // from producing a chip wider than the panel.
                  maxWidth: "100%", overflowWrap: "anywhere",
                }}>
                  {key.replace(/_/g, " ")}: {value}
                </span>
              );
            })}
          </div>
        )}

        {/* Description from meta */}
        {node.meta.description && (
          <div style={{ fontSize: 12, color: "var(--gray-600)", lineHeight: 1.6, marginBottom: 14, padding: "10px 12px", background: "var(--gray-50)", borderRadius: 8 }}>
            {node.meta.description}
          </div>
        )}

        {/* Source quote — skip if it looks like table data */}
        {node.meta.source_quote && !node.meta.source_quote.includes("|") && (
          <div style={{ fontSize: 12, fontStyle: "italic", color: "#4b5563", padding: "8px 12px", borderLeft: "3px solid var(--green)", background: "#f0fdf8", borderRadius: "0 6px 6px 0", marginBottom: 14, lineHeight: 1.5 }}>
            &ldquo;{node.meta.source_quote}&rdquo;
          </div>
        )}

        {/* Connections — unique linked nodes */}
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--gray-400)", marginBottom: 4 }}>
            Connected To ({connectedNodes.length})
          </h3>
          <p style={{ fontSize: 10, color: "var(--gray-400)", margin: "0 0 8px" }}>Nodes directly linked via wikilinks</p>
          {connectedNodes.length === 0 && (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>No connections</p>
          )}
          {connectedNodes.map((cn) => (
            <button
              key={cn.id}
              onClick={() => onSelect(cn)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "8px 10px", marginBottom: 4, background: "var(--gray-50)",
                border: "1px solid var(--gray-200)", borderRadius: 8, fontSize: 12,
                color: "var(--dark)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font)",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--green)"; e.currentTarget.style.background = "#f0fdf8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--gray-200)"; e.currentTarget.style.background = "var(--gray-50)"; }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: TYPE_COLORS[cn.type] || "#6b7280", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{cn.label}</span>
              <span style={{ fontSize: 9, color: TYPE_COLORS[cn.type], fontWeight: 600, textTransform: "uppercase", flexShrink: 0 }}>{cn.type}</span>
            </button>
          ))}
        </div>

        {/* Relationships — edges with context */}
        {selectedEdges.length > 0 && (
          <div>
            <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--gray-400)", marginBottom: 4 }}>
              Edges ({selectedEdges.length})
            </h3>
            <p style={{ fontSize: 10, color: "var(--gray-400)", margin: "0 0 8px" }}>How this node is referenced in documents</p>
            {selectedEdges.map((e, i) => {
              const otherId = e.source === node.id ? e.target : e.source;
              const other = nodes.find((n) => n.id === otherId);
              const direction = e.source === node.id ? "links to" : "linked from";
              let cleanLabel = e.label && !e.label.includes("|") ? e.label.trim() : "";
              if (cleanLabel && other) {
                const otherLabel = (other.label || "").toLowerCase();
                const cl = cleanLabel.toLowerCase();
                if (cl.startsWith(otherId.toLowerCase()) || cl === otherLabel || cl.length < 5) {
                  cleanLabel = "";
                }
              }
              return (
                <div key={i} style={{
                  padding: "5px 10px", marginBottom: 2, background: "var(--gray-50)",
                  border: "1px solid var(--gray-100)", borderRadius: 6, fontSize: 12, lineHeight: 1.4,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: TYPE_COLORS[other?.type || ""] || "#6b7280", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: "var(--dark)", flex: 1, fontSize: 11 }}>{other?.label || otherId}</span>
                    <span style={{ fontSize: 9, color: "var(--gray-400)" }}>{direction}</span>
                  </div>
                  {cleanLabel && (
                    <div style={{ fontSize: 10, color: "var(--gray-500)", fontStyle: "italic", marginTop: 1, paddingLeft: 12 }}>
                      {cleanLabel.length > 80 ? cleanLabel.slice(0, 80) + "..." : cleanLabel}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
