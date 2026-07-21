import assert from "node:assert/strict";
import test from "node:test";
import { applyAnnotateOps } from "./v2-bridge-ops.ts";

const empty = () => ({ nodes: [], ports: [], edges: [], continuations: [] });

test("add_component mints a labeled node", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 10, y: 10, width: 50, height: 30 } },
  ]);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].label, "COMP-1");
  assert.match(notes[0], /added component/);
});

test("tiny component bbox is rejected", () => {
  const g = empty();
  applyAnnotateOps(g, [{ op: "add_component", bbox: { x: 0, y: 0, width: 4, height: 4 } }]);
  assert.equal(g.nodes.length, 0);
});

test("add_ground snaps a snug box to the glyph circle and mints a first-class ground", () => {
  const g = empty();
  // A circle is encoded as a diagonal bbox segment; stem/bars are axis-aligned.
  const geometry = {
    segments: [
      { x1: 591, y1: 679, x2: 636, y2: 724 }, // 45x45 circle bbox (diagonal)
      { x1: 614, y1: 668, x2: 614, y2: 701 }, // stem
      { x1: 597, y1: 701, x2: 630, y2: 701 }, // earth bar
    ],
    texts: [],
  };
  const { notes, minted } = applyAnnotateOps(
    g, [{ op: "add_ground", point: { x: 613, y: 701 } }], [], [], geometry
  );
  assert.equal((g.grounds ?? []).length, 1);
  assert.equal(g.grounds[0].label, "GND");
  assert.ok(g.grounds[0].bbox.width >= 43 && g.grounds[0].bbox.width <= 52);
  assert.ok(minted[0]?.ground);
  assert.match(notes.join(" "), /added ground/);
});

test("add_ground dedupes a redelivered command", () => {
  const g = empty();
  const geometry = { segments: [{ x1: 591, y1: 679, x2: 636, y2: 724 }], texts: [] };
  const op = { op: "add_ground", point: { x: 613, y: 701 } };
  applyAnnotateOps(g, [op], [], [], geometry);
  applyAnnotateOps(g, [op], [], [], geometry);
  assert.equal(g.grounds.length, 1);
});

test("add_ground with no glyph under the point is a no-op skip", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(
    g, [{ op: "add_ground", point: { x: 10, y: 10 } }], [], [], { segments: [], texts: [] }
  );
  assert.equal((g.grounds ?? []).length, 0);
  assert.match(notes.join(" "), /no ground glyph/);
});

test("delete removes a first-class ground", () => {
  const g = empty();
  const geometry = { segments: [{ x1: 591, y1: 679, x2: 636, y2: 724 }], texts: [] };
  applyAnnotateOps(g, [{ op: "add_ground", point: { x: 613, y: 701 } }], [], [], geometry);
  const id = g.grounds[0].id;
  const { notes } = applyAnnotateOps(g, [{ op: "delete", id }]);
  assert.equal(g.grounds.length, 0);
  assert.match(notes.join(" "), /deleted/);
});

test("add_wire creates ports at both ends and parents them to containing components", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 40, height: 40 }, label: "F1" },
    { op: "add_wire", path: [{ x: 20, y: 20 }, { x: 300, y: 20 }], label: "101K" },
  ]);
  assert.equal(g.edges.length, 1);
  assert.equal(g.ports.length, 2);
  const srcPort = g.ports.find((p) => p.id === g.edges[0].sourcePortId);
  assert.equal(srcPort.parentId, g.nodes[0].id); // inside F1's bbox
  assert.equal(g.edges[0].label, "101K");
});

test("add_wire reuses a port already at the endpoint", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_terminal", point: { x: 100, y: 100 }, label: "T9" },
    { op: "add_wire", path: [{ x: 100, y: 100 }, { x: 200, y: 100 }] },
  ]);
  assert.equal(g.ports.length, 2); // T9 reused, one new at far end
  const src = g.ports.find((p) => p.id === g.edges[0].sourcePortId);
  assert.equal(src.label, "T9");
});

test("degenerate wire (both ends at one point) is skipped", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 5, y: 5 }, { x: 8, y: 5 }] },
  ]);
  assert.equal(g.edges.length, 0);
  assert.match(notes.find((n) => n.includes("degenerate")), /degenerate/);
});

test("duplicate terminal placement is skipped", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_terminal", point: { x: 50, y: 50 } },
    { op: "add_terminal", point: { x: 53, y: 50 } },
  ]);
  assert.equal(g.ports.length, 1);
});

test("rename and delete round-trip", () => {
  const g = empty();
  applyAnnotateOps(g, [{ op: "add_component", bbox: { x: 0, y: 0, width: 30, height: 30 } }]);
  const id = g.nodes[0].id;
  applyAnnotateOps(g, [{ op: "rename", id, label: "MC-4" }]);
  assert.equal(g.nodes[0].label, "MC-4");
  applyAnnotateOps(g, [{ op: "delete", id }]);
  assert.equal(g.nodes.length, 0);
});

test("unknown op is skipped with a note, not thrown", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [{ op: "teleport" }]);
  assert.match(notes[0], /unknown op/);
});

test("clear empties the whole page in one op and reports the count", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 40, height: 40 } },
    { op: "add_wire", path: [{ x: 20, y: 20 }, { x: 300, y: 20 }] },
  ]);
  const { notes } = applyAnnotateOps(g, [{ op: "clear" }]);
  assert.equal(g.nodes.length + g.ports.length + g.edges.length + g.continuations.length, 0);
  assert.match(notes[0], /cleared page \(4 elements removed\)/);
});

test("resize finds a component by id or containing point; interior terminals never move", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "ELB12" },
    { op: "add_terminal", point: { x: 110, y: 125 }, label: "1" }, // 10px inside the left edge — interior
  ]);
  const port = g.ports[0];
  const { notes } = applyAnnotateOps(g, [
    { op: "resize", at: { x: 120, y: 120 }, bbox: { x: 90, y: 90, width: 80, height: 80 } },
  ]);
  assert.match(notes[0], /resized ELB12/);
  assert.deepEqual(g.nodes[0].bbox, { x: 90, y: 90, width: 80, height: 80 });
  assert.deepEqual(port.point, { x: 110, y: 125 }); // interior: not ours to guess
});

test("resize: BORDER terminals ride the moved edge by default (Shane's ruling 2026-07-09)", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "MC7" },
    { op: "add_terminal", point: { x: 150, y: 125 }, label: "13" }, // ON the right edge
  ]);
  const port = g.ports[0];
  const { notes } = applyAnnotateOps(g, [
    { op: "resize", id: g.nodes[0].id, bbox: { x: 100, y: 100, width: 90, height: 50 } },
  ]);
  assert.match(notes[0], /rode the moved edges/);
  assert.deepEqual(port.point, { x: 190, y: 125 }); // rode right edge 150 -> 190
});

