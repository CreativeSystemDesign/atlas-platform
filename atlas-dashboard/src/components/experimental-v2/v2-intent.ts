// The "smart canvas" semantic layer: interpret a freehand stroke as the
// schematic element the operator intends, snapped to the underlying PDF truth.
//
// - Wire mode:      trace a wire -> clean orthogonal path along the real vector
//                   wire, endpoints snapped to terminals/junctions, wire number
//                   auto-captured from nearby text.
// - Component mode: encircle a part -> bounding box of the enclosed artwork,
//                   labelled from the enclosed reference designator.

import { type Point, boundsOf, distance } from "./v2-geometry.ts";
import type { Rect } from "./v2-detect";
import {
  type PageGeometry,
  type SnapResult,
  type SnapKind,
  snapPoint,
  projectOntoSegment,
  groundClusterAtPoint,
  DEFAULT_SNAP_RADIUS_PX,
} from "./v2-snapping.ts";
import { routeWire } from "./v2-routing.ts";

export type WireIntent = {
  path: Point[];
  source: SnapResult | { point: Point; kind: "free" };
  target: SnapResult | { point: Point; kind: "free" };
  label: string | null;
};

export type ComponentIntent = {
  bbox: Rect;
  label: string | null;
};

export type IntentOptions = {
  snapRadiusPx?: number;
  corridorPx?: number;
  autoLabel?: boolean;
  kinds?: Set<SnapKind>;
};

const snapOrFree = (p: Point, geom: PageGeometry | null, radius: number, kinds?: Set<SnapKind>) =>
  snapPoint(p, geom, radius, kinds) ?? { point: p, kind: "free" as const };

// Reference designators look like F10, CT11, WHM10, MCB10, ELB12, PL10, K1...
const REF_RE = /^[A-Z]{1,4}\d{1,4}[A-Z]?$/;
// A confident wire number: clean uppercase alphanumeric with >=2 digits, e.g.
// R100, S101, T101, 101K, 102L, 1111, 1112. Excludes ratings/colors like
// "(3A)", "BK", "W", "100mA", "LPJ-3SP".
export function isWireNumber(token: string): boolean {
  // Wire numbers carry >=3 digits (R100, 101K, 1111, T101); component
  // designators carry <=2 (F10, PL10, CT11, WHM10) and are excluded.
  return /^[A-Z]{0,2}\d{3,4}[A-Z]?$/.test(token);
}

// --- Border-crossing detection (ghost terminals, Shane 2026-07-09) -----------
// "Use the machine we've built to automatically detect wires and create
// terminals on a rectangle that's drawn." A printed conductor crossing the
// drag-box border IS where a terminal belongs (terminals live ON the border;
// internals are never modeled — manufacturer doctrine). Detected live while dragging
// (the ghosts) and minted on commit. Print evidence only — no model, no guess.
export type BorderCrossing = {
  point: Point;
  side: "left" | "right" | "top" | "bottom";
  netLabel: string | null;
  // The printed PIN designator just INSIDE the border at this lead (FWD, X1,
  // 13, 23-L+…) — the [<pin>~] slot of the naming convention. Null when the
  // print offers none (the slot is then omitted, per doctrine).
  pinLabel: string | null;
};

// Phase/earth tokens (IEC/JIS): legitimate 0-2 digit net names the >=3-digit
// wire-number rule excludes on purpose. Scoped allowlist so R1/S1/T1/L1/G/PE
// name their terminals while designators (F10, PL10, K1) stay excluded.
const PHASE_TOKEN_RE = /^(?:[RSTUVWLN]\d{0,2}|G|PE|FG|E|N)$/;
// 24V control-rail nets (P24/N24/PC24/PL24/NL24…): 2-letter+2-digit names the
// >=3-digit wire rule excludes as designator-shaped. Shane ruled PL24 a net
// (2026-07-10, page 13 T2). Scoped to the 24 family — PL10 stays a pilot lamp.
const RAIL_24_RE = /^[PN][A-Z]?24$/;
const netToken = (raw: string): string | null => {
  const t = raw.trim().toUpperCase();
  return t && (isWireNumber(t) || PHASE_TOKEN_RE.test(t) || RAIL_24_RE.test(t)) ? t : null;
};

