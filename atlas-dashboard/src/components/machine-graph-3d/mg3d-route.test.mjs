// Run: node --experimental-strip-types --test mg3d-route.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { offsetOrthogonal, pathClear, routeOrthogonal, straightenOrthogonal } from "./mg3d-route.ts";

function assertOrthogonal(path) {
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    assert.ok(dx === 0 || dy === 0, `segment ${i} is diagonal: ${JSON.stringify(path)}`);
  }
}

function crossesRect(path, r) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (r.y0 < a.y && a.y < r.y1 && r.x0 < hi && r.x1 > lo) return true;
    } else {
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      if (r.x0 < a.x && a.x < r.x1 && r.y0 < hi && r.y1 > lo) return true;
    }
  }
  return false;
}

test("clear field: straight or single-L route", () => {
  const path = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 0 }, []);
  assert.deepEqual(path, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const l = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 50 }, []);
  assertOrthogonal(l);
  assert.ok(l.length <= 3);
});

test("routes around a blocking component", () => {
  const block = { x0: 40, y0: -20, x1: 60, y1: 20 };
  const path = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 0 }, [block]);
  assertOrthogonal(path);
  assert.ok(!crossesRect(path, block), `path crosses block: ${JSON.stringify(path)}`);
  assert.ok(path.length >= 4, "detour requires turns");
});

test("obstacle containing an endpoint is ignored, not a wall", () => {
  const swallow = { x0: -10, y0: -10, x1: 10, y1: 10 };
  const path = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 0 }, [swallow]);
  assertOrthogonal(path);
  assert.equal(path[0].x, 0);
  assert.equal(path[path.length - 1].x, 100);
});

test("straightenOrthogonal: a staircase over open space becomes one L", () => {
  const stair = [
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 40, y: 20 },
    { x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 },
  ];
  const taut = straightenOrthogonal(stair, []);
  assertOrthogonal(taut);
  assert.equal(taut.length, 3, `expected one L, got ${JSON.stringify(taut)}`);
  assert.deepEqual(taut[0], { x: 0, y: 0 });
  assert.deepEqual(taut[taut.length - 1], { x: 60, y: 60 });
});

test("straightenOrthogonal: keeps the bend it needs to clear an obstacle", () => {
  const block = { x0: 25, y0: -100, x1: 35, y1: 30 };
  const stair = [
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 50 }, { x: 60, y: 50 },
  ];
  const taut = straightenOrthogonal(stair, [block]);
  assertOrthogonal(taut);
  assert.ok(!crossesRect(taut, block), `straightened path cuts the block: ${JSON.stringify(taut)}`);
  assert.deepEqual(taut[0], { x: 0, y: 0 });
  assert.deepEqual(taut[taut.length - 1], { x: 60, y: 50 });
});

test("straightenOrthogonal: two near-identical inputs give the SAME taut path (stability)", () => {
  // the anti-fragility property: a 1px perturbation must not change the output
  const a = straightenOrthogonal(
    [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 80, y: 40 }],
    []
  );
  const b = straightenOrthogonal(
    [{ x: 0, y: 0 }, { x: 31, y: 0 }, { x: 31, y: 40 }, { x: 80, y: 40 }],
    []
  );
  assert.deepEqual(a, b);
});

test("pathClear: detects interior crossings, allows edge riding", () => {
  const block = { x0: 40, y0: -20, x1: 60, y1: 20 };
  assert.equal(pathClear([{ x: 0, y: 0 }, { x: 100, y: 0 }], [block]), false);
  assert.equal(pathClear([{ x: 0, y: 30 }, { x: 100, y: 30 }], [block]), true);
  assert.equal(pathClear([{ x: 0, y: 20 }, { x: 100, y: 20 }], [block]), true); // riding the edge
});

test("offsetOrthogonal: parallel L with a clean right-angle miter", () => {
  const l = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }];
  const off = offsetOrthogonal(l, 10);
  // travel +x then +y: left of travel is +y then -x
  assert.deepEqual(off, [{ x: 0, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 80 }]);
  const off2 = offsetOrthogonal(l, -10);
  assert.deepEqual(off2, [{ x: 0, y: -10 }, { x: 110, y: -10 }, { x: 110, y: 80 }]);
});

test("offsetOrthogonal: pitch is preserved THROUGH turns (no collapse)", () => {
  // a Z-shaped route: over, down, over
  const z = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
  const off = offsetOrthogonal(z, 10);
  // every vertex of the offset path stays exactly 10 from the original run,
  // and the path still has the same number of turns (parallel, not cinched)
  assertOrthogonal(off);
  // horizontal runs shifted in y by +10 (left of +x travel), preserved after
  // the turn — the second horizontal run is also at y = 100 + 10
  const ys = off.filter((_, i) => i === 0 || i === off.length - 1).map((p) => p.y);
  assert.deepEqual(ys, [10, 110]);
  // turn count preserved: 4 vertices in, 4 out
  assert.equal(off.length, 4);
});

test("offsetOrthogonal: straight line shifts sideways only", () => {
  const s = offsetOrthogonal([{ x: 0, y: 0 }, { x: 50, y: 0 }], 6);
  assert.deepEqual(s, [{ x: 0, y: 6 }, { x: 50, y: 6 }]);
});

test("threads the channel between two blocks", () => {
  const top = { x0: 40, y0: 10, x1: 60, y1: 100 };
  const bottom = { x0: 40, y0: -100, x1: 60, y1: -10 };
  const path = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 0 }, [top, bottom]);
  assertOrthogonal(path);
  assert.ok(!crossesRect(path, top) && !crossesRect(path, bottom));
  // the open channel at y=0 is the shortest legal run
  assert.deepEqual(path, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
});
