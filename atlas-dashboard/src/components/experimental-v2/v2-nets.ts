// Net engine for the Experimental v2 smart canvas.
//
// Given a page's PDF vector geometry, computes electrically-connected NETS:
// a flood-fill over wire segments that share an endpoint (a 3px-quantized node).
// - T-junctions connect for free: >=3 segment-ends coincide -> one shared node.
// - Plain dotless crossings do NOT connect: two segments merely passing over each
//   other don't share an endpoint node, so the flood never bridges them.
// - Mid-span TAPS are recovered by a split pass: a wire that dead-ends on the
//   interior of another wire splits that wire at the tap so the branch joins the net.
// - A net STOPS where a wire enters a component symbol (bounded by ComponentBox);
//   that endpoint is recorded as the net's terminal.
//
// HONEST LIMIT: /metadata shapes carry only a bbox (no dot glyph), so we cannot
// tell a real dotted tap from a mechanical dead-end-on-a-wire, nor a real 4-way
// junction from a coincidental crossing. The tap-split + default-connect are the
// best geometric guess; the JUNCTION OVERRIDE (mergeNodes + an `isolate` override)
// is the manual escape hatch to break a false merge. A true fix needs dot-glyph
// detection upstream in the extractor.

// Self-contained (no imports) so the pure net logic runs under `node --test`.
// Point/Rect are structurally identical to v2-geometry's; any PageGeometry (which
// has these fields plus more) is assignable to NetGeometry.
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type NetGeometry = {
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  components: { bbox: Rect; label: string | null }[];
  terminals: { point: Point; label: string | null }[];
};

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

// Must match v2-routing QUANT and v2-snapping JUNCTION_CLUSTER_PX (both 3px).
export const NET_QUANT = 3;
const keyOf = (x: number, y: number): string =>
  `${Math.round(x / NET_QUANT)},${Math.round(y / NET_QUANT)}`;

/** Node key for a point — used by the UI to address a junction override. */
export const nodeKeyAt = (p: Point): string => keyOf(p.x, p.y);

const COMPONENT_PAD_PX = 4; // endpoints often land on the box edge / terminal circle
const TERMINAL_SNAP_PX = 18; // label a net terminal from the nearest detected terminal
const TAP_TOL_PX = 3; // perpendicular distance for a dead-end to count as a tap
// Detected terminal circles interrupt conductors: segments dead-end at each side
// of the blob (gap 6-25px on real pages — measured 2026-07-02), so endpoints
// within this radius of a non-component terminal are bridged into one node.
export const TERMINAL_BRIDGE_PX = 25;
const TAP_END_MARGIN_PX = 4; // a tap must land this far from the through-wire's ends

export type JunctionOverride = "connect" | "isolate";

/** Fold DRAWN graph components into the geometry the net engine sees.
 * The vector detector misses large parts (componentMaxPx cap) — e.g. a
 * watt-hour meter box — and an unbounded component lets nets merge straight
 * through it. Annotated components are truth: they bound nets exactly like
 * detected ones, so the more the page is annotated, the truer the colors. */
export function withDrawnComponents<G extends NetGeometry>(
  geometry: G,
  drawn: { bbox: Rect; label?: string | null }[]
): G {
  if (drawn.length === 0) return geometry;
  return {
    ...geometry,
    components: [
      ...geometry.components,
      ...drawn.map((n) => ({ bbox: n.bbox, label: n.label ?? null })),
    ],
  };
}

export type MergeNode = { key: string; point: Point; degree: number; isolated: boolean };

export type Net = {
  id: number;
  segmentIndices: number[]; // indices into geometry.segments
  terminals: { point: Point; label: string | null }[];
  bbox: Rect;
};

export type NetColoring = {
  segmentNetId: Int32Array; // per (original) segment net id; -1 = orphan / component-internal
  nets: Net[];
  mergeNodes: MergeNode[]; // >=3-degree nodes (incl. tap points) — the click-to-toggle targets
  netColor: (id: number) => string;
  segmentColor: (segmentIndex: number) => string;
};

type WSeg = { x1: number; y1: number; x2: number; y2: number; src: number };

// Project p onto segment s; return the foot point + distance iff it lands on the
// interior (not near either end). Used to detect a mid-span tap.
function projectInterior(p: Point, s: WSeg): { point: Point; dist: number } | null {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2;
  if (t <= 0 || t >= 1) return null;
  const len = Math.sqrt(len2);
  if (t * len < TAP_END_MARGIN_PX || (1 - t) * len < TAP_END_MARGIN_PX) return null;
  const fx = s.x1 + t * dx;
  const fy = s.y1 + t * dy;
  return { point: { x: fx, y: fy }, dist: Math.hypot(p.x - fx, p.y - fy) };
}

