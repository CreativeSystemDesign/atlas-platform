// Snapping the v2 overlay onto the actual PDF vector artwork.
//
// The workbench /metadata endpoint returns, per page:
//   - scale:        PDF-point -> render-pixel factor (300dpi => ~4.1667)
//   - shapes[]:     vector drawings as bbox [x0,y0,x1,y1] in PDF points. For
//                   schematic lines these are degenerate rects, i.e. the wire
//                   segment itself.
//   - text_blocks[]: { text, bbox } label geometry in PDF points.
//
// We convert all of that into render-pixel space (the same space the overlay
// graph and the displayed page image use) and build a uniform-grid spatial
// index so cursor snapping stays O(1) regardless of page size.

import { type Point, distance } from "./v2-geometry.ts";
import {
  type Terminal,
  type ComponentBox,
  type ShapePx,
  type DetectOptions,
  detectTerminals,
  detectComponents,
} from "./v2-detect.ts";
import { buildSegmentGraph, type SegmentGraph } from "./v2-routing.ts";

export type { Terminal, ComponentBox } from "./v2-detect";

export type RawPageMetadata = {
  scale: number;
  shapes: Array<{ bbox: [number, number, number, number] }>;
  text_blocks: Array<{ text: string; bbox: [number, number, number, number] }>;
};

export type Segment = { x1: number; y1: number; x2: number; y2: number };
export type TextItem = {
  text: string;
  center: Point;
  bbox: { x: number; y: number; width: number; height: number };
};

export type PageGeometry = {
  scale: number;
  segments: Segment[];
  endpoints: Point[];
  junctions: Point[];
  terminals: Terminal[];
  components: ComponentBox[];
  texts: TextItem[];
  index: SnapIndex;
  segmentGraph: SegmentGraph;
};

export type SnapKind = "terminal" | "junction" | "endpoint" | "segment";
export type SnapResult = { point: Point; kind: SnapKind; distance: number; label?: string | null };

export const DEFAULT_SNAP_RADIUS_PX = 28;
const GRID_CELL_PX = 32;
const JUNCTION_CLUSTER_PX = 3; // endpoints within this distance are one node
const JUNCTION_MIN_DEGREE = 3; // a node where >=3 segment-ends meet is a junction

