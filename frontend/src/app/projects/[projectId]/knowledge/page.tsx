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
    <div className="kg-page">
      {/* Header — single compact row */}
      <div className="kg-header">
        <h1 className="kg-title">Knowledge Base</h1>
        <span className="kg-stats">
          <strong>{filteredNodes.length}</strong> nodes · <strong>{filteredEdgeCount}</strong> edges
        </span>

        <div className="kg-view-tabs">
          {(["graph", "wiki"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`kg-view-tab${viewMode === v ? " active" : ""}`}
              onClick={() => setViewMode(v)}
            >
              {v === "graph" ? "Graph" : "Wiki"}
            </button>
          ))}
        </div>

        <div className="kg-search-cluster">
          {[...pinnedNodes].map((id) => {
            const node = nodes.find((n) => n.id === id);
            const color = TYPE_COLORS[node?.type || ""] || "var(--ink-3)";
            return (
              <span
                key={id}
                className="kg-pin-chip"
                style={{ color, background: `${color}14`, borderColor: `${color}33` }}
              >
                <span className="kg-pin-chip-dot" style={{ background: color }} />
                {node?.label || id}
                <button
                  type="button"
                  className="kg-pin-chip-close"
                  onClick={() => unpinNode(id)}
                  aria-label="Unpin"
                >×</button>
              </span>
            );
          })}
          {pinnedNodes.size > 0 && (
            <button type="button" className="kg-pin-clear-btn" onClick={clearPins}>
              Clear
            </button>
          )}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder={pinnedNodes.size > 0 ? "Add node..." : "Search nodes..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="kg-search-input"
            />
            {search.length >= 2 && (
              <div className="kg-search-dropdown">
                {(() => {
                  const matches = nodes.filter((n) =>
                    !pinnedNodes.has(n.id) &&
                    (n.label.toLowerCase().includes(search.toLowerCase()) ||
                     n.id.toLowerCase().includes(search.toLowerCase())),
                  );
                  if (matches.length === 0) {
                    return <div className="kg-search-empty">No matching nodes</div>;
                  }
                  return matches.slice(0, 10).map((n) => {
                    const color = TYPE_COLORS[n.type] || "var(--ink-3)";
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className="kg-search-row"
                        onClick={() => pinNode(n.id)}
                      >
                        <span className="kg-search-row-dot" style={{ background: color }} />
                        <span className="kg-search-row-label">{n.label}</span>
                        <span className="kg-search-row-kind" style={{ color }}>{n.type}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main area — minWidth:0 + maxWidth:100% so this flex child of
          the outer column can't widen past the viewport regardless of
          what the graph column's content wants to be. */}
      <div className="kg-main">
        {nodes.length === 0 && (
          <div className="kg-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <p className="kg-empty-title">No knowledge graph data yet</p>
            <p className="kg-empty-sub">
              Upload documents and chat with the AI to build the knowledge base
            </p>
          </div>
        )}

        {viewMode === "graph" && (
          <div className="kg-graph-col">
            <GraphToolbar
              graphLayout={graphLayout}
              changeLayout={changeLayout}
              activeFilters={activeFilters}
              toggleFilter={toggleFilter}
              filteredNodes={filteredNodes}
            />
            <div className="kg-graph-canvas-wrap">
              <canvas ref={canvasRef} {...mouseHandlers} />
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

        {viewMode === "wiki" && (
          <WikiView projectId={projectId} onSelectNode={(id) => {
            const node = nodes.find((n) => n.id === id);
            if (node) setSelectedNode({ ...node });
          }} />
        )}

        <div className={`kg-side-panel${selectedNode ? " open" : ""}`}>
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
    </div>
  );
}


/* ══════════ Wiki View Component ══════════ */

