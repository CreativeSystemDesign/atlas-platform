import assert from "node:assert/strict";
import test from "node:test";
import { computeNets, nodeKeyAt, withDrawnComponents } from "./v2-nets.ts";

// computeNets only reads { segments, components, terminals } from geometry, so a
// partial object is enough to exercise the connectivity logic in isolation.
const geo = (segments, { components = [], terminals = [] } = {}) => ({
  segments,
  components,
  terminals,
});

test("a bus (colinear segments sharing an endpoint) is one net", () => {
  const nc = computeNets(
    geo([
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 200, y2: 0 },
    ])
  );
  assert.ok(nc.segmentNetId[0] >= 0);
  assert.equal(nc.segmentNetId[0], nc.segmentNetId[1]);
});

test("a plain crossing (no shared endpoint) does NOT connect", () => {
  // Horizontal and vertical cross at (50,0) but neither shares an endpoint there.
  const nc = computeNets(
    geo([
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 50, y1: -50, x2: 50, y2: 50 },
    ])
  );
  assert.ok(nc.segmentNetId[0] >= 0 && nc.segmentNetId[1] >= 0);
  assert.notEqual(nc.segmentNetId[0], nc.segmentNetId[1]);
});

test("a mid-span tap connects into the bus (tap-split)", () => {
  // Branch dead-ends on the interior of the bus at (100,0).
  const nc = computeNets(
    geo([
      { x1: 0, y1: 0, x2: 200, y2: 0 }, // bus
      { x1: 100, y1: 0, x2: 100, y2: 50 }, // tap
    ])
  );
  assert.ok(nc.segmentNetId[0] >= 0);
  assert.equal(nc.segmentNetId[0], nc.segmentNetId[1]); // bus and tap are one net
  // The tap point is exposed as a clickable >=3-way junction.
  assert.ok(nc.mergeNodes.some((n) => n.key === nodeKeyAt({ x: 100, y: 0 })));
});

test("a net stops at a component (bounded, terminal recorded)", () => {
  // Two colinear segments meet at (100,0), which sits inside a component box.
  const nc = computeNets(
    geo(
      [
        { x1: 0, y1: 0, x2: 100, y2: 0 },
        { x1: 100, y1: 0, x2: 200, y2: 0 },
      ],
      { components: [{ bbox: { x: 95, y: -5, width: 10, height: 10 }, label: "X" }] }
    )
  );
  // The component pin breaks the run into two nets...
  assert.notEqual(nc.segmentNetId[0], nc.segmentNetId[1]);
  // ...and at least one terminal is recorded at the boundary.
  const terminalCount = nc.nets.reduce((a, n) => a + n.terminals.length, 0);
  assert.ok(terminalCount >= 1);
});

test("junction override isolates a false merge", () => {
  const segments = [
    { x1: 0, y1: 0, x2: 200, y2: 0 }, // bus
    { x1: 100, y1: 0, x2: 100, y2: 50 }, // tap
  ];
  // Without override: bus + tap are one net.
  const before = computeNets(geo(segments));
  assert.equal(before.segmentNetId[0], before.segmentNetId[1]);

  // Isolate the tap junction -> the branch splits off from the bus.
  const overrides = new Map([[nodeKeyAt({ x: 100, y: 0 }), "isolate"]]);
  const after = computeNets(geo(segments), overrides);
  assert.notEqual(after.segmentNetId[0], after.segmentNetId[1]);
  assert.ok(
    after.mergeNodes.some((n) => n.key === nodeKeyAt({ x: 100, y: 0 }) && n.isolated)
  );
});

test("a conductor interrupted by a terminal blob is ONE net (terminal bridge)", () => {
  const nc = computeNets(
    geo(
      [
        { x1: 0, y1: 0, x2: 95, y2: 0 },
        { x1: 115, y1: 0, x2: 200, y2: 0 },
      ],
      { terminals: [{ point: { x: 105, y: 0 }, label: "7" }] }
    )
  );
  assert.equal(nc.segmentNetId[0], nc.segmentNetId[1]);
  assert.equal(nc.nets.length, 1);
  const bridged = nc.mergeNodes.find((m) => m.point.x === 105);
  assert.ok(bridged, "bridge appears as a toggleable merge node");
  assert.equal(bridged.isolated, false);
});

test("a terminal blob on a component edge does NOT merge nets through the component", () => {
  const nc = computeNets(
    geo(
      [
        { x1: 0, y1: 50, x2: 98, y2: 50 },
        { x1: 162, y1: 50, x2: 260, y2: 50 },
      ],
      {
        components: [{ bbox: { x: 100, y: 20, width: 60, height: 60 }, label: "F1" }],
        terminals: [{ point: { x: 100, y: 50 }, label: "1" }, { point: { x: 160, y: 50 }, label: "2" }],
      }
    )
  );
  assert.notEqual(nc.segmentNetId[0], nc.segmentNetId[1]);
  assert.equal(nc.nets.length, 2);
});

test("isolate override splits a terminal bridge and keeps its toggle dot", () => {
  const segs = [
    { x1: 0, y1: 0, x2: 95, y2: 0 },
    { x1: 115, y1: 0, x2: 200, y2: 0 },
  ];
  const terminals = [{ point: { x: 105, y: 0 }, label: "7" }];
  const overrides = new Map([[nodeKeyAt({ x: 105, y: 0 }), "isolate"]]);
  const nc = computeNets(geo(segs, { terminals }), overrides);
  assert.notEqual(nc.segmentNetId[0], nc.segmentNetId[1]);
  const dot = nc.mergeNodes.find((m) => m.point.x === 105);
  assert.ok(dot, "isolated bridge still shows its toggle dot");
  assert.equal(dot.isolated, true);
});

test("a DRAWN component bounds nets: wires to its terminals stay separate (WHM10 case)", () => {
  const { computeNets: cn } = { computeNets };
  const geometry = withDrawnComponents(
    geo(
      [
        { x1: 0, y1: 100, x2: 395, y2: 100 },   // wire 101K into left edge
        { x1: 0, y1: 200, x2: 395, y2: 200 },   // wire 101L into left edge
        { x1: 405, y1: 100, x2: 405, y2: 200 }, // internal meter artwork joining both
      ],
      { terminals: [{ point: { x: 400, y: 100 }, label: "1" }, { point: { x: 400, y: 200 }, label: "2" }] }
    ),
    [{ bbox: { x: 398, y: 50, width: 300, height: 400 }, label: "WHM10" }]
  );
  const nc = cn(geometry);
  assert.notEqual(nc.segmentNetId[0], nc.segmentNetId[1], "101K and 101L must not merge through the meter");
  assert.equal(nc.segmentNetId[2], -1, "internal artwork is excluded, not a wire");
});