/** Is this printed token a plausible NET name (wire number / phase / rail)?
 *  Cable Ctrl-attach classifies on this: nets join the conductor roster,
 *  everything else (part numbers like MR-J2M-CN1TBL1M) is cable metadata. */
export function isNetToken(raw: string): boolean {
  return netToken(raw) !== null;
}

// Pin designators print VERBATIM inside the box beside the lead (doctrine:
// any characters except ~): FWD, REV, X1, 13, 23-L+, and function-annotated
// forms like X1(SS1) / Y1(RUN). Short tokens only — and never a rating/unit
// callout (3A, 250V, AC200V), which also print inside.
const PIN_TOKEN_RE = /^[A-Z0-9][A-Z0-9+\-./()]{0,7}$/;
const RATING_RE = /^(?:AC|DC)?\d+(?:\.\d+)?(?:A|V|W|VA|KW|MA|HZ)$/;
const pinToken = (raw: string): string | null => {
  const t = raw.trim().toUpperCase();
  return t && PIN_TOKEN_RE.test(t) && !RATING_RE.test(t) ? t : null;
};

// Printed earth tokens beside a ground glyph. Deliberately NO bare fallback:
// a conductor ending inside some unlabeled circle (a motor symbol!) must not
// claim a ground net — the token is the proof it's an earth reference.
const EARTH_TOKEN_RE = /^(?:G|FG|SG|PE|E|GND|EARTH)$/;

// Follow a conductor OUTWARD from a border crossing, through its bends, to
// where the run ends. Hops endpoint-to-endpoint using the geometry's own
// junction tolerance (~3px); bounded so a whole-page bus never gets walked.
function conductorEnd(
  geom: PageGeometry,
  start: Point,
  dir: Point,
  maxHops = 5
): Point | null {
  // Seed: the segment the crossing sits ON, aligned with the outward axis,
  // extending at least a little in that direction.
  let seed: { far: Point; back: Point } | null = null;
  for (const s of geom.segments) {
    const horiz = Math.abs(s.y2 - s.y1) <= 1.5 && Math.abs(s.x2 - s.x1) > 4;
    const vert = Math.abs(s.x2 - s.x1) <= 1.5 && Math.abs(s.y2 - s.y1) > 4;
    if (dir.x !== 0 ? !horiz : !vert) continue;
    if (projectOntoSegment(start, s).distance > 2) continue;
    const a = { x: s.x1, y: s.y1 }, b = { x: s.x2, y: s.y2 };
    const far = (b.x - a.x) * dir.x + (b.y - a.y) * dir.y > 0 ? b : a;
    if ((far.x - start.x) * dir.x + (far.y - start.y) * dir.y < 4) continue;
    seed = { far, back: far === b ? a : b };
    break;
  }
  if (!seed) return null;
  let cur = seed.far;
  const visited = new Set<string>();
  // The seed's inward endpoint is behind us — without this the first hop
  // walks straight back through the seed segment into the box.
  visited.add(`${Math.round(seed.back.x)},${Math.round(seed.back.y)}`);
  for (let hop = 0; hop < maxHops; hop++) {
    const key = `${Math.round(cur.x)},${Math.round(cur.y)}`;
    if (visited.has(key)) break;
    visited.add(key);
    let next: Point | null = null;
    for (const s of geom.segments) {
      // Axis-aligned conductor pieces only — the glyph's own circle (a
      // diagonal) must terminate the walk, not extend it.
      const horiz = Math.abs(s.y2 - s.y1) <= 1.5 && Math.abs(s.x2 - s.x1) > 4;
      const vert = Math.abs(s.x2 - s.x1) <= 1.5 && Math.abs(s.y2 - s.y1) > 4;
      if (!horiz && !vert) continue;
      const a = { x: s.x1, y: s.y1 }, b = { x: s.x2, y: s.y2 };
      const da = Math.hypot(a.x - cur.x, a.y - cur.y);
      const db = Math.hypot(b.x - cur.x, b.y - cur.y);
      const [near, farPt] = da <= db ? [da, b] : [db, a];
      if (near > 3) continue;
      const fKey = `${Math.round(farPt.x)},${Math.round(farPt.y)}`;
      if (visited.has(fKey)) continue;
      next = farPt;
      break;
    }
    if (!next) break;
    cur = next;
  }
  return cur;
}