// Split through-wires wherever a dead-end (degree-1) endpoint lands on their
// interior, so a mid-span tap becomes a real shared node. Conservative: only
// degree-1 ends, small tolerance, skips ends inside a component (those are pins).
function tapSplit(work: WSeg[], insideComponent: (p: Point) => boolean): WSeg[] {
  const degree = new Map<string, number>();
  for (const s of work) {
    degree.set(keyOf(s.x1, s.y1), (degree.get(keyOf(s.x1, s.y1)) ?? 0) + 1);
    degree.set(keyOf(s.x2, s.y2), (degree.get(keyOf(s.x2, s.y2)) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const dangling: Point[] = [];
  for (const s of work) {
    for (const p of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
      const k = keyOf(p.x, p.y);
      if (degree.get(k) === 1 && !seen.has(k) && !insideComponent(p)) {
        seen.add(k);
        dangling.push(p);
      }
    }
  }

  const splits = new Map<number, Point[]>();
  for (const p of dangling) {
    let bestJ = -1;
    let bestD = TAP_TOL_PX;
    let bestPt: Point | null = null;
    for (let j = 0; j < work.length; j++) {
      const s = work[j];
      const pk = keyOf(p.x, p.y);
      if (keyOf(s.x1, s.y1) === pk || keyOf(s.x2, s.y2) === pk) continue; // p is an end of s
      const proj = projectInterior(p, s);
      if (proj && proj.dist < bestD) {
        bestD = proj.dist;
        bestJ = j;
        bestPt = proj.point;
      }
    }
    if (bestJ >= 0 && bestPt) {
      const arr = splits.get(bestJ) ?? [];
      arr.push(bestPt);
      splits.set(bestJ, arr);
    }
  }
  if (splits.size === 0) return work;

  const out: WSeg[] = [];
  for (let j = 0; j < work.length; j++) {
    const s = work[j];
    const pts = splits.get(j);
    if (!pts || pts.length === 0) {
      out.push(s);
      continue;
    }
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy || 1;
    const param = (p: Point) => ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2;
    const ordered = [...pts].sort((a, b) => param(a) - param(b));
    let cur: Point = { x: s.x1, y: s.y1 };
    for (const sp of ordered) {
      out.push({ x1: cur.x, y1: cur.y, x2: sp.x, y2: sp.y, src: s.src });
      cur = sp;
    }
    out.push({ x1: cur.x, y1: cur.y, x2: s.x2, y2: s.y2, src: s.src });
  }
  return out;
}

export function computeNets(
  geometry: NetGeometry,
  overrides?: Map<string, JunctionOverride>
): NetColoring {
  const srcSegments = geometry.segments;
  const components = geometry.components;
  const terminals = geometry.terminals;
  const srcCount = srcSegments.length;

  const insideComponent = (p: Point): boolean => {
    for (const c of components) {
      const b = c.bbox;
      if (
        p.x >= b.x - COMPONENT_PAD_PX &&
        p.x <= b.x + b.width + COMPONENT_PAD_PX &&
        p.y >= b.y - COMPONENT_PAD_PX &&
        p.y <= b.y + b.height + COMPONENT_PAD_PX
      ) {
        return true;
      }
    }
    return false;
  };

  // Working segments (with a back-reference to the original index), tap-split.
  const work: WSeg[] = tapSplit(
    srcSegments.map((s, i) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, src: i })),
    insideComponent
  );
  const workCount = work.length;

  // TERMINAL-BRIDGE PASS (the conductor-fragmentation fix, 2026-07-02):
  // a connection circle on a wire is a junction of the SAME net — but in the
  // vector dump the wire dead-ends at each side of the blob, so the flood never
  // crossed it (page 8 measured: 90/165 blobs falsely splitting nets). Remap
  // every endpoint within TERMINAL_BRIDGE_PX of a non-component terminal onto
  // that terminal's node. Component-edge blobs are pins: bridging there would
  // leak nets THROUGH the component, so they are skipped (boundary still stops
  // the net). An `isolate` override on the terminal's key disables its bridge —
  // the click-to-toggle escape hatch for a false merge.
  const keyRemap = new Map<string, string>();
  const bridgeCandidates = new Map<string, { point: Point; degree: number; isolated: boolean }>();
  for (const t of terminals) {
    if (insideComponent(t.point)) continue;
    const bridgeKey = keyOf(t.point.x, t.point.y);
    const isolated = overrides?.get(bridgeKey) === "isolate";
    let touched = 0;
    for (const s of work) {
      for (const p of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
        if (dist(p, t.point) <= TERMINAL_BRIDGE_PX) {
          touched += 1;
          if (!isolated) {
            const k = keyOf(p.x, p.y);
            if (k !== bridgeKey) keyRemap.set(k, bridgeKey);
          }
        }
      }
    }
    if (touched >= 2) bridgeCandidates.set(bridgeKey, { point: t.point, degree: touched, isolated });
  }
  const canon = (k: string): string => keyRemap.get(k) ?? k;

  // node key -> working-segment indices, plus a representative point.
  const nodeToSegs = new Map<string, number[]>();
  const nodePoint = new Map<string, Point>();
  const register = (x: number, y: number, idx: number) => {
    const k = canon(keyOf(x, y));
    let arr = nodeToSegs.get(k);
    if (!arr) {
      arr = [];
      nodeToSegs.set(k, arr);
      nodePoint.set(k, { x, y });
    }
    arr.push(idx);
  };
  const nodeKeysOf = (i: number): [string, string] => {
    const s = work[i];
    return [canon(keyOf(s.x1, s.y1)), canon(keyOf(s.x2, s.y2))];
  };
  for (let i = 0; i < workCount; i++) {
    register(work[i].x1, work[i].y1, i);
    register(work[i].x2, work[i].y2, i);
  }
  for (const [k, c] of bridgeCandidates) {
    if (nodeToSegs.has(k)) nodePoint.set(k, c.point);
  }

  // Boundary nodes: a wire endpoint inside (padded) a component box. The net
  // reaches it (records a terminal) but does not propagate through the component.
  const boundary = new Set<string>();
  for (const [k, p] of nodePoint) {
    if (insideComponent(p)) boundary.add(k);
  }

  // Segments fully inside a component (both ends boundary) are component-internal
  // artwork, not wires — leave them orphan (gray) so wire nets read cleanly.
  const excluded = new Uint8Array(workCount);
  for (let i = 0; i < workCount; i++) {
    const [a, b] = nodeKeysOf(i);
    if (boundary.has(a) && boundary.has(b)) excluded[i] = 1;
  }

  const nearestTerminalLabel = (p: Point): string | null => {
    let best: string | null = null;
    let bestD = TERMINAL_SNAP_PX;
    for (const t of terminals) {
      const d = dist(p, t.point);
      if (d < bestD) {
        bestD = d;
        best = t.label;
      }
    }
    return best;
  };

  const workNetId = new Int32Array(workCount).fill(-1);
  const nets: Net[] = [];
  let nextNet = 0;
  const queue: number[] = [];

  for (let start = 0; start < workCount; start++) {
    if (workNetId[start] !== -1 || excluded[start]) continue;
    const id = nextNet++;
    queue.length = 0;
    queue.push(start);
    workNetId[start] = id;

    const srcSet = new Set<number>();
    const termKeys = new Set<string>();
    const terms: { point: Point; label: string | null }[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    while (queue.length) {
      const s = queue.pop() as number;
      const seg = work[s];
      srcSet.add(seg.src);
      minX = Math.min(minX, seg.x1, seg.x2);
      maxX = Math.max(maxX, seg.x1, seg.x2);
      minY = Math.min(minY, seg.y1, seg.y2);
      maxY = Math.max(maxY, seg.y1, seg.y2);

      for (const ek of nodeKeysOf(s)) {
        if (overrides?.get(ek) === "isolate") continue; // manual break
        if (boundary.has(ek)) {
          if (!termKeys.has(ek)) {
            termKeys.add(ek);
            const p = nodePoint.get(ek) as Point;
            terms.push({ point: p, label: nearestTerminalLabel(p) });
          }
          continue; // stop at the component pin; don't propagate through it
        }
        const neighbors = nodeToSegs.get(ek);
        if (!neighbors) continue;
        for (const j of neighbors) {
          if (workNetId[j] === -1 && !excluded[j]) {
            workNetId[j] = id;
            queue.push(j);
          }
        }
      }
    }

    const bbox: Rect = Number.isFinite(minX)
      ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      : { x: 0, y: 0, width: 0, height: 0 };
    nets.push({ id, segmentIndices: [...srcSet], terminals: terms, bbox });
  }

  // Map working-segment nets back onto the ORIGINAL segment indices (for paint).
  const segmentNetId = new Int32Array(srcCount).fill(-1);
  for (let i = 0; i < workCount; i++) {
    if (workNetId[i] >= 0 && segmentNetId[work[i].src] < 0) {
      segmentNetId[work[i].src] = workNetId[i];
    }
  }

  // Toggle targets: nodes where >=3 working segments meet (real T's, 4-way merges,
  // and tap points). These are what an operator clicks to break a false merge.
  const mergeNodes: MergeNode[] = [];
  for (const [k, segs] of nodeToSegs) {
    if (segs.length >= 3 && !boundary.has(k)) {
      mergeNodes.push({
        key: k,
        point: nodePoint.get(k) as Point,
        degree: segs.length,
        isolated: overrides?.get(k) === "isolate",
      });
    }
  }
  for (const [k, c] of bridgeCandidates) {
    if (!mergeNodes.some((m) => m.key === k)) {
      mergeNodes.push({ key: k, point: c.point, degree: c.degree, isolated: c.isolated });
    }
  }

  const colorCache = new Map<number, string>();
  const netColor = (id: number): string => {
    if (id < 0) return "rgba(148,163,184,0.22)"; // faint slate for orphan/internal
    let c = colorCache.get(id);
    if (!c) {
      // Golden-angle hue spacing keeps sequential (spatially-adjacent) nets distinct.
      c = `hsl(${(id * 137.508) % 360} 72% 55%)`;
      colorCache.set(id, c);
    }
    return c;
  };
  const segmentColor = (segmentIndex: number): string => netColor(segmentNetId[segmentIndex]);

  return { segmentNetId, nets, mergeNodes, netColor, segmentColor };
}