// --- Build px geometry from raw metadata --------------------------------------
export function buildPageGeometry(
  meta: RawPageMetadata,
  detectOpts: DetectOptions = {}
): PageGeometry {
  const s = meta.scale || 1;

  // px-space shapes. A shape whose bbox is a line (zero width or height) is a
  // wire segment; small square-ish blobs are terminals; larger boxes are parts.
  const shapesPx: ShapePx[] = meta.shapes.map((shape) => ({
    x0: shape.bbox[0] * s,
    y0: shape.bbox[1] * s,
    x1: shape.bbox[2] * s,
    y1: shape.bbox[3] * s,
  }));

  const segments: Segment[] = shapesPx.map((p) => ({ x1: p.x0, y1: p.y0, x2: p.x1, y2: p.y1 }));

  const endpoints: Point[] = [];
  for (const seg of segments) {
    endpoints.push({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
  }

  const junctions = computeJunctions(endpoints);

  const texts: TextItem[] = meta.text_blocks.map((t) => {
    const x = t.bbox[0] * s;
    const y = t.bbox[1] * s;
    const width = (t.bbox[2] - t.bbox[0]) * s;
    const height = (t.bbox[3] - t.bbox[1]) * s;
    return {
      // Normalize full-width CJK digits/letters (１２１２ -> 1212, Ｒ -> R) so
      // wire numbers and designators match downstream.
      text: t.text.normalize("NFKC"),
      bbox: { x, y, width, height },
      center: { x: x + width / 2, y: y + height / 2 },
    };
  });

  const textsLite = texts.map((t) => ({ text: t.text, center: t.center }));
  const terminals = detectTerminals(shapesPx, textsLite, detectOpts);
  const components = detectComponents(shapesPx, textsLite, detectOpts);

  const index = buildSnapIndex(endpoints, junctions, segments, terminals);
  const segmentGraph = buildSegmentGraph(segments);
  return { scale: s, segments, endpoints, junctions, terminals, components, texts, index, segmentGraph };
}

// Cluster coincident endpoints; a cluster fed by >=3 segment ends is a junction.
export function computeJunctions(endpoints: Point[]): Point[] {
  const buckets = new Map<string, { sum: Point; count: number }>();
  for (const p of endpoints) {
    const k = `${Math.round(p.x / JUNCTION_CLUSTER_PX)},${Math.round(p.y / JUNCTION_CLUSTER_PX)}`;
    const b = buckets.get(k);
    if (b) {
      b.sum.x += p.x;
      b.sum.y += p.y;
      b.count += 1;
    } else {
      buckets.set(k, { sum: { x: p.x, y: p.y }, count: 1 });
    }
  }
  const junctions: Point[] = [];
  for (const b of buckets.values()) {
    if (b.count >= JUNCTION_MIN_DEGREE) {
      junctions.push({ x: b.sum.x / b.count, y: b.sum.y / b.count });
    }
  }
  return junctions;
}

// --- Spatial index ------------------------------------------------------------
export type SnapIndex = {
  cell: number;
  terminals: Map<string, Terminal[]>;
  endpoints: Map<string, Point[]>;
  junctions: Map<string, Point[]>;
  segments: Map<string, Segment[]>;
};

function cellKey(x: number, y: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function buildSnapIndex(
  endpoints: Point[],
  junctions: Point[],
  segments: Segment[],
  terminals: Terminal[] = []
): SnapIndex {
  const cell = GRID_CELL_PX;
  const tMap = new Map<string, Terminal[]>();
  const epMap = new Map<string, Point[]>();
  const jMap = new Map<string, Point[]>();
  const segMap = new Map<string, Segment[]>();

  for (const t of terminals) pushTo(tMap, cellKey(t.point.x, t.point.y, cell), t);
  for (const p of endpoints) pushTo(epMap, cellKey(p.x, p.y, cell), p);
  for (const p of junctions) pushTo(jMap, cellKey(p.x, p.y, cell), p);

  // Index each segment into every cell its (axis-aligned) bbox covers. Schematic
  // wires are short axis lines, so this stays cheap.
  for (const seg of segments) {
    const minCx = Math.floor(Math.min(seg.x1, seg.x2) / cell);
    const maxCx = Math.floor(Math.max(seg.x1, seg.x2) / cell);
    const minCy = Math.floor(Math.min(seg.y1, seg.y2) / cell);
    const maxCy = Math.floor(Math.max(seg.y1, seg.y2) / cell);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        pushTo(segMap, `${cx},${cy}`, seg);
      }
    }
  }
  return { cell, terminals: tMap, endpoints: epMap, junctions: jMap, segments: segMap };
}

function gatherNearby<T>(map: Map<string, T[]>, p: Point, cell: number): T[] {
  const cx = Math.floor(p.x / cell);
  const cy = Math.floor(p.y / cell);
  const out: T[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const arr = map.get(`${cx + dx},${cy + dy}`);
      if (arr) out.push(...arr);
    }
  }
  return out;
}

function nearestPoint(point: Point, candidates: Point[], radius: number): { point: Point; distance: number } | null {
  let best: Point | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = distance(point, c);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { point: best, distance: bestD } : null;
}

