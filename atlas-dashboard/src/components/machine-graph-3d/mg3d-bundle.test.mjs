// Run: node --experimental-strip-types --test mg3d-bundle.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { routeLinks, routeRibbon } from "./mg3d-bundle.ts";

function assertOrthogonal(path) {
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    assert.ok(dx === 0 || dy === 0, `diagonal segment: ${JSON.stringify(path)}`);
  }
}

// Sample a path densely and return points, so we can check separation.
function sample(path, step = 6) {
  const pts = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k <= n; k++) {
      pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return pts;
}

function minSeparation(p, q) {
  const sp = sample(p);
  const sq = sample(q);
  let m = Infinity;
  for (const a of sp) for (const b of sq) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
  return m;
}

const SHEET_A = { x0: 0, y0: 0, x1: 200, y1: 400 };
const SHEET_B = { x0: 600, y0: 0, x1: 800, y1: 400 };

test("N conductors -> N distinct paths, each connecting its own endpoints", () => {
  const conductors = [
    { s: { x: 200, y: 100 }, d: { x: 600, y: 100 } },
    { s: { x: 200, y: 140 }, d: { x: 600, y: 140 } },
    { s: { x: 200, y: 180 }, d: { x: 600, y: 180 } },
    { s: { x: 200, y: 220 }, d: { x: 600, y: 220 } },
  ];
  const paths = routeRibbon(conductors, [SHEET_A, SHEET_B], { launch: 70 });
  assert.equal(paths.length, 4);
  paths.forEach((p, i) => {
    assertOrthogonal(p);
    assert.deepEqual(p[0], conductors[i].s, `path ${i} starts at its chip`);
    assert.deepEqual(p[p.length - 1], conductors[i].d, `path ${i} ends at its chip`);
  });
});

test("non-crossing conductors never collapse onto each other (wedge guard)", () => {
  // ordered starts, ordered dests, offset diagonally — the real 5/1 shape
  const conductors = [
    { s: { x: 200, y: 100 }, d: { x: 600, y: 220 } },
    { s: { x: 200, y: 140 }, d: { x: 600, y: 260 } },
    { s: { x: 200, y: 180 }, d: { x: 600, y: 300 } },
    { s: { x: 200, y: 220 }, d: { x: 600, y: 340 } },
  ];
  const paths = routeRibbon(conductors, [SHEET_A, SHEET_B], { launch: 70 });
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const sep = minSeparation(paths[i], paths[j]);
      assert.ok(sep >= 8, `paths ${i},${j} collapse (min sep ${sep.toFixed(1)})`);
    }
  }
});

test("genuinely crossing conductors still each reach their own endpoints", () => {
  const conductors = [
    { s: { x: 200, y: 100 }, d: { x: 600, y: 300 } },
    { s: { x: 200, y: 300 }, d: { x: 600, y: 100 } },
  ];
  const paths = routeRibbon(conductors, [SHEET_A, SHEET_B], { launch: 70 });
  paths.forEach((p, i) => {
    assertOrthogonal(p);
    assert.deepEqual(p[0], conductors[i].s);
    assert.deepEqual(p[p.length - 1], conductors[i].d);
  });
});

test("a wire never crosses a page that sits between its endpoints", () => {
  const MIDDLE = { x0: 350, y0: 0, x1: 450, y1: 400 };
  const conductors = [{ s: { x: 200, y: 200 }, d: { x: 600, y: 200 } }];
  const [path] = routeRibbon(conductors, [SHEET_A, MIDDLE, SHEET_B], { launch: 70 });
  assertOrthogonal(path);
  // no segment passes through the middle page interior
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      const through = MIDDLE.y0 < a.y && a.y < MIDDLE.y1 && MIDDLE.x0 < hi && MIDDLE.x1 > lo;
      assert.ok(!through, `horizontal segment cuts the middle page: ${JSON.stringify(path)}`);
    }
  }
});

test("routeLinks: adjacent pairs share a ribbon, scattered chips route alone, input order kept", () => {
  const conductors = [
    { s: { x: 200, y: 380 }, d: { x: 600, y: 380 } }, // far from the pair below
    { s: { x: 200, y: 100 }, d: { x: 600, y: 100 } },
    { s: { x: 200, y: 140 }, d: { x: 600, y: 140 } }, // adjacent to the one above
  ];
  const paths = routeLinks(conductors, [SHEET_A, SHEET_B], { launch: 70, cluster: 120 });
  assert.equal(paths.length, 3);
  paths.forEach((p, i) => {
    assertOrthogonal(p);
    assert.deepEqual(p[0], conductors[i].s, `path ${i} starts at its own chip`);
    assert.deepEqual(p[p.length - 1], conductors[i].d, `path ${i} ends at its own chip`);
  });
  // The scattered wire must not be dragged toward the pair's ribbon corridor:
  // its whole run stays near its own row.
  for (const pt of sample(paths[0])) {
    assert.ok(pt.y > 300, `scattered wire pulled into the pair's ribbon: y=${pt.y.toFixed(1)}`);
  }
});

test("endpoints inside their own page are still reachable (obstacle dropped)", () => {
  // chips sit INSIDE their sheets, not on the edge
  const conductors = [{ s: { x: 100, y: 200 }, d: { x: 700, y: 200 } }];
  const [path] = routeRibbon(conductors, [SHEET_A, SHEET_B], { launch: 70 });
  assert.deepEqual(path[0], { x: 100, y: 200 });
  assert.deepEqual(path[path.length - 1], { x: 700, y: 200 });
  assertOrthogonal(path);
});
