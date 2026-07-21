import assert from "node:assert/strict";
import test from "node:test";
import { buildPageGeometry, snapPoint } from "./v2-snapping.ts";
import { buildSegmentGraph, routeWire, orthogonalElbow } from "./v2-routing.ts";
import { interpretWireStroke, interpretComponentStroke, detectBorderCrossings, groundBorderTerminals, cableLabelNear } from "./v2-intent.ts";

// scale 2. One horizontal wire (20,20)-(100,20); two terminal blobs at its ends;
// a "R100" wire label near the middle; a component box with "F10" inside.
const META = {
  scale: 2,
  shapes: [
    { bbox: [10, 10, 50, 10] },   // wire  -> px (20,20)-(100,20)
    { bbox: [9, 9, 11, 11] },     // term  -> px center (20,20)
    { bbox: [49, 9, 51, 11] },    // term  -> px center (100,20)
    { bbox: [60, 30, 90, 50] },   // box   -> px (120,60)-(180,100)
  ],
  text_blocks: [
    { text: "R100", bbox: [29, 11, 33, 13] }, // px center ~ (62,24), below the wire
    { text: "W", bbox: [29.5, 9.5, 30.5, 10.5] }, // px center ~ (60,20), ON the wire (closer)
    { text: "F10", bbox: [73, 38, 77, 42] },  // px center ~ (150,80) inside box
  ],
};

test("geometry detects terminals at the circle blobs", () => {
  const g = buildPageGeometry(META);
  const near = (p, x, y) => Math.hypot(p.x - x, p.y - y) < 2;
  assert.ok(g.terminals.some((t) => near(t.point, 20, 20)), "terminal at (20,20)");
  assert.ok(g.terminals.some((t) => near(t.point, 100, 20)), "terminal at (100,20)");
});

test("geometry detects the component box", () => {
  const g = buildPageGeometry(META);
  const box = g.components.find((c) => Math.abs(c.bbox.x - 120) < 2 && Math.abs(c.bbox.width - 60) < 2);
  assert.ok(box, "component box detected");
  assert.equal(box.label, "F10");
});

test("snapPoint prioritizes terminals and carries the label", () => {
  const g = buildPageGeometry(META);
  const r = snapPoint({ x: 23, y: 22 }, g);
  assert.equal(r?.kind, "terminal");
  assert.ok(Math.hypot(r.point.x - 20, r.point.y - 20) < 2);
});

test("routeWire follows the underlying segment between snapped endpoints", () => {
  const g = buildPageGeometry(META);
  const stroke = [{ x: 24, y: 23 }, { x: 60, y: 18 }, { x: 96, y: 22 }]; // wobbly
  const path = routeWire(stroke, { x: 20, y: 20 }, { x: 100, y: 20 }, g.segmentGraph);
  assert.equal(path.length, 2);
  assert.deepEqual(path[0], { x: 20, y: 20 });
  assert.deepEqual(path[path.length - 1], { x: 100, y: 20 });
});

test("orthogonalElbow emits an L for diagonal endpoints", () => {
  const path = orthogonalElbow({ x: 0, y: 0 }, { x: 100, y: 50 }, [{ x: 0, y: 0 }, { x: 20, y: 1 }]);
  assert.equal(path.length, 3);
  // horizontal-first elbow
  assert.deepEqual(path[1], { x: 100, y: 0 });
});

test("interpretWireStroke snaps endpoints, straightens, and captures the wire number", () => {
  const g = buildPageGeometry(META);
  const stroke = [{ x: 23, y: 22 }, { x: 55, y: 17 }, { x: 98, y: 23 }];
  const intent = interpretWireStroke(stroke, g);
  assert.equal(intent.source.kind, "terminal");
  assert.equal(intent.target.kind, "terminal");
  assert.ok(Math.hypot(intent.path[0].x - 20, intent.path[0].y - 20) < 2);
  assert.ok(Math.hypot(intent.path.at(-1).x - 100, intent.path.at(-1).y - 20) < 2);
  assert.equal(intent.label, "R100");
});

