// Cross-sheet link routing (Shane, 2026-07-11). Extracted from the scene into
// a PURE, TESTABLE module after a night of geometry bugs proved that inline,
// untestable routing is where the regressions hide.
//
// Model: a bundle is a rigid flat RIBBON. ONE centerline routes for the whole
// bundle; every conductor is a fixed parallel offset of it at a FIXED rank
// spacing (0, ±pitch, ±2·pitch, …). Fixed distinct offsets are what make the
// wedge impossible: offsetOrthogonal preserves each offset through every
// right-angle turn, so N conductors can never collapse onto each other no
// matter how the centerline bends. Short breakouts fan each conductor from its
// chip onto its slot — like a real harness leaving a terminal block.

import {
  offsetOrthogonal,
  routeOrthogonal,
  simplifyOrthogonal,
  straightenOrthogonal,
  type PlanPoint,
  type Rect,
} from "./mg3d-route.ts";

export type Conductor = {
  /** Endpoint on the SOURCE side (already outside its sheet, plan space). */
  s: PlanPoint;
  /** Endpoint on the DESTINATION side (already outside its sheet). */
  d: PlanPoint;
};

export type RibbonOptions = {
  /** Perpendicular launch distance off each sheet before the ribbon turns —
   * long enough to clear the chip fan-out. */
  launch: number;
};

export type BundleOptions = RibbonOptions & {
  /** Max spacing (both ends) for two conductors to ride the same ribbon.
   * Wires farther apart than this route independently instead of being forced
   * into one cross-section (which fanned scattered chips into a wedge). */
  cluster: number;
};

function inflate(r: Rect, g: number): Rect {
  return { x0: r.x0 - g, y0: r.y0 - g, x1: r.x1 + g, y1: r.y1 + g };
}

function mean(pts: PlanPoint[]): PlanPoint {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

// Left-normal of a segment's travel direction (unit, axis-aligned).
function leftNormal(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: -Math.sign(b.y - a.y), y: Math.sign(b.x - a.x) };
}

// Right-angle join a -> b (one bend when they differ on both axes).
function lJoin(a: PlanPoint, b: PlanPoint): PlanPoint[] {
  return a.x === b.x || a.y === b.y ? [a, b] : [a, { x: a.x, y: b.y }, b];
}

function spread(vals: number[]): number {
  return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
}

/** Route one bundle (all conductors share a source region and a dest region)
 * as a rigid flat RIBBON around `sheetObstacles` (page footprints as no-fly
 * zones, already inflated by the caller). Returns one orthogonal path per
 * input conductor, in the input order.
 *
 * Correctness rests on two things: (1) the ribbon leaves each side
 * PERPENDICULAR to the direction its conductors are spread, so a conductor's
 * offset lands exactly on its own chip — zero fan, no compression; (2) each
 * conductor's offset is its EXACT printed displacement, so the ribbon carries
 * the page's own spacing, and offsetOrthogonal holds it constant through every
 * turn. Distinct chips => distinct offsets => a collapse is impossible. */
