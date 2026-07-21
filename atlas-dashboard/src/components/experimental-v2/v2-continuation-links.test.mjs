import assert from "node:assert/strict";
import test from "node:test";
import { continuationStatuses, pageSightings, printedRefAt, resolveLinks, refSheetOf, sheetNumberOf } from "./v2-continuation-links.ts";

function graphWith(conts, edges) {
  return { nodes: [], ports: [], edges, continuations: conts };
}

test("sheetNumberOf: fraction numerator is the identity; zero-pad preserved", () => {
  assert.equal(sheetNumberOf("5/207"), "5");
  assert.equal(sheetNumberOf("01/207"), "01"); // front matter series — NEVER int-normalized
  assert.equal(sheetNumberOf(null), null);
});

test("refSheetOf: sheet field wins; rawRef parses both slash and dash forms", () => {
  assert.equal(refSheetOf({ sheet: "6", rawRef: null }), "6");
  assert.equal(refSheetOf({ sheet: null, rawRef: "33-4" }), "33");
  assert.equal(refSheetOf({ sheet: null, rawRef: "6/1" }), "6");
  assert.equal(refSheetOf({ sheet: null, rawRef: null }), null);
});

test("pageSightings: only anchored, labeled, sheet-parseable chips sight", () => {
  const g = graphWith(
    [
      { id: "c1", sheet: "6", zone: "1", rawRef: "6/1", target: { kind: "port", id: "p1" }, point: { x: 0, y: 0 } },
      { id: "c2", sheet: "6", zone: "1", rawRef: "6/1", target: null, point: { x: 0, y: 0 } }, // unanchored
      { id: "c3", sheet: "6", zone: "1", rawRef: "6/1", target: { kind: "component", id: "n1" }, point: { x: 0, y: 0 } }, // device xref
      { id: "c4", sheet: null, rawRef: null, zone: null, target: { kind: "port", id: "p2" }, point: { x: 0, y: 0 } }, // no sheet
    ],
    [
      { id: "e1", sourcePortId: "px", targetPortId: "p1", path: [], label: "R502" },
      { id: "e2", sourcePortId: "py", targetPortId: "p2", path: [], label: "S502" },
    ]
  );
  const s = pageSightings(g);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], { contId: "c1", net: "R502", refSheet: "6", refZone: "1", rawRef: "6/1" });
});

test("resolveLinks: reciprocal sighting on the destination sheet resolves", () => {
  // Page 11 = sheet 5; its R502 points at sheet 6 (page 12). Page 12's R502
  // points back at sheet 5 -> linked pair.
  const registry = {
    "12": { sheet: "6/207", sightings: [{ contId: "cB", net: "R502", refSheet: "5", refZone: null, rawRef: "5/9" }] },
  };
  const mine = [{ contId: "cA", net: "R502", refSheet: "6", refZone: "1", rawRef: "6/1" }];
  const links = resolveLinks(registry, 11, "5/207", mine);
  assert.deepEqual(links.get("cA"), { page: 12, contId: "cB", net: "R502", sheet: "6" });
});

test("resolveLinks: wrong net, wrong back-ref, or same page never resolve", () => {
  const mine = [{ contId: "cA", net: "R502", refSheet: "6", refZone: null, rawRef: "6/1" }];
  // wrong net
  let links = resolveLinks(
    { "12": { sheet: "6/207", sightings: [{ contId: "x", net: "T502", refSheet: "5", refZone: null, rawRef: null }] } },
    11, "5/207", mine);
  assert.equal(links.size, 0);
  // right net but points elsewhere (not back at sheet 5)
  links = resolveLinks(
    { "12": { sheet: "6/207", sightings: [{ contId: "x", net: "R502", refSheet: "31", refZone: null, rawRef: null }] } },
    11, "5/207", mine);
  assert.equal(links.size, 0);
  // reciprocal entry on MY OWN page is ignored
  links = resolveLinks(
    { "11": { sheet: "5/207", sightings: [{ contId: "x", net: "R502", refSheet: "5", refZone: null, rawRef: null }] } },
    11, "5/207", mine);
  assert.equal(links.size, 0);
});

test("resolveLinks: front-matter zero-pad series never collides with sheet 1", () => {
  // A sighting pointing at sheet '1' must not resolve against a page whose
  // sheet is '01' (the contents series).
  const mine = [{ contId: "cA", net: "R1", refSheet: "1", refZone: null, rawRef: "1/1" }];
  const links = resolveLinks(
    { "2": { sheet: "01/207", sightings: [{ contId: "x", net: "R1", refSheet: "5", refZone: null, rawRef: null }] } },
    11, "5/207", mine);
  assert.equal(links.size, 0);
});

