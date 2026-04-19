"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { getKnowledgeGraph, getWikiFiles, getWikiFile } from "@/lib/api";
import { usePersistedState } from "@/lib/persistedState";
import {
  type GraphNode, type GraphEdge,
  TYPE_COLORS, TYPE_LABELS,
} from "./_parts/graph-layout";
import { WikiView } from "./_parts/wiki-view";
import { NodeDetailPanel } from "./_parts/node-detail-panel";
import { drawKnowledgeGraph } from "./_parts/canvas-draw";


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
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());
  // Persisted user preferences — survive page reloads, scoped per project.
  const [activeFilters, setActiveFilters] = usePersistedState<Set<string>>(
    `knowledge:filters:${projectId}`,
    new Set(Object.keys(TYPE_COLORS)),
    {
      serialize: (s) => JSON.stringify([...s]),
      deserialize: (r) => new Set(JSON.parse(r) as string[]),
    },
  );
  const [dragNode, setDragNode] = useState<GraphNode | null>(null);
  const [viewMode, setViewMode] = usePersistedState<"graph" | "wiki" | "list" | "timeline">(
    `knowledge:viewMode:${projectId}`,
    "graph",
  );
  const [sortCol, setSortCol] = usePersistedState<string>(
    `knowledge:sortCol:${projectId}`,
    "type",
  );
  const [sortAsc, setSortAsc] = usePersistedState<boolean>(
    `knowledge:sortAsc:${projectId}`,
    true,
  );
  const [graphLayout, setGraphLayout] = usePersistedState<string>(
    `knowledge:graphLayout:${projectId}`,
    "force",
  );
  const [timelineStep, setTimelineStep] = useState<number>(-1); // -1 = show all
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const timelineIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Refs for animation loop access
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const filtersRef = useRef<Set<string>>(activeFilters);
  const searchRef = useRef("");
  const selectedRef = useRef<GraphNode | null>(null);
  const hoveredRef = useRef<GraphNode | null>(null);
  const dragRef = useRef<GraphNode | null>(null);
  const layoutRef = useRef<string>("force");
  const layoutAppliedRef = useRef<string>("");

  layoutRef.current = graphLayout;
  const timelineStepRef = useRef<number>(-1);
  const timelineDatesRef = useRef<string[]>([]);
  timelineStepRef.current = timelineStep;
  nodesRef.current = nodes;
  edgesRef.current = edges;
  filtersRef.current = activeFilters;
  searchRef.current = search;
  const pinnedRef = useRef<Set<string>>(new Set());
  pinnedRef.current = pinnedNodes;
  const pinnedNeighborRef = useRef<Set<string> | null>(null);

  selectedRef.current = selectedNode;
  hoveredRef.current = hoveredNode;
  dragRef.current = dragNode;

  /* ---------- load data ---------- */
  useEffect(() => {
    (async () => {
      try {
        // No explicit localStorage token gate here — fetchAPI attaches the
        // token automatically and the backend responds with 401 if absent.
        // The previous `window.location.href = "/"` bounced authenticated
        // users whose token hadn't been written to localStorage yet.
        const data = await getKnowledgeGraph(projectId);
        const rawNodes: GraphNode[] = (data.nodes || []).map((n: any, i: number) => {
          const x = 400 + Math.cos(i * 0.8) * 200 + Math.random() * 100;
          const y = 300 + Math.sin(i * 0.8) * 200 + Math.random() * 100;
          return { ...n, x, y, tx: x, ty: y, vx: 0, vy: 0, connections: 0 };
        });

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
  /* ---------- canvas draw loop ---------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawKnowledgeGraph(canvas, {
      nodes: nodesRef.current,
      edges: edgesRef.current,
      filters: filtersRef.current,
      search: searchRef.current,
      selected: selectedRef.current,
      hovered: hoveredRef.current,
      drag: dragRef.current,
      layout: layoutRef.current,
      layoutApplied: layoutAppliedRef,
      timelineStep: timelineStepRef.current,
      timelineDates: timelineDatesRef.current,
      pinnedNeighbors: pinnedNeighborRef.current,
    });
    animRef.current = requestAnimationFrame(draw);
  }, []);


  useEffect(() => {
    if (nodes.length > 0 && viewMode === "graph") {
      animRef.current = requestAnimationFrame(draw);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [nodes, draw, viewMode]);

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

  function setStep(n: number) {
    setTimelineStep(n);
  }

  function togglePlay() {
    if (timelinePlaying) {
      clearInterval(timelineIntervalRef.current);
      setTimelinePlaying(false);
      return;
    }
    setTimelinePlaying(true);
    setTimelineStep(0);
    let step = 0;
    timelineIntervalRef.current = setInterval(() => {
      step++;
      if (step >= timelineDates.length) {
        clearInterval(timelineIntervalRef.current);
        setTimelinePlaying(false);
        setTimelineStep(-1); // show all
        return;
      }
      setTimelineStep(step);
    }, 1200);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (timelineIntervalRef.current) clearInterval(timelineIntervalRef.current); };
  }, []);

  function pinNode(id: string) {
    setPinnedNodes((prev) => { const next = new Set(prev); next.add(id); return next; });
    setSearch("");
    layoutAppliedRef.current = ""; // re-apply layout for new node set
  }

  function unpinNode(id: string) {
    setPinnedNodes((prev) => { const next = new Set(prev); next.delete(id); return next; });
    layoutAppliedRef.current = "";
  }

  function clearPins() {
    setPinnedNodes(new Set());
    layoutAppliedRef.current = "";
  }

  function changeLayout(layout: string) {
    layoutAppliedRef.current = "";
    setGraphLayout(layout);
  }

  function toggleFilter(type: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  /* ---------- timeline dates ---------- */
  // Use created_at (file mod time) for timeline, fallback to date. Group by date part.
  const timelineDates = (() => {
    const stamps = nodes
      .map((n) => n.meta?.created_at || n.meta?.date)
      .filter(Boolean) as string[];
    // Group by date (YYYY-MM-DD) or full value if already date-only
    const dateSet = new Set(stamps.map((s) => s.slice(0, 10)));
    return [...dateSet].sort();
  })();
  timelineDatesRef.current = timelineDates;

  // Compute pinned + neighbor IDs for filtering
  const pinnedAndNeighbors = (() => {
    if (pinnedNodes.size === 0) return null;
    const ids = new Set<string>(pinnedNodes);
    for (const e of edges) {
      if (pinnedNodes.has(e.source)) ids.add(e.target);
      if (pinnedNodes.has(e.target)) ids.add(e.source);
    }
    return ids;
  })();
  pinnedNeighborRef.current = pinnedAndNeighbors;

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
      {/* Header — single compact row */}
      <div style={{
        padding: "10px 20px",
        borderBottom: "1px solid #e2e8f0",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0, whiteSpace: "nowrap" }}>
          Knowledge Base
        </h1>
        <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
          {filteredNodes.length} nodes &middot; {filteredEdgeCount} edges
        </span>

        {/* View tabs */}
        <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          {(["graph", "wiki"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              style={{
                padding: "4px 14px", border: "none", borderRadius: 6,
                background: viewMode === v ? "var(--green)" : "var(--gray-100)",
                color: viewMode === v ? "var(--dark)" : "#64748b",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font)", transition: "all 0.15s",
              }}
            >
              {v === "graph" ? "Graph" : "Wiki"}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Search + pinned pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", position: "relative" }}>
          {/* Pinned node pills */}
          {[...pinnedNodes].map((id) => {
            const node = nodes.find((n) => n.id === id);
            const color = TYPE_COLORS[node?.type || ""] || "#6b7280";
            return (
              <span
                key={id}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", borderRadius: 12,
                  background: `${color}15`, border: `1px solid ${color}40`,
                  fontSize: 11, fontWeight: 600, color,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                {node?.label || id}
                <button
                  onClick={() => unpinNode(id)}
                  style={{
                    background: "none", border: "none", padding: 0, marginLeft: 2,
                    cursor: "pointer", color, fontSize: 13, lineHeight: 1, fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
          {pinnedNodes.size > 0 && (
            <button
              onClick={clearPins}
              style={{
                background: "none", border: "none", padding: "2px 4px",
                cursor: "pointer", color: "#94a3b8", fontSize: 11, fontFamily: "var(--font)",
              }}
            >
              Clear
            </button>
          )}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder={pinnedNodes.size > 0 ? "Add node..." : "Search nodes..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: 6,
                fontSize: 12, width: 180, outline: "none", background: "#f8fafc",
              }}
            />
            {/* Search dropdown — click to pin */}
            {search.length >= 2 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200,
                maxHeight: 200, overflowY: "auto",
              }}>
                {nodes
                  .filter((n) =>
                    !pinnedNodes.has(n.id) &&
                    (n.label.toLowerCase().includes(search.toLowerCase()) ||
                     n.id.toLowerCase().includes(search.toLowerCase()))
                  )
                  .slice(0, 10)
                  .map((n) => {
                    const color = TYPE_COLORS[n.type] || "#6b7280";
                    return (
                      <button
                        key={n.id}
                        onClick={() => pinNode(n.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%",
                          padding: "7px 12px", border: "none", background: "none",
                          cursor: "pointer", fontFamily: "var(--font)", textAlign: "left",
                          fontSize: 12, transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0f172a" }}>{n.label}</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color, textTransform: "uppercase" }}>{n.type}</span>
                      </button>
                    );
                  })}
                {nodes.filter((n) =>
                  !pinnedNodes.has(n.id) &&
                  (n.label.toLowerCase().includes(search.toLowerCase()) ||
                   n.id.toLowerCase().includes(search.toLowerCase()))
                ).length === 0 && (
                  <div style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
                    No matching nodes
                  </div>
                )}
              </div>
            )}
          </div>
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

        {/* Graph view */}
        {viewMode === "graph" && (
          <div style={{ flex: 1, position: "relative", transition: "all 0.25s ease", display: "flex", flexDirection: "column" }}>
            {/* Graph toolbar — layout modes + entity filters */}
            <div style={{
              display: "flex", alignItems: "center", gap: 0, padding: "6px 12px",
              background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
              zIndex: 2, flexShrink: 0,
            }}>
              {/* Layout buttons */}
              {["force", "circle", "grid", "tree", "clusters", "timeline-layout"].map((l) => (
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
                  {l === "force" ? "Force" : l === "circle" ? "Circle" : l === "grid" ? "Grid" : l === "tree" ? "Tree" : l === "clusters" ? "Clusters" : "Timeline"}
                </button>
              ))}

              <div style={{ width: 1, height: 16, background: "#e2e8f0", margin: "0 8px" }} />

              {/* Reset */}
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

              {/* Entity type filters */}
              <div style={{ display: "flex", gap: 4 }}>
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
            <div style={{ flex: 1, position: "relative" }}>
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

            {/* Timeline scrubber bar */}
            {timelineDates.length > 0 && (
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
                  {/* Track line */}
                  <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "#e2e8f0", borderRadius: 1 }} />
                  {/* Fill line */}
                  <div style={{
                    position: "absolute", left: 0, height: 2, borderRadius: 1,
                    background: "#00E5A0", transition: "width 0.3s ease",
                    width: timelineStep < 0
                      ? "100%"
                      : `${(timelineStep / Math.max(timelineDates.length - 1, 1)) * 100}%`,
                  }} />
                  {/* Dots */}
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

                {/* Stats */}
                <div style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap", minWidth: 120, textAlign: "right" }}>
                  {(() => {
                    if (timelineStep < 0) {
                      return `${filteredNodes.length} entities · ${filteredEdgeCount} edges`;
                    }
                    const cutoff = timelineDates[timelineStep];
                    const nodeDate = (n: GraphNode) => (n.meta?.created_at || n.meta?.date || "").slice(0, 10);
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

                {/* Show all button */}
                {timelineStep >= 0 && (
                  <button
                    onClick={() => { setTimelineStep(-1); setTimelinePlaying(false); clearInterval(timelineIntervalRef.current); }}
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
            )}
          </div>
        )}

        {/* List view */}
        {viewMode === "list" && (
          <div style={{ flex: 1, overflow: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
                  {[
                    { key: "type", label: "Type" },
                    { key: "id", label: "ID" },
                    { key: "label", label: "Name" },
                    { key: "status", label: "Status" },
                    { key: "priority", label: "Priority" },
                    { key: "connections", label: "Links" },
                    { key: "date", label: "Date" },
                  ].map((col) => (
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
                {[...filteredNodes].sort((a, b) => {
                  let av: string | number = "", bv: string | number = "";
                  if (sortCol === "connections") { av = a.connections; bv = b.connections; }
                  else if (sortCol === "status") { av = a.meta?.status || ""; bv = b.meta?.status || ""; }
                  else if (sortCol === "priority") { av = a.meta?.priority || ""; bv = b.meta?.priority || ""; }
                  else if (sortCol === "date") { av = a.meta?.date || "zzzz"; bv = b.meta?.date || "zzzz"; }
                  else { av = (a as any)[sortCol] || ""; bv = (b as any)[sortCol] || ""; }
                  if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
                  return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
                }).map((n) => {
                  const color = TYPE_COLORS[n.type] || "#6b7280";
                  const isSelected = selectedNode?.id === n.id;
                  return (
                    <tr
                      key={n.id}
                      onClick={() => setSelectedNode({ ...n })}
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
        )}

        {/* Timeline view */}
        {viewMode === "timeline" && (
          <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
            {(() => {
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
                <div style={{ position: "relative", paddingLeft: 28 }}>
                  {/* Vertical line */}
                  <div style={{ position: "absolute", left: 10, top: 0, bottom: 0, width: 2, background: "#e2e8f0" }} />

                  {sortedDates.map((date) => (
                    <div key={date} style={{ marginBottom: 24 }}>
                      {/* Date marker */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, marginLeft: -28 }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%", background: "#00E5A0",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: "3px solid #fff", boxShadow: "0 0 0 2px #e2e8f0", zIndex: 1,
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{date}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{grouped.get(date)!.length} item{grouped.get(date)!.length !== 1 ? "s" : ""}</span>
                      </div>

                      {/* Nodes for this date */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {grouped.get(date)!.map((n) => {
                          const color = TYPE_COLORS[n.type] || "#6b7280";
                          const isSelected = selectedNode?.id === n.id;
                          return (
                            <div
                              key={n.id}
                              onClick={() => setSelectedNode({ ...n })}
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
                                {TYPE_LABELS[n.type] || n.type}
                              </span>
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {n.label}
                              </span>
                              {n.meta?.status && (
                                <span style={{
                                  fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                                  background: n.meta.status === "confirmed" ? "#d1fae5" : "#f1f5f9",
                                  color: n.meta.status === "confirmed" ? "#00E5A0" : "#64748b",
                                }}>
                                  {n.meta.status}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: "#94a3b8" }}>{n.connections} links</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Undated section */}
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
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{undated.length} item{undated.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {undated.map((n) => {
                          const color = TYPE_COLORS[n.type] || "#6b7280";
                          const isSelected = selectedNode?.id === n.id;
                          return (
                            <div
                              key={n.id}
                              onClick={() => setSelectedNode({ ...n })}
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
                                {TYPE_LABELS[n.type] || n.type}
                              </span>
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {n.label}
                              </span>
                              {n.meta?.status && (
                                <span style={{
                                  fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                                  background: n.meta.status === "confirmed" ? "#d1fae5" : "#f1f5f9",
                                  color: n.meta.status === "confirmed" ? "#00E5A0" : "#64748b",
                                }}>
                                  {n.meta.status}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: "#94a3b8" }}>{n.connections} links</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Wiki view */}
        {viewMode === "wiki" && (
          <WikiView projectId={projectId} onSelectNode={(id) => {
            const node = nodes.find((n) => n.id === id);
            if (node) setSelectedNode({ ...node });
          }} />
        )}

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
          {selectedNode && (
            <NodeDetailPanel
              node={selectedNode}
              nodes={nodes}
              edges={edges}
              projectId={projectId}
              onClose={() => setSelectedNode(null)}
              onSelect={setSelectedNode}
            />
          )}
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


/* ══════════ Wiki View Component ══════════ */