export function detectBorderCrossings(
  bbox: { x: number; y: number; width: number; height: number },
  geom: PageGeometry | null,
  overhangPx = 8,
  labelWalkPx = 220,
  // The component's designator, when the caller has resolved it — excluded
  // from pin capture (INV70 printed near a lead is the owner, not a pin).
  ownerLabel: string | null = null,
  // Corner margin: a conductor grazing the very corner is border artwork /
  // ambiguous — demand the crossing land on the border's interior span.
  // Ground glyph boxes pass 0: on a ~26px box the margin eats the real stem.
  cornerMarginPx = 4
): BorderCrossing[] {
  if (!geom || bbox.width < 24 || bbox.height < 24) return [];
  const x0 = bbox.x, y0 = bbox.y, x1 = bbox.x + bbox.width, y1 = bbox.y + bbox.height;
  const m = cornerMarginPx;
  // A conductor earns a terminal two ways: it passes THROUGH the border
  // (extends >= overhang on both sides), or it TERMINATES at it — its run
  // ends within endTol of the border while extending >= overhang outward.
  // (Shane's catch, 2026-07-09: stop-at-component wires ARE terminals; the
  // pass-through-only test missed every one of them.)
  const endTol = 6;
  const out: BorderCrossing[] = [];
  for (const s of geom.segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    if (Math.abs(dy) <= 1.5 && Math.abs(dx) > 4) {
      const y = (s.y1 + s.y2) / 2;
      if (y < y0 + m || y > y1 - m) continue;
      const lo = Math.min(s.x1, s.x2), hi = Math.max(s.x1, s.x2);
      // LEFT border: pass-through, or run ending at it from outside.
      if ((lo < x0 - overhangPx && hi > x0 + overhangPx) ||
          (lo < x0 - overhangPx && Math.abs(hi - x0) <= endTol))
        out.push({ point: { x: x0, y }, side: "left", netLabel: null, pinLabel: null });
      if ((lo < x1 - overhangPx && hi > x1 + overhangPx) ||
          (hi > x1 + overhangPx && Math.abs(lo - x1) <= endTol))
        out.push({ point: { x: x1, y }, side: "right", netLabel: null, pinLabel: null });
    } else if (Math.abs(dx) <= 1.5 && Math.abs(dy) > 4) {
      const x = (s.x1 + s.x2) / 2;
      if (x < x0 + m || x > x1 - m) continue;
      const lo = Math.min(s.y1, s.y2), hi = Math.max(s.y1, s.y2);
      if ((lo < y0 - overhangPx && hi > y0 + overhangPx) ||
          (lo < y0 - overhangPx && Math.abs(hi - y0) <= endTol))
        out.push({ point: { x, y: y0 }, side: "top", netLabel: null, pinLabel: null });
      if ((lo < y1 - overhangPx && hi > y1 + overhangPx) ||
          (hi > y1 + overhangPx && Math.abs(lo - y1) <= endTol))
        out.push({ point: { x, y: y1 }, side: "bottom", netLabel: null, pinLabel: null });
    }
  }
  // Dedupe multi-strand/doubled linework: crossings on one side within 6px
  // are one conductor.
  const deduped: BorderCrossing[] = [];
  for (const c of out.sort((a, b) => a.side.localeCompare(b.side) || a.point.x - b.point.x || a.point.y - b.point.y)) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.side === c.side && Math.hypot(prev.point.x - c.point.x, prev.point.y - c.point.y) <= 6) continue;
    deduped.push(c);
  }
  if (deduped.length > 40) return []; // implausible box (whole-page drag) — stand down
  // Net labels: WALK outward along the conductor (Shane's catch: "the wire
  // labels are too far away" — numbers print along the run, often nowhere
  // near the component). Sample every 36px out to ~220px; at each step scan
  // the texts within reach and take the FIRST recognizable net token —
  // wire numbers (>=3 digits) or phase/earth tokens (R1/S1/T1/L1/G/PE).
  for (const c of deduped) {
    const dir =
      c.side === "left" ? { x: -1, y: 0 } :
      c.side === "right" ? { x: 1, y: 0 } :
      c.side === "top" ? { x: 0, y: -1 } :
      { x: 0, y: 1 };
    // Lateral discipline (Shane's T2 calibration, 2026-07-10): wire numbers
    // print ON their conductor's row/column (measured lat 10-19px on the
    // the reference machine); a NEIGHBOR row's number sits ~29px off and used to get grabbed
    // by the purely radial probe (30C once took X3810 from the row above).
    const lateralOf = (t: { center: Point }) =>
      dir.x !== 0 ? Math.abs(t.center.y - c.point.y) : Math.abs(t.center.x - c.point.x);
    outer: for (let step = 20; step <= labelWalkPx; step += 36) {
      const probe = { x: c.point.x + dir.x * step, y: c.point.y + dir.y * step };
      // All texts within reach of this probe, nearest first — not just the
      // single nearest (which is often a rating/gauge callout, not the net).
      const near = geom.texts
        .map((t) => ({ t, d: Math.hypot(t.center.x - probe.x, t.center.y - probe.y) }))
        .filter((e) => e.d <= 34 && lateralOf(e.t) <= 24)
        .sort((a, b) => a.d - b.d);
      for (const e of near) {
        const token = netToken(e.t.text);
        if (token) { c.netLabel = token; break outer; }
      }
    }
  }
  // Pin designators: walk INWARD along the conductor (Shane's catch,
  // 2026-07-09: T~INV70~Y4200 was missing its printed FWD — the [<pin>~]
  // slot the convention reserves). Measured on the reference print (page 13
  // INV70): pins print ON their lead's row (FWD dy=0, X4 dy=1, CM dy=0),
  // 44-72px inside the PRINTED border — deeper when the drawn box is
  // oversized, so the walk goes deep while the tight LATERAL gate is what
  // keeps a 42px-pitch strip's neighbors out. The mirror of the outward
  // net-label walk: one axis-aligned search each way from the crossing.
  const owner = ownerLabel?.trim().toUpperCase() ?? null;
  const PIN_DEPTH = 130;
  const PIN_LATERAL = 16;
  for (const c of deduped) {
    const horizontal = c.side === "left" || c.side === "right";
    const inSign = c.side === "left" || c.side === "top" ? 1 : -1;
    const candidates = geom.texts
      .filter((t) => t.center.x > x0 && t.center.x < x1 && t.center.y > y0 && t.center.y < y1)
      .map((t) => ({
        t,
        depth: horizontal ? (t.center.x - c.point.x) * inSign : (t.center.y - c.point.y) * inSign,
        lateral: horizontal ? Math.abs(t.center.y - c.point.y) : Math.abs(t.center.x - c.point.x),
      }))
      .filter((e) => e.depth >= 4 && e.depth <= PIN_DEPTH && e.lateral <= PIN_LATERAL)
      .sort((a, b) => a.depth - b.depth);
    for (const e of candidates) {
      const token = pinToken(e.t.text);
      if (!token) continue;
      if (owner && token === owner) continue; // the designator is not a pin
      if (c.netLabel && token === c.netLabel) continue; // net text leaking inside
      c.pinLabel = token;
      break;
    }
  }
  // Grounded conductors (Shane, 2026-07-10: the INV70 ground tap had to be
  // hand-named): a run that ends at a printed earth glyph carries the earth
  // net even though no wire number prints along it — the glyph's label sits
  // beside the SYMBOL, past the bend, invisible to the straight walk. Follow
  // the conductor through its bends; if it lands on a ground cluster WITH a
  // printed earth token, that token is the net. Runs AFTER the pin scan so a
  // printed pin "G" still captures (T~INV70~G~G: both slots are print facts).
  for (const c of deduped) {
    if (c.netLabel) continue; // a printed wire number always wins
    const dir =
      c.side === "left" ? { x: -1, y: 0 } :
      c.side === "right" ? { x: 1, y: 0 } :
      c.side === "top" ? { x: 0, y: -1 } :
      { x: 0, y: 1 };
    const end = conductorEnd(geom, c.point, dir);
    if (!end) continue;
    const cluster = groundClusterAtPoint(geom, end, { seedRadiusPx: 20 });
    if (!cluster) continue;
    const gc = { x: cluster.x + cluster.width / 2, y: cluster.y + cluster.height / 2 };
    const tok = geom.texts
      .map((t) => ({ t, d: Math.hypot(t.center.x - gc.x, t.center.y - gc.y) }))
      .filter((e) => e.d <= 60)
      .sort((a, b) => a.d - b.d)
      .map((e) => e.t.text.trim().toUpperCase())
      .find((t) => EARTH_TOKEN_RE.test(t));
    if (tok) c.netLabel = tok;
  }
  return deduped;
}

