"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { getKnowledgeGraph } from "@/lib/api";

/* ---------- types ---------- */
interface GraphNode {
  id: string;
  label: string;
  type: string;
  meta: Record<string, string>;
  // layout fields
  x: number;
  y: number;
  vx: number;
  vy: number;
  connections: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

/* ---------- constants ---------- */
const TYPE_COLORS: Record<string, string> = {
  requirement: "#059669",
  decision: "#2563eb",
  stakeholder: "#7c3aed",
  contradiction: "#EF4444",
  constraint: "#0891b2",
  gap: "#F59E0B",
  document: "#6b7280",
};

const TYPE_LABELS: Record<string, string> = {
  requirement: "Requirement",
  decision: "Decision",
  stakeholder: "People",
  contradiction: "Contradiction",
  constraint: "Constraint",
  gap: "Gap",
  document: "Document",
};

/* ---------- force layout ---------- */
function runForces(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const alpha = 0.3;
  const repulsion = 3000;
  const attraction = 0.005;
  const centering = 0.01;
  const damping = 0.85;

  // Build lookup
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Repulsion (all pairs)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = repulsion / (dist * dist);
      const fx = (dx / dist) * force * alpha;
      const fy = (dy / dist) * force * alpha;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Attraction along edges
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const fx = dx * attraction * alpha;
    const fy = dy * attraction * alpha;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Centering
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * centering * alpha;
    n.vy += (cy - n.y) * centering * alpha;
  }

  // Apply velocity
  for (const n of nodes) {
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
    // Clamp to bounds
    n.x = Math.max(40, Math.min(width - 40, n.x));
    n.y = Math.max(40, Math.min(height - 40, n.y));
  }
}

