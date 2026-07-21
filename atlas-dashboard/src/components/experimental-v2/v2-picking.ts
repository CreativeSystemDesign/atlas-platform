// Hit-test the annotated graph for the element a placement tool would act on,
// so each tool can select+delete its OWN element type without leaving the mode
// (Shane's ground-mode workflow, generalized to all placement tools). Returns
// the element id under the point that matches the active tool, or null.
//
// The rule mirrors placement: in <tool> mode, clicking an existing <tool>-type
// element selects it (Del removes it); clicking empty space places/draws a new
// one. Pure graph geometry — no PDF geometry needed.

import type { V2Graph, V2Tool } from "./experimental-v2-types";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

const inRect = (p: Point, b: Rect) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPath(p: Point, path: Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    best = Math.min(best, distToSegment(p, path[i], path[i + 1]));
  }
  return path.length === 1 ? Math.hypot(p.x - path[0].x, p.y - path[0].y) : best;
}

// Continuation render half-extents (mirrors the SVG chip: width scales with the
// ref text, height ~18px centered on the point).
function continuationHalf(ref: string): { hw: number; hh: number } {
  return { hw: Math.max(11, (ref.length * 7 + 8) / 2), hh: 9 };
}

/**
 * The element id a click in `tool` mode should SELECT (instead of placing a new
 * one), or null when the point is over empty space. Only placement tools that
 * own a graph element type participate; select/ask/bless/lasso/pen return null.
 */
export function pickForTool(
  graph: V2Graph,
  tool: V2Tool,
  p: Point,
  tolPx = 6
): string | null {
  if (tool === "ground") {
    // Smallest ground box under the point (an inner ring wins over an encloser).
    let best: string | null = null;
    let area = Infinity;
    for (const g of graph.grounds ?? []) {
      if (!inRect(p, g.bbox)) continue;
      const a = g.bbox.width * g.bbox.height;
      if (a < area) { area = a; best = g.id; }
    }
    return best;
  }
  if (tool === "component") {
    let best: string | null = null;
    let area = Infinity;
    for (const n of graph.nodes) {
      if (!inRect(p, n.bbox)) continue;
      const a = n.bbox.width * n.bbox.height;
      if (a < area) { area = a; best = n.id; }
    }
    return best;
  }
  if (tool === "terminal" || tool === "connector") {
    let best: string | null = null;
    let d = tolPx + 7; // ports render at r≈5-7px
    for (const port of graph.ports) {
      const dd = Math.hypot(port.point.x - p.x, port.point.y - p.y);
      if (dd <= d) { d = dd; best = port.id; }
    }
    return best;
  }
  if (tool === "continuation") {
    let best: string | null = null;
    let d = Infinity;
    for (const c of graph.continuations) {
      const ref = c.sheet && c.zone ? `${c.sheet}/${c.zone}` : c.rawRef ?? "?";
      const { hw, hh } = continuationHalf(ref);
      if (Math.abs(p.x - c.point.x) <= hw && Math.abs(p.y - c.point.y) <= hh) {
        const dd = Math.hypot(c.point.x - p.x, c.point.y - p.y);
        if (dd < d) { d = dd; best = c.id; }
      }
    }
    return best;
  }
  if (tool === "cable") {
    // Smallest cable box under the point.
    let best: string | null = null;
    let area = Infinity;
    for (const c of graph.cables ?? []) {
      if (!inRect(p, c.bbox)) continue;
      const a = c.bbox.width * c.bbox.height;
      if (a < area) { area = a; best = c.id; }
    }
    return best;
  }
  if (tool === "wire") {
    let best: string | null = null;
    let d = tolPx;
    for (const e of graph.edges) {
      const dd = distToPath(p, e.path);
      if (dd <= d) { d = dd; best = e.id; }
    }
    return best;
  }
  return null;
}

export type PickedElement = {
  id: string;
  kind: "ground" | "component" | "terminal" | "junction" | "mate" | "continuation" | "wire" | "cable";
  label: string | null;
  point: Point;
  bbox?: Rect;
};

