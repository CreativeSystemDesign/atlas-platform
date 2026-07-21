// Wire routing: turn a wobbly freehand trace into the clean, orthogonal path of
// the actual PDF wire it follows. No schematic wire is curved, so we never emit
// curves — we walk the underlying vector-segment graph between the two snapped
// endpoints, staying within a corridor of the operator's stroke.

import { type Point, distance } from "./v2-geometry.ts";

export type Seg = { x1: number; y1: number; x2: number; y2: number };

const QUANT = 3; // px grid for treating segment endpoints as the same node

const keyOf = (p: Point) => `${Math.round(p.x / QUANT)},${Math.round(p.y / QUANT)}`;

export type SegmentGraph = {
  nodes: Map<string, Point>;
  adj: Map<string, { to: string; len: number }[]>;
};

export function buildSegmentGraph(segments: Seg[]): SegmentGraph {
  const nodes = new Map<string, Point>();
  const adj = new Map<string, { to: string; len: number }[]>();
  const add = (p: Point) => {
    const k = keyOf(p);
    if (!nodes.has(k)) {
      nodes.set(k, p);
      adj.set(k, []);
    }
    return k;
  };
  for (const s of segments) {
    const a = add({ x: s.x1, y: s.y1 });
    const b = add({ x: s.x2, y: s.y2 });
    if (a === b) continue;
    const len = distance(nodes.get(a)!, nodes.get(b)!);
    adj.get(a)!.push({ to: b, len });
    adj.get(b)!.push({ to: a, len });
  }
  return { nodes, adj };
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// Min distance from a point to a polyline (the operator's stroke).
function distToStroke(p: Point, stroke: Point[]): number {
  if (stroke.length === 1) return distance(p, stroke[0]);
  let min = Infinity;
  for (let i = 1; i < stroke.length; i++) {
    const d = pointToSegmentDist(p, stroke[i - 1], stroke[i]);
    if (d < min) min = d;
  }
  return min;
}

function nearestNode(graph: SegmentGraph, p: Point): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [k, np] of graph.nodes) {
    const d = distance(p, np);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// Dijkstra from start to end, only traversing edges whose far node stays within
// `corridorPx` of the stroke (so we follow the traced wire, not a shortcut).
function shortestPath(
  graph: SegmentGraph,
  startKey: string,
  endKey: string,
  stroke: Point[],
  corridorPx: number
): Point[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(startKey, 0);
  // Simple priority selection (graphs here are small: a few hundred nodes).
  const pending = new Set<string>([startKey]);

  while (pending.size) {
    let u: string | null = null;
    let ud = Infinity;
    for (const k of pending) {
      const d = dist.get(k) ?? Infinity;
      if (d < ud) { ud = d; u = k; }
    }
    if (u === null) break;
    pending.delete(u);
    if (u === endKey) break;
    if (visited.has(u)) continue;
    visited.add(u);

    for (const edge of graph.adj.get(u) ?? []) {
      if (visited.has(edge.to)) continue;
      const np = graph.nodes.get(edge.to)!;
      if (distToStroke(np, stroke) > corridorPx) continue;
      const nd = ud + edge.len;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, u);
        pending.add(edge.to);
      }
    }
  }

  if (!dist.has(endKey)) return null;
  const path: Point[] = [];
  let cur: string | undefined = endKey;
  while (cur !== undefined) {
    path.unshift(graph.nodes.get(cur)!);
    cur = prev.get(cur);
  }
  return path.length >= 2 ? path : null;
}

// Fallback: an orthogonal L between two points; elbow direction chosen by which
// axis the stroke moved along first.
export function orthogonalElbow(a: Point, b: Point, stroke: Point[]): Point[] {
  if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) return [a, b]; // straight
  let horizontalFirst = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (stroke.length >= 2) {
    const dx = Math.abs(stroke[1].x - stroke[0].x);
    const dy = Math.abs(stroke[1].y - stroke[0].y);
    horizontalFirst = dx >= dy;
  }
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [a, corner, b];
}

export type RouteOptions = { corridorPx?: number };

// Produce the clean wire path between two already-snapped endpoints, following
// the underlying vector wire when the trace runs along real segments.
export function routeWire(
  stroke: Point[],
  start: Point,
  end: Point,
  graph: SegmentGraph,
  opts: RouteOptions = {}
): Point[] {
  const corridorPx = opts.corridorPx ?? 36;
  const startKey = nearestNode(graph, start);
  const endKey = nearestNode(graph, end);
  if (startKey && endKey && startKey !== endKey) {
    const path = shortestPath(graph, startKey, endKey, stroke, corridorPx);
    if (path) {
      // Replace the graph's endpoint nodes with the exact snapped endpoints.
      const out = [start, ...path.slice(1, -1), end];
      return dedupe(out);
    }
  }
  return orthogonalElbow(start, end, stroke);
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > 0.5) out.push(p);
  }
  return out.length >= 2 ? out : points;
}
