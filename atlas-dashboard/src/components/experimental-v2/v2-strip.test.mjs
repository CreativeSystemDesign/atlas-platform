import assert from "node:assert/strict";
import test from "node:test";
import { extractStripRows, rowForY, ensureRowConduction, stripTitleAbove, stripsTouchingBox, adoptionEntries, bboxesTouch, portsTouchingBox, STRIP_MIN_ROWS } from "./v2-strip.ts";

// Synthetic strip mirroring the REAL TB30 print facts (page 9 of the reference print):
// per-digit pin fragments, two-line names, a blank row gap, PLATE fragments.
const STRIP_BOX = { x: 650, y: 290, width: 340, height: 800 };
const t = (text, x, y) => ({ text, center: { x, y } });
const GEOM = {
  segments: [],
  texts: [
    t("PIN No.", 729, 320), t("NAME", 882, 320), // header — self-excludes
    t("2", 710, 380), t("0", 725, 380), t("DICOM", 914, 380),
    t("4", 710, 460), t("2", 725, 460), t("EMG", 931, 460), t("(E-STOP)", 889, 480),
    t("1", 717, 620), t("P15R", 923, 620), // single-digit pin after a blank-row gap
    t("P", 686, 700), t("LA", 710, 700), t("TE", 741, 700), t("SD", 940, 700),
  ],
};

test("extractStripRows: digit fragments merge, two-line names join, header excluded", () => {
  const rows = extractStripRows(STRIP_BOX, GEOM);
  assert.deepEqual(rows.map((r) => r.pin), ["20", "42", "1", "PLATE"]);
  assert.equal(rows[0].name, "DICOM");
  assert.equal(rows[1].name, "EMG(E-STOP)"); // continuation line joined verbatim
  assert.equal(rows[2].name, "P15R");
  assert.equal(rows[3].name, "SD");
});

test("rowForY: a crossing claims its nearest row inside half a pitch", () => {
  const rows = extractStripRows(STRIP_BOX, GEOM);
  assert.equal(rowForY(rows, 383).pin, "20");
  assert.equal(rowForY(rows, 455).pin, "42");
  assert.equal(rowForY(rows, 540), null); // the blank-row gap belongs to no one
});

test("stripTitleAbove: the designator prints above the tight box; prose is skipped", () => {
  const geom = {
    segments: [],
    texts: [
      t("TB30", 822, 186),
      t("CONNECTOR TERMINAL", 822, 215), // nearer, but not designator-shaped
      t("(MR-TB50)", 822, 280),
    ],
  };
  assert.equal(stripTitleAbove(STRIP_BOX, geom), "TB30");
  assert.equal(stripTitleAbove({ ...STRIP_BOX, y: 600 }, geom), null); // out of reach
});

test("STRIP_MIN_ROWS gates classification", () => {
  const sparse = { segments: [], texts: [t("1", 710, 380), t("X", 914, 380)] };
  assert.ok(extractStripRows(STRIP_BOX, sparse).length < STRIP_MIN_ROWS);
});

test("ensureRowConduction: both-side row ports join once; single-side rows wait (lazy)", () => {
  const rows = extractStripRows(STRIP_BOX, GEOM);
  const node = { id: "n1", type: "component", label: "TB30", bbox: STRIP_BOX, kind: "strip", rows };
  const g = {
    nodes: [node],
    ports: [
      { id: "pL", parentId: "n1", type: "terminal", label: "T~TB30~20~CAB", point: { x: 650, y: 380 } },
      { id: "pR", parentId: "n1", type: "terminal", label: "T~TB30~20~N24", point: { x: 990, y: 381 } },
      { id: "pR2", parentId: "n1", type: "terminal", label: "T~TB30~42~301", point: { x: 990, y: 460 } },
    ],
    edges: [],
    continuations: [],
  };
  rows[0].portIds = ["pL", "pR"];
  rows[1].portIds = ["pR2"]; // right side only — no conduction yet
  let n = 0;
  const notes = ensureRowConduction(g, node, () => `edge-${++n}`);
  assert.equal(g.edges.length, 1);
  assert.deepEqual([g.edges[0].sourcePortId, g.edges[0].targetPortId], ["pL", "pR"]);
  assert.match(notes[0], /row 20/);
  // idempotent: calling again mints nothing
  ensureRowConduction(g, node, () => `edge-${++n}`);
  assert.equal(g.edges.length, 1);
});

test("touch-to-link: a cable bbox touching a strip adopts its rows once, SPARE for unwired", () => {
  const rows = [
    { pin: "20", name: "DICOM", y: 380, portIds: ["pR"] },
    { pin: "23", name: "ZSP", y: 460, portIds: [] },
  ];
  const strip = { id: "n1", type: "component", label: "TB30", kind: "strip", rows, bbox: { x: 650, y: 290, width: 340, height: 800 } };
  const ports = [{ id: "pR", label: "T~TB30~20~N24" }];
  // touching (within tolerance of the left border)
  assert.ok(bboxesTouch({ x: 400, y: 500, width: 240, height: 60 }, strip.bbox));
  assert.equal(stripsTouchingBox([strip], { x: 400, y: 500, width: 240, height: 60 }).length, 1);
  // NOT touching
  assert.equal(stripsTouchingBox([strip], { x: 100, y: 500, width: 200, height: 60 }).length, 0);
  const adds = adoptionEntries(strip, ports, new Set());
  assert.deepEqual(adds.map((a) => `${a.core}|${a.net}`), ["20|N24", "23|SPARE"]);
  // dedupe: cores already in the roster never re-add
  assert.equal(adoptionEntries(strip, ports, new Set(["20", "23"])).length, 0);
});

test("portsTouchingBox: connector terminals inside the cable box link; counters and junctions never", () => {
  const ports = [
    { id: "a", parentId: "n9", type: "terminal", label: "T~CON20~7~Y1501", point: { x: 120, y: 60 } },
    { id: "b", parentId: "n9", type: "terminal", label: "T~M10~CON3", point: { x: 150, y: 62 } },
    { id: "c", parentId: "n9", type: "terminal", label: "T7", point: { x: 130, y: 60 } },   // counter name: no net
    { id: "d", parentId: "n9", type: "junction", label: "J1", point: { x: 140, y: 60 } },    // wire topology
    { id: "e", parentId: "n9", type: "terminal", label: "T~CON20~9~Y1502", point: { x: 400, y: 60 } }, // out of reach
  ];
  const hits = portsTouchingBox(ports, { x: 100, y: 40, width: 100, height: 30 });
  assert.deepEqual(hits.map((h) => `${h.core ?? "-"}|${h.net}`), ["7|Y1501", "-|CON3"]);
});