test("continuationStatuses: every why-state is distinguishable", () => {
  const graph = graphWith(
    [
      // resolved: anchored R502 -> sheet 6; page 12 reciprocates
      { id: "cRes", sheet: "6", zone: "1", rawRef: "6/1", target: { kind: "port", id: "p1" }, point: { x: 0, y: 0 } },
      // waiting: anchored T900 -> sheet 99 (not annotated)
      { id: "cWait", sheet: "99", zone: "2", rawRef: "99/2", target: { kind: "port", id: "p2" }, point: { x: 0, y: 0 } },
      // mismatch: anchored S502 -> sheet 6 annotated, but no reciprocal S502
      { id: "cMis", sheet: "6", zone: "3", rawRef: "6/3", target: { kind: "port", id: "p3" }, point: { x: 0, y: 0 } },
      // unanchored
      { id: "cUn", sheet: "2", zone: "9", rawRef: "2/9", target: null, point: { x: 0, y: 0 } },
      // unlabeled wire
      { id: "cNoNet", sheet: "6", zone: "4", rawRef: "6/4", target: { kind: "port", id: "p4" }, point: { x: 0, y: 0 } },
      // device cross-ref
      { id: "cDev", sheet: null, zone: null, rawRef: "34-22", target: { kind: "component", id: "n1" }, point: { x: 0, y: 0 } },
    ],
    [
      { id: "e1", sourcePortId: "px", targetPortId: "p1", path: [], label: "R502" },
      { id: "e2", sourcePortId: "py", targetPortId: "p2", path: [], label: "T900" },
      { id: "e3", sourcePortId: "pz", targetPortId: "p3", path: [], label: "S502" },
      { id: "e4", sourcePortId: "pw", targetPortId: "p4", path: [], label: "" },
    ]
  );
  const registry = {
    "12": { sheet: "6/207", sightings: [{ contId: "cB", net: "R502", refSheet: "5", refZone: null, rawRef: "5/9" }] },
  };
  const st = continuationStatuses(registry, 11, "5/207", graph);
  assert.equal(st.get("cRes").state, "resolved");
  assert.deepEqual(st.get("cRes").link, { page: 12, contId: "cB", net: "R502", sheet: "6" });
  assert.equal(st.get("cWait").state, "waiting");
  assert.equal(st.get("cMis").state, "mismatch");
  assert.equal(st.get("cMis").destPage, 12);
  assert.equal(st.get("cUn").state, "unanchored");
  assert.equal(st.get("cNoNet").state, "unlabeled");
  assert.equal(st.get("cDev").state, "device");
  // every detail is human-readable words, not codes
  for (const [, v] of st) assert.ok(v.detail.length > 10);
});

test("continuationStatuses: cable refs resolve through the cable registry", () => {
  const graph = {
    nodes: [], ports: [],
    edges: [],
    cables: [{ id: "cab-1", type: "cable", label: "CAB21", bbox: { x: 0, y: 0, width: 100, height: 20 } }],
    continuations: [
      // bound to CAB21, points at sheet 3 — registry says CAB21 lives on page 9 (sheet 3): LINKED
      { id: "cCab", sheet: "3", zone: "13", rawRef: "3/13", target: { kind: "cable", id: "cab-1" }, point: { x: 0, y: 0 } },
      // bound to CAB21, points at sheet 1 — page 7 (sheet 1) annotated but CAB21 not drawn there: MISMATCH
      { id: "cCabMis", sheet: "1", zone: "2", rawRef: "1/2", target: { kind: "cable", id: "cab-1" }, point: { x: 0, y: 0 } },
      // bound to CAB21, points at sheet 99 — not annotated: WAITING
      { id: "cCabWait", sheet: "99", zone: "1", rawRef: "99/1", target: { kind: "cable", id: "cab-1" }, point: { x: 0, y: 0 } },
    ],
  };
  const registry = {
    "7": { sheet: "1/207", sightings: [] },
    "9": { sheet: "3/207", sightings: [] },
  };
  const cableReg = { CAB21: { pages: [8, 9] } };
  const st = continuationStatuses(registry, 8, "2/207", graph, cableReg);
  assert.equal(st.get("cCab").state, "resolved");
  assert.equal(st.get("cCab").destPage, 9);
  assert.equal(st.get("cCabMis").state, "mismatch");
  assert.equal(st.get("cCabMis").destPage, 7);
  assert.equal(st.get("cCabWait").state, "waiting");
});

test("moveContinuation: a drop on a cable box binds the CABLE, not an endpoint", async () => {
  const { moveContinuation } = await import("./v2-graph-ops.ts");
  const g = {
    nodes: [], ports: [], edges: [],
    cables: [{ id: "cab-1", type: "cable", label: "CAB21", bbox: { x: 100, y: 100, width: 200, height: 30 } }],
    continuations: [{ id: "c1", sheet: "3", zone: "13", rawRef: "3/13", target: null, point: { x: 0, y: 0 } }],
  };
  moveContinuation(g, "c1", { x: 150, y: 115 });
  assert.deepEqual(g.continuations[0].target, { kind: "cable", id: "cab-1" });
});