/** The printed cable name beside a traced bundle (CAB21). Conservative:
 *  only CAB-prefixed tokens qualify — a wrong cable identity would corrupt
 *  the document-level registry it keys. */
/** The printed cable name on/beside the boxed bundle symbol (CAB21).
 *  Conservative: only CAB-prefixed tokens qualify — a wrong cable identity
 *  would corrupt the document-level registry it keys. */
const CABLE_NAME_RE = /^CAB\d{1,3}[A-Z]?$/;
export function cableLabelNear(
  bbox: { x: number; y: number; width: number; height: number },
  geom: PageGeometry | null,
  reachPx = 80
): string | null {
  if (!geom) return null;
  const x0 = bbox.x - reachPx, x1 = bbox.x + bbox.width + reachPx;
  const y0 = bbox.y - reachPx, y1 = bbox.y + bbox.height + reachPx;
  const cx = bbox.x + bbox.width / 2, cy = bbox.y + bbox.height / 2;
  let best: { tok: string; d: number } | null = null;
  for (const t of geom.texts) {
    const tok = t.text.trim().toUpperCase();
    if (!CABLE_NAME_RE.test(tok)) continue;
    if (t.center.x < x0 || t.center.x > x1 || t.center.y < y0 || t.center.y > y1) continue;
    const d = Math.hypot(t.center.x - cx, t.center.y - cy);
    if (!best || d < best.d) best = { tok, d };
  }
  return best?.tok ?? null;
}