test("resize: opts.resizeRideTerminals=false resizes the shell only", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "MC8" },
    { op: "add_terminal", point: { x: 150, y: 125 }, label: "14" }, // ON the right edge
  ]);
  const port = g.ports[0];
  const { notes } = applyAnnotateOps(g, [
    { op: "resize", id: g.nodes[0].id, bbox: { x: 100, y: 100, width: 90, height: 50 } },
  ], [], [], null, { resizeRideTerminals: false });
  assert.match(notes[0], /shell only/);
  assert.deepEqual(g.nodes[0].bbox, { x: 100, y: 100, width: 90, height: 50 });
  assert.deepEqual(port.point, { x: 150, y: 125 }); // kept page coordinates
});

test("reparent attaches an orphaned terminal to a component", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "CT11" },
    { op: "add_terminal", point: { x: 130, y: 174 }, label: "T-L-T1" }, // 1px outside bbox -> orphan
  ]);
  assert.equal(g.ports[0].parentId, "");
  const { notes } = applyAnnotateOps(g, [{ op: "reparent", id: g.ports[0].id, component_id: g.nodes[0].id }]);
  assert.equal(g.ports[0].parentId, g.nodes[0].id);
  assert.match(notes[0], /reparented/);
});

test("reparent receipt PROVES wire preservation with a count (page-11 ELB50 lesson)", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "ELB50" },
    { op: "add_wire", path: [{ x: 170, y: 125 }, { x: 300, y: 125 }], label: "R500" }, // both ends orphan
  ]);
  const orphan = g.ports.find((p) => p.point.x === 170);
  assert.equal(orphan.parentId, "");
  const { notes } = applyAnnotateOps(g, [{ op: "reparent", id: orphan.id, component_id: g.nodes[0].id }]);
  assert.match(notes[0], /reparented/);
  assert.match(notes[0], /1 attached wire\(s\) preserved/);
  assert.equal(g.edges.length, 1); // the conductor survived the re-parent
});

test("reparent refuses a junction with the riding-wire count", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "MC1" },
    { op: "add_wire", path: [{ x: 200, y: 100 }, { x: 200, y: 500 }], label: "R1" }, // trunk
    { op: "add_wire", path: [{ x: 200, y: 300 }, { x: 400, y: 300 }], label: "R1" }, // tap -> junction
  ]);
  const tap = g.ports.find((p) => p.type === "junction");
  const edgesBefore = g.edges.length;
  const { notes } = applyAnnotateOps(g, [{ op: "reparent", id: tap.id, component_id: g.nodes[0].id }]);
  assert.match(notes[0], /refused reparent/);
  assert.match(notes[0], /junction/);
  assert.equal(g.ports.find((p) => p.id === tap.id).parentId, ""); // unchanged
  assert.equal(g.edges.length, edgesBefore); // nothing cascaded
});

test("add_continuation attaches to a wire-end port when one is close", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 50 }, { x: 300, y: 50 }], label: "1112" },
  ]);
  const endPort = g.ports.find((p) => p.point.x === 300);
  const { notes } = applyAnnotateOps(g, [
    { op: "add_continuation", point: { x: 300, y: 50 }, sheet: "11", zone: "24" },
  ]);
  assert.equal(g.continuations.length, 1);
  assert.deepEqual(g.continuations[0].target, { kind: "port", id: endPort.id });
  assert.equal(g.continuations[0].rawRef, "11/24");
  assert.match(notes[0], /added continuation 11\/24/);
});

test("a wire end landing on an existing wire mints a junction, not a terminal", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 100 }, { x: 100, y: 500 }], label: "R1" }, // trunk
    { op: "add_wire", path: [{ x: 100, y: 300 }, { x: 400, y: 300 }], label: "R1" }, // tap branch
  ]);
  const tap = g.ports.find((p) => p.point.x === 100 && p.point.y === 300);
  assert.equal(tap.type, "junction");
  assert.equal(tap.parentId, "");
  // R1.0: the trunk SPLITS at the tap (degree-3 junction) — one NET, encoded
  // in the data, not just pixels (both halves keep the trunk's label).
  assert.equal(g.edges.length, 3);
  const tapDeg = g.edges.filter((e) => e.sourcePortId === tap.id || e.targetPortId === tap.id).length;
  assert.equal(tapDeg, 3);
});

test("add_continuation with target_id attaches to a component outside containment", () => {
  const g = empty();
  applyAnnotateOps(g, [{ op: "add_component", bbox: { x: 100, y: 100, width: 50, height: 50 }, label: "ELB11" }]);
  applyAnnotateOps(g, [
    { op: "add_continuation", point: { x: 120, y: 200 }, sheet: "32", zone: "7", target_id: g.nodes[0].id },
  ]);
  assert.deepEqual(g.continuations[0].target, { kind: "component", id: g.nodes[0].id });
  assert.equal(g.continuations[0].rawRef, "32/7");
});

test("set_page_meta merges metadata onto the graph", () => {
  const g = empty();
  applyAnnotateOps(g, [{ op: "set_page_meta", meta: { description: "MAIN POWER, POWER LAMP", drawing_number: "<drawing-no>:202-0" } }]);
  applyAnnotateOps(g, [{ op: "set_page_meta", meta: { sheet_ref: "1/207" } }]);
  assert.equal(g.meta.description, "MAIN POWER, POWER LAMP");
  assert.equal(g.meta.sheet_ref, "1/207");
});

// --- redelivery safety: at-least-once command delivery must not double elements ---

test("redelivered add_wire (identical path) is a no-op", () => {
  const g = empty();
  const ops = [{ op: "add_wire", path: [{ x: 100, y: 100 }, { x: 500, y: 100 }], label: "R102" }];
  applyAnnotateOps(g, ops);
  const { notes } = applyAnnotateOps(g, ops); // resend after lost receipt
  assert.equal(g.edges.length, 1);
  assert.equal(g.ports.length, 2);
  // Slate 4.3 binds the resent endpoints to the existing terminals first, so
  // the dedupe note follows the two bind notes rather than leading.
  assert.ok(notes.some((n) => /redelivered/.test(n)), JSON.stringify(notes));
});

test("redelivered add_component (identical bbox+label) is a no-op", () => {
  const g = empty();
  const ops = [{ op: "add_component", bbox: { x: 10, y: 10, width: 80, height: 60 }, label: "ELB21" }];
  applyAnnotateOps(g, ops);
  applyAnnotateOps(g, ops);
  assert.equal(g.nodes.length, 1);
});

