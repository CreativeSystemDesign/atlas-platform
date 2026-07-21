// Orthogonal (Manhattan) routing for cross-sheet continuation links (Shane,
// 2026-07-11: link wires must LOOK like the drawn wires — right angles only,
// steering around components, never rubber-banding across the scene).
//
// A* over the Hanan grid of the obstacle corners: nodes are (x, y) grid
// intersections, moves are axis-aligned hops to the neighboring grid line,
// a segment is legal when it does not pass through any obstacle's interior
// (riding an inflated edge is fine — that IS the routing channel), and turns
// cost extra so runs stay straight like a drafter would draw them.

export type PlanPoint = { x: number; y: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

const TURN_PENALTY = 60;

function contains(r: Rect, p: PlanPoint): boolean {
  return p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
}

function uniqSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
}

function hBlocked(obstacles: Rect[], y: number, xa: number, xb: number): boolean {
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  return obstacles.some((r) => r.y0 < y && y < r.y1 && r.x0 < hi && r.x1 > lo);
}

function vBlocked(obstacles: Rect[], x: number, ya: number, yb: number): boolean {
  const lo = Math.min(ya, yb);
  const hi = Math.max(ya, yb);
  return obstacles.some((r) => r.x0 < x && x < r.x1 && r.y0 < hi && r.y1 > lo);
}

export function simplifyOrthogonal(points: PlanPoint[]): PlanPoint[] {
  return simplify(points);
}

/** Pull an orthogonal path taut: greedily replace any run of vertices with a
 * single obstacle-free L (or straight segment) reaching as far ahead as
 * possible. This removes the A*-grid staircases that make the raw route jump
 * between shapes under sub-pixel drags — both the jittery route and the clean
 * route straighten to the SAME taut path, so the output is stable. */
export function straightenOrthogonal(path: PlanPoint[], obstacles: Rect[]): PlanPoint[] {
  const pts = simplify(path);
  if (pts.length <= 2) return pts;
  const out: PlanPoint[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    let bestCorner: PlanPoint | null = null;
    // Reach as far ahead as a single clean L (or straight line) allows.
    for (let j = pts.length - 1; j > i + 1; j--) {
      const a = pts[i];
      const b = pts[j];
      if (a.x === b.x || a.y === b.y) {
        if (pathClear([a, b], obstacles)) { best = j; bestCorner = null; break; }
      } else {
        const c1 = { x: a.x, y: b.y };
        const c2 = { x: b.x, y: a.y };
        if (pathClear([a, c1, b], obstacles)) { best = j; bestCorner = c1; break; }
        if (pathClear([a, c2, b], obstacles)) { best = j; bestCorner = c2; break; }
      }
    }
    if (bestCorner) out.push(bestCorner);
    out.push(pts[best]);
    i = best;
  }
  return simplify(out);
}

/** True when no segment of an axis-aligned path passes through an obstacle
 * interior (riding edges is legal). Guards against the router's L-shape
 * fallback being mistaken for a clean route. */
export function pathClear(path: PlanPoint[], obstacles: Rect[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.y === b.y) {
      if (hBlocked(obstacles, a.y, a.x, b.x)) return false;
    } else if (vBlocked(obstacles, a.x, a.y, b.y)) {
      return false;
    }
  }
  return true;
}

/** Parallel-offset an orthogonal polyline (harness bundling: members ride a
 * shared spine spaced a few px apart). Positive offset = left of travel. */
export function offsetOrthogonal(path: PlanPoint[], o: number): PlanPoint[] {
  if (path.length < 2 || o === 0) return path.slice();
  type Seg = { ax: number; ay: number; bx: number; by: number; horiz: boolean };
  const segs: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.x === b.x && a.y === b.y) continue;
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const nx = -dy;
    const ny = dx;
    segs.push({ ax: a.x + nx * o, ay: a.y + ny * o, bx: b.x + nx * o, by: b.y + ny * o, horiz: a.y === b.y });
  }
  if (segs.length === 0) return path.slice();
  const out: PlanPoint[] = [{ x: segs[0].ax, y: segs[0].ay }];
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1];
    const cur = segs[i];
    if (prev.horiz === cur.horiz) {
      out.push({ x: cur.ax, y: cur.ay });
      continue;
    }
    // right-angle miter: the horizontal segment owns y, the vertical owns x
    out.push(prev.horiz ? { x: cur.ax, y: prev.by } : { x: prev.bx, y: cur.ay });
  }
  out.push({ x: segs[segs.length - 1].bx, y: segs[segs.length - 1].by });
  return simplify(out);
}

