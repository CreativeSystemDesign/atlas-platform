import assert from "node:assert/strict";
import test from "node:test";
import { resolvePenTarget } from "./v2-bridge-target.ts";
import { buildPageGeometry } from "./v2-snapping.ts";

const geometry = () =>
  buildPageGeometry({
    scale: 1,
    shapes: [{ bbox: [100, 200, 500, 200] }],
    text_blocks: [],
  });

const emptyGraph = () => ({ nodes: [], ports: [], edges: [], continuations: [] });

test("segment hit carries the printed line's endpoints", () => {
  const t = resolvePenTarget({ x: 250, y: 205 }, geometry(), null, emptyGraph());
  assert.equal(t.segment_index, 0);
  assert.deepEqual(t.segment, { x1: 100, y1: 200, x2: 500, y2: 200 });
});

test("a drawn terminal resolves to its element id", () => {
  const g = emptyGraph();
  g.ports.push({ id: "port-1", parentId: "", type: "terminal", point: { x: 800, y: 800 }, label: "T-K-T1" });
  const t = resolvePenTarget({ x: 805, y: 803 }, null, null, g);
  assert.equal(t.element_id, "port-1");
  assert.equal(t.element_kind, "terminal");
  assert.equal(t.element_label, "T-K-T1");
  assert.ok(t.element_distance_px <= 6);
});

test("a drawn wire resolves by path proximity; ports win over wires", () => {
  const g = emptyGraph();
  g.edges.push({ id: "edge-1", sourcePortId: "a", targetPortId: "b", label: "102K",
    path: [{ x: 100, y: 600 }, { x: 500, y: 600 }] });
  const onWire = resolvePenTarget({ x: 300, y: 608 }, null, null, g);
  assert.equal(onWire.element_id, "edge-1");
  assert.equal(onWire.element_kind, "wire");
  g.ports.push({ id: "port-2", parentId: "", type: "junction", point: { x: 300, y: 600 }, label: "J-1" });
  const onBoth = resolvePenTarget({ x: 300, y: 604 }, null, null, g);
  assert.equal(onBoth.element_id, "port-2");
  assert.equal(onBoth.element_kind, "junction");
});

test("nothing in range resolves to undefined", () => {
  assert.equal(resolvePenTarget({ x: 50, y: 50 }, null, null, emptyGraph()), undefined);
});
