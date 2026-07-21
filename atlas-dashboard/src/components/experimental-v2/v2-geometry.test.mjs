import assert from "node:assert/strict";
import test from "node:test";
import {
  getNearestPointOnRect,
  distanceToRect,
  pointInRect,
  findOwningNode,
  snapToComponentEdge,
  findNearestPort,
  classifyStroke,
  COMPONENT_MIN_SIZE,
  TERMINAL_MAX_SIZE,
} from "./v2-geometry.ts";

test("getNearestPointOnRect snaps correctly to rectangle boundaries", () => {
  const rect = { x: 100, y: 100, width: 200, height: 150 };
  assert.deepEqual(getNearestPointOnRect({ x: 50, y: 150 }, rect), { x: 100, y: 150 });
  assert.deepEqual(getNearestPointOnRect({ x: 350, y: 50 }, rect), { x: 300, y: 100 });
  assert.deepEqual(getNearestPointOnRect({ x: 110, y: 150 }, rect), { x: 100, y: 150 });
  assert.deepEqual(getNearestPointOnRect({ x: 200, y: 245 }, rect), { x: 200, y: 250 });
});

test("distanceToRect is 0 inside and positive outside", () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(distanceToRect({ x: 50, y: 50 }, rect), 0);
  assert.equal(distanceToRect({ x: 130, y: 50 }, rect), 30);
  assert.equal(distanceToRect({ x: -3, y: -4 }, rect), 5);
});

test("pointInRect", () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(pointInRect({ x: 5, y: 5 }, rect), true);
  assert.equal(pointInRect({ x: 11, y: 5 }, rect), false);
});

test("findOwningNode prefers containment then nearest edge", () => {
  const nodes = [
    { id: "a", type: "component", label: "A", bbox: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "b", type: "component", label: "B", bbox: { x: 400, y: 400, width: 100, height: 100 } },
  ];
  assert.equal(findOwningNode({ x: 50, y: 50 }, nodes)?.id, "a");
  // Just outside A's right edge, far from B -> A.
  assert.equal(findOwningNode({ x: 110, y: 50 }, nodes)?.id, "a");
  // Far from everything -> null.
  assert.equal(findOwningNode({ x: 2000, y: 2000 }, nodes), null);
});

test("snapToComponentEdge returns a perimeter point on the owning node", () => {
  const nodes = [
    { id: "a", type: "component", label: "A", bbox: { x: 100, y: 100, width: 200, height: 200 } },
  ];
  const snap = snapToComponentEdge({ x: 90, y: 200 }, nodes);
  assert.equal(snap?.node.id, "a");
  assert.deepEqual(snap?.point, { x: 100, y: 200 });
});

test("findNearestPort respects max distance", () => {
  const ports = [
    { id: "p1", parentId: "a", type: "terminal", label: "T1", point: { x: 0, y: 0 } },
    { id: "p2", parentId: "a", type: "terminal", label: "T2", point: { x: 1000, y: 1000 } },
  ];
  assert.equal(findNearestPort({ x: 5, y: 5 }, ports)?.id, "p1");
  assert.equal(findNearestPort({ x: 500, y: 500 }, ports), null);
});

test("classifyStroke recognizes a small blob as a terminal", () => {
  const half = TERMINAL_MAX_SIZE / 4;
  const stroke = [
    { x: 200, y: 200 },
    { x: 200 + half, y: 200 },
    { x: 200 + half, y: 200 + half },
    { x: 200, y: 200 + half },
  ];
  const result = classifyStroke(stroke);
  assert.equal(result.type, "terminal");
});

test("classifyStroke recognizes a closed box as a component", () => {
  const s = COMPONENT_MIN_SIZE * 2;
  const stroke = [
    { x: 0, y: 0 },
    { x: s, y: 0 },
    { x: s, y: s },
    { x: 0, y: s },
    { x: 0, y: 0 },
  ];
  const result = classifyStroke(stroke);
  assert.equal(result.type, "component");
  assert.equal(result.bbox.width, s);
});

test("classifyStroke recognizes an open sweep as a wire", () => {
  const s = COMPONENT_MIN_SIZE * 3;
  const stroke = [
    { x: 0, y: 0 },
    { x: s, y: 10 },
    { x: 2 * s, y: 0 },
  ];
  const result = classifyStroke(stroke);
  assert.equal(result.type, "wire");
  assert.equal(result.points.length, 3);
});