test("interpretComponentStroke locks to the enclosed box and labels it", () => {
  const g = buildPageGeometry(META);
  // wobbly encircle around the box (center 150,80)
  const stroke = [
    { x: 118, y: 58 }, { x: 184, y: 56 }, { x: 182, y: 104 }, { x: 116, y: 102 }, { x: 118, y: 58 },
  ];
  const intent = interpretComponentStroke(stroke, g);
  assert.ok(Math.abs(intent.bbox.x - 120) < 2 && Math.abs(intent.bbox.width - 60) < 2, "snapped to artwork box");
  assert.equal(intent.label, "F10");
});

test("interpretWireStroke degrades gracefully with no geometry", () => {
  const stroke = [{ x: 5, y: 5 }, { x: 50, y: 5 }];
  const intent = interpretWireStroke(stroke, null);
  assert.equal(intent.path.length, 2);
  assert.equal(intent.source.kind, "free");
  assert.equal(intent.label, null);
});

// --- Ghost-terminal pin capture (Shane's catch, 2026-07-09: INV70's FWD) ----

const INV_BOX = { x: 100, y: 100, width: 200, height: 160 };
const invGeom = (texts) => ({
  // one horizontal conductor crossing the RIGHT border at y=180
  segments: [{ x1: 120, y1: 180, x2: 420, y2: 180 }],
  texts,
});

test("pin capture: printed pin inside the border joins the name (FWD -> T~INV70~FWD~Y4200)", () => {
  const out = detectBorderCrossings(INV_BOX, invGeom([
    { text: "FWD", center: { x: 272, y: 180 } },   // just inside the right border
    { text: "Y4200", center: { x: 380, y: 168 } }, // wire number along the run outside
    { text: "INV70", center: { x: 200, y: 130 } }, // designator, mid-box
  ]), 8, 220, "INV70");
  assert.equal(out.length, 1);
  assert.equal(out[0].side, "right");
  assert.equal(out[0].netLabel, "Y4200");
  assert.equal(out[0].pinLabel, "FWD");
});

test("pin capture: the owner designator near a lead is never a pin", () => {
  const out = detectBorderCrossings(INV_BOX, invGeom([
    { text: "INV70", center: { x: 272, y: 180 } },
    { text: "Y4200", center: { x: 380, y: 168 } },
  ]), 8, 220, "INV70");
  assert.equal(out[0].netLabel, "Y4200");
  assert.equal(out[0].pinLabel, null);
});

test("pin capture: net text leaking inside the border is not a pin; ratings never are", () => {
  const out = detectBorderCrossings(INV_BOX, invGeom([
    { text: "Y4200", center: { x: 272, y: 180 } }, // the net printed inside
    { text: "AC200V", center: { x: 275, y: 195 } }, // voltage callout
    { text: "Y4200", center: { x: 380, y: 168 } },
  ]), 8, 220, "INV70");
  assert.equal(out[0].netLabel, "Y4200");
  assert.equal(out[0].pinLabel, null);
});

test("net walk: 24V rail names (PL24/NL24) are nets, not designators (Shane's T2 ruling)", () => {
  const out = detectBorderCrossings(INV_BOX, invGeom([
    { text: "PL24", center: { x: 380, y: 168 } }, // on the conductor's row
  ]), 8, 500, "INV70");
  assert.equal(out[0].netLabel, "PL24");
});

test("net walk: a NEIGHBOR row's wire number is refused by the lateral gate", () => {
  // Valid wire number within radial reach of the walk probes, but 29px off
  // the conductor's row — the reference print's neighbor-row offset (30C once stole
  // X3810 this way). The row's own rail name wins instead.
  const out = detectBorderCrossings(INV_BOX, invGeom([
    { text: "X3810", center: { x: 380, y: 151 } }, // lat 29 — neighbor's number
    { text: "PL24", center: { x: 400, y: 167 } },  // lat 13 — this row's net
  ]), 8, 500, "INV70");
  assert.equal(out[0].netLabel, "PL24");
});

