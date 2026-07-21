import assert from "node:assert/strict";
import test from "node:test";
import { deleteElement, inferWireNet, nameEndpointsFromNet, pasteContinuationAt, renameElement, reparentPort, resizedPortPoint, resizeBoxWithTerminals } from "./v2-graph-ops.ts";

function sampleGraph() {
  return {
    nodes: [
      { id: "n1", type: "component", label: "A", bbox: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "n2", type: "component", label: "B", bbox: { x: 50, y: 0, width: 10, height: 10 } },
    ],
    ports: [
      { id: "p1", parentId: "n1", type: "terminal", label: "T1", point: { x: 10, y: 5 } },
      { id: "p2", parentId: "n2", type: "terminal", label: "T2", point: { x: 50, y: 5 } },
    ],
    edges: [
      { id: "e1", sourcePortId: "p1", targetPortId: "p2", path: [], label: "R100" },
    ],
    continuations: [
      { id: "c1", type: "continuation", point: { x: 0, y: 0 }, sheet: "12", zone: "9", rawRef: "12/9", target: { kind: "port", id: "p2" } },
    ],
  };
}

test("deleting a component removes its ports AND wires touching them", () => {
  const g = sampleGraph();
  deleteElement(g, "n1");
  assert.equal(g.nodes.length, 1);
  assert.equal(g.ports.length, 1); // only p2 remains
  assert.equal(g.edges.length, 0); // e1 was orphaned -> removed
});

test("deleting a terminal removes connected wires", () => {
  const g = sampleGraph();
  deleteElement(g, "p2");
  assert.equal(g.ports.length, 1);
  assert.equal(g.edges.length, 0);
});

test("deleting an edge leaves nodes and ports intact", () => {
  const g = sampleGraph();
  deleteElement(g, "e1");
  assert.equal(g.edges.length, 0);
  assert.equal(g.nodes.length, 2);
  assert.equal(g.ports.length, 2);
});

test("renameElement updates a node, port, or wire label", () => {
  const g = sampleGraph();
  renameElement(g, "n1", "Relay K1");
  assert.equal(g.nodes[0].label, "Relay K1");
  renameElement(g, "p1", "Pin 3");
  assert.equal(g.ports[0].label, "Pin 3");
  renameElement(g, "e1", "R101");
  assert.equal(g.edges[0].label, "R101");
});

test("deleting a terminal drops continuations attached to it", () => {
  const g = sampleGraph();
  deleteElement(g, "p2");
  assert.equal(g.continuations.length, 0);
});

test("deleting a cable touches nothing else (cables never conduct)", () => {
  const g = { ...sampleGraph(), cables: [{ id: "cab1", type: "cable", label: "CAB21", bbox: { x: 0, y: 0, width: 100, height: 20 } }] };
  deleteElement(g, "cab1");
  assert.equal(g.cables.length, 0);
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1);
});

test("deleting a continuation leaves the rest intact", () => {
  const g = sampleGraph();
  deleteElement(g, "c1");
  assert.equal(g.continuations.length, 0);
  assert.equal(g.edges.length, 1);
});

// --- Handle-resize: border pins ride the moved edge -------------------------

test("resizedPortPoint: a pin on a moved edge follows it; along-edge stays", () => {
  const prev = { x: 0, y: 0, width: 100, height: 60 };
  const next = { x: 0, y: 0, width: 140, height: 60 }; // right edge 100 -> 140
  // Pin on the right edge, mid-height: x follows the edge, y stays absolute.
  assert.deepEqual(resizedPortPoint(prev, next, { x: 100, y: 30 }), { x: 140, y: 30 });
  // Pin on the top edge keeps its absolute x (clamped into the new span).
  assert.deepEqual(resizedPortPoint(prev, next, { x: 50, y: 0 }), { x: 50, y: 0 });
});