test("redelivered add_continuation (same point+refs) is a no-op", () => {
  const g = empty();
  const ops = [{ op: "add_continuation", point: { x: 250, y: 590 }, sheet: "8", zone: "2" }];
  applyAnnotateOps(g, ops);
  applyAnnotateOps(g, ops);
  assert.equal(g.continuations.length, 1);
});

test("same path with a DIFFERENT label is not treated as a duplicate wire", () => {
  const g = empty();
  applyAnnotateOps(g, [{ op: "add_wire", path: [{ x: 0, y: 0 }, { x: 300, y: 0 }], label: "S102" }]);
  applyAnnotateOps(g, [{ op: "add_wire", path: [{ x: 0, y: 0 }, { x: 300, y: 0 }], label: "T102" }]);
  assert.equal(g.edges.length, 2);
});

test("reusing a legacy port binds with label and distance named", () => {
  // Slate 4.3: wire endpoints bind to EXISTING graph ports (<=15px) before
  // ensurePort ever runs, so reuse is reported as a bind note naming the
  // terminal and the displacement — visible reuse, never silent wiring.
  const g = empty();
  g.ports.push({ id: "port-legacy-7-3", parentId: "", type: "terminal", point: { x: 100, y: 100 }, label: "L3" });
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 105, y: 100 }, { x: 300, y: 100 }] },
  ]);
  assert.equal(g.ports.length, 2); // legacy reused + far end minted
  const note = notes.find((n) => n.includes("bound to existing"));
  assert.match(note, /terminal L3/);
  assert.match(note, /Δ5px/);
});

test("joining a dot-less mid-run stub terminal warns (segmented conductor)", () => {
  // The dangerous unparented-reuse class: the stub already carries an edge,
  // so binding to it mid-run segments the conductor — born-WARN at apply
  // time instead of surfacing one audit later.
  const g = empty();
  g.ports.push(
    { id: "port-x", parentId: "", type: "terminal", point: { x: 100, y: 100 }, label: "T1" },
    { id: "port-y", parentId: "", type: "terminal", point: { x: 100, y: 40 }, label: "T2" }
  );
  g.edges.push({ id: "edge-1", sourcePortId: "port-y", targetPortId: "port-x",
                 path: [{ x: 100, y: 40 }, { x: 100, y: 100 }], label: null });
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 100 }, { x: 300, y: 100 }] },
  ]);
  assert.match(notes.find((n) => n.includes("stub-edge")), /segmented conductor/);
});

test("tap near a trunk END mints a junction — the endpoint magnet does not steal it", () => {
  // Page-11 live trap (2026-07-06): trunk drawn 700→1470, tap aimed at 1461
  // (9px from the end, ON the trunk). The 15px endpoint bind magnetized the
  // tap to the trunk's end terminal — degree-2 join, diagonal spur, and a
  // cascade-consumed trunk on cleanup. The 6px tap law now outranks port
  // reuse when the point sits on the candidate's own edge.
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 530, y: 700 }, { x: 530, y: 1470 }], label: "T1" },
  ]);
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 530, y: 1461 }, { x: 700, y: 1461 }] },
  ]);
  const junctions = g.ports.filter((p) => p.type === "junction");
  assert.equal(junctions.length, 1, JSON.stringify(notes));
  assert.deepEqual({ x: junctions[0].point.x, y: junctions[0].point.y }, { x: 530, y: 1461 });
  // trunk split + spur = 3 edges; junction is degree-3
  assert.equal(g.edges.length, 3);
  const jid = junctions[0].id;
  const deg = g.edges.filter((e) => e.sourcePortId === jid || e.targetPortId === jid).length;
  assert.equal(deg, 3);
  assert.ok(notes.some((n) => n.includes("trunk") && n.includes("split")), JSON.stringify(notes));
});

test("joining exactly at a trunk end still binds to the endpoint terminal", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 530, y: 700 }, { x: 530, y: 1470 }], label: "T1" },
  ]);
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 532, y: 1470 }, { x: 700, y: 1470 }] },
  ]);
  assert.equal(g.ports.filter((p) => p.type === "junction").length, 0);
  assert.ok(notes.some((n) => n.includes("bound to existing")), JSON.stringify(notes));
});

test("orphan terminal mint warns box-first", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [{ op: "add_terminal", point: { x: 500, y: 500 } }]);
  assert.equal(g.ports.length, 1);
  assert.match(notes.find((n) => n.includes("box first")), /no component box here/);
});

test("terminal inside a component box mints without warnings", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 40, height: 40 }, label: "F1" },
    { op: "add_terminal", point: { x: 20, y: 20 } },
  ]);
  assert.equal(notes.filter((n) => n.startsWith("warning:")).length, 0);
});

test("minted map is parallel to ops with role->id per mint", () => {
  const g = empty();
  const { minted } = applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 40, height: 40 }, label: "F1" },
    { op: "add_wire", path: [{ x: 20, y: 20 }, { x: 300, y: 20 }] },
    { op: "add_terminal", point: { x: 600, y: 600 } },
    { op: "rename", id: g.nodes?.[0]?.id ?? "none", label: "F1" },
    { op: "add_terminal", point: { x: 600, y: 600 } }, // dup -> skipped, no mint
  ]);
  assert.equal(minted.length, 5);
  assert.equal(minted[0].node, g.nodes[0].id);
  assert.equal(minted[1].edge, g.edges[0].id);
  assert.equal(minted[1].source_port, g.edges[0].sourcePortId);
  assert.equal(minted[1].target_port, g.edges[0].targetPortId);
  assert.equal(minted[2].port, g.ports.find((p) => p.point.x === 600).id);
  assert.equal(minted[3], null);
  assert.equal(minted[4], null);
});

// --- snap:"artwork" -------------------------------------------------------------

import { buildPageGeometry } from "./v2-snapping.ts";

// Fake page: one horizontal conductor y=200 (x 100..500), one vertical x=300
// (y 200..400) — they meet at (300,200); plus a third segment ending there so
// the meet clusters as a junction (>=3 segment ends).
const fakeGeometry = () =>
  buildPageGeometry({
    scale: 1,
    shapes: [
      { bbox: [100, 200, 500, 200] },
      { bbox: [300, 200, 300, 400] },
      { bbox: [300, 120, 300, 200] },
    ],
    text_blocks: [],
  });

test("add_wire snap:'artwork' projects sloppy points onto the printed line", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(
    g,
    [{ op: "add_wire", path: [{ x: 152, y: 208 }, { x: 448, y: 193 }], snap: "artwork" }],
    [],
    [],
    fakeGeometry()
  );
  assert.equal(g.edges.length, 1);
  const path = g.edges[0].path;
  assert.equal(path[0].y, 200); // snapped onto y=200 conductor
  assert.equal(path[1].y, 200);
  assert.match(notes.find((n) => n.includes("snapped")), /snapped 2\/2 points .*max shift 8px/);
});

