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
import { useGraphMouse } from "./_parts/use-graph-mouse";
import { GraphToolbar } from "./_parts/graph-toolbar";
import { TimelineScrubber } from "./_parts/timeline-scrubber";
import { ListView } from "./_parts/list-view";
import { TimelineView } from "./_parts/timeline-view";


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
  const mouseHandlers = useGraphMouse({
    canvasRef, nodesRef, filtersRef, searchRef,
    dragNode, setDragNode, setHoveredNode, setSelectedNode,
  });


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

      {/* Main area — minWidth:0 + maxWidth:100% so this flex child of
          the outer column can't widen past the viewport regardless of
          what the graph column's content wants to be. */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: "100%", display: "flex", position: "relative", overflow: "hidden" }}>
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

        {/* Graph view. minWidth:0 is critical here — without it, the
            toolbar/scrubber intrinsic min-content pushes this flex
            column wider than available, shoving the side panel past
            the viewport's right edge. */}
        {viewMode === "graph" && (
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative", transition: "all 0.25s ease", display: "flex", flexDirection: "column" }}>
            <GraphToolbar
              graphLayout={graphLayout}
              changeLayout={changeLayout}
              activeFilters={activeFilters}
              toggleFilter={toggleFilter}
              filteredNodes={filteredNodes}
            />
            <div style={{ flex: 1, position: "relative" }}>
            <canvas
              ref={canvasRef}
              {...mouseHandlers}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            />
            </div>

            <TimelineScrubber
              timelineDates={timelineDates}
              timelineStep={timelineStep}
              timelinePlaying={timelinePlaying}
              filteredNodes={filteredNodes}
              filteredEdgeCount={filteredEdgeCount}
              nodes={nodes}
              setStep={setStep}
              togglePlay={togglePlay}
              showAll={() => { setTimelineStep(-1); setTimelinePlaying(false); clearInterval(timelineIntervalRef.current); }}
            />
          </div>
        )}

        {viewMode === "list" && (
          <ListView
            filteredNodes={filteredNodes}
            selectedNode={selectedNode}
            onSelectNode={(n) => setSelectedNode({ ...n })}
            sortCol={sortCol}
            setSortCol={setSortCol}
            sortAsc={sortAsc}
            setSortAsc={setSortAsc}
          />
        )}

        {viewMode === "timeline" && (
          <TimelineView
            filteredNodes={filteredNodes}
            selectedNode={selectedNode}
            onSelectNode={(n) => setSelectedNode({ ...n })}
          />
        )}

        {/* Wiki view */}
        {viewMode === "wiki" && (
          <WikiView projectId={projectId} onSelectNode={(id) => {
            const node = nodes.find((n) => n.id === id);
            if (node) setSelectedNode({ ...node });
          }} />
        )}

        {/* Side panel — slides in/out. flexShrink:0 + maxWidth pin the
            width at 380; inner content uses minWidth:0 so long strings
            (descriptions, chip values) wrap instead of pushing the
            panel past the viewport. */}
        <div
          style={{
            width: selectedNode ? 440 : 0,
            minWidth: selectedNode ? 440 : 0,
            maxWidth: selectedNode ? 440 : 0,
            flexShrink: 0,
            boxSizing: "border-box",
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