// Closest point on a segment to p (clamped projection).
export function projectOntoSegment(p: Point, seg: Segment): { point: Point; distance: number } {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const pt = { x: seg.x1, y: seg.y1 };
    return { point: pt, distance: distance(p, pt) };
  }
  let t = ((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const pt = { x: seg.x1 + t * dx, y: seg.y1 + t * dy };
  return { point: pt, distance: distance(p, pt) };
}

// --- Snap query ---------------------------------------------------------------
// Priority: junction > endpoint > on-segment. Returns null when nothing is in
// range so the caller falls back to the raw cursor point.
export function snapPoint(
  point: Point,
  geometry: PageGeometry | null,
  radius: number = DEFAULT_SNAP_RADIUS_PX,
  kinds?: Set<SnapKind>
): SnapResult | null {
  if (!geometry) return null;
  const { index } = geometry;
  const on = (k: SnapKind) => !kinds || kinds.has(k);

  // Terminals (the connection circles) are the highest-value snap targets.
  if (on("terminal")) {
    let bestTerminal: { t: Terminal; d: number } | null = null;
    for (const t of gatherNearby(index.terminals, point, index.cell)) {
      const d = distance(point, t.point);
      if (d <= radius && (!bestTerminal || d < bestTerminal.d)) bestTerminal = { t, d };
    }
    if (bestTerminal) {
      return {
        point: bestTerminal.t.point,
        kind: "terminal",
        distance: bestTerminal.d,
        label: bestTerminal.t.label,
      };
    }
  }

  if (on("junction")) {
    const j = nearestPoint(point, gatherNearby(index.junctions, point, index.cell), radius);
    if (j) return { point: j.point, kind: "junction", distance: j.distance };
  }

  if (on("endpoint")) {
    const e = nearestPoint(point, gatherNearby(index.endpoints, point, index.cell), radius);
    if (e) return { point: e.point, kind: "endpoint", distance: e.distance };
  }

  if (on("segment")) {
    let best: SnapResult | null = null;
    for (const seg of gatherNearby(index.segments, point, index.cell)) {
      const proj = projectOntoSegment(point, seg);
      if (proj.distance <= radius && (!best || proj.distance < best.distance)) {
        best = { point: proj.point, kind: "segment", distance: proj.distance };
      }
    }
    if (best) return best;
  }
  return null;
}

// Nearest text block to a point (for label suggestion) within radius.
export function nearestText(
  point: Point,
  geometry: PageGeometry | null,
  radius: number
): TextItem | null {
  if (!geometry) return null;
  let best: TextItem | null = null;
  let bestD = radius;
  for (const t of geometry.texts) {
    const d = distance(point, t.center);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

// --- Ground glyph snap (click-to-fit) -----------------------------------------
// The Ground tool: Shane clicks a ground symbol and we fit a snug box to it.
// These schematics enclose the earth glyph in a CIRCLE, and the box must hug
// just that circle (leaving the stem + glyph free for a later ground terminal
// and tap) — so the primary path finds the squarish, glyph-scale diagonal shape
// (a circle/box bbox) at the click and boxes it. For a bare ▽/earth glyph with
// no enclosing circle, we fall back to a bounded flood-fill of the stem + bars
// that stops where the glyph meets its conductor (a naive fill would run away
// down the attached wire).
type Rect = { x: number; y: number; width: number; height: number };

function pointSegDist(p: Point, s: Segment): number {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - s.x1, p.y - s.y1);
  let t = ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy));
}

