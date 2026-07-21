import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileTouchedCableReferenceConnectionPointsInBoxes,
} from "./cable-reference-connection-point.ts";

const capturedAt = "2026-05-10T12:00:00.000Z";

test("adds endpoint-owned cable-reference connection links to touched component connection points", () => {
  const cableReference = box({
    id: "cable-ref-1",
    label: "3-ASP",
    metadata: {
      rootType: "cable_reference",
      attachments: [
        connectionPoint({
          id: "cable-ref-cp-1",
          text: "A",
          relation: "cable_reference_has_connection_point",
          bbox: { x: 90, y: 95, width: 18, height: 18 },
        }),
      ],
    },
  });
  const component = box({
    id: "component-inv-1",
    label: "INV1",
    metadata: {
      rootType: "component",
      attachments: [
        connectionPoint({
          id: "component-cp-1",
          text: "CN1",
          relation: "component_has_connection_point",
          bbox: { x: 91, y: 96, width: 18, height: 18 },
        }),
      ],
    },
  });

  const result = reconcileTouchedCableReferenceConnectionPointsInBoxes(
    [cableReference, component],
    8,
    capturedAt
  );

  assert.equal(result.addedCount, 1);
  const updatedCableReference = result.boxes.find((item) => item.id === "cable-ref-1");
  const link = updatedCableReference.metadata.attachments.find(
    (attachment) =>
      attachment.relation ===
      "cable_reference_connection_point_to_connection_point"
  );
  assert.equal(link.type, "connection_point");
  assert.equal(link.text, "INV1:CN1");
  assert.equal(link.linkedBoxId, "component-inv-1");
  assert.equal(link.linkedAttachmentId, "component-cp-1");
  assert.equal(link.parentAttachmentId, "cable-ref-cp-1");
  assert.equal(link.provenance.source, "cable_reference_auto_connection_point");
});

test("does not duplicate existing cable-reference connection links", () => {
  const cableReference = box({
    id: "cable-ref-1",
    label: "3-ASP",
    metadata: {
      rootType: "cable_reference",
      attachments: [
        connectionPoint({
          id: "cable-ref-cp-1",
          text: "A",
          relation: "cable_reference_has_connection_point",
          bbox: { x: 90, y: 95, width: 18, height: 18 },
        }),
        connectionPoint({
          id: "cable-ref-cp-link-1",
          text: "INV1:CN1",
          relation: "cable_reference_connection_point_to_connection_point",
          linkedBoxId: "component-inv-1",
          linkedAttachmentId: "component-cp-1",
          parentAttachmentId: "cable-ref-cp-1",
          bbox: { x: 91, y: 96, width: 18, height: 18 },
        }),
      ],
    },
  });
  const component = box({
    id: "component-inv-1",
    label: "INV1",
    metadata: {
      rootType: "component",
      attachments: [
        connectionPoint({
          id: "component-cp-1",
          text: "CN1",
          relation: "component_has_connection_point",
          bbox: { x: 91, y: 96, width: 18, height: 18 },
        }),
      ],
    },
  });

  const boxes = [cableReference, component];
  const result = reconcileTouchedCableReferenceConnectionPointsInBoxes(boxes, 8, capturedAt);

  assert.equal(result.addedCount, 0);
  assert.equal(result.boxes, boxes);
  assert.equal(cableReference.metadata.attachments.length, 2);
});

function box(overrides = {}) {
  return {
    id: "box-1",
    label: "box",
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    metadata: {
      rootType: "component",
      attachments: [],
    },
    ...overrides,
  };
}

function connectionPoint(overrides = {}) {
  return {
    id: "cp-1",
    type: "connection_point",
    text: "connection",
    bbox: { x: 10, y: 10, width: 18, height: 18 },
    parentAttachmentId: null,
    relation: "component_has_connection_point",
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
    ...overrides,
  };
}