test("snap prefers the junction over the plain segment (within the silent band)", () => {
  // Slate 4.3: snaps land silently only up to SNAP_SILENT_MAX_PX (8px);
  // a Δ2px nudge onto the junction applies, and the junction outranks the
  // plain segment passing equally close.
  const g = empty();
  applyAnnotateOps(
    g,
    [{ op: "add_terminal", point: { x: 302, y: 201 }, snap: "artwork" }],
    [],
    [],
    fakeGeometry()
  );
  assert.deepEqual({ x: g.ports[0].point.x, y: g.ports[0].point.y }, { x: 300, y: 200 });
});

test("snap displacement past the silent max keeps RAW coords and reports", () => {
  // Slate 4.3: visible imprecision beats silent mutation — a snap that wants
  // to move a point >8px is refused; the point stays as given and the note
  // says what snap wanted.
  const g = empty();
  const { notes } = applyAnnotateOps(
    g,
    [{ op: "add_terminal", point: { x: 306, y: 206 }, snap: "artwork" }],
    [],
    [],
    fakeGeometry()
  );
  assert.deepEqual({ x: g.ports[0].point.x, y: g.ports[0].point.y }, { x: 306, y: 206 });
  assert.match(notes.find((n) => n.includes("wanted")), /snap onto \w+ wanted Δ8px.*REJECTED/);
});

test("snap with no artwork in radius keeps raw coords and warns", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(
    g,
    [{ op: "add_terminal", point: { x: 900, y: 900 }, snap: "artwork" }],
    [],
    [],
    fakeGeometry()
  );
  assert.equal(g.ports[0].point.x, 900);
  assert.match(notes.find((n) => n.includes("only")), /only 0\/1 points snapped within 28px/);
});

test("snap requested without geometry warns and applies raw", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 10, y: 10 }, { x: 90, y: 10 }], snap: "artwork" },
  ]);
  assert.equal(g.edges.length, 1);
  assert.match(notes.find((n) => n.includes("geometry")), /snap requested but page geometry not loaded/);
});

// --- scoped clear + delete_prefix -------------------------------------------------

const populated = () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 40, height: 40 }, label: "F1" },
    { op: "add_wire", path: [{ x: 20, y: 20 }, { x: 300, y: 20 }], label: "101K" },
    { op: "add_wire", path: [{ x: 300, y: 20 }, { x: 300, y: 200 }] },
    { op: "add_continuation", point: { x: 300, y: 200 }, sheet: "11", zone: "3" },
  ]);
  return g;
};

test("clear keep:['components'] wipes wires/terminals/continuations, boxes survive", () => {
  const g = populated();
  const { notes } = applyAnnotateOps(g, [{ op: "clear", keep: ["components"] }]);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.edges.length, 0);
  assert.equal(g.continuations.length, 0);
  assert.equal(g.ports.filter((p) => p.type === "terminal").length, 0);
  assert.ok(notes.find((n) => n.includes("post-wipe invariant")));
  assert.match(notes.find((n) => n.includes("invariant")), /wires\/continuations\/grounds = 0 ✓/);
});

test("clear layers:['wires'] keeps terminals but drops junction taps", () => {
  const g = populated();
  const junctionsBefore = g.ports.filter((p) => p.type === "junction").length;
  const terminalsBefore = g.ports.filter((p) => p.type === "terminal").length;
  const { notes } = applyAnnotateOps(g, [{ op: "clear", layers: ["wires"] }]);
  assert.equal(g.edges.length, 0);
  assert.equal(g.ports.filter((p) => p.type === "junction").length, 0);
  assert.equal(g.ports.filter((p) => p.type === "terminal").length, terminalsBefore);
  assert.ok(junctionsBefore >= 0);
  assert.match(notes.find((n) => n.includes("cleared wires")), /2 edges/);
});

test("clearing terminals keeps ones still used by kept wires, and notes it", () => {
  const g = populated();
  const { notes } = applyAnnotateOps(g, [{ op: "clear", layers: ["terminals"] }]);
  const inUse = new Set(g.edges.flatMap((e) => [e.sourcePortId, e.targetPortId]));
  for (const p of g.ports.filter((p) => p.type === "terminal")) {
    assert.ok(inUse.has(p.id), "surviving terminal must be a kept-wire endpoint");
  }
  assert.match(notes.find((n) => n.includes("cleared terminals")), /kept — still endpoints/);
});

test("delete_prefix removes matching ids with cascades; short prefixes refused", () => {
  const g = populated();
  g.ports.push({ id: "port-legacy-7-1", parentId: "", type: "terminal", point: { x: 900, y: 900 }, label: "L1" });
  g.ports.push({ id: "port-legacy-7-2", parentId: "", type: "terminal", point: { x: 950, y: 900 }, label: "L2" });
  const { notes } = applyAnnotateOps(g, [{ op: "delete_prefix", prefix: "port-legacy-" }]);
  assert.equal(g.ports.filter((p) => p.id.startsWith("port-legacy-")).length, 0);
  assert.match(notes[0], /deleted 2 elements with id prefix/);
  const { notes: n2 } = applyAnnotateOps(g, [{ op: "delete_prefix", prefix: "port" }]);
  assert.match(n2[0], /too short/);
});

test("diagonal wire segments warn (conductors are H/V)", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 100 }, { x: 300, y: 250 }] },
  ]);
  assert.equal(g.edges.length, 1); // warned, not blocked
  assert.match(notes.find((n) => n.includes("diagonal")), /conductors are H\/V/);
  const { notes: clean } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 500, y: 100 }, { x: 900, y: 100 }] },
  ]);
  assert.equal(clean.filter((n) => n.includes("diagonal")).length, 0);
});

// --- junction membership: taps are degree-3, electrically joined (R1.0) ---------

import fs from "node:fs";

function netSets(g) {
  // union-find over ports via edges
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x); parent.set(find(a), find(b)); };
  for (const e of g.edges) union(e.sourcePortId, e.targetPortId);
  const sets = new Map();
  for (const p of g.ports) {
    if (!parent.has(p.id)) parent.set(p.id, p.id);
    const r = find(p.id);
    if (!sets.has(r)) sets.set(r, new Set());
    sets.get(r).add(p.id);
  }
  return sets;
}

