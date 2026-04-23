// Pure graph-layout primitives — types, type→color map, type→label map,
// and the six layout algorithms used by the knowledge-base canvas.
// Extracted from knowledge/page.tsx so the layouts can be unit-tested
// and swapped out without touching the canvas renderer.

/* ---------- types ---------- */
export interface GraphNode {
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

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

/* ---------- constants ---------- */
export const TYPE_COLORS: Record<string, string> = {
  requirement: "#00E5A0",
  stakeholder: "#7c3aed",
  contradiction: "#EF4444",
  constraint: "#0891b2",
  gap: "#F59E0B",
  document: "#6b7280",
};

export const TYPE_LABELS: Record<string, string> = {
  requirement: "Requirement",
  stakeholder: "People",
  contradiction: "Contradiction",
  constraint: "Constraint",
  gap: "Gap",
  document: "Document",
};

/* ---------- force layout ---------- */
export function runForces(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
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

export function applyCircleLayout(nodes: GraphNode[], width: number, height: number) {
  const cx = width / 2, cy = height / 2;
  const radius = Math.min(width, height) * 0.38;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    n.tx = cx + Math.cos(angle) * radius;
    n.ty = cy + Math.sin(angle) * radius;
    n.vx = 0; n.vy = 0;
  });
}

export function applyGridLayout(nodes: GraphNode[], width: number, height: number) {
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

export function applyTreeLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
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

export function applyClustersLayout(nodes: GraphNode[], width: number, height: number) {
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

export function applyTimelineLayout(nodes: GraphNode[], width: number, height: number) {
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
