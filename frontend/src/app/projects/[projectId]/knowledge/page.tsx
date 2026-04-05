"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { getKnowledgeGraph, getWikiFiles, getWikiFile } from "@/lib/api";

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
  tx: number; // target x for animation
  ty: number; // target y for animation
  connections: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

/* ---------- constants ---------- */
const TYPE_COLORS: Record<string, string> = {
  requirement: "#00E5A0",
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

/* ---------- layout algorithms ---------- */
// All layout functions set tx/ty (targets). The draw loop lerps x/y toward them.

function applyCircleLayout(nodes: GraphNode[], width: number, height: number) {
  const cx = width / 2, cy = height / 2;
  const radius = Math.min(width, height) * 0.38;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    n.tx = cx + Math.cos(angle) * radius;
    n.ty = cy + Math.sin(angle) * radius;
    n.vx = 0; n.vy = 0;
  });
}

function applyGridLayout(nodes: GraphNode[], width: number, height: number) {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const padX = 60, padY = 60;
  const cellW = (width - padX * 2) / Math.max(cols, 1);
  const cellH = (height - padY * 2) / Math.max(rows, 1);
  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    n.tx = padX + col * cellW + cellW / 2;
    n.ty = padY + row * cellH + cellH / 2;
    n.vx = 0; n.vy = 0;
  });
}

function applyTreeLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }
  const root = [...nodes].sort((a, b) => b.connections - a.connections)[0];
  if (!root) return;

  const levels = new Map<string, number>();
  const queue = [root.id];
  levels.set(root.id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const lvl = levels.get(id)!;
    for (const nb of adj.get(id) || []) {
      if (!levels.has(nb)) { levels.set(nb, lvl + 1); queue.push(nb); }
    }
  }
  for (const n of nodes) { if (!levels.has(n.id)) levels.set(n.id, 999); }

  const maxLvl = Math.max(...levels.values());
  const byLevel = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const l = levels.get(n.id) || 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(n);
  }

  const padY = 60;
  const levelH = (height - padY * 2) / Math.max(maxLvl, 1);
  byLevel.forEach((levelNodes, lvl) => {
    const cellW = (width - 80) / (levelNodes.length + 1);
    levelNodes.forEach((n, i) => {
      n.tx = 40 + (i + 1) * cellW;
      n.ty = padY + lvl * levelH;
      n.vx = 0; n.vy = 0;
    });
  });
}

function applyClustersLayout(nodes: GraphNode[], width: number, height: number) {
  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const g = n.type;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(n);
  }
  const gKeys = [...groups.keys()];
  const cols = Math.ceil(Math.sqrt(gKeys.length));
  const rows = Math.ceil(gKeys.length / cols);
  const padX = 80, padY = 80;
  const spacingX = (width - padX * 2) / Math.max(cols, 1);
  const spacingY = (height - padY * 2) / Math.max(rows, 1);

  gKeys.forEach((g, gi) => {
    const col = gi % cols;
    const row = Math.floor(gi / cols);
    const cx = padX + col * spacingX + spacingX / 2;
    const cy = padY + row * spacingY + spacingY / 2;
    const gNodes = groups.get(g)!;
    const subCols = Math.max(1, Math.ceil(Math.sqrt(gNodes.length)));
    const subRows = Math.ceil(gNodes.length / subCols);
    const gap = 50;
    gNodes.forEach((n, ni) => {
      const sc = ni % subCols;
      const sr = Math.floor(ni / subCols);
      n.tx = cx + (sc - (subCols - 1) / 2) * gap;
      n.ty = cy + (sr - (subRows - 1) / 2) * gap;
      n.vx = 0; n.vy = 0;
    });
  });
}