test("ground-net rule: a run ending at a LABELED earth glyph nets the terminal", () => {
  // Vertical conductor leaves the box bottom, runs to a glyph circle
  // (diagonal segment) labeled PE. No wire number prints anywhere.
  const geom = {
    segments: [
      { x1: 150, y1: 200, x2: 150, y2: 330 }, // conductor through bottom border (y=260)
      { x1: 137, y1: 330, x2: 163, y2: 356 }, // the glyph's enclosing circle
    ],
    texts: [{ text: "PE", center: { x: 150, y: 345 } }],
  };
  const out = detectBorderCrossings(INV_BOX, geom, 8, 220, "INV70");
  assert.equal(out.length, 1);
  assert.equal(out[0].side, "bottom");
  assert.equal(out[0].netLabel, "PE");
});

test("ground-net rule: an UNLABELED circle claims nothing (motor symbols are circles too)", () => {
  const geom = {
    segments: [
      { x1: 150, y1: 200, x2: 150, y2: 330 },
      { x1: 137, y1: 330, x2: 163, y2: 356 },
    ],
    texts: [{ text: "M10", center: { x: 150, y: 345 } }], // not an earth token
  };
  const out = detectBorderCrossings(INV_BOX, geom, 8, 220, "INV70");
  assert.equal(out[0].netLabel, null); // wrong net is worse than none
});

test("groundBorderTerminals: the entering conductor mints T~<label>~<label>; glyph bars don't", () => {
  const geom = {
    segments: [
      // the conductor dropping into the glyph — SPLIT mid-run like real
      // vector dumps (the chain-follow must see through the split)
      { x1: 150, y1: 200, x2: 150, y2: 320 },
      { x1: 150, y1: 320, x2: 150, y2: 330 },
      { x1: 139, y1: 332, x2: 173, y2: 332 }, // glyph bar poking past the box: dead-ends
    ],
    texts: [],
  };
  const specs = groundBorderTerminals({ x: 135, y: 328, width: 30, height: 30 }, "G", geom);
  assert.equal(specs.length, 1);
  assert.deepEqual(specs[0].point, { x: 150, y: 328 }); // ON the top border, at the stem
  assert.equal(specs[0].label, "T~G~G"); // earth net = the ground's own label
});

test("cableLabelNear: the printed CAB name on/beside the boxed symbol wins; prose never", () => {
  const geom = {
    segments: [],
    texts: [
      { text: "CAB21", center: { x: 425, y: 1689 } },
      { text: "CONNECTOR TERMINAL", center: { x: 430, y: 1695 } },
    ],
  };
  assert.equal(cableLabelNear({ x: 360, y: 1695, width: 220, height: 40 }, geom), "CAB21");
  assert.equal(cableLabelNear({ x: 360, y: 3000, width: 220, height: 40 }, geom), null); // out of reach
});

test("pin capture: on a dense strip a pin belongs to its NEAREST lead only", () => {
  const geom = {
    segments: [
      { x1: 120, y1: 150, x2: 420, y2: 150 },
      { x1: 120, y1: 178, x2: 420, y2: 178 },
    ],
    texts: [
      { text: "X1", center: { x: 272, y: 152 } }, // beside the y=150 lead
      { text: "Y4200", center: { x: 380, y: 140 } },
      { text: "Y4300", center: { x: 380, y: 190 } },
    ],
  };
  const out = detectBorderCrossings(INV_BOX, geom, 8, 220, "INV70");
  const top = out.find((c) => c.point.y === 150);
  const bottom = out.find((c) => c.point.y === 178);
  assert.equal(top.pinLabel, "X1");
  assert.equal(bottom.pinLabel, null); // X1 is within reach but belongs to the other lead
});