/** Border terminals for a GROUND box (Shane, 2026-07-10: "adding a terminal
 *  to the ground border on the wire" — the component-box engine, applied to
 *  the glyph's snug box). Net = printed token along the conductor when the
 *  walk finds one, else the ground's own label — the earth net IS this
 *  conductor's net. Pure: returns specs; callers mint ids and dedupe. */
export function groundBorderTerminals(
  bbox: { x: number; y: number; width: number; height: number },
  groundLabel: string,
  geom: PageGeometry | null,
  labelWalkPx = 220
): { point: Point; label: string }[] {
  // Corner margin 0 (a ~26px box has no interior span to spare), then keep
  // only crossings whose run CHAINS onward: a real conductor travels ≥20px
  // outward (through segment splits — the bare IEC glyph's stem is often cut
  // 9px above the box), while the glyph's own bars poke out and dead-end.
  return detectBorderCrossings(bbox, geom, 6, labelWalkPx, groundLabel, 0)
    .filter((c) => {
      if (!geom) return false;
      const dir =
        c.side === "left" ? { x: -1, y: 0 } :
        c.side === "right" ? { x: 1, y: 0 } :
        c.side === "top" ? { x: 0, y: -1 } :
        { x: 0, y: 1 };
      const end = conductorEnd(geom, c.point, dir);
      return !!end && Math.hypot(end.x - c.point.x, end.y - c.point.y) >= 20;
    })
    .map((c) => ({
      point: c.point,
      label: `T~${groundLabel}~${c.pinLabel ? `${c.pinLabel}~` : ""}${c.netLabel ?? groundLabel}`,
    }));
}

