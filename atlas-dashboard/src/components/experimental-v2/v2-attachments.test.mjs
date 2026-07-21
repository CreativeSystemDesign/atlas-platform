import assert from "node:assert/strict";
import test from "node:test";
import {
  attachTextToComponent,
  removeAttachment,
  classifyAttachmentKind,
  deriveIdentityFromAttachments,
  normalizePartNumber,
} from "./v2-attachments.ts";

const BANK = [
  { symbol: "ELB12", family: "ELB", suffix: "12", suffix_semantics: "opaque_identifier",
    description: "EARTH LEAKAGE BREAKER", part_number: "NV30-FAU 3P 30A", location: "PANEL1", source_page: "4" },
];

const graphWith = (node) => ({ nodes: [node], ports: [], edges: [], continuations: [] });

test("normalizePartNumber mirrors the server (NFKC, upper, strip)", () => {
  assert.equal(normalizePartNumber("ｎｖ３０-fau 3p 30a"), "NV30FAU3P30A");
});

test("classify is Studio-canonical: bank match only for part_number; location/ground/wire kinds", () => {
  assert.equal(classifyAttachmentKind("NV30-FAU 3P 30A", BANK), "part_number");
  assert.equal(classifyAttachmentKind("LPJ-3SP", BANK), "spec"); // letters+digits, NOT in parts list
  assert.equal(classifyAttachmentKind("(3A)", BANK), "spec");
  assert.equal(classifyAttachmentKind("400/5A", BANK), "spec");
  assert.equal(classifyAttachmentKind("(PP)", BANK), "location");
  assert.equal(classifyAttachmentKind("G", BANK), "ground_label");
  assert.equal(classifyAttachmentKind("MAIN CIRCUIT", BANK), "text");
  const WIRES = [{ wire_label: "1112", raw_label: "1112", cable_number: "C1", originating_point: "WHM10", termination_point: "TB1", source_page: "2", extraction_id: "x" }];
  assert.equal(classifyAttachmentKind("１１１２", BANK, WIRES), "wire_label");
});

test("attach part-number evidence derives full parts-list identity", () => {
  const node = { id: "n1", type: "component", label: "ELB12", bbox: { x: 0, y: 0, width: 10, height: 10 } };
  const g = graphWith(node);
  const r = attachTextToComponent(g, "n1", { text: "ＮＶ３０－ＦＡＵ ３Ｐ ３０Ａ", bbox: { x: 1, y: 1, width: 8, height: 3 } }, BANK);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "part_number");
  assert.equal(r.identity, "parts_match");
  assert.equal(node.identity.partNumber, "NV30-FAU 3P 30A");
  assert.equal(node.identity.matchStatus, "part_number_attachment_match");
  assert.equal(node.attachments.length, 1);
});

test("no bank match -> schematic-evidence fallback identity with honest status", () => {
  const node = { id: "n1", type: "component", label: "F12", bbox: { x: 0, y: 0, width: 10, height: 10 } };
  const g = graphWith(node);
  const r = attachTextToComponent(g, "n1", { text: "LPJ-3SP", bbox: { x: 0, y: 0, width: 5, height: 2 } }, BANK);
  assert.equal(r.identity, "schematic_only");
  assert.equal(node.identity.matchStatus, "no_parts_list_match_schematic_attachments");
  assert.equal(node.identity.family, "F");
});

test("existing identity is kept; duplicate evidence is rejected", () => {
  const node = {
    id: "n1", type: "component", label: "ELB12", bbox: { x: 0, y: 0, width: 10, height: 10 },
    identity: { fullSymbol: "ELB12", family: "ELB", description: "x", partNumber: "KEEP", location: "", sourcePage: "" },
  };
  const g = graphWith(node);
  const r1 = attachTextToComponent(g, "n1", { text: "NV30-FAU 3P 30A", bbox: { x: 0, y: 0, width: 5, height: 2 } }, BANK);
  assert.equal(r1.identity, "kept_existing");
  assert.equal(node.identity.partNumber, "KEEP");
  const r2 = attachTextToComponent(g, "n1", { text: "nv30-fau 3p 30a", bbox: { x: 9, y: 9, width: 5, height: 2 } }, BANK);
  assert.equal(r2.ok, false);
  assert.match(r2.note, /already attached/);
});

test("derive alone respects precedence: parts match beats fallback", () => {
  const node = {
    id: "n1", type: "component", label: "ELB12", bbox: { x: 0, y: 0, width: 10, height: 10 },
    attachments: [
      { id: "a1", kind: "spec", text: "NV30-FAU 3P 30A", bbox: { x: 0, y: 0, width: 1, height: 1 }, source: "ctrl_click", snapped: true, createdAt: "" },
    ],
  };
  assert.equal(deriveIdentityFromAttachments(node, BANK), "parts_match");
});

test("removeAttachment re-derives identity from remaining evidence", () => {
  const node = { id: "n1", type: "component", label: "ELB12", bbox: { x: 0, y: 0, width: 10, height: 10 } };
  const g = graphWith(node);
  attachTextToComponent(g, "n1", { text: "NV30-FAU 3P 30A", bbox: { x: 0, y: 0, width: 5, height: 2 } }, BANK);
  const badId = node.attachments[0].id;
  assert.equal(node.identity.matchStatus, "part_number_attachment_match");
  const r = removeAttachment(g, badId, BANK);
  assert.equal(r.ok, true);
  assert.equal(node.attachments.length, 0);
  assert.equal(node.identity, null); // derived identity un-poisoned
});

test("removeAttachment never touches a hand-set identity", () => {
  const node = {
    id: "n1", type: "component", label: "F12", bbox: { x: 0, y: 0, width: 10, height: 10 },
    identity: { fullSymbol: "F12", family: "F", description: "manual", partNumber: "KEEP", location: "", sourcePage: "" },
  };
  const g = graphWith(node);
  attachTextToComponent(g, "n1", { text: "LPJ-3SP", bbox: { x: 0, y: 0, width: 5, height: 2 } }, BANK);
  removeAttachment(g, node.attachments[0].id, BANK);
  assert.equal(node.identity.partNumber, "KEEP");
});
