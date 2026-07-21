import assert from "node:assert/strict";
import test from "node:test";

import {
  RESIZE_HANDLES,
  activeSelectionLabel,
  attachmentDisplayText,
  canAuthorWireAttachment,
  compareCandidatesByProximity,
} from "./studio-selection-helpers.ts";

test("formats active annotation and attachment selection labels", () => {
  const component = {
    id: "component-f12",
    label: "F12",
    metadata: { rootType: "component" },
  };
  const connectionPoint = {
    id: "cp-r101",
    type: "connection_point",
    text: "R101",
  };

  assert.equal(attachmentDisplayText(undefined), "selected parent");
  assert.equal(
    attachmentDisplayText(connectionPoint),
    "connection point R101"
  );
  assert.equal(activeSelectionLabel(null, null), "no active bbox");
  assert.equal(activeSelectionLabel(component, null), "component · F12");
  assert.equal(
    activeSelectionLabel(component, connectionPoint),
    "component · F12 -> connection point · R101"
  );
  assert.equal(
    activeSelectionLabel(component, { id: "empty", type: "terminal", text: "" }),
    "component · F12 -> terminal · linked object"
  );
});

test("orders label candidates by distance with normalized text tie break", () => {
  const candidates = [
    { normalizedText: "S101", distance: 20 },
    { normalizedText: "R101", distance: 20 },
    { normalizedText: "T101", distance: 8 },
  ];

  assert.deepEqual(
    candidates.sort(compareCandidatesByProximity).map((candidate) => candidate.normalizedText),
    ["T101", "R101", "S101"]
  );
});

test("keeps wire segment authoring limited to trace-safe attachment types", () => {
  assert.deepEqual(RESIZE_HANDLES, ["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
  assert.equal(canAuthorWireAttachment("component", "component", null), true);
  assert.equal(canAuthorWireAttachment("wire_segment", "wire_endpoint", null), true);
  assert.equal(canAuthorWireAttachment("wire_segment", "ground_reference", null), true);
  assert.equal(canAuthorWireAttachment("wire_segment", "component", null), false);
  assert.equal(canAuthorWireAttachment("wire_segment", "connection_point", null), false);
  assert.equal(canAuthorWireAttachment("wire_segment", "connection_point", "endpoint-a"), true);
});