function bboxOfSegs(segs: Segment[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function groundClusterAtPoint(
  geometry: PageGeometry | null,
  point: Point,
  opts: { seedRadiusPx?: number; connectTolPx?: number; maxGlyphPx?: number } = {}
): Rect | null {
  if (!geometry) return null;
  const seedR = opts.seedRadiusPx ?? 36;
  const connTol = opts.connectTolPx ?? 5;
  const maxGlyph = opts.maxGlyphPx ?? 170;

  // These schematics draw a ground as an enclosing CIRCLE with the earth glyph
  // (stem + stacked bars) inside it — and Shane wants the box to hug JUST the
  // circle, leaving the stem/glyph free for a later ground terminal + tap.
  // Every raw vector shape becomes a Segment spanning its bbox corners, so a
  // circle/box is a DIAGONAL segment (both dx and dy substantial), while wires,
  // the stem, and the earth bars are axis-aligned (one of dx/dy ~0). So the
  // circle is the squarish, glyph-scale diagonal shape at the click. Box that.
  const CIRCLE_MIN_SIDE_PX = 12; // ignore tiny junction dots / stroke ends
  const candidates: Rect[] = [];
  let containing: Rect | null = null;
  let containingArea = Infinity;
  let nearest: Rect | null = null;
  let nearestDist = Infinity;
  for (const seg of geometry.segments) {
    const w = Math.abs(seg.x2 - seg.x1);
    const h = Math.abs(seg.y2 - seg.y1);
    if (w < CIRCLE_MIN_SIDE_PX || h < CIRCLE_MIN_SIDE_PX) continue; // a line, not a box
    if (w > maxGlyph || h > maxGlyph) continue; // too big to be a glyph
    const ar = w / h;
    if (ar < 0.55 || ar > 1.8) continue; // not squarish → not the ground circle
    const x = Math.min(seg.x1, seg.x2);
    const y = Math.min(seg.y1, seg.y2);
    const cx = x + w / 2, cy = y + h / 2;
    const box: Rect = { x, y, width: w, height: h };
    candidates.push(box);
    if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
      // Click landed inside the circle: prefer the smallest such (inner ring).
      const area = w * h;
      if (area < containingArea) { containing = box; containingArea = area; }
    } else {
      // Near-miss on the ring: remember the closest within a snap radius.
      const d = Math.hypot(point.x - cx, point.y - cy);
      if (d <= Math.max(seedR, Math.max(w, h) / 2) && d < nearestDist) {
        nearest = box; nearestDist = d;
      }
    }
  }
  const circle = containing ?? nearest;
  if (circle) {
    // The circle often arrives as FOUR QUADRANT ARCS, each itself a squarish
    // diagonal shape (Shane's catch, 2026-07-10: the box hugged one quadrant
    // of the machine-frame ground). Union the clicked shape with every
    // TOUCHING squarish sibling until stable — one shape or four, the box is
    // the whole ring. The glyph-scale cap keeps the union from swallowing a
    // neighboring symbol.
    const touches = (a: Rect, b: Rect, tol = 3) =>
      a.x <= b.x + b.width + tol && b.x <= a.x + a.width + tol &&
      a.y <= b.y + b.height + tol && b.y <= a.y + a.height + tol;
    const ring: Rect[] = [circle];
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of candidates) {
        if (ring.includes(c)) continue;
        if (!ring.some((u) => touches(u, c))) continue;
        const minX = Math.min(...ring.map((u) => u.x), c.x);
        const minY = Math.min(...ring.map((u) => u.y), c.y);
        const maxX = Math.max(...ring.map((u) => u.x + u.width), c.x + c.width);
        const maxY = Math.max(...ring.map((u) => u.y + u.height), c.y + c.height);
        if (maxX - minX > maxGlyph || maxY - minY > maxGlyph) continue;
        ring.push(c);
        grew = true;
      }
    }
    const rx0 = Math.min(...ring.map((u) => u.x));
    const ry0 = Math.min(...ring.map((u) => u.y));
    const rx1 = Math.max(...ring.map((u) => u.x + u.width));
    const ry1 = Math.max(...ring.map((u) => u.y + u.height));
    const pad = 2; // hug the ring, don't clip its stroke
    return { x: rx0 - pad, y: ry0 - pad, width: rx1 - rx0 + 2 * pad, height: ry1 - ry0 + 2 * pad };
  }

  // Fallback — a bare IEC earth glyph with NO enclosing circle (pure stem +
  // bars). Bounded flood-fill that hugs the glyph and stops where it meets its
  // conductor.
  // Pre-filter to segments in a local window around the click — the glyph is
  // small, so there is no need to scan the whole page (keeps this O(local)).
  const win = maxGlyph + seedR;
  const local = geometry.segments.filter(
    (s) => pointSegDist(point, s) <= win
  );
  if (local.length === 0) return null;

  // A seed must be a SHORT, glyph-scale stroke near the click — a long
  // conductor the click happens to lie on (a stem collinear with its wire)
  // must never seed the cluster, or the box engulfs the whole conductor.
  const segLen = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const seeds = local.filter((s) => pointSegDist(point, s) <= seedR && segLen(s) <= maxGlyph);
  if (seeds.length === 0) return null;

  const included: Segment[] = [...seeds];
  const ends = (s: Segment) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
  let changed = true;
  while (changed) {
    changed = false;
    const inclEnds = included.flatMap(ends);
    for (const cand of local) {
      if (included.includes(cand)) continue;
      const touches = ends(cand).some((p) =>
        inclEnds.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= connTol)
      );
      if (!touches) continue;
      const bb = bboxOfSegs([...included, cand]);
      if (bb.width <= maxGlyph && bb.height <= maxGlyph) {
        included.push(cand);
        changed = true;
      }
    }
  }

  const bb = bboxOfSegs(included);
  const pad = 3; // hug, don't clip
  return { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: bb.height + 2 * pad };
}
