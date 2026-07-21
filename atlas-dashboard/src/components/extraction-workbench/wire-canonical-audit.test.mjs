import assert from "node:assert/strict";
import test from "node:test";

import { auditCanonicalWireAnnotations } from "./wire-canonical-audit.ts";

test("passes a canonical wire with endpoints and endpoint-to-connection-point links", () => {
  const boxes = [
    component("component-f13", "F13", [
      connectionPoint("f13-left", "1", { x: 90, y: 95, width: 20, height: 20 }),
      connectionPoint("f13-right", "2", { x: 290, y: 95, width: 20, height: 20 }),
    ]),
    wire("wire-left", "102L", { x: 10, y: 100, width: 90, height: 10 }, [
      endpoint("wire-left-start", "start", { x: 3, y: 96, width: 18, height: 18 }),
      endpoint("wire-left-end", "end", { x: 91, y: 96, width: 18, height: 18 }),
      wireConnection("wire-left-link", {
        componentId: "component-f13",
        connectionPointId: "f13-left",
        endpointId: "wire-left-end",
      }),
    ]),
    wire("wire-right", "102L", { x: 300, y: 100, width: 90, height: 10 }, [
      endpoint("wire-right-start", "start", { x: 291, y: 96, width: 18, height: 18 }),
      endpoint("wire-right-end", "end", { x: 383, y: 96, width: 18, height: 18 }),
      wireConnection("wire-right-link", {
        componentId: "component-f13",
        connectionPointId: "f13-right",
        endpointId: "wire-right-start",
      }),
    ]),
  ];

  assert.deepEqual(auditCanonicalWireAnnotations(boxes), []);
});

test("flags a wire endpoint that touches a component connection point without a saved link", () => {
  const boxes = [
    component("component-f13", "F13", [
      connectionPoint("f13-left", "1", { x: 90, y: 95, width: 20, height: 20 }),
    ]),
    wire("wire-left", "102L", { x: 10, y: 100, width: 90, height: 10 }, [
      endpoint("wire-left-start", "start", { x: 3, y: 96, width: 18, height: 18 }),
      endpoint("wire-left-end", "end", { x: 91, y: 96, width: 18, height: 18 }),
    ]),
  ];

  const issues = auditCanonicalWireAnnotations(boxes);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "endpoint_touch_unlinked_connection_point");
  assert.equal(issues[0].wireId, "wire-left");
  assert.deepEqual(issues[0].attachmentIds, ["wire-left-end", "f13-left"]);
});

test("flags an unlinked endpoint whose bbox overlaps a component connection point", () => {
  const boxes = [
    component("component-f12", "F12", [
      connectionPoint("f12-right", "R101", { x: 526, y: 207, width: 18, height: 18 }),
    ]),
    wire("wire-r101", "R101", { x: 100, y: 200, width: 420, height: 24 }, [
      endpoint("wire-r101-start", "start", { x: 86, y: 198, width: 28, height: 28 }),
      endpoint("wire-r101-end", "end", { x: 506, y: 198, width: 28, height: 28 }),
    ]),
  ];

  const issues = auditCanonicalWireAnnotations(boxes);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "endpoint_touch_unlinked_connection_point");
  assert.equal(issues[0].wireId, "wire-r101");
  assert.deepEqual(issues[0].attachmentIds, ["wire-r101-end", "f12-right"]);
});

test("flags legacy direct wire relations that bypass endpoint links", () => {
  const boxes = [
    component("component-f13", "F13", [
      connectionPoint("f13-left", "1", { x: 90, y: 95, width: 20, height: 20 }),
    ]),
    wire("wire-left", "102L", { x: 10, y: 100, width: 90, height: 10 }, [
      endpoint("wire-left-start", "start", { x: 3, y: 96, width: 18, height: 18 }),
      endpoint("wire-left-end", "end", { x: 91, y: 96, width: 18, height: 18 }),
      {
        id: "legacy-direct-component",
        type: "component",
        text: "F13",
        bbox: { x: 90, y: 95, width: 20, height: 20 },
        relation: "wire_segment_to_component",
        linkedBoxId: "component-f13",
      },
    ]),
  ];

  const issues = auditCanonicalWireAnnotations(boxes);

  assert.equal(issues.length, 2);
  assert.deepEqual(
    issues.map((issue) => issue.kind).sort(),
    [
      "endpoint_touch_unlinked_connection_point",
      "legacy_direct_wire_relation",
    ]
  );
});

test("flags endpoint-to-connection-point links that have no parent endpoint", () => {
  const boxes = [
    component("component-f13", "F13", [
      connectionPoint("f13-left", "1", { x: 90, y: 95, width: 20, height: 20 }),
    ]),
    wire("wire-left", "102L", { x: 10, y: 100, width: 90, height: 10 }, [
      endpoint("wire-left-start", "start", { x: 3, y: 96, width: 18, height: 18 }),
      endpoint("wire-left-end", "end", { x: 91, y: 96, width: 18, height: 18 }),
      wireConnection("wire-left-link", {
        componentId: "component-f13",
        connectionPointId: "f13-left",
        endpointId: null,
      }),
    ]),
  ];

  const issues = auditCanonicalWireAnnotations(boxes);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "wire_connection_link_missing_parent_endpoint");
  assert.equal(issues[0].attachmentIds[0], "wire-left-link");
});

test("allows segment-level ground taps as canonical wire truth", () => {
  const boxes = [
    wire("wire-102l", "102L", { x: 100, y: 200, width: 420, height: 16 }, [
      endpoint("wire-102l-start", "start", { x: 86, y: 199, width: 18, height: 18 }),
      endpoint("wire-102l-end", "end", { x: 506, y: 199, width: 18, height: 18 }),
      {
        id: "wire-102l-ground-tap",
        type: "ground_reference",
        text: "G",
        bbox: { x: 250, y: 190, width: 40, height: 48 },
        relation: "wire_segment_to_ground_reference",
        linkedBoxId: "ground-g",
        linkedAttachmentId: null,
        parentAttachmentId: null,
      },
    ]),
    {
      id: "ground-g",
      label: "G",
      bbox: { x: 250, y: 190, width: 40, height: 48 },
      metadata: { rootType: "ground_reference", attachments: [] },
    },
  ];

  assert.deepEqual(auditCanonicalWireAnnotations(boxes), []);
});

function component(id, label, attachments = []) {
  return {
    id,
    label,
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    metadata: { rootType: "component", attachments },
  };
}

function wire(id, label, bbox, attachments = []) {
  return {
    id,
    label,
    bbox,
    metadata: {
      rootType: "wire_segment",
      wireGeometry: {
        segments: [{ id: `${id}-segment`, bbox, x1: bbox.x, y1: bbox.y + bbox.height / 2, x2: bbox.x + bbox.width, y2: bbox.y + bbox.height / 2 }],
      },
      attachments,
    },
  };
}

function connectionPoint(id, text, bbox) {
  return {
    id,
    type: "connection_point",
    text,
    bbox,
    relation: "component_has_connection_point",
  };
}

function endpoint(id, text, bbox) {
  return {
    id,
    type: "wire_endpoint",
    text,
    bbox,
    relation: "wire_segment_has_endpoint",
  };
}

function wireConnection(id, { componentId, connectionPointId, endpointId }) {
  return {
    id,
    type: "connection_point",
    text: connectionPointId,
    bbox: { x: 90, y: 95, width: 20, height: 20 },
    relation: "wire_segment_endpoint_to_connection_point",
    linkedBoxId: componentId,
    linkedAttachmentId: connectionPointId,
    parentAttachmentId: endpointId,
  };
}