export function routeRibbon(
  conductors: Conductor[],
  sheetObstacles: Rect[],
  opts: RibbonOptions
): PlanPoint[][] {
  const n = conductors.length;
  if (n === 0) return [];
  const paths: PlanPoint[][] = new Array(n);

  const cS = mean(conductors.map((c) => c.s));
  const cD = mean(conductors.map((c) => c.d));
  const L = opts.launch;

  // Which axis are the conductors spread along, at each end? Launch
  // perpendicular to it so the ribbon's normal IS the spread axis.
  const srcVertical = spread(conductors.map((c) => c.s.y)) >= spread(conductors.map((c) => c.s.x));
  const dstVertical = spread(conductors.map((c) => c.d.y)) >= spread(conductors.map((c) => c.d.x));
  const sgn = (v: number) => (v >= 0 ? 1 : -1);
  const lS: PlanPoint = srcVertical
    ? { x: cS.x + sgn(cD.x - cS.x) * L, y: cS.y }
    : { x: cS.x, y: cS.y + sgn(cD.y - cS.y) * L };
  const lD: PlanPoint = dstVertical
    ? { x: cD.x + sgn(cS.x - cD.x) * L, y: cD.y }
    : { x: cD.x, y: cD.y + sgn(cS.y - cD.y) * L };

  // Offset axis = left-normal of the perpendicular launch (guaranteed the
  // spread axis, never degenerate since L > 0).
  const nF = leftNormal(cS, lS);
  const offs = conductors.map((c) => (c.s.x - cS.x) * nF.x + (c.s.y - cS.y) * nF.y);
  const halfW = Math.max(0, ...offs.map(Math.abs));

  // Straighten the void crossing (mid) so the ribbon doesn't jump between A*
  // staircases under sub-pixel drags; keep the perpendicular launch stubs,
  // which are what make each conductor's offset land on its own chip.
  const inflated = sheetObstacles.map((r) => inflate(r, halfW));
  const mid = straightenOrthogonal(routeOrthogonal(lS, lD, inflated), inflated);
  const centerline = simplifyOrthogonal([cS, lS, ...mid, lD, cD]);
  if (centerline.length < 2) {
    conductors.forEach((c, i) => (paths[i] = simplifyOrthogonal([c.s, ...lJoin(c.s, c.d), c.d])));
    return paths;
  }

  conductors.forEach((c, i) => {
    const o = offs[i];
    const rail = o === 0 ? centerline : offsetOrthogonal(centerline, o);
    // rail[0] == c.s by construction (launch ⟂ spread); the dest end fans by
    // a short breakout only when source/dest spacing differ — never a loop.
    paths[i] = simplifyOrthogonal([
      ...lJoin(c.s, rail[0]),
      ...rail,
      ...lJoin(rail[rail.length - 1], c.d),
    ]);
  });
  return paths;
}

/** Route a whole page->page group. Conductors are first CLUSTERED — only wires
 * adjacent at BOTH ends (within opts.cluster) share a ribbon; the rest route as
 * their own independent wires. This is what stops scattered continuations from
 * being forced into one cross-section and fanning into a wedge, while genuinely
 * parallel runs (the R/S/T bundle) still travel together. Returns one path per
 * conductor, in the INPUT order. */
export function routeLinks(
  conductors: Conductor[],
  sheetObstacles: Rect[],
  opts: BundleOptions
): PlanPoint[][] {
  const n = conductors.length;
  if (n === 0) return [];

  // Cluster along whichever axis the sources spread most; a new cluster starts
  // when the next wire is too far at EITHER end (or reverses order at the dest).
  const srcVertical = spread(conductors.map((c) => c.s.y)) >= spread(conductors.map((c) => c.s.x));
  const sKey = (c: Conductor) => (srcVertical ? c.s.y : c.s.x);
  const order = conductors.map((_, i) => i).sort((a, b) => sKey(conductors[a]) - sKey(conductors[b]));

  const clusters: number[][] = [];
  for (const idx of order) {
    const c = conductors[idx];
    const last = clusters[clusters.length - 1];
    const prev = last ? conductors[last[last.length - 1]] : null;
    const near =
      prev &&
      Math.abs(sKey(c) - sKey(prev)) <= opts.cluster &&
      Math.hypot(c.s.x - prev.s.x, c.s.y - prev.s.y) <= opts.cluster &&
      Math.hypot(c.d.x - prev.d.x, c.d.y - prev.d.y) <= opts.cluster;
    if (near) last!.push(idx);
    else clusters.push([idx]);
  }

  const paths: PlanPoint[][] = new Array(n);
  for (const cluster of clusters) {
    const sub = cluster.map((i) => conductors[i]);
    const rails = routeRibbon(sub, sheetObstacles, opts);
    cluster.forEach((idx, k) => (paths[idx] = rails[k]));
  }
  return paths;
}

export { inflate as inflateRect };