function simplify(points: PlanPoint[]): PlanPoint[] {
  const out: PlanPoint[] = [];
  for (const p of points) {
    const n = out.length;
    if (n >= 2) {
      const a = out[n - 2];
      const b = out[n - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) {
        out[n - 1] = p;
        continue;
      }
    }
    if (n >= 1 && out[n - 1].x === p.x && out[n - 1].y === p.y) continue;
    out.push(p);
  }
  return out;
}

/** Route start -> end with axis-aligned segments around the obstacles.
 * Obstacles containing an endpoint are dropped (continuation chips live on
 * component borders — their own block must not wall them in). Falls back to
 * a plain L when no route exists. */
export function routeOrthogonal(start: PlanPoint, end: PlanPoint, obstaclesIn: Rect[]): PlanPoint[] {
  const obstacles = obstaclesIn.filter((r) => !contains(r, start) && !contains(r, end));
  const xs = uniqSorted([start.x, end.x, ...obstacles.flatMap((r) => [r.x0, r.x1])]);
  const ys = uniqSorted([start.y, end.y, ...obstacles.flatMap((r) => [r.y0, r.y1])]);
  const xi0 = xs.indexOf(uniqSorted([start.x])[0]);
  const yi0 = ys.indexOf(uniqSorted([start.y])[0]);
  const xi1 = xs.indexOf(uniqSorted([end.x])[0]);
  const yi1 = ys.indexOf(uniqSorted([end.y])[0]);
  const NY = ys.length;

  // state = grid node x direction of arrival (0 none, 1 horizontal, 2 vertical)
  const key = (xi: number, yi: number, dir: number) => (xi * NY + yi) * 3 + dir;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  type Item = { k: number; xi: number; yi: number; dir: number; f: number };
  const heap: Item[] = [];
  const push = (item: Item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= heap[i].f) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): Item | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (xi: number, yi: number) => Math.abs(xs[xi] - xs[xi1]) + Math.abs(ys[yi] - ys[yi1]);

  const startKey = key(xi0, yi0, 0);
  gScore.set(startKey, 0);
  push({ k: startKey, xi: xi0, yi: yi0, dir: 0, f: h(xi0, yi0) });

  let goalKey: number | null = null;
  let guard = 0;
  while (heap.length > 0 && guard++ < 200_000) {
    const cur = pop()!;
    if ((gScore.get(cur.k) ?? Infinity) < -1) continue;
    if (cur.xi === xi1 && cur.yi === yi1) {
      goalKey = cur.k;
      break;
    }
    const curG = gScore.get(cur.k) ?? Infinity;
    const neighbors: Array<{ xi: number; yi: number; dir: number; cost: number }> = [];
    if (cur.xi > 0 && !hBlocked(obstacles, ys[cur.yi], xs[cur.xi - 1], xs[cur.xi])) {
      neighbors.push({ xi: cur.xi - 1, yi: cur.yi, dir: 1, cost: xs[cur.xi] - xs[cur.xi - 1] });
    }
    if (cur.xi < xs.length - 1 && !hBlocked(obstacles, ys[cur.yi], xs[cur.xi], xs[cur.xi + 1])) {
      neighbors.push({ xi: cur.xi + 1, yi: cur.yi, dir: 1, cost: xs[cur.xi + 1] - xs[cur.xi] });
    }
    if (cur.yi > 0 && !vBlocked(obstacles, xs[cur.xi], ys[cur.yi - 1], ys[cur.yi])) {
      neighbors.push({ xi: cur.xi, yi: cur.yi - 1, dir: 2, cost: ys[cur.yi] - ys[cur.yi - 1] });
    }
    if (cur.yi < ys.length - 1 && !vBlocked(obstacles, xs[cur.xi], ys[cur.yi], ys[cur.yi + 1])) {
      neighbors.push({ xi: cur.xi, yi: cur.yi + 1, dir: 2, cost: ys[cur.yi + 1] - ys[cur.yi] });
    }
    for (const n of neighbors) {
      const turn = cur.dir !== 0 && cur.dir !== n.dir ? TURN_PENALTY : 0;
      const nk = key(n.xi, n.yi, n.dir);
      const g = curG + n.cost + turn;
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g);
        cameFrom.set(nk, cur.k);
        push({ k: nk, xi: n.xi, yi: n.yi, dir: n.dir, f: g + h(n.xi, n.yi) });
      }
    }
  }

  if (goalKey == null) {
    // no channel found — honest fallback, still right angles
    return simplify([start, { x: end.x, y: start.y }, end]);
  }

  const points: PlanPoint[] = [];
  let k: number | undefined = goalKey;
  while (k !== undefined) {
    const node = Math.floor(k / 3);
    const xi = Math.floor(node / NY);
    const yi = node % NY;
    points.push({ x: xs[xi], y: ys[yi] });
    k = cameFrom.get(k);
  }
  points.reverse();
  return simplify(points);
}