// Auto-capture only a confident wire number near the path; otherwise leave it
// blank so the operator fills it in (a wrong number is worse than none).
function labelAlongPath(
  path: Point[],
  geom: PageGeometry,
  radius: number
): string | null {
  let best: string | null = null;
  let bestDist = radius;
  for (const t of geom.texts) {
    const token = t.text.trim();
    if (!isWireNumber(token)) continue;
    // Distance to the path's line segments (not just its vertices) — a label
    // sits mid-span on a long straight wire, far from either endpoint.
    let min = path.length === 1 ? distance(path[0], t.center) : Infinity;
    for (let i = 1; i < path.length; i++) {
      const d = projectOntoSegment(t.center, {
        x1: path[i - 1].x, y1: path[i - 1].y, x2: path[i].x, y2: path[i].y,
      }).distance;
      if (d < min) min = d;
    }
    if (min <= bestDist) {
      bestDist = min;
      best = token;
    }
  }
  return best;
}

export function interpretWireStroke(
  stroke: Point[],
  geom: PageGeometry | null,
  opts: IntentOptions = {}
): WireIntent {
  const radius = opts.snapRadiusPx ?? DEFAULT_SNAP_RADIUS_PX;
  const autoLabel = opts.autoLabel ?? true;
  const start = stroke[0];
  const end = stroke[stroke.length - 1];

  const source = snapOrFree(start, geom, radius, opts.kinds);
  const target = snapOrFree(end, geom, radius, opts.kinds);

  let path: Point[];
  if (geom) {
    path = routeWire(stroke, source.point, target.point, geom.segmentGraph, {
      corridorPx: opts.corridorPx,
    });
  } else {
    path = [source.point, target.point];
  }

  // Wire numbers sit just off their line; search a bit wider than the snap
  // radius, but not so wide we grab the adjacent parallel wire's number.
  const labelRadius = Math.max(radius * 2, 72);
  const label = autoLabel && geom ? labelAlongPath(path, geom, labelRadius) : null;
  return { path, source, target, label };
}

// Pick the reference designator inside a component box.
function componentLabel(bbox: Rect, geom: PageGeometry): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  for (const t of geom.texts) {
    const inside =
      t.center.x >= bbox.x &&
      t.center.x <= bbox.x + bbox.width &&
      t.center.y >= bbox.y &&
      t.center.y <= bbox.y + bbox.height;
    if (!inside) continue;
    const token = t.text.trim();
    if (!token) continue;
    const d = Math.hypot(t.center.x - cx, t.center.y - cy);
    const score = d + (REF_RE.test(token) ? 0 : 10000);
    if (score < bestScore) {
      bestScore = score;
      best = token;
    }
  }
  return best;
}

export function interpretComponentStroke(
  stroke: Point[],
  geom: PageGeometry | null,
  opts: IntentOptions = {}
): ComponentIntent {
  const autoLabel = opts.autoLabel ?? true;
  const b = boundsOf(stroke);
  let bbox: Rect = { x: b.x, y: b.y, width: b.width, height: b.height };

  if (geom) {
    // Snap to the union of detected component boxes whose center the encircle
    // contains; this locks the box to the real artwork instead of the wobble.
    const enclosed = geom.components.filter((c) => {
      const ccx = c.bbox.x + c.bbox.width / 2;
      const ccy = c.bbox.y + c.bbox.height / 2;
      return ccx >= b.x && ccx <= b.x + b.width && ccy >= b.y && ccy <= b.y + b.height;
    });
    if (enclosed.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of enclosed) {
        minX = Math.min(minX, c.bbox.x);
        minY = Math.min(minY, c.bbox.y);
        maxX = Math.max(maxX, c.bbox.x + c.bbox.width);
        maxY = Math.max(maxY, c.bbox.y + c.bbox.height);
      }
      bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
  }

  const label = autoLabel && geom ? componentLabel(bbox, geom) : null;
  return { bbox, label };
}
