import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageGeometry,
  computeJunctions,
  projectOntoSegment,
  snapPoint,
  nearestText,
  DEFAULT_SNAP_RADIUS_PX,
} from "./v2-snapping.ts";

// scale 2 keeps the px math easy to reason about in assertions.
const META = {
  scale: 2,
  shapes: [
    { bbox: [10, 10, 50, 10] }, // horizontal wire -> px (20,20)-(100,20)
    { bbox: [50, 10, 50, 40] }, // vertical wire   -> px (100,20)-(100,80)
    { bbox: [50, 10, 80, 10] }, // horizontal wire -> px (100,20)-(160,20)
  ],
  text_blocks: [
    { text: "WHM10", bbox: [12, 12, 28, 18] }, // center px ~ (40,30)
  ],
};

test("buildPageGeometry scales shapes into px segments", () => {
  const g = buildPageGeometry(META);
  assert.equal(g.segments.length, 3);
  assert.deepEqual(g.segments[0], { x1: 20, y1: 20, x2: 100, y2: 20 });
  assert.equal(g.endpoints.length, 6);
});

test("computeJunctions finds the shared 3-way node", () => {
  const g = buildPageGeometry(META);
  // (100,20) is shared by all three segment ends -> a junction.
  const hit = g.junctions.find((p) => Math.abs(p.x - 100) < 1 && Math.abs(p.y - 20) < 1);
  assert.ok(hit, "expected a junction near (100,20)");
});

test("computeJunctions ignores simple 2-end meetings", () => {
  const j = computeJunctions([
    { x: 0, y: 0 },
    { x: 0, y: 0 }, // only degree 2
    { x: 500, y: 500 },
  ]);
  assert.equal(j.length, 0);
});

test("snapPoint prefers a junction when in range", () => {
  const g = buildPageGeometry(META);
  const r = snapPoint({ x: 108, y: 25 }, g);
  assert.equal(r?.kind, "junction");
  assert.ok(Math.abs(r.point.x - 100) < 1 && Math.abs(r.point.y - 20) < 1);
});

test("snapPoint falls back to endpoint, then segment", () => {
  const g = buildPageGeometry(META);
  // Near the free end (160,20) -> endpoint snap.
  const e = snapPoint({ x: 158, y: 23 }, g);
  assert.equal(e?.kind, "endpoint");

  // Over the middle of a horizontal wire, away from any endpoint/junction.
  const seg = snapPoint({ x: 60, y: 24 }, g);
  assert.equal(seg?.kind, "segment");
  assert.ok(Math.abs(seg.point.y - 20) < 1);
});

test("snapPoint returns null when nothing is in range", () => {
  const g = buildPageGeometry(META);
  assert.equal(snapPoint({ x: 2000, y: 2000 }, g), null);
  assert.equal(snapPoint({ x: 0, y: 0 }, null), null);
});

test("projectOntoSegment clamps to the segment", () => {
  const seg = { x1: 0, y1: 0, x2: 100, y2: 0 };
  assert.deepEqual(projectOntoSegment({ x: 50, y: 10 }, seg).point, { x: 50, y: 0 });
  assert.deepEqual(projectOntoSegment({ x: -20, y: 5 }, seg).point, { x: 0, y: 0 });
  assert.deepEqual(projectOntoSegment({ x: 200, y: 5 }, seg).point, { x: 100, y: 0 });
});

test("nearestText returns the closest label within radius", () => {
  const g = buildPageGeometry(META);
  const t = nearestText({ x: 42, y: 31 }, g, DEFAULT_SNAP_RADIUS_PX);
  assert.equal(t?.text, "WHM10");
  assert.equal(nearestText({ x: 2000, y: 2000 }, g, DEFAULT_SNAP_RADIUS_PX), null);
});
