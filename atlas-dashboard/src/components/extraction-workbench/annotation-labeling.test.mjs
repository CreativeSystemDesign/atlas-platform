import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAttachmentText,
  datasetWireLabelClassName,
  isWireColorText,
  normalizePartText,
  normalizeSymbolText,
  normalizeTerminalLabelText,
  normalizeWireColorText,
  normalizeWireLabelText,
} from "./annotation-labeling.ts";

test("normalizes OCR text variants used by schematic labels", () => {
  assert.equal(normalizeSymbolText(" １５１–Ｅ８８１０ "), "<drawing-no>");
  assert.equal(normalizePartText("<drawing-no>"), "151E8810202");
  assert.equal(normalizeTerminalLabelText(" Ｌ＋ "), "L+");
  assert.equal(normalizeWireLabelText(" １０２Ｌ "), "102L");
  assert.equal(normalizeWireColorText(" 0r "), "OR");
  assert.equal(isWireColorText("0r"), true);
  assert.equal(isWireColorText("102L"), false);
});

test("maps dataset wire labels to text-specific classes", () => {
  assert.equal(datasetWireLabelClassName("P5"), "Wire Label (+5v)");
  assert.equal(datasetWireLabelClassName("n5"), "Wire Label (-5v)");
  assert.equal(datasetWireLabelClassName("P24"), "Wire Label (+24v)");
  assert.equal(datasetWireLabelClassName("N24"), "Wire Label (-24v)");
  assert.equal(datasetWireLabelClassName("NC24"), "Wire Label (com24v)");
  assert.equal(datasetWireLabelClassName("X0001"), "Input Signal Wire");
  assert.equal(datasetWireLabelClassName("Y1234"), "Output Signal Wire");
  assert.equal(datasetWireLabelClassName("102L"), "Wire Label");
});

test("classifies attachment text from known banks before generic patterns", () => {
  const symbolBank = [{ part_number: "<drawing-no>" }];
  const wireLabelBank = [{ wire_label: "102L" }];

  assert.equal(classifyAttachmentText("151 E8810 202", symbolBank, []), "part_number");
  assert.equal(classifyAttachmentText("102l", [], wireLabelBank), "wire_label");
  assert.equal(classifyAttachmentText("pp", [], []), "location");
  assert.equal(classifyAttachmentText("FG", [], []), "ground_label");
  assert.equal(classifyAttachmentText("11", [], []), "terminal");
  assert.equal(classifyAttachmentText("R1", [], []), "terminal_label");
  assert.equal(classifyAttachmentText("3-ASP", [], []), "spec");
  assert.equal(classifyAttachmentText("3ASP", [], []), "spec");
  assert.equal(classifyAttachmentText("pilot lamp", [], []), "text");
});