test("a tap splits the trunk: junction is degree-3 and spur joins the trunk net", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 100 }, { x: 100, y: 500 }], label: "R103" }, // trunk
    { op: "add_wire", path: [{ x: 100, y: 300 }, { x: 400, y: 300 }], label: "R103" }, // tap spur
  ]);
  const tap = g.ports.find((p) => p.type === "junction");
  const deg = g.edges.filter((e) => e.sourcePortId === tap.id || e.targetPortId === tap.id).length;
  assert.equal(deg, 3, "junction must reference trunk-in, trunk-out, spur");
  assert.equal(g.edges.length, 3); // trunk split into 2 + spur
  const sets = netSets(g);
  const trunkTop = g.ports.find((p) => p.point.y === 100);
  const spurEnd = g.ports.find((p) => p.point.x === 400);
  const roots = [...sets.values()].filter((s) => s.has(trunkTop.id) || s.has(spurEnd.id));
  assert.equal(roots.length, 1, "trunk and spur must be ONE net");
});

test("deleting a pass-through junction heals the trunk back into one edge", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 100 }, { x: 100, y: 500 }], label: "R103" },
    { op: "add_wire", path: [{ x: 100, y: 300 }, { x: 400, y: 300 }] },
  ]);
  const tap = g.ports.find((p) => p.type === "junction");
  // delete the spur first, then the junction — trunk must heal to a single edge
  const spur = g.edges.find((e) => e.path.some((pt) => pt.x === 400));
  applyAnnotateOps(g, [{ op: "delete", id: spur.id }, { op: "delete", id: tap.id }]);
  const trunkEdges = g.edges.filter((e) => e.label === "R103");
  assert.equal(trunkEdges.length, 1, "trunk healed to one edge");
  assert.equal(trunkEdges[0].path[0].y, 100);
  assert.equal(trunkEdges[0].path[trunkEdges[0].path.length - 1].y, 500);
});

test("normalize_taps repairs the arm-3 dangling junctions (archived ground truth)", () => {
  const raw = JSON.parse(fs.readFileSync(".atlas/experiment-archive/arm3-page10/graph.json", "utf8"));
  const g = raw.graph ?? raw;
  const danglingBefore = g.ports.filter((p) => p.type === "junction").filter(
    (p) => g.edges.filter((e) => e.sourcePortId === p.id || e.targetPortId === p.id).length < 2
  );
  assert.equal(danglingBefore.length, 7, "fixture expectation: 7 dangles");
  const { notes } = applyAnnotateOps(g, [{ op: "normalize_taps" }]);
  assert.match(notes[0], /normalized \d+ dangling junction/);
  const danglingAfter = g.ports.filter((p) => p.type === "junction").filter(
    (p) => g.edges.filter((e) => e.sourcePortId === p.id || e.targetPortId === p.id).length < 2
  );
  assert.ok(danglingAfter.length <= 2, `dangles after normalize: ${danglingAfter.length} (offset ones may remain)`);
});

test("mate: add_terminal on two flush borders mints ONE dual-parent mate", () => {
  const g = empty();
  const { notes, minted } = applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 100, height: 100 }, label: "CON20" },
    { op: "add_component", bbox: { x: 100, y: 0, width: 100, height: 100 }, label: "INV1" },
    { op: "add_terminal", point: { x: 100, y: 50 }, label: "T~CON20+INV1~MO1" },
  ]);
  const mate = g.ports.find((p) => p.type === "mate");
  assert.ok(mate, "mate minted");
  assert.equal(g.ports.length, 1);
  assert.ok(mate.parentId && mate.parentId2 && mate.parentId !== mate.parentId2);
  assert.ok(minted[2]?.port);
  assert.match(notes.join(" "), /MATE terminal .*conduct at this shared border/);
});

test("mate: cross-parent add_terminal onto an existing terminal UPGRADES it", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 100, height: 100 }, label: "A" },
  ]);
  const aId = g.nodes[0].id;
  applyAnnotateOps(g, [{ op: "add_terminal", component_id: aId, point: { x: 100, y: 50 } }]);
  assert.equal(g.ports[0].type, "terminal");
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 0, width: 100, height: 100 }, label: "B" },
  ]);
  const bId = g.nodes.find((n) => n.label === "B").id;
  const { notes } = applyAnnotateOps(g, [
    { op: "add_terminal", component_id: bId, point: { x: 100, y: 50 } },
  ]);
  assert.equal(g.ports.length, 1, "no duplicate minted");
  assert.equal(g.ports[0].type, "mate");
  assert.equal(g.ports[0].parentId, aId);
  assert.equal(g.ports[0].parentId2, bId);
  assert.match(notes.join(" "), /upgraded .*conduct/);
});

test("mate: one border only mints an ordinary terminal (no accidental mates)", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 100, height: 100 }, label: "A" },
    { op: "add_terminal", point: { x: 100, y: 50 } },
  ]);
  assert.equal(g.ports[0].type, "terminal");
  assert.equal(g.ports[0].parentId2, undefined);
});

test("mate: deleting one parent DEGRADES the mate to the survivor's terminal", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 100, height: 100 }, label: "CON20" },
    { op: "add_component", bbox: { x: 100, y: 0, width: 100, height: 100 }, label: "INV1" },
    { op: "add_terminal", point: { x: 100, y: 50 } },
  ]);
  const con20 = g.nodes.find((n) => n.label === "CON20");
  const inv1 = g.nodes.find((n) => n.label === "INV1");
  const { notes } = applyAnnotateOps(g, [{ op: "delete", id: con20.id }]);
  assert.equal(g.ports.length, 1, "mate survives the parent delete");
  assert.equal(g.ports[0].type, "terminal");
  assert.equal(g.ports[0].parentId, inv1.id);
  assert.equal(g.ports[0].parentId2, undefined);
  assert.match(notes.join(" "), /degraded to a terminal/);
});

test("connector pair: adopts an aligned existing terminal and upgrades it to a mate", () => {
  // Socket-first ordering (the real arrival order): CN23A's pin terminal was
  // placed before the connector box existed, so it's a plain terminal.
  const g2 = empty();
  applyAnnotateOps(g2, [
    { op: "add_component", bbox: { x: 160, y: 80, width: 80, height: 200 }, label: "CN23A" },
  ]);
  const sock2 = g2.nodes.find((n) => n.label === "CN23A");
  applyAnnotateOps(g2, [{ op: "add_terminal", component_id: sock2.id, point: { x: 160, y: 131 }, label: "T~CN23A~3" }]);
  assert.equal(g2.ports[0].type, "terminal");
  // Now the connector box lands flush against it…
  applyAnnotateOps(g2, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 60, height: 120 }, label: "CON23" },
  ]);
  // …and one tap on the INPUT pin (left border, row 130) pairs across: the
  // out side projects to (160,130) and ADOPTS the pin at (160,131) — 1px off
  // the row — upgrading it to a mate at ITS exact point.
  const { notes, minted } = applyAnnotateOps(g2, [
    { op: "add_connector_pair", point: { x: 100, y: 130 } },
  ]);
  const mate = g2.ports.find((p) => p.type === "mate");
  assert.ok(mate, "adopted terminal upgraded to mate: " + notes.join(" | "));
  assert.equal(mate.point.y, 131, "existing point wins over the projection");
  assert.equal(mate.parentId, sock2.id);
  assert.ok(minted[0].internal_edge, "internal conduction recorded");
  assert.equal(g2.edges.length, 1);
  assert.match(notes.join(" "), /adopted existing terminal .*upgraded to MATE/);
});