/* ---------- component ---------- */
export default function KnowledgeGraphPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interaction state
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(Object.keys(TYPE_COLORS)));
  const [dragNode, setDragNode] = useState<GraphNode | null>(null);

  // Refs for animation loop access
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const filtersRef = useRef<Set<string>>(activeFilters);
  const searchRef = useRef("");
  const selectedRef = useRef<GraphNode | null>(null);
  const hoveredRef = useRef<GraphNode | null>(null);
  const dragRef = useRef<GraphNode | null>(null);

  nodesRef.current = nodes;
  edgesRef.current = edges;
  filtersRef.current = activeFilters;
  searchRef.current = search;
  selectedRef.current = selectedNode;
  hoveredRef.current = hoveredNode;
  dragRef.current = dragNode;

  /* ---------- load data ---------- */
  useEffect(() => {
    (async () => {
      try {
        // Check if logged in
        const token = localStorage.getItem("token");
        if (!token) {
          window.location.href = "/";
          return;
        }
        const data = await getKnowledgeGraph(projectId);
        const rawNodes: GraphNode[] = (data.nodes || []).map((n: any, i: number) => ({
          ...n,
          x: 400 + Math.cos(i * 0.8) * 200 + Math.random() * 100,
          y: 300 + Math.sin(i * 0.8) * 200 + Math.random() * 100,
          vx: 0,
          vy: 0,
          connections: 0,
        }));

        // Count connections
        const connCount = new Map<string, number>();
        for (const e of data.edges || []) {
          connCount.set(e.source, (connCount.get(e.source) || 0) + 1);
          connCount.set(e.target, (connCount.get(e.target) || 0) + 1);
        }
        for (const n of rawNodes) {
          n.connections = connCount.get(n.id) || 0;
        }

        setNodes(rawNodes);
        setEdges(data.edges || []);
      } catch (e: any) {
        setError(e.message || "Failed to load knowledge graph");
      }
      setLoading(false);
    })();
  }, [projectId]);

  /* ---------- canvas draw loop ---------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    // Reset transform every frame to avoid accumulated scaling
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const allNodes = nodesRef.current;
    const allEdges = edgesRef.current;
    const filters = filtersRef.current;
    const q = searchRef.current.toLowerCase();

    // Filter nodes
    const visibleIds = new Set<string>();
    const visible = allNodes.filter((n) => {
      if (!filters.has(n.type)) return false;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
      visibleIds.add(n.id);
      return true;
    });
    const visibleEdges = allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

    // Run physics (only on visible nodes)
    if (!dragRef.current) {
      runForces(visible, visibleEdges, w, h);
    }

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Build node map for edge drawing
    const nodeMap = new Map<string, GraphNode>();
    for (const n of visible) nodeMap.set(n.id, n);

    // Draw edges
    const highlightedEdges: { e: GraphEdge; a: GraphNode; b: GraphNode }[] = [];
    ctx.lineWidth = 1;
    for (const e of visibleEdges) {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) continue;

      const isHighlighted =
        selectedRef.current && (selectedRef.current.id === e.source || selectedRef.current.id === e.target);
      if (isHighlighted) {
        highlightedEdges.push({ e, a, b });
      }
      ctx.strokeStyle = isHighlighted ? "rgba(5,150,105,0.6)" : "rgba(148,163,184,0.25)";
      ctx.lineWidth = isHighlighted ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw edge labels on highlighted edges
    for (const { e, a, b } of highlightedEdges) {
      let label = e.label && !e.label.includes("|") ? e.label.trim() : "";
      if (!label || label.length < 5) continue;
      // Truncate
      if (label.length > 40) label = label.slice(0, 38) + "…";
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.save();
      ctx.font = "9px Inter, sans-serif";
      const tw = ctx.measureText(label).width;
      // Background pill
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.roundRect(mx - tw / 2 - 4, my - 6, tw + 8, 13, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(5,150,105,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Text
      ctx.fillStyle = "#374151";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my + 0.5);
      ctx.restore();
    }

    // Draw nodes
    for (const n of visible) {
      const r = Math.max(6, Math.min(20, 6 + n.connections * 2));
      const isGap = n.meta?.confidence === "low" || n.meta?.status === "pending";
      const color = isGap ? "#F59E0B" : (TYPE_COLORS[n.type] || "#6b7280");
      const isSelected = selectedRef.current?.id === n.id;
      const isHovered = hoveredRef.current?.id === n.id;

      // Glow for selected/hovered
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? `${color}44` : `${color}22`;
        ctx.fill();
      }

      // Gap indicator: dashed ring
      if (isGap) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#EF4444";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label — short ID for requirements/gaps/constraints, full name for others
      const shortLabel = n.id.match(/^(BR|GAP|CON)-\d+/) ? n.id : n.label;
      ctx.font = isSelected || isHovered ? "bold 11px system-ui" : "11px system-ui";
      ctx.fillStyle = "#334155";
      ctx.textAlign = "center";
      ctx.fillText(shortLabel, n.x, n.y + r + 14);
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    if (nodes.length > 0) {
      animRef.current = requestAnimationFrame(draw);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [nodes, draw]);

  /* ---------- mouse interaction ---------- */
  function findNodeAt(mx: number, my: number): GraphNode | null {
    // Only search visible (filtered) nodes
    const filters = filtersRef.current;
    const q = searchRef.current.toLowerCase();
    const allNodes = nodesRef.current;
    for (let i = allNodes.length - 1; i >= 0; i--) {
      const n = allNodes[i];
      if (!filters.has(n.type)) continue;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) continue;
      const r = Math.max(6, Math.min(20, 6 + n.connections * 2)) + 8; // larger hit area
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  }

  function getCanvasPos(e: React.MouseEvent): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    // No DPR adjustment needed — node positions are in CSS pixels
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleMouseDown(e: React.MouseEvent) {
    const [mx, my] = getCanvasPos(e);
    const node = findNodeAt(mx, my);
    dragStartRef.current = { x: mx, y: my };
    if (node) {
      setDragNode(node);
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const [mx, my] = getCanvasPos(e);
    if (dragNode) {
      dragNode.x = mx;
      dragNode.y = my;
      dragNode.vx = 0;
      dragNode.vy = 0;
      return;
    }
    const node = findNodeAt(mx, my);
    setHoveredNode(node);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? "pointer" : "default";
    }
  }

  function handleClick(e: React.MouseEvent) {
    const [mx, my] = getCanvasPos(e);
    console.log("CLICK at", mx, my);
    console.log("Visible nodes:", nodesRef.current.filter(n => filtersRef.current.has(n.type)).map(n => `${n.id}(${Math.round(n.x)},${Math.round(n.y)})`).slice(0, 5));
    const node = findNodeAt(mx, my);
    console.log("Found node:", node?.id, node?.label);
    // Force re-render by using a callback
    if (node) {
      setSelectedNode({...node});
    } else {
      setSelectedNode(null);
    }
  }

  function handleMouseUp() {
    setDragNode(null);
    dragStartRef.current = null;
  }

  function toggleFilter(type: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  /* ---------- derived counts ---------- */
  const filteredNodes = nodes.filter(
    (n) =>
      activeFilters.has(n.type) &&
      (!search || n.label.toLowerCase().includes(search.toLowerCase()) || n.id.toLowerCase().includes(search.toLowerCase()))
  );
  const filteredEdgeCount = edges.filter(
    (e) =>
      filteredNodes.some((n) => n.id === e.source) && filteredNodes.some((n) => n.id === e.target)
  ).length;

  /* ---------- selected node edges ---------- */
  const selectedEdges = selectedNode
    ? edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
    : [];
  const connectedNodes = selectedNode
    ? [...new Map<string, GraphNode>(selectedEdges.map((e) => {
        const otherId = e.source === selectedNode.id ? e.target : e.source;
        const node = nodes.find((n) => n.id === otherId);
        return [otherId, node] as [string, GraphNode];
      }).filter((entry): entry is [string, GraphNode] => entry[1] != null)).values()]
    : [];

  /* ---------- render ---------- */
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Graph header */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #e2e8f0",
          background: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Knowledge Graph
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0" }}>
            {filteredNodes.length} nodes &middot; {filteredEdgeCount} edges
          </p>
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <input
          type="text"
          placeholder="Search nodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "6px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 13,
            width: 220,
            outline: "none",
            background: "#f8fafc",
          }}
        />

        {/* Filter buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          {Object.entries(TYPE_LABELS).map(([type, label]) => {
            const active = activeFilters.has(type);
            const color = TYPE_COLORS[type];
            return (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  border: `1px solid ${active ? color : "#e2e8f0"}`,
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 500,
                  background: active ? `${color}15` : "#fff",
                  color: active ? color : "#94a3b8",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: active ? color : "#cbd5e1",
                  }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden" }}>
        {/* Empty state */}
        {nodes.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 500 }}>No knowledge graph data yet</p>
            <p style={{ fontSize: 13, color: "#94a3b8" }}>
              Upload documents and chat with the AI to build the knowledge base
            </p>
          </div>
        )}

        {/* Canvas — shrinks when panel opens */}
        <div style={{ flex: 1, position: "relative", transition: "all 0.25s ease" }}>
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setDragNode(null); dragStartRef.current = null; }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
        </div>

        {/* Side panel — slides in/out */}
        <div
          style={{
            width: selectedNode ? 380 : 0,
            minWidth: selectedNode ? 380 : 0,
            borderLeft: selectedNode ? "1px solid var(--gray-200)" : "none",
            background: "var(--white)",
            overflowY: selectedNode ? "auto" : "hidden",
            overflowX: "hidden",
            display: "flex",
            flexDirection: "column",
            transition: "all 0.25s ease",
            boxShadow: selectedNode ? "-4px 0 16px rgba(0,0,0,0.06)" : "none",
          }}
        >
          {selectedNode && <>
            {/* Panel header */}
            <div style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--gray-100)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: TYPE_COLORS[selectedNode.type] || "#6b7280",
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: TYPE_COLORS[selectedNode.type] || "#64748b" }}>
                  {TYPE_LABELS[selectedNode.type] || selectedNode.type}
                </span>
                {(selectedNode.meta?.confidence === "low" || selectedNode.meta?.status === "pending") && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#FEF3C7", color: "#D97706", marginLeft: 4 }}>
                    GAP
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedNode(null)} style={{
                background: "none", border: "none", fontSize: 16, color: "#94a3b8", cursor: "pointer", padding: "2px 6px",
              }}>
                x
              </button>
            </div>

            <div style={{ padding: 16, flex: 1, overflow: "auto" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--dark)", margin: "0 0 8px", lineHeight: 1.3 }}>
                {selectedNode.label}
              </h2>

              {/* Link to document/requirement */}
              {selectedNode.id.match(/^BR-\d+/) && (
                <a
                  href={`/projects/${projectId}/chat`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11, fontWeight: 600, color: "#059669",
                    textDecoration: "none", padding: "3px 8px",
                    background: "#d1fae5", borderRadius: 6, marginBottom: 12,
                  }}
                >
                  View in Requirements
                </a>
              )}
              {selectedNode.id.match(/^GAP-\d+/) && (
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
              {selectedNode.id.match(/^CON-\d+/) && (
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
              {Object.keys(selectedNode.meta).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
                  {Object.entries(selectedNode.meta).map(([key, value]) => {
                    if (!value) return null;
                    const chipColor = key === "priority" ? (value === "must" ? "#EF4444" : value === "should" ? "#F59E0B" : "#3B82F6")
                      : key === "status" ? (value === "confirmed" ? "#059669" : value === "proposed" ? "#F59E0B" : "#6b7280")
                      : key === "confidence" ? (value === "high" ? "#059669" : value === "low" ? "#EF4444" : "#F59E0B")
                      : "#6b7280";
                    return (
                      <span key={key} style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                        background: `${chipColor}15`, color: chipColor,
                      }}>
                        {key.replace(/_/g, " ")}: {value}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Description from meta */}
              {selectedNode.meta.description && (
                <div style={{ fontSize: 12, color: "var(--gray-600)", lineHeight: 1.6, marginBottom: 14, padding: "10px 12px", background: "var(--gray-50)", borderRadius: 8 }}>
                  {selectedNode.meta.description}
                </div>
              )}

              {/* Source quote — skip if it looks like table data */}
              {selectedNode.meta.source_quote && !selectedNode.meta.source_quote.includes("|") && (
                <div style={{ fontSize: 12, fontStyle: "italic", color: "#4b5563", padding: "8px 12px", borderLeft: "3px solid var(--green)", background: "#f0fdf8", borderRadius: "0 6px 6px 0", marginBottom: 14, lineHeight: 1.5 }}>
                  "{selectedNode.meta.source_quote}"
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
                    onClick={() => setSelectedNode(cn)}
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
                    <span style={{ flex: 1 }}>{cn.label}</span>
                    <span style={{ fontSize: 9, color: TYPE_COLORS[cn.type], fontWeight: 600, textTransform: "uppercase" }}>{cn.type}</span>
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
                    const otherId = e.source === selectedNode.id ? e.target : e.source;
                    const other = nodes.find((n) => n.id === otherId);
                    const direction = e.source === selectedNode.id ? "links to" : "linked from";
                    // Clean context — skip table data, skip if just repeats node name/id
                    let cleanLabel = e.label && !e.label.includes("|") ? e.label.trim() : "";
                    // Remove if it's just the node ID or name repeated
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
          </>}
        </div>
      </div>

      {/* Inline animation style */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