function applyTimelineLayout(nodes: GraphNode[], width: number, height: number) {
  const getDate = (n: GraphNode) => (n.meta?.created_at || n.meta?.date || "").slice(0, 10);
  const dated = nodes.filter((n) => getDate(n)).sort((a, b) => getDate(a).localeCompare(getDate(b)));
  const undated = nodes.filter((n) => !getDate(n));
  const dates = [...new Set(dated.map((n) => getDate(n)))];

  const padX = 60;
  const totalCols = dates.length + (undated.length > 0 ? 1 : 0);
  const colW = (width - padX * 2) / Math.max(totalCols, 1);

  dates.forEach((d, di) => {
    const colNodes = dated.filter((n) => getDate(n) === d);
    const rowH = (height - 80) / (colNodes.length + 1);
    colNodes.forEach((n, i) => {
      n.tx = padX + di * colW + colW / 2;
      n.ty = 40 + (i + 1) * rowH;
      n.vx = 0; n.vy = 0;
    });
  });

  if (undated.length > 0) {
    const colX = padX + dates.length * colW + colW / 2;
    const rowH = (height - 80) / (undated.length + 1);
    undated.forEach((n, i) => {
      n.tx = colX;
      n.ty = 40 + (i + 1) * rowH;
      n.vx = 0; n.vy = 0;
    });
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
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(Object.keys(TYPE_COLORS)));
  const [dragNode, setDragNode] = useState<GraphNode | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "wiki" | "list" | "timeline">("graph");
  const [sortCol, setSortCol] = useState<string>("type");
  const [sortAsc, setSortAsc] = useState(true);
  const [graphLayout, setGraphLayout] = useState<string>("force");
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
        // Check if logged in
        const token = localStorage.getItem("token");
        if (!token) {
          window.location.href = "/";
          return;
        }
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
    const tlStep = timelineStepRef.current;
    const tlDates = timelineDatesRef.current;
    const pinned = pinnedNeighborRef.current;
    const visibleIds = new Set<string>();
    const visible = allNodes.filter((n) => {
      if (!filters.has(n.type)) return false;
      // Pinned filter: if nodes are pinned, only show pinned + neighbors
      if (pinned) {
        if (!pinned.has(n.id)) return false;
        // Don't apply text search when pinned — pinning is the filter
      } else if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) {
        return false;
      }
      // Timeline filter
      if (tlStep >= 0 && tlDates.length > 0) {
        const cutoffDate = tlDates[tlStep];
        const nodeDate = (n.meta?.created_at || n.meta?.date || "").slice(0, 10);
        if (nodeDate && nodeDate > cutoffDate) return false;
      }
      visibleIds.add(n.id);
      return true;
    });
    const visibleEdges = allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

    // Apply layout
    const layout = layoutRef.current;
    if (layout !== "force" && layoutAppliedRef.current !== layout) {
      // Compute target positions
      if (layout === "circle") applyCircleLayout(visible, w, h);
      else if (layout === "grid") applyGridLayout(visible, w, h);
      else if (layout === "tree") applyTreeLayout(visible, visibleEdges, w, h);
      else if (layout === "clusters") applyClustersLayout(visible, w, h);
      else if (layout === "timeline-layout") applyTimelineLayout(visible, w, h);
      layoutAppliedRef.current = layout;
    } else if (layout === "force" && !dragRef.current) {
      runForces(visible, visibleEdges, w, h);
      layoutAppliedRef.current = "force";
    }

    // Animate toward targets (for non-force layouts)
    if (layout !== "force") {
      const lerp = 0.08;
      for (const n of visible) {
        n.x += (n.tx - n.x) * lerp;
        n.y += (n.ty - n.y) * lerp;
        n.vx = 0;
        n.vy = 0;
      }
    }

    // Clear + background
    ctx.clearRect(0, 0, w, h);

    // Dot grid background
    const gridSize = 20;
    ctx.fillStyle = "rgba(148,163,184,0.25)";
    for (let gx = gridSize; gx < w; gx += gridSize) {
      for (let gy = gridSize; gy < h; gy += gridSize) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Radial vignette — soft fade at edges
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.65);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(249,250,251,0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

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
      ctx.strokeStyle = isHighlighted ? "rgba(0,229,160,0.6)" : "rgba(148,163,184,0.25)";
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
      ctx.strokeStyle = "rgba(0,229,160,0.3)";
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
                    fontSize: 11, fontWeight: 600, color: "#00E5A0",
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
                      : key === "status" ? (value === "confirmed" ? "#00E5A0" : value === "proposed" ? "#F59E0B" : "#6b7280")
                      : key === "confidence" ? (value === "high" ? "#00E5A0" : value === "low" ? "#EF4444" : "#F59E0B")
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


/* ══════════ Wiki View Component ══════════ */

interface WikiFile {
  path: string;
  name: string;
  folder: string;
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  date: string;
}

interface WikiBacklink {
  path: string;
  id: string;
  title: string;
  category: string;
}

const STATUS_ICONS: Record<string, string> = {
  confirmed: "✓",
  discussed: "◐",
  open: "?",
  tentative: "~",
  proposed: "○",
};

const STATUS_COLORS: Record<string, string> = {
  confirmed: "#00E5A0",
  discussed: "#F59E0B",
  open: "#EF4444",
  tentative: "#94a3b8",
  proposed: "#3B82F6",
};

function WikiView({ projectId, onSelectNode }: { projectId: string; onSelectNode: (id: string) => void }) {
  const [files, setFiles] = useState<WikiFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [frontmatter, setFrontmatter] = useState<Record<string, string>>({});
  const [backlinks, setBacklinks] = useState<WikiBacklink[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["", "requirements", "gaps", "constraints"]));

  useEffect(() => {
    getWikiFiles(projectId).then((data) => {
      setFiles(data.files || []);
      setLoading(false);
      // Auto-select index.md or first file
      const idx = (data.files || []).find((f: WikiFile) => f.name === "index");
      if (idx) openFile(idx.path);
      else if (data.files?.length > 0) openFile(data.files[0].path);
    }).catch(() => setLoading(false));
  }, [projectId]);

  async function openFile(path: string) {
    setSelectedPath(path);
    try {
      const data = await getWikiFile(projectId, path);
      setContent(data.body || "");
      setFrontmatter(data.frontmatter || {});
      setBacklinks(data.backlinks || []);
    } catch {
      setContent("*Failed to load file*");
    }
  }

  function handleWikiLinkClick(target: string) {
    // Try to find the file by ID or name
    const normalized = target.toLowerCase().trim();
    const match = files.find((f) =>
      f.id.toLowerCase() === normalized ||
      f.name.toLowerCase() === normalized ||
      f.path.toLowerCase().replace(".md", "") === normalized ||
      f.path.toLowerCase().endsWith(`/${normalized}.md`)
    );
    if (match) {
      openFile(match.path);
    } else {
      onSelectNode(target);
    }
  }

  // Group files by folder
  const grouped = new Map<string, WikiFile[]>();
  for (const f of files) {
    const folder = f.folder || "";
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder)!.push(f);
  }

  const folderOrder = ["", "requirements", "gaps", "constraints"];
  const sortedFolders = [...grouped.keys()].sort((a, b) => {
    const ai = folderOrder.indexOf(a);
    const bi = folderOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  function toggleFolder(folder: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  function renderWikiMarkdown(md: string): string {
    // 1. Extract tables and wikilinks before escaping
    const tables: Record<string, string> = {};
    const lines = md.split("\n");
    const cleaned: string[] = [];
    let li = 0;
    let tIdx = 0;

    while (li < lines.length) {
      if (
        lines[li].includes("|") &&
        li + 1 < lines.length &&
        /^\|?\s*[-:]+[-| :]*$/.test(lines[li + 1])
      ) {
        const tableLines: string[] = [];
        tableLines.push(lines[li]);
        li++;
        const sepLine = lines[li];
        li++;
        while (li < lines.length && lines[li].includes("|") && lines[li].trim() !== "") {
          tableLines.push(lines[li]);
          li++;
        }

        const aligns = sepLine.split("|").filter((c) => c.trim()).map((c) => {
          const t = c.trim();
          if (t.startsWith(":") && t.endsWith(":")) return "center";
          if (t.endsWith(":")) return "right";
          return "left";
        });

        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const parseCells = (line: string) =>
          line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - (line.endsWith("|") ? 1 : 0)).map((c) => c.trim());

        // Render wikilinks inside table cells
        const renderCell = (cell: string) => {
          const escaped = esc(cell);
          return escaped.replace(/\[\[([^\]]+)\]\]/g, (_m, target) =>
            `<a class="wiki-link" data-target="${target}" style="color:#00E5A0;font-weight:600;cursor:pointer;border-bottom:1px dashed #00E5A0;text-decoration:none">${target}</a>`
          );
        };

        const hdrCells = parseCells(tableLines[0]);
        let h = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:12px"><thead><tr>';
        hdrCells.forEach((cell, ci) => {
          h += `<th style="text-align:${aligns[ci] || "left"};padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;color:#0f172a">${renderCell(cell)}</th>`;
        });
        h += "</tr></thead><tbody>";
        for (let r = 1; r < tableLines.length; r++) {
          const cells = parseCells(tableLines[r]);
          h += "<tr>";
          cells.forEach((cell, ci) => {
            h += `<td style="text-align:${aligns[ci] || "left"};padding:6px 12px;border:1px solid #e2e8f0;color:#4b5563">${renderCell(cell)}</td>`;
          });
          h += "</tr>";
        }
        h += "</tbody></table>";
        const key = `__TBL_${tIdx++}__`;
        tables[key] = h;
        cleaned.push(key);
      } else {
        cleaned.push(lines[li]);
        li++;
      }
    }

    // 2. Process remaining text
    let html = cleaned.join("\n")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[\[([^\]]+)\]\]/g, (_m, target) =>
        `<a class="wiki-link" data-target="${target}" style="color:#00E5A0;font-weight:600;cursor:pointer;border-bottom:1px dashed #00E5A0;text-decoration:none">${target}</a>`
      )
      .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;margin:16px 0 6px;color:#0f172a">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:18px 0 8px;color:#0f172a">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:800;margin:20px 0 10px;color:#0f172a">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="padding:1px 5px;background:#f0fdf4;border:1px solid #dcfce7;border-radius:4px;font-size:0.88em;font-family:monospace;color:#16a34a">$1</code>')
      .replace(/^- (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0;padding-left:4px">$1</li>')
      .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid #00E5A0;padding:6px 12px;margin:8px 0;background:#f0fdf8;border-radius:0 6px 6px 0;font-size:12px;color:#4b5563;font-style:italic">$1</blockquote>')
      .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0">')
      .replace(/\n\n/g, '</p><p style="margin:8px 0">')
      .replace(/\n/g, '<br>');

    html = '<p style="margin:8px 0">' + html + '</p>';
    html = html.replace(/(<li[^>]*>.*?<\/li>(\s*<br>)?)+/g, (match) =>
      '<ul style="padding-left:18px;margin:6px 0">' + match.replace(/<br>/g, '') + '</ul>'
    );

    // 3. Re-insert tables
    for (const [key, tableHtml] of Object.entries(tables)) {
      html = html.replace(key, tableHtml);
    }

    return html;
  }

  if (loading) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>Loading wiki...</div>;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* File tree sidebar */}
      <div style={{
        width: 240, flexShrink: 0, borderRight: "1px solid #e2e8f0",
        background: "#fafbfc", overflowY: "auto", padding: "12px 0",
      }}>
        {sortedFolders.map((folder) => {
          const folderFiles = grouped.get(folder) || [];
          const isExpanded = expandedFolders.has(folder);
          const label = folder || "Overview";

          return (
            <div key={folder}>
              <div
                onClick={() => toggleFolder(folder)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", cursor: "pointer", userSelect: "none",
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.5px", color: "#64748b",
                }}
              >
                <span style={{ fontSize: 10, transition: "transform 0.2s", transform: isExpanded ? "rotate(90deg)" : "none" }}>
                  ▶
                </span>
                {label}
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500, marginLeft: "auto" }}>{folderFiles.length}</span>
              </div>
              {isExpanded && folderFiles.map((f) => {
                const isActive = selectedPath === f.path;
                const statusIcon = STATUS_ICONS[f.status] || "";
                const statusColor = STATUS_COLORS[f.status] || "#94a3b8";
                return (
                  <div
                    key={f.path}
                    onClick={() => openFile(f.path)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 14px 5px 28px", cursor: "pointer",
                      background: isActive ? "#f0fdf8" : "transparent",
                      borderRight: isActive ? "2px solid #00E5A0" : "2px solid transparent",
                      fontSize: 12, color: isActive ? "#0f172a" : "#4b5563",
                      fontWeight: isActive ? 600 : 400,
                      transition: "all 0.1s",
                    }}
                  >
                    {statusIcon && <span style={{ color: statusColor, fontSize: 11 }}>{statusIcon}</span>}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.id || f.title}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Obsidian hint */}
        <div style={{
          padding: "10px 14px", borderTop: "1px solid #e2e8f0",
          fontSize: 10, color: "#94a3b8", lineHeight: 1.4,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Open in Obsidian</div>
          <div
            style={{ fontFamily: "monospace", fontSize: 9, cursor: "pointer", wordBreak: "break-all" }}
            onClick={() => { navigator.clipboard.writeText(`.runtime/projects/${projectId}/.memory-bank`); }}
            title="Click to copy path"
          >
            .runtime/projects/{projectId.slice(0, 8)}.../.memory-bank
          </div>
        </div>
      </div>

      {/* Content panel */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        {!selectedPath ? (
          <div style={{ color: "#94a3b8", textAlign: "center", paddingTop: 60 }}>
            <p style={{ fontSize: 15, fontWeight: 500 }}>Select a file to view</p>
          </div>
        ) : (
          <>
            {/* Breadcrumb */}
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
              discovery / {selectedPath.replace(".md", "")}
            </div>

            {/* Frontmatter badges */}
            {Object.keys(frontmatter).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {Object.entries(frontmatter).map(([key, value]) => {
                  if (!value || key === "description" || key === "category") return null;
                  const color =
                    key === "priority" ? (value === "must" ? "#EF4444" : value === "should" ? "#F59E0B" : "#3B82F6")
                    : key === "status" ? (STATUS_COLORS[value] || "#94a3b8")
                    : key === "confidence" ? (value === "high" ? "#00E5A0" : value === "low" ? "#EF4444" : "#F59E0B")
                    : "#64748b";
                  return (
                    <span key={key} style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                      background: `${color}15`, color,
                    }}>
                      {key}: {value}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Rendered content */}
            <div
              style={{ fontSize: 13, lineHeight: 1.7, color: "#1e293b" }}
              dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(content) }}
              onClick={(e) => {
                const target = (e.target as HTMLElement).closest("[data-target]");
                if (target) {
                  e.preventDefault();
                  handleWikiLinkClick(target.getAttribute("data-target") || "");
                }
              }}
            />

            {/* Backlinks */}
            {backlinks.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#94a3b8", marginBottom: 8 }}>
                  Referenced By ({backlinks.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {backlinks.map((bl) => (
                    <button
                      key={bl.path}
                      onClick={() => openFile(bl.path)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px", borderRadius: 6,
                        border: "1px solid #e2e8f0", background: "#fff",
                        cursor: "pointer", fontFamily: "var(--font)", textAlign: "left",
                        fontSize: 12, color: "#0f172a", transition: "all 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00E5A0"; e.currentTarget.style.background = "#f0fdf8"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00E5A0", flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{bl.title}</span>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{bl.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