test("resizedPortPoint: corner pin follows both moved edges", () => {
  const prev = { x: 10, y: 10, width: 50, height: 50 };
  const next = { x: 10, y: 10, width: 80, height: 90 };
  assert.deepEqual(resizedPortPoint(prev, next, { x: 60, y: 60 }), { x: 90, y: 100 });
});

test("resizedPortPoint: along-edge position clamps into a SHRUNK span", () => {
  const prev = { x: 0, y: 0, width: 100, height: 60 };
  const next = { x: 0, y: 0, width: 40, height: 60 }; // width shrinks past the pin
  // Pin on the top edge at x=80 would fall off the new border — clamps inside.
  assert.deepEqual(resizedPortPoint(prev, next, { x: 80, y: 0 }), { x: 36, y: 0 });
});

test("resizedPortPoint: interior pins are not ours to guess", () => {
  const prev = { x: 0, y: 0, width: 100, height: 60 };
  const next = { x: 0, y: 0, width: 140, height: 80 };
  assert.equal(resizedPortPoint(prev, next, { x: 50, y: 30 }), null);
});

test("resizeBoxWithTerminals: border terminal rides, its wire follows by port id", () => {
  const g = sampleGraph();
  // p1 sits on n1's right edge (x=10); wire e1 runs from it horizontally.
  g.edges[0].path = [{ x: 10, y: 5 }, { x: 50, y: 5 }];
  resizeBoxWithTerminals(g, "n1", { x: 0, y: 0, width: 30, height: 10 });
  assert.deepEqual(g.nodes[0].bbox, { x: 0, y: 0, width: 30, height: 10 });
  assert.deepEqual(g.ports[0].point, { x: 30, y: 5 }); // rode the right edge
  assert.deepEqual(g.edges[0].path[0], { x: 30, y: 5 }); // wire end followed
  assert.deepEqual(g.ports[1].point, { x: 50, y: 5 }); // other component untouched
});

test("resizeBoxWithTerminals: resizes a ground bbox through the same entry", () => {
  const g = { ...sampleGraph(), grounds: [{ id: "g1", type: "ground", label: "FG", bbox: { x: 5, y: 5, width: 10, height: 10 } }] };
  assert.equal(resizeBoxWithTerminals(g, "g1", { x: 5, y: 5, width: 20, height: 14 }), true);
  assert.deepEqual(g.grounds[0].bbox, { x: 5, y: 5, width: 20, height: 14 });
});

test("resizeBoxWithTerminals: a ground's border terminal RIDES like a component's", () => {
  const g = {
    ...sampleGraph(),
    grounds: [{ id: "g1", type: "ground", label: "G", bbox: { x: 100, y: 100, width: 30, height: 30 } }],
  };
  g.ports.push({ id: "gp1", parentId: "g1", type: "terminal", label: "T~G~G", point: { x: 115, y: 100 } }); // on the top edge
  resizeBoxWithTerminals(g, "g1", { x: 100, y: 90, width: 30, height: 40 });
  assert.deepEqual(g.ports.find((p) => p.id === "gp1").point, { x: 115, y: 90 }); // rode the top edge up
});

test("deleteElement: deleting a ground cascades its terminals and their wires", () => {
  const g = {
    ...sampleGraph(),
    grounds: [{ id: "g1", type: "ground", label: "G", bbox: { x: 100, y: 100, width: 30, height: 30 } }],
  };
  g.ports.push({ id: "gp1", parentId: "g1", type: "terminal", label: "T~G~G", point: { x: 115, y: 100 } });
  g.edges.push({ id: "ge1", sourcePortId: "p2", targetPortId: "gp1", path: [{ x: 50, y: 5 }, { x: 115, y: 100 }] });
  deleteElement(g, "g1");
  assert.equal(g.grounds.length, 0);
  assert.equal(g.ports.some((p) => p.id === "gp1"), false);
  assert.equal(g.edges.some((e) => e.id === "ge1"), false);
  assert.equal(g.ports.some((p) => p.id === "p2"), true); // the far component keeps its pin
});