test("connector pair: two candidates near the row = ambiguous, refuses entirely", () => {
  // Socket-first again: two plain pin terminals on the future shared face,
  // >12px apart (no reuse merge) but both within ±8px of the projected row.
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 168, y: 80, width: 80, height: 200 }, label: "CN23B" },
  ]);
  const sock = g.nodes.find((n) => n.label === "CN23B");
  applyAnnotateOps(g, [
    { op: "add_terminal", component_id: sock.id, point: { x: 168, y: 123 }, label: "T~CN23B~1" },
    { op: "add_terminal", component_id: sock.id, point: { x: 168, y: 136 }, label: "T~CN23B~2" },
  ]);
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 68, height: 120 }, label: "CON24" }, // flush at 168
  ]);
  const before = { ports: g.ports.length, edges: g.edges.length };
  const { notes, minted } = applyAnnotateOps(g, [
    { op: "add_connector_pair", point: { x: 100, y: 130 } },
  ]);
  assert.equal(minted[0], null, "nothing minted on ambiguity: " + notes.join(" | "));
  assert.equal(g.ports.length, before.ports, "no half-built pair");
  assert.equal(g.edges.length, before.edges);
  assert.match(notes.join(" "), /AMBIGUOUS adoption/);
});

test("connector pair: fresh out-side mate when the socket box abuts flush", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 60, height: 120 }, label: "CON23" },
    { op: "add_component", bbox: { x: 160, y: 80, width: 80, height: 200 }, label: "CN23A" }, // flush at 160
  ]);
  const { notes, minted } = applyAnnotateOps(g, [
    { op: "add_connector_pair", point: { x: 100, y: 130 } },
  ]);
  assert.ok(minted[0]?.input_port && minted[0]?.out_port && minted[0]?.internal_edge, notes.join(" | "));
  const mate = g.ports.find((p) => p.type === "mate");
  assert.ok(mate, "out side minted as mate (flush socket): " + notes.join(" | "));
  assert.ok(mate.parentId2, "dual-parent");
  assert.equal(g.edges.length, 1, "internal segment recorded");
});

test("ground: resize op targets grounds by id (page-7 delete+re-add workaround retired)", () => {
  const g = empty();
  const geometry = { segments: [{ x1: 591, y1: 679, x2: 636, y2: 724 }], texts: [] };
  applyAnnotateOps(g, [{ op: "add_ground", point: { x: 613, y: 701 } }], [], [], geometry);
  const id = g.grounds[0].id;
  const { notes } = applyAnnotateOps(g, [
    { op: "resize", id, bbox: { x: 590, y: 678, width: 48, height: 48 } },
  ]);
  assert.equal(g.grounds[0].bbox.width, 48);
  assert.match(notes.join(" "), /resized ground/);
});

test("ground: clear layers:['grounds'] wipes only grounds", () => {
  const g = empty();
  const geometry = { segments: [{ x1: 591, y1: 679, x2: 636, y2: 724 }], texts: [] };
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 0, y: 0, width: 40, height: 40 }, label: "F1" },
    { op: "add_ground", point: { x: 613, y: 701 } },
  ], [], [], geometry);
  const { notes } = applyAnnotateOps(g, [{ op: "clear", layers: ["grounds"] }]);
  assert.equal(g.grounds.length, 0);
  assert.equal(g.nodes.length, 1, "components untouched");
  assert.match(notes.join(" "), /cleared grounds: 1/);
});

test("ground terminus: parent-less terminal at a ground notes doctrine, not 'box first?'", () => {
  const g = empty();
  const geometry = { segments: [{ x1: 591, y1: 679, x2: 636, y2: 724 }], texts: [] };
  applyAnnotateOps(g, [{ op: "add_ground", point: { x: 613, y: 701 } }], [], [], geometry);
  const { notes } = applyAnnotateOps(g, [
    { op: "add_terminal", point: { x: 613, y: 677 } }, // on the ground box top border
  ]);
  assert.match(notes.join(" "), /ground terminus/);
  assert.ok(!notes.join(" ").includes("box first?"), notes.join(" | "));
});

test("moveTerminal: a parented terminal slides along its component's border", async () => {
  const { moveTerminal } = await import("./v2-graph-ops.ts");
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 60, height: 120 }, label: "K1" },
  ]);
  const node = g.nodes[0];
  applyAnnotateOps(g, [{ op: "add_terminal", component_id: node.id, point: { x: 100, y: 130 }, label: "T~K1~A1" }]);
  const port = g.ports[0];
  // Cursor wanders INSIDE the box — the pin stays on the nearest border.
  assert.equal(moveTerminal(g, port.id, { x: 112, y: 160 }), true);
  assert.deepEqual(port.point, { x: 100, y: 160 }, "slid down the left border");
  // Cursor beyond a corner clamps to it.
  moveTerminal(g, port.id, { x: 80, y: 60 });
  assert.deepEqual(port.point, { x: 100, y: 100 });
});

test("moveTerminal: a mate stays on the shared flush face of BOTH parents", async () => {
  const { moveTerminal } = await import("./v2-graph-ops.ts");
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 60, height: 120 }, label: "CON20" },
    { op: "add_component", bbox: { x: 160, y: 80, width: 80, height: 200 }, label: "CN40B" },
  ]);
  applyAnnotateOps(g, [{ op: "add_terminal", point: { x: 160, y: 130 }, label: "T~CON20+CN40B~1" }]);
  const mate = g.ports.find((p) => p.type === "mate");
  assert.ok(mate, "setup minted a mate");
  moveTerminal(g, mate.id, { x: 150, y: 170 });
  assert.deepEqual(mate.point, { x: 160, y: 170 }, "slides along the shared x=160 face");
  // Past the shorter parent's end: chained projection clamps to the overlap.
  moveTerminal(g, mate.id, { x: 165, y: 40 });
  assert.equal(mate.point.x, 160);
  assert.ok(mate.point.y >= 100, "clamped to CON20's top corner on the shared face");
});

