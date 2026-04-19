"use client";

// Mouse-handler hook for the knowledge-graph canvas. Owns hit-testing
// (findNodeAt over the visible/filtered subset), drag, hover, and
// selection. Extracted from page.tsx so the component stays focused
// on orchestration.

import { useRef, type RefObject } from "react";
import type { GraphNode } from "./graph-layout";


interface UseGraphMouseArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  nodesRef: RefObject<GraphNode[]>;
  filtersRef: RefObject<Set<string>>;
  searchRef: RefObject<string>;
  dragNode: GraphNode | null;
  setDragNode: (n: GraphNode | null) => void;
  setHoveredNode: (n: GraphNode | null) => void;
  setSelectedNode: (n: GraphNode | null) => void;
}


export function useGraphMouse({
  canvasRef, nodesRef, filtersRef, searchRef,
  dragNode, setDragNode, setHoveredNode, setSelectedNode,
}: UseGraphMouseArgs) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function findNodeAt(mx: number, my: number): GraphNode | null {
    const filters = filtersRef.current;
    const q = searchRef.current.toLowerCase();
    const allNodes = nodesRef.current;
    for (let i = allNodes.length - 1; i >= 0; i--) {
      const n = allNodes[i];
      if (!filters.has(n.type)) continue;
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) continue;
      const r = Math.max(6, Math.min(20, 6 + n.connections * 2)) + 8;
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
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onMouseDown(e: React.MouseEvent) {
    const [mx, my] = getCanvasPos(e);
    const node = findNodeAt(mx, my);
    dragStartRef.current = { x: mx, y: my };
    if (node) setDragNode(node);
  }

  function onMouseMove(e: React.MouseEvent) {
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

  function onClick(e: React.MouseEvent) {
    const [mx, my] = getCanvasPos(e);
    const node = findNodeAt(mx, my);
    setSelectedNode(node ? { ...node } : null);
  }

  function onMouseUp() {
    setDragNode(null);
    dragStartRef.current = null;
  }

  function onMouseLeave() {
    setDragNode(null);
    dragStartRef.current = null;
  }

  return { onMouseDown, onMouseMove, onClick, onMouseUp, onMouseLeave };
}
