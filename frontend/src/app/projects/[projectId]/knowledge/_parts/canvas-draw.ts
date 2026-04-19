// Single-frame draw routine for the knowledge-graph canvas.
// Handles: DPR-aware resize, visibility filter (type + search + pin +
// timeline), layout application, background grid + vignette, edge
// strokes with highlight labels, node circles with gap rings and
// selection glow. Mutates node positions (force / lerp toward target).
// Extracted from page.tsx so the 200-line render routine is no
// longer inline in the component.

import {
  type GraphNode, type GraphEdge, TYPE_COLORS,
  runForces, applyCircleLayout, applyGridLayout, applyTreeLayout,
  applyClustersLayout, applyTimelineLayout,
} from "./graph-layout";


export interface DrawState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filters: Set<string>;
  search: string;
  selected: GraphNode | null;
  hovered: GraphNode | null;
  drag: GraphNode | null;
  layout: string;
  layoutApplied: { current: string };  // mutable to track "already applied"
  timelineStep: number;
  timelineDates: string[];
  pinnedNeighbors: Set<string> | null;
}


export function drawKnowledgeGraph(canvas: HTMLCanvasElement, state: DrawState) {
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const q = state.search.toLowerCase();

  const visibleIds = new Set<string>();
  const visible = state.nodes.filter((n) => {
    if (!state.filters.has(n.type)) return false;
    if (state.pinnedNeighbors) {
      if (!state.pinnedNeighbors.has(n.id)) return false;
    } else if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) {
      return false;
    }
    if (state.timelineStep >= 0 && state.timelineDates.length > 0) {
      const cutoffDate = state.timelineDates[state.timelineStep];
      const nodeDate = (n.meta?.created_at || n.meta?.date || "").slice(0, 10);
      if (nodeDate && nodeDate > cutoffDate) return false;
    }
    visibleIds.add(n.id);
    return true;
  });
  const visibleEdges = state.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

  const layout = state.layout;
  if (layout !== "force" && state.layoutApplied.current !== layout) {
    if (layout === "circle") applyCircleLayout(visible, w, h);
    else if (layout === "grid") applyGridLayout(visible, w, h);
    else if (layout === "tree") applyTreeLayout(visible, visibleEdges, w, h);
    else if (layout === "clusters") applyClustersLayout(visible, w, h);
    else if (layout === "timeline-layout") applyTimelineLayout(visible, w, h);
    state.layoutApplied.current = layout;
  } else if (layout === "force" && !state.drag) {
    runForces(visible, visibleEdges, w, h);
    state.layoutApplied.current = "force";
  }

  if (layout !== "force") {
    const lerp = 0.08;
    for (const n of visible) {
      n.x += (n.tx - n.x) * lerp;
      n.y += (n.ty - n.y) * lerp;
      n.vx = 0;
      n.vy = 0;
    }
  }

  ctx.clearRect(0, 0, w, h);

  const gridSize = 20;
  ctx.fillStyle = "rgba(148,163,184,0.25)";
  for (let gx = gridSize; gx < w; gx += gridSize) {
    for (let gy = gridSize; gy < h; gy += gridSize) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.65);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(249,250,251,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const nodeMap = new Map<string, GraphNode>();
  for (const n of visible) nodeMap.set(n.id, n);

  const highlightedEdges: { e: GraphEdge; a: GraphNode; b: GraphNode }[] = [];
  ctx.lineWidth = 1;
  for (const e of visibleEdges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;

    const isHighlighted =
      state.selected && (state.selected.id === e.source || state.selected.id === e.target);
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

  for (const { e, a, b } of highlightedEdges) {
    let label = e.label && !e.label.includes("|") ? e.label.trim() : "";
    if (!label || label.length < 5) continue;
    if (label.length > 40) label = label.slice(0, 38) + "…";
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.save();
    ctx.font = "9px Inter, sans-serif";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.roundRect(mx - tw / 2 - 4, my - 6, tw + 8, 13, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,229,160,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#374151";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, mx, my + 0.5);
    ctx.restore();
  }

  for (const n of visible) {
    const r = Math.max(6, Math.min(20, 6 + n.connections * 2));
    const isGap = n.meta?.confidence === "low" || n.meta?.status === "pending";
    const color = isGap ? "#F59E0B" : (TYPE_COLORS[n.type] || "#6b7280");
    const isSelected = state.selected?.id === n.id;
    const isHovered = state.hovered?.id === n.id;

    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? `${color}44` : `${color}22`;
      ctx.fill();
    }

    if (isGap) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#EF4444";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const shortLabel = n.id.match(/^(BR|GAP|CON)-\d+/) ? n.id : n.label;
    ctx.font = isSelected || isHovered ? "bold 11px system-ui" : "11px system-ui";
    ctx.fillStyle = "#334155";
    ctx.textAlign = "center";
    ctx.fillText(shortLabel, n.x, n.y + r + 14);
  }
}