test("moveTerminal: attached wires follow BY ID and stay H/V (corner inserted on 2-point wires)", async () => {
  const { moveTerminal } = await import("./v2-graph-ops.ts");
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 60, height: 120 }, label: "K1" },
  ]);
  const node = g.nodes[0];
  applyAnnotateOps(g, [
    { op: "add_terminal", component_id: node.id, point: { x: 160, y: 130 }, label: "T~K1~A1" },
    { op: "add_wire", path: [{ x: 160, y: 130 }, { x: 300, y: 130 }], label: "N1" },
  ]);
  const port = g.ports.find((p) => p.label === "T~K1~A1");
  const edge = g.edges[0];
  assert.equal(edge.sourcePortId, port.id, "wire reused the pin");
  moveTerminal(g, port.id, { x: 160, y: 150 });
  assert.deepEqual(edge.path[0], { x: 160, y: 150 }, "endpoint followed the pin");
  assert.equal(edge.path.length, 3, "corner inserted to keep H/V");
  const [a, b, c] = edge.path;
  assert.ok((a.x === b.x || a.y === b.y) && (b.x === c.x || b.y === c.y), "every segment axis-aligned");
  assert.deepEqual(c, { x: 300, y: 130 }, "far terminal never moves");
});

test("moveTerminal: junctions refuse (wire topology is not draggable)", async () => {
  const { moveTerminal } = await import("./v2-graph-ops.ts");
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 300 }, { x: 400, y: 300 }], label: "N9" },
    { op: "add_wire", path: [{ x: 250, y: 300 }, { x: 250, y: 400 }], label: "N9" },
  ]);
  const junction = g.ports.find((p) => p.type === "junction");
  assert.ok(junction, "tap minted a junction");
  const before = { ...junction.point };
  assert.equal(moveTerminal(g, junction.id, { x: 260, y: 310 }), false);
  assert.deepEqual(junction.point, before);
});

test("move_terminal op: copilot parity with the canvas pin-drag (constrained + wires follow)", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 100, y: 100, width: 60, height: 120 }, label: "K1" },
  ]);
  const node = g.nodes[0];
  applyAnnotateOps(g, [
    { op: "add_terminal", component_id: node.id, point: { x: 160, y: 130 }, label: "T~K1~A1" },
    { op: "add_wire", path: [{ x: 160, y: 130 }, { x: 300, y: 130 }], label: "N1" },
  ]);
  const port = g.ports.find((p) => p.label === "T~K1~A1");
  const { notes } = applyAnnotateOps(g, [
    { op: "move_terminal", id: port.id, point: { x: 172, y: 150 } }, // off-border request
  ]);
  assert.deepEqual(port.point, { x: 160, y: 150 }, "projected onto the right border");
  assert.match(notes.join(" "), /moved terminal T~K1~A1 .*projected onto its parent's border/);
  assert.match(notes.join(" "), /1 wire endpoint followed/);
  assert.deepEqual(g.edges[0].path[0], { x: 160, y: 150 });
  assert.deepEqual(g.edges[0].path[1], { x: 160, y: 130 }, "jog at the moved pin — span stays on the printed row");
  // Junctions refuse.
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 200, y: 130 }, { x: 200, y: 260 }], label: "N1" },
  ]);
  const junction = g.ports.find((p) => p.type === "junction");
  assert.ok(junction, "tap minted a junction");
  const r2 = applyAnnotateOps(g, [{ op: "move_terminal", id: junction.id, point: { x: 220, y: 140 } }]);
  assert.match(r2.notes.join(" "), /refused move_terminal: .*junction/);
});

test("add_component ADOPTS pre-existing wire endpoints instead of doubling them (Shane's TB30 catch)", () => {
  const g = empty();
  // A wire drawn BEFORE the box: its endpoint terminal sits at the printed
  // border (x=148), unparented, 12px inside where the drawn border will land.
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 300, y: 125 }, { x: 148, y: 125 }], label: "Y4200" },
  ]);
  const endpoint = g.ports.find((p) => Math.abs(p.point.x - 148) <= 2);
  assert.ok(endpoint, "wire endpoint exists");
  const before = g.ports.length;
  // geometry: the conductor crosses the drawn border at x=160
  const geometry = { segments: [{ x1: 100, y1: 125, x2: 300, y2: 125 }], texts: [] };
  applyAnnotateOps(g, [
    { op: "add_component", bbox: { x: 60, y: 100, width: 100, height: 60 }, label: "CN9", auto_terminals: true },
  ], [], [], geometry);
  assert.equal(g.ports.length, before, "no duplicate minted — the endpoint was adopted");
  assert.equal(endpoint.parentId, g.nodes.find((n) => n.label === "CN9").id);
  assert.deepEqual(endpoint.point, { x: 160, y: 125 }); // slid onto the drawn border
  assert.match(endpoint.label, /^T~CN9~/); // renamed per convention
  assert.match(endpoint.label, /Y4200$/); // its wire's net preserved
  const wire = g.edges.find((e) => e.label === "Y4200");
  assert.deepEqual(wire.path[wire.path.length - 1], { x: 160, y: 125 }); // wire followed by port id
});

test("resize handles a CABLE bbox by id", () => {
  const g = { ...empty(), cables: [{ id: "cab1", type: "cable", label: "CAB21", bbox: { x: 100, y: 100, width: 200, height: 40 } }] };
  const { notes } = applyAnnotateOps(g, [
    { op: "resize", id: "cab1", bbox: { x: 100, y: 100, width: 260, height: 48 } },
  ]);
  assert.deepEqual(g.cables[0].bbox, { x: 100, y: 100, width: 260, height: 48 });
  assert.match(notes[0], /resized cable CAB21/);
});

test("rename on a cable reports the transition for the registry re-key", () => {
  const g = { ...empty(), cables: [{ id: "cab1", type: "cable", label: "CABLE-1", bbox: { x: 0, y: 0, width: 100, height: 30 } }] };
  const { cableRenames, notes } = applyAnnotateOps(g, [
    { op: "rename", id: "cab1", label: "CAB21" },
  ]);
  assert.equal(g.cables[0].label, "CAB21");
  assert.deepEqual(cableRenames, [{ from: "CABLE-1", to: "CAB21" }]);
  assert.match(notes[0], /roster follows the name/);
});

// --- 3-wire meet conversion (the redrawn-tap harness bug, fixed 2026-07-12) ---

test("third wire reusing a parentless terminal outside any box converts it to a junction", () => {
  const g = empty();
  // Two wires meet end-to-end at a shared parentless terminal in open field.
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 200 }, { x: 300, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 500, y: 200 }] },
  ]);
  const meet = g.ports.find((p) => p.point.x === 300 && p.point.y === 200);
  assert.equal(meet.type, "terminal");
  assert.equal(meet.parentId, "");
  // The 3rd wire lands on the same point: the meet must become a junction.
  const { notes } = applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 300, y: 400 }] },
  ]);
  assert.equal(meet.type, "junction");
  assert.match(meet.label, /^J/);
  assert.match(notes.join(" "), /3-wire meet outside any box/);
  // Same id throughout: all three wires still reference the converted port.
  const deg = g.edges.filter((e) => e.sourcePortId === meet.id || e.targetPortId === meet.id).length;
  assert.equal(deg, 3);
});

