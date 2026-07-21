import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentTypeLabel,
  inferAttachmentRelation,
  normalizeRelation,
  relationDisplayLabel,
  rootObjectTypeLabel,
  strictAttachmentRelation,
} from "./annotation-model.ts";

test("infers strict connection-point and wire endpoint relations", () => {
  assert.equal(
    inferAttachmentRelation("component", "connection_point"),
    "component_has_connection_point"
  );
  assert.equal(
    inferAttachmentRelation("wire_segment", "connection_point"),
    "wire_segment_endpoint_to_connection_point"
  );
  assert.equal(
    inferAttachmentRelation("wire_segment", "wire_endpoint"),
    "wire_segment_has_endpoint"
  );
  assert.equal(
    inferAttachmentRelation("cable_segment", "cable_label"),
    "cable_segment_has_cable_label"
  );
  assert.equal(
    inferAttachmentRelation("cable_segment", "cable_endpoint"),
    "cable_segment_has_endpoint"
  );
  assert.equal(
    inferAttachmentRelation("cable_segment", "connection_point"),
    "cable_segment_endpoint_to_connection_point"
  );
  assert.equal(
    inferAttachmentRelation("cable_segment", "part_number"),
    "cable_segment_has_part_number"
  );
  assert.equal(
    inferAttachmentRelation("cable_reference", "cable_label"),
    "cable_reference_has_cable_label"
  );
  assert.equal(
    inferAttachmentRelation("cable_reference", "connection_point"),
    "cable_reference_has_connection_point"
  );
  assert.equal(
    inferAttachmentRelation("cable_reference", "part_number"),
    "cable_reference_has_part_number"
  );
  assert.equal(
    inferAttachmentRelation("connector", "connection_point"),
    "connector_has_connection_point"
  );
  assert.equal(
    inferAttachmentRelation("connector", "part_number"),
    "connector_has_part_number"
  );
});

test("blocks generic non-text attachment links in strict mode", () => {
  assert.equal(strictAttachmentRelation("component", "wire_segment"), null);
  assert.equal(
    strictAttachmentRelation("component", "text"),
    "object_has_text"
  );
  assert.equal(
    strictAttachmentRelation("wire_segment", "ground_reference"),
    "wire_segment_to_ground_reference"
  );
  assert.equal(
    strictAttachmentRelation("cable_segment", "cable_label"),
    "cable_segment_has_cable_label"
  );
  assert.equal(
    strictAttachmentRelation("cable_segment", "part_number"),
    "cable_segment_has_part_number"
  );
  assert.equal(
    strictAttachmentRelation("cable_reference", "connection_point"),
    "cable_reference_has_connection_point"
  );
  assert.equal(
    strictAttachmentRelation(
      "cable_reference",
      "connection_point",
      "cable-ref-cp-1"
    ),
    "cable_reference_connection_point_to_connection_point"
  );
  assert.equal(
    strictAttachmentRelation("connector", "connection_point"),
    "connector_has_connection_point"
  );
  assert.equal(
    strictAttachmentRelation("connector", "connection_point", "connector-cp-1"),
    "connector_connection_point_pair"
  );
});

test("normalizes legacy relations without rewriting explicit strict relations", () => {
  assert.equal(
    normalizeRelation("terminal", {
      type: "terminal_label",
      relation: "terminal_label_for",
      parentAttachmentId: null,
    }),
    "terminal_has_terminal_label"
  );
  assert.equal(
    normalizeRelation("wire_segment", {
      type: "wire_color",
      relation: "wire_segment_has_color",
      parentAttachmentId: null,
    }),
    "wire_segment_has_color"
  );
});

test("formats root, attachment, and relation labels for operator-facing UI", () => {
  assert.equal(attachmentTypeLabel("connection_point"), "connection point");
  assert.equal(attachmentTypeLabel("wire_color"), "wire color");
  assert.equal(attachmentTypeLabel("cable_segment"), "cable segment");
  assert.equal(attachmentTypeLabel("cable_reference"), "cable reference");
  assert.equal(attachmentTypeLabel("cable_label"), "cable label");
  assert.equal(attachmentTypeLabel("cable_endpoint"), "cable endpoint");
  assert.equal(rootObjectTypeLabel("cable_segment"), "cable segment");
  assert.equal(rootObjectTypeLabel("cable_reference"), "cable reference");
  assert.equal(rootObjectTypeLabel("connector"), "connector");
  assert.equal(rootObjectTypeLabel("circuit_descriptor"), "circuit descriptor");
  assert.equal(relationDisplayLabel("terminal_label_for"), "legacy terminal label");
  assert.equal(
    relationDisplayLabel("wire_segment_endpoint_to_connection_point"),
    "wire segment endpoint to connection point"
  );
});
