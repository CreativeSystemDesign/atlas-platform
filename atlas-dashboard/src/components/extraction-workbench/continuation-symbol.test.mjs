import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveContinuationReference,
  resolveContinuationReferenceBank,
} from "./continuation-symbol.ts";

test("resolves stacked continuation page and row numbers near a symbol", () => {
  const symbolBox = { x: 820, y: 1120, width: 46, height: 58 };
  const result = resolveContinuationReference(symbolBox, [
    { text: "12", bbox: { x: 829, y: 1110, width: 22, height: 15 } },
    { text: "4", bbox: { x: 835, y: 1142, width: 10, height: 14 } },
    { text: "R102", bbox: { x: 620, y: 1115, width: 48, height: 14 } },
  ]);

  assert.deepEqual(result, {
    page: 12,
    row: 4,
    label: "12/4",
    pageText: "12",
    rowText: "4",
    pageBbox: { x: 829, y: 1110, width: 22, height: 15 },
    rowBbox: { x: 835, y: 1142, width: 10, height: 14 },
  });
});

test("returns null when the stacked page and row numbers are not present", () => {
  const symbolBox = { x: 820, y: 1120, width: 46, height: 58 };
  const result = resolveContinuationReference(symbolBox, [
    { text: "R102", bbox: { x: 620, y: 1115, width: 48, height: 14 } },
  ]);

  assert.equal(result, null);
});

test("ignores distant sheet grid numbers that are not a compact continuation pair", () => {
  const symbolBox = { x: 97, y: 1050, width: 56, height: 56 };
  const result = resolveContinuationReference(symbolBox, [
    { text: "7", bbox: { x: 110, y: 964, width: 29, height: 33 } },
    { text: "8", bbox: { x: 110, y: 1089, width: 29, height: 33 } },
  ]);

  assert.equal(result, null);
});

test("ignores embedded digits inside wire labels and other non-numeric text", () => {
  const symbolBox = { x: 1180, y: 1560, width: 56, height: 56 };
  const result = resolveContinuationReference(symbolBox, [
    { text: "101K", bbox: { x: 1183, y: 1548, width: 84, height: 23 } },
    { text: "2", bbox: { x: 1183, y: 1589, width: 17, height: 19 } },
  ]);

  assert.equal(result, null);
});

test("groups fragmented digit blocks into stacked continuation numbers", () => {
  const symbolBox = { x: 1172, y: 1558, width: 58, height: 66 };
  const result = resolveContinuationReference(symbolBox, [
    { text: "1", bbox: { x: 1183, y: 1566, width: 17, height: 19 } },
    { text: "1", bbox: { x: 1196, y: 1566, width: 17, height: 19 } },
    { text: "2", bbox: { x: 1183, y: 1589, width: 17, height: 19 } },
    { text: "4", bbox: { x: 1196, y: 1589, width: 17, height: 19 } },
  ]);

  assert.deepEqual(result, {
    page: 11,
    row: 24,
    label: "11/24",
    pageText: "11",
    rowText: "24",
    pageBbox: { x: 1183, y: 1566, width: 30, height: 19 },
    rowBbox: { x: 1183, y: 1589, width: 30, height: 19 },
  });
});

test("splits side-by-side continuation references from shared text rows", () => {
  const leftSymbolBox = { x: 100, y: 100, width: 34, height: 24 };
  const rightSymbolBox = { x: 146, y: 100, width: 34, height: 24 };
  const textBlocks = [
    { text: "71 90", bbox: { x: 98, y: 88, width: 82, height: 16 } },
    { text: "7 4", bbox: { x: 106, y: 114, width: 54, height: 16 } },
  ];

  const left = resolveContinuationReference(leftSymbolBox, textBlocks);
  const right = resolveContinuationReference(rightSymbolBox, textBlocks);

  assert.equal(left?.label, "71/7");
  assert.equal(right?.label, "90/4");
});

test("resolves a horizontal bank of connected continuation symbols from one clicked cell", () => {
  const symbolBox = { x: 188, y: 100, width: 34, height: 24 };
  const result = resolveContinuationReferenceBank(symbolBox, [
    { text: "17 37 41 49", bbox: { x: 100, y: 88, width: 220, height: 16 } },
    { text: "1 16 7 1", bbox: { x: 108, y: 114, width: 198, height: 16 } },
    { text: "52 55", bbox: { x: 100, y: 160, width: 92, height: 16 } },
    { text: "1 18", bbox: { x: 108, y: 186, width: 76, height: 16 } },
  ]);

  assert.deepEqual(
    result.map((reference) => reference.label),
    ["17/1", "37/16", "41/7", "49/1"]
  );
});