test("meet conversion spares in-box, ground-terminus, and printed-circle terminals", () => {
  // In a component box: pins legitimately take many wires.
  const boxed = empty();
  applyAnnotateOps(boxed, [
    { op: "add_component", bbox: { x: 250, y: 150, width: 100, height: 100 }, label: "MC1" },
    { op: "add_wire", path: [{ x: 100, y: 200 }, { x: 300, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 300, y: 240 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 340, y: 200 }] },
  ]);
  const pin = boxed.ports.find((p) => p.point.x === 300 && p.point.y === 200);
  assert.equal(pin.type, "terminal");
  // On a printed terminal circle: the print outranks the topological rule.
  const printed = empty();
  const geometry = { segments: [], texts: [], terminals: [{ point: { x: 300, y: 200 } }] };
  applyAnnotateOps(printed, [
    { op: "add_wire", path: [{ x: 100, y: 200 }, { x: 300, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 500, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 300, y: 400 }] },
  ], [], [], geometry);
  const circle = printed.ports.find((p) => p.point.x === 300 && p.point.y === 200);
  assert.equal(circle.type, "terminal");
  // At a ground element: the drain terminus stays a terminal by doctrine.
  const grounded = { ...empty(), grounds: [{ id: "gnd1", type: "ground", label: "GND", bbox: { x: 280, y: 180, width: 40, height: 40 } }] };
  applyAnnotateOps(grounded, [
    { op: "add_wire", path: [{ x: 100, y: 200 }, { x: 300, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 500, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 300, y: 400 }] },
  ]);
  const drain = grounded.ports.find((p) => p.point.x === 300 && p.point.y === 200);
  assert.equal(drain.type, "terminal");
});

test("a redelivered third wire cannot convert a meet without adding its wire", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 200 }, { x: 300, y: 200 }] },
    { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 500, y: 200 }] },
  ]);
  const spur = { op: "add_wire", path: [{ x: 300, y: 200 }, { x: 300, y: 400 }] };
  applyAnnotateOps(g, [spur]);
  const edgesAfterFirst = g.edges.length;
  const meet = g.ports.find((p) => p.point.x === 300 && p.point.y === 200);
  const labelAfterFirst = meet.label;
  applyAnnotateOps(g, [spur]); // redelivery: dedupe skips before conversion runs
  assert.equal(g.edges.length, edgesAfterFirst);
  assert.equal(meet.type, "junction");
  assert.equal(meet.label, labelAfterFirst); // no double conversion/relabel
});

// --- point-less add_continuation crash (live incident, 2026-07-12) ---

test("add_continuation with target_id and NO point derives the point and never crashes", () => {
  const g = empty();
  applyAnnotateOps(g, [
    { op: "add_wire", path: [{ x: 100, y: 200 }, { x: 300, y: 200 }], label: "X4211" },
  ]);
  const end = g.ports.find((p) => p.point.x === 300);
  const op = { op: "add_continuation", target_id: end.id, sheet: "8", zone: "4" };
  const { notes } = applyAnnotateOps(g, [op]);
  assert.equal(g.continuations.length, 1);
  assert.deepEqual(g.continuations[0].point, { x: 300, y: 200 }); // derived from the port
  assert.equal(g.continuations[0].target.id, end.id);
  assert.match(notes.join(" "), /added continuation/);
  // Redelivery dedupes by target binding even without a point.
  applyAnnotateOps(g, [op]);
  assert.equal(g.continuations.length, 1);
  // A follow-up point-based chip still dedupe-scans without crashing.
  const { notes: n2 } = applyAnnotateOps(g, [
    { op: "add_continuation", point: { x: 100, y: 200 }, sheet: "5", zone: "10" },
  ]);
  assert.equal(g.continuations.length, 2);
  assert.match(n2.join(" "), /added continuation/);
});

test("add_continuation with neither point nor resolvable target skips with a note", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_continuation", target_id: "port-nope", sheet: "8", zone: "4" },
  ]);
  assert.equal(g.continuations.length, 0);
  assert.match(notes.join(" "), /skipped add_continuation: no point/);
});

test("a throwing op becomes an error note; the rest of the batch still applies", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_component" }, // malformed: no bbox — throws inside the case
    { op: "add_component", bbox: { x: 10, y: 10, width: 50, height: 30 }, label: "MC1" },
  ]);
  assert.equal(g.nodes.length, 1); // second op landed
  assert.equal(g.nodes[0].label, "MC1");
  assert.match(notes.join(" "), /error: op 0 \(add_component\) threw/);
});

// --- the rawRef tax (mined from the first autonomous gold runs, 2026-07-13) ---

test("add_continuation accepts rawRef/ref spellings and parses the fraction into sheet/zone", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_continuation", point: { x: 100, y: 100 }, rawRef: "8/24" },
  ]);
  assert.equal(g.continuations.length, 1);
  assert.equal(g.continuations[0].sheet, "8");
  assert.equal(g.continuations[0].zone, "24");
  assert.equal(g.continuations[0].rawRef, "8/24");
  assert.match(notes.join(" "), /added continuation 8\/24/);
  assert.doesNotMatch(notes.join(" "), /UNLABELED/);
  // legacy 'ref' spelling too
  applyAnnotateOps(g, [{ op: "add_continuation", point: { x: 400, y: 100 }, ref: "9/1" }]);
  assert.equal(g.continuations[1].sheet, "9");
  // canonical raw_ref still works
  applyAnnotateOps(g, [{ op: "add_continuation", point: { x: 700, y: 100 }, raw_ref: "10/2" }]);
  assert.equal(g.continuations[2].sheet, "10");
});

test("an unlabelable continuation lands with a LOUD warning, never silently", () => {
  const g = empty();
  const { notes } = applyAnnotateOps(g, [
    { op: "add_continuation", point: { x: 100, y: 100 }, rawRef: "see sheet eight" },
  ]);
  assert.equal(g.continuations.length, 1); // still lands (annotation is real)
  assert.equal(g.continuations[0].sheet, null);
  assert.match(notes.join(" "), /warning: continuation landed UNLABELED/);
});

test("a redelivered rawRef-only command dedupes against its labeled chip", () => {
  const g = empty();
  const op = { op: "add_continuation", point: { x: 100, y: 100 }, rawRef: "8/24" };
  applyAnnotateOps(g, [op]);
  applyAnnotateOps(g, [op]);
  assert.equal(g.continuations.length, 1);
});
