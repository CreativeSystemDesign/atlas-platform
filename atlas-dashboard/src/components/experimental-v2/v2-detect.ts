// Interpret raw PDF vector shapes into the schematic's semantic primitives:
// terminals (the connection circles/dots) and component outlines. Pure; works
// on px-space bboxes derived from the /metadata `shapes`.

import { type Point, distance } from "./v2-geometry.ts";
import { assignLabels } from "./v2-labeling.ts";

export type Rect = { x: number; y: number; width: number; height: number };
export type ShapePx = { x0: number; y0: number; x1: number; y1: number };
export type TextItemLite = { text: string; center: Point };

export type Terminal = { point: Point; label: string | null };
export type ComponentBox = { bbox: Rect; label: string | null };

// Terminal circles render as ~10px blobs; junction dots are smaller; both are
// valid connection points. Tunable via opts so the settings panel can adjust.
export type DetectOptions = {
  terminalMaxPx?: number; // largest blob that counts as a terminal
  clusterPx?: number; // merge blobs whose centers are this close
  labelRadiusPx?: number; // attach the nearest short text within this radius
  componentMinPx?: number; // smallest box side that counts as a component
  componentMaxPx?: number; // largest box side (excludes the page border)
};

const DEFAULTS = {
  // Numbered connection circles render ~33px; small junction dots ~8-12px.
  terminalMaxPx: 42,
  clusterPx: 18,
  labelRadiusPx: 40,
  // A component box's longest side must reach this (fuses are ~50x21, the
  // WHM10 box much larger); excludes terminal circles and dots.
  componentMinPx: 40,
  componentMaxPx: 1800,
};

// A square-ish blob (circle/dot) vs. a rectangle (box).
const isSquarish = (w: number, h: number) => {
  const ar = w / h;
  return ar > 0.55 && ar < 1.8;
};

function bboxOf(s: ShapePx) {
  const x = Math.min(s.x0, s.x1);
  const y = Math.min(s.y0, s.y1);
  return { x, y, width: Math.abs(s.x1 - s.x0), height: Math.abs(s.y1 - s.y0) };
}

const isShortLabel = (t: string) => {
  const v = t.trim();
  return v.length > 0 && v.length <= 6;
};

function nearestLabel(
  point: Point,
  texts: TextItemLite[],
  radius: number
): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const t of texts) {
    const d = distance(point, t.center);
    if (d > radius) continue;
    // Prefer short tokens (terminal numbers/letters) and closer ones.
    const score = d + (isShortLabel(t.text) ? 0 : radius);
    if (score < bestScore) {
      bestScore = score;
      best = t.text.trim();
    }
  }
  return best;
}

// Cluster small square-ish blobs into terminal points, then label each from the
// nearest short text.
export function detectTerminals(
  shapes: ShapePx[],
  texts: TextItemLite[],
  opts: DetectOptions = {}
): Terminal[] {
  const o = { ...DEFAULTS, ...opts };
  const centers: Point[] = [];
  for (const s of shapes) {
    const b = bboxOf(s);
    if (b.width < 1 || b.height < 1) continue;
    if (b.width > o.terminalMaxPx || b.height > o.terminalMaxPx) continue;
    const ar = b.width / b.height;
    if (ar < 0.4 || ar > 2.5) continue;
    centers.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }

  // Single-link clustering by proximity.
  const used = new Array(centers.length).fill(false);
  const points: Point[] = [];
  for (let i = 0; i < centers.length; i++) {
    if (used[i]) continue;
    const members = [centers[i]];
    used[i] = true;
    for (let j = i + 1; j < centers.length; j++) {
      if (used[j]) continue;
      if (members.some((m) => distance(m, centers[j]) <= o.clusterPx)) {
        members.push(centers[j]);
        used[j] = true;
      }
    }
    points.push({
      x: members.reduce((a, m) => a + m.x, 0) / members.length,
      y: members.reduce((a, m) => a + m.y, 0) / members.length,
    });
  }

  // Density-aware one-to-one assignment of short labels to terminals: each
  // number/letter binds to exactly one circle, so packed terminal arrays don't
  // cross-label. Wire numbers and designators are excluded (handled elsewhere).
  const candidates = texts
    .filter((t) => isShortLabel(t.text) && !/\d{3,}/.test(t.text))
    .map((t) => ({ text: t.text.trim(), center: t.center }));
  const assigned = assignLabels(points, candidates, o.labelRadiusPx);

  return points.map((point, i) => ({ point, label: assigned.get(i) ?? null }));
}

// Component outlines: boxes large enough to be a part, excluding lines and the
// page border. Labelled from an enclosed/adjacent reference designator.
export function detectComponents(
  shapes: ShapePx[],
  texts: TextItemLite[],
  opts: DetectOptions = {}
): ComponentBox[] {
  const o = { ...DEFAULTS, ...opts };
  const out: ComponentBox[] = [];
  for (const s of shapes) {
    const b = bboxOf(s);
    const maxDim = Math.max(b.width, b.height);
    const minDim = Math.min(b.width, b.height);
    // Skip terminal-sized circles/dots (they're handled as terminals).
    if (isSquarish(b.width, b.height) && maxDim <= o.terminalMaxPx) continue;
    // A part: long enough to be a box, not a hairline, within the page border.
    if (maxDim < o.componentMinPx || minDim < 8) continue;
    if (maxDim > o.componentMaxPx) continue;
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    out.push({ bbox: b, label: nearestLabel(center, texts, o.labelRadiusPx) });
  }
  return out;
}