test("continuationStatuses: chips on printed symbols are quiet annotations", () => {
  const graph = graphWith(
    [
      { id: "cSym", sheet: "2", zone: "8", rawRef: "2/8", target: null, point: { x: 500, y: 500 } },
      { id: "cFloat", sheet: "2", zone: "8", rawRef: "2/8", target: null, point: { x: 900, y: 900 } },
    ],
    []
  );
  const st = continuationStatuses({}, 9, "3/207", graph, undefined, new Set(["cSym"]));
  // Updated by Shane's severed-edge ruling (2026-07-11): a symbol chip whose
  // ref has NO anchored link chip is an ORPHAN — the inter-page edge is
  // missing, "that can break the entire machine electrically".
  assert.equal(st.get("cSym").state, "orphan");
  assert.equal(st.get("cFloat").state, "unanchored"); // floating — still flagged
});

test("printedRefAt: reads a stacked fraction from split digit tokens", () => {
  // page 11's real geometry: '3'(1400,971) '2'(1413,971) over '9'(1407,994)
  const texts = [
    { text: "3", center: { x: 1400, y: 971 } },
    { text: "2", center: { x: 1413, y: 971 } },
    { text: "9", center: { x: 1407, y: 994 } },
  ];
  const r = printedRefAt(texts, { x: 1407, y: 982 });
  assert.deepEqual(r, { sheet: "32", zone: "9", rawRef: "32/9" });
});

test("printedRefAt: whole tokens win (slash and dash forms)", () => {
  const texts = [
    { text: "33- 4", center: { x: 1240, y: 927 } },
    { text: "7", center: { x: 1250, y: 940 } },
  ];
  const r = printedRefAt(texts, { x: 1240, y: 930 });
  assert.deepEqual(r, { sheet: "33", zone: "4", rawRef: "33/4" });
});

test("printedRefAt: nothing ref-shaped nearby returns null", () => {
  const r = printedRefAt([{ text: "MOTOR", center: { x: 10, y: 10 } }], { x: 12, y: 12 });
  assert.equal(r, null);
});

test("continuationStatuses: component chips resolve via the destination page's label roster", () => {
  const graph = {
    nodes: [{ id: "n1", type: "component", label: "ELB50", bbox: { x: 0, y: 0, width: 50, height: 50 } }],
    ports: [], edges: [], cables: [],
    continuations: [
      { id: "cComp", sheet: "27", zone: "9", rawRef: "27/9", target: { kind: "component", id: "n1" }, point: { x: 10, y: 10 } },
      { id: "cCompMis", sheet: "1", zone: "2", rawRef: "1/2", target: { kind: "component", id: "n1" }, point: { x: 10, y: 30 } },
      { id: "cCompWait", sheet: "99", zone: "1", rawRef: "99/1", target: { kind: "component", id: "n1" }, point: { x: 10, y: 50 } },
    ],
  };
  const registry = {
    "32": { sheet: "27/207", sightings: [], labels: ["ELB50", "M2"] },
    "7": { sheet: "1/207", sightings: [], labels: ["MC7"] },
  };
  const st = continuationStatuses(registry, 11, "5/207", graph);
  assert.equal(st.get("cComp").state, "resolved");
  assert.equal(st.get("cComp").destPage, 32);
  assert.equal(st.get("cCompMis").state, "mismatch"); // sheet 1 annotated, no ELB50
  assert.equal(st.get("cCompWait").state, "waiting");
});

test("copyContinuationTo: copies bind by touch — component when nothing closer", async () => {
  const { copyContinuationTo } = await import("./v2-graph-ops.ts");
  const g = {
    nodes: [{ id: "n1", type: "component", label: "THR2", bbox: { x: 100, y: 100, width: 80, height: 60 } }],
    ports: [], edges: [], cables: [],
    continuations: [{ id: "src", sheet: "32", zone: "9", rawRef: "32/9", target: null, point: { x: 500, y: 500 } }],
  };
  copyContinuationTo(g, "src", { x: 140, y: 130 }, "copy-1");
  const copy = g.continuations.find((c) => c.id === "copy-1");
  assert.deepEqual(copy.target, { kind: "component", id: "n1" });
  assert.equal(copy.rawRef, "32/9");
  // the source stays untouched on the print
  assert.equal(g.continuations.find((c) => c.id === "src").target, null);
});

test("continuationStatuses: an annotated symbol with no link chip is SEVERED (orphan)", () => {
  const graph = graphWith(
    [
      // symbol chip on the print, ref 33/4 — no anchored chip carries it
      { id: "cSym1", sheet: "33", zone: "4", rawRef: "33/4", target: null, point: { x: 100, y: 100 } },
      // symbol chip whose ref IS carried by an anchored copy -> quiet
      { id: "cSym2", sheet: "6", zone: "1", rawRef: "6/1", target: null, point: { x: 300, y: 300 } },
      { id: "cLink", sheet: "6", zone: "1", rawRef: "6/1", target: { kind: "port", id: "p1" }, point: { x: 320, y: 340 } },
    ],
    [{ id: "e1", sourcePortId: "px", targetPortId: "p1", path: [], label: "R502" }]
  );
  const st = continuationStatuses({}, 11, "5/207", graph, undefined, new Set(["cSym1", "cSym2"]));
  assert.equal(st.get("cSym1").state, "orphan"); // machine graph severed here
  assert.ok(st.get("cSym1").detail.includes("SEVERED"));
  assert.equal(st.get("cSym2").state, "symbol"); // electrical side carried
});