test("resizeBoxWithTerminals: unknown id is a clean no-op", () => {
  const g = sampleGraph();
  assert.equal(resizeBoxWithTerminals(g, "nope", { x: 0, y: 0, width: 10, height: 10 }), false);
});

test("pasteContinuationAt: anchors to a wire end within snap radius", () => {
  const g = sampleGraph();
  g.edges[0].path = [{ x: 10, y: 5 }, { x: 50, y: 5 }];
  pasteContinuationAt(g, { sheet: "6", zone: "1", rawRef: "6/1" }, { x: 45, y: 8 }, "cont-new");
  const c = g.continuations.find((x) => x.id === "cont-new");
  assert.ok(c);
  assert.deepEqual(c.point, { x: 50, y: 5 }); // snapped onto the endpoint
  assert.deepEqual(c.target, { kind: "port", id: "p2" }); // target-bound
  assert.equal(c.rawRef, "6/1");
});

test("pasteContinuationAt: empty space pastes unanchored at the cursor", () => {
  const g = sampleGraph();
  g.edges[0].path = [{ x: 10, y: 5 }, { x: 50, y: 5 }];
  pasteContinuationAt(g, { sheet: "6", zone: "1", rawRef: "6/1" }, { x: 400, y: 400 }, "cont-far");
  const c = g.continuations.find((x) => x.id === "cont-far");
  assert.deepEqual(c.point, { x: 400, y: 400 });
  assert.equal(c.target, null);
});

test("inferWireNet: inherits through a pass-through THR device (Shane's U2/V2/W2)", () => {
  // MS2 -> THR2 wire; THR2's far-side terminal carries net U2.
  const g = {
    nodes: [
      { id: "ms2", type: "component", label: "MS2", bbox: { x: 1200, y: 700, width: 73, height: 250 } },
      { id: "thr2", type: "component", label: "THR2", bbox: { x: 1390, y: 700, width: 60, height: 250 } },
    ],
    ports: [
      { id: "pA", parentId: "ms2", type: "terminal", label: "T-7", point: { x: 1273, y: 730 } },
      { id: "pB", parentId: "thr2", type: "terminal", label: "T-8", point: { x: 1390, y: 730 } },
      { id: "pC", parentId: "thr2", type: "terminal", label: "T~THR2~U2", point: { x: 1450, y: 730 } },
    ],
    edges: [],
    continuations: [],
  };
  assert.equal(inferWireNet(g, "pA", "pB"), "U2");
  nameEndpointsFromNet(g, ["pA", "pB"], "U2");
  assert.equal(g.ports[0].label, "T~MS2~U2"); // generic name repaired
  assert.equal(g.ports[1].label, "T~THR2~U2");
  assert.equal(g.ports[2].label, "T~THR2~U2"); // untouched (already conventional)
});

// --- reparentPort: the page-11 ELB50 lesson (blessed 2026-07-11) ------------
// Re-parenting via delete+re-add cascade-deleted 3 conductors silently; the
// op must preserve attached wires (they follow by port id) or refuse with a
// count — and a port-delete cascade must never run unspoken.

test("reparentPort: adopts an orphan terminal and PRESERVES its attached wires", () => {
  const g = sampleGraph();
  g.ports.push({ id: "p3", parentId: "", type: "terminal", label: "T~R500~R500", point: { x: 864, y: 730 } });
  g.edges.push({ id: "e2", sourcePortId: "p3", targetPortId: "p2", path: [{ x: 864, y: 730 }, { x: 50, y: 5 }], label: "R500" });
  const r = reparentPort(g, "p3", "n1");
  assert.equal(r.ok, true);
  assert.equal(r.wiresPreserved, 1);
  assert.equal(g.ports.find((p) => p.id === "p3").parentId, "n1");
  assert.equal(g.edges.some((e) => e.id === "e2"), true); // the conductor survived
});