/**
 * The topmost overlay element of ANY type under the point — the Bless tool's
 * "select whatever is under me" (Shane 2026-07-08). Priority is specific→broad:
 * a terminal/junction dot or a continuation chip wins over the box it sits on
 * (grounds/components), so a terminal ON a ground's border selects the terminal
 * while a click in the ground's interior selects the ground. Wires are last.
 */
export function pickAnyElement(graph: V2Graph, p: Point, tolPx = 8): PickedElement | null {
  // 1. ports (terminals / junctions) — most specific, small hit radius.
  let bestPort: PickedElement | null = null;
  let portD = tolPx + 6;
  for (const port of graph.ports) {
    const dd = Math.hypot(port.point.x - p.x, port.point.y - p.y);
    if (dd <= portD) {
      portD = dd;
      bestPort = { id: port.id, kind: port.type === "junction" ? "junction" : port.type === "mate" ? "mate" : "terminal", label: port.label, point: port.point };
    }
  }
  if (bestPort) return bestPort;

  // 2. continuations (small chips).
  let bestCont: PickedElement | null = null;
  let contD = Infinity;
  for (const c of graph.continuations) {
    const ref = c.sheet && c.zone ? `${c.sheet}/${c.zone}` : c.rawRef ?? "?";
    const hw = Math.max(11, (ref.length * 7 + 8) / 2);
    if (Math.abs(p.x - c.point.x) <= hw && Math.abs(p.y - c.point.y) <= 9) {
      const dd = Math.hypot(c.point.x - p.x, c.point.y - p.y);
      if (dd < contD) { contD = dd; bestCont = { id: c.id, kind: "continuation", label: ref, point: c.point }; }
    }
  }
  if (bestCont) return bestCont;

  // 3. grounds (boxed) — smallest containing.
  let bestGround: PickedElement | null = null;
  let groundArea = Infinity;
  for (const g of graph.grounds ?? []) {
    if (!inRect(p, g.bbox)) continue;
    const a = g.bbox.width * g.bbox.height;
    if (a < groundArea) {
      groundArea = a;
      bestGround = { id: g.id, kind: "ground", label: g.label, point: { x: g.bbox.x + g.bbox.width / 2, y: g.bbox.y + g.bbox.height / 2 }, bbox: g.bbox };
    }
  }
  if (bestGround) return bestGround;

  // 4. components (boxed) — smallest containing.
  let bestNode: PickedElement | null = null;
  let nodeArea = Infinity;
  for (const n of graph.nodes) {
    if (!inRect(p, n.bbox)) continue;
    const a = n.bbox.width * n.bbox.height;
    if (a < nodeArea) {
      nodeArea = a;
      bestNode = { id: n.id, kind: "component", label: n.label, point: { x: n.bbox.x + n.bbox.width / 2, y: n.bbox.y + n.bbox.height / 2 }, bbox: n.bbox };
    }
  }
  if (bestNode) return bestNode;

  // 5. wires (near path).
  let bestEdge: PickedElement | null = null;
  let edgeD = tolPx;
  for (const e of graph.edges) {
    const dd = distToPath(p, e.path);
    if (dd <= edgeD) {
      edgeD = dd;
      const mid = e.path[Math.floor(e.path.length / 2)] ?? e.path[0];
      bestEdge = { id: e.id, kind: "wire", label: e.label ?? null, point: mid };
    }
  }
  if (bestEdge) return bestEdge;

  // 6. cables (boxed) — smallest containing.
  let bestCable: PickedElement | null = null;
  let cableArea = Infinity;
  for (const c of graph.cables ?? []) {
    if (!inRect(p, c.bbox)) continue;
    const a = c.bbox.width * c.bbox.height;
    if (a < cableArea) {
      cableArea = a;
      bestCable = { id: c.id, kind: "cable", label: c.label, point: { x: c.bbox.x + c.bbox.width / 2, y: c.bbox.y + c.bbox.height / 2 }, bbox: c.bbox };
    }
  }
  return bestCable;
}