test("reparentPort: unknown port or component REFUSES (never a silent no-op)", () => {
  const g = sampleGraph();
  const r1 = reparentPort(g, "nope", "n1");
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /not found/);
  const r2 = reparentPort(g, "p1", "nope");
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /not found/);
  assert.equal(g.edges.length, 1); // graph untouched either way
});

test("reparentPort: junctions refuse — wire topology is never a component pin", () => {
  const g = sampleGraph();
  g.ports.push({ id: "j1", parentId: "", type: "junction", label: "J-1", point: { x: 30, y: 5 } });
  g.edges.push({ id: "e2", sourcePortId: "j1", targetPortId: "p2", path: [], label: "R100" });
  const r = reparentPort(g, "j1", "n1");
  assert.equal(r.ok, false);
  assert.match(r.reason, /junction/);
  assert.match(r.reason, /1 wire/); // the count is in the refusal
  assert.equal(g.ports.find((p) => p.id === "j1").parentId, ""); // unchanged
  assert.equal(g.edges.length, 2); // nothing cascaded
});

test("reparentPort: re-parenting to the current parent is a preserved no-op", () => {
  const g = sampleGraph();
  const r = reparentPort(g, "p1", "n1");
  assert.equal(r.ok, true);
  assert.equal(r.wiresPreserved, 1);
  assert.match(r.detail, /already parented/);
  assert.equal(g.ports[0].parentId, "n1");
  assert.equal(g.edges.length, 1);
});

test("reparentPort: a mate keeps its second parent and its wires", () => {
  const g = sampleGraph();
  g.nodes.push({ id: "n3", type: "component", label: "C", bbox: { x: 100, y: 0, width: 10, height: 10 } });
  g.ports.push({ id: "m1", parentId: "n1", parentId2: "n2", type: "mate", label: "T~A~B", point: { x: 10, y: 8 } });
  g.edges.push({ id: "e2", sourcePortId: "m1", targetPortId: "p2", path: [], label: "X1" });
  const r = reparentPort(g, "m1", "n3");
  assert.equal(r.ok, true);
  assert.equal(r.wiresPreserved, 1);
  assert.match(r.detail, /second parent/);
  const m = g.ports.find((p) => p.id === "m1");
  assert.equal(m.parentId, "n3");
  assert.equal(m.parentId2, "n2"); // untouched
  assert.equal(g.edges.length, 2);
});

test("deleteElement: a wired terminal's cascade is COUNTED in the notes (the silence fix)", () => {
  const g = sampleGraph();
  const notes = [];
  deleteElement(g, "p2", notes);
  assert.equal(g.edges.length, 0); // the cascade itself stays legal...
  assert.equal(notes.some((n) => /cascaded 1 attached wire/.test(n) && /R100/.test(n)), true); // ...but never silent
});

test("inferWireNet: endpoint net agreement, and no inference through non-pass-through", () => {
  const g = {
    nodes: [
      { id: "mc", type: "component", label: "MC321", bbox: { x: 0, y: 0, width: 60, height: 60 } },
    ],
    ports: [
      { id: "p1", parentId: "", type: "terminal", label: "T~CONT~P24", point: { x: 100, y: 10 } },
      { id: "p2", parentId: "mc", type: "terminal", label: "T~MC321~P24", point: { x: 30, y: 0 } },
      { id: "p3", parentId: "mc", type: "terminal", label: "T~MC321~X1", point: { x: 30, y: 60 } },
      { id: "p4", parentId: "", type: "terminal", label: "T-2", point: { x: 300, y: 60 } },
    ],
    edges: [],
    continuations: [],
  };
  assert.equal(inferWireNet(g, "p1", "p2"), "P24"); // agreement
  assert.equal(inferWireNet(g, "p3", "p4"), "X1"); // one named end, other bare
  // MC321 is NOT pass-through: a bare-to-bare wire on it infers nothing
  g.ports[2].label = "T-9";
  assert.equal(inferWireNet(g, "p3", "p4"), null);
});
