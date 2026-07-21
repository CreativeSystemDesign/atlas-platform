import assert from "node:assert/strict";
import test from "node:test";

import { buildConnectorRootAnnotation } from "./connector-authoring.ts";

const capturedAt = "2026-05-11T12:00:00.000Z";

test("vertical connector bbox creates evenly spaced left and right terminal pairs", () => {
  const result = buildConnectorRootAnnotation({
    id: "connector-cn22",
    bbox: { x: 100, y: 200, width: 80, height: 240 },
    pairCount: 3,
    pageNum: 8,
    zoom: 1,
    capturedAt,
    createId: (suffix) => `connector-cn22-${suffix}`,
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.metadata.rootType, "connector");
  assert.equal(result.box.label, "connector");

  const attachments = result.box.metadata.attachments;
  const connectionPoints = attachments.filter(
    (attachment) => attachment.relation === "connector_has_connection_point"
  );
  const pairLinks = attachments.filter(
    (attachment) => attachment.relation === "connector_connection_point_pair"
  );

  assert.equal(connectionPoints.length, 6);
  assert.equal(pairLinks.length, 3);
  assert.deepEqual(
    connectionPoints.map((point) => ({
      id: point.id,
      centerX: point.bbox.x + point.bbox.width / 2,
      centerY: point.bbox.y + point.bbox.height / 2,
    })),
    [
      { id: "connector-cn22-left-1", centerX: 100, centerY: 260 },
      { id: "connector-cn22-right-1", centerX: 180, centerY: 260 },
      { id: "connector-cn22-left-2", centerX: 100, centerY: 320 },
      { id: "connector-cn22-right-2", centerX: 180, centerY: 320 },
      { id: "connector-cn22-left-3", centerX: 100, centerY: 380 },
      { id: "connector-cn22-right-3", centerX: 180, centerY: 380 },
    ]
  );
  assert.deepEqual(
    pairLinks.map((link) => ({
      parentAttachmentId: link.parentAttachmentId,
      linkedAttachmentId: link.linkedAttachmentId,
    })),
    [
      {
        parentAttachmentId: "connector-cn22-left-1",
        linkedAttachmentId: "connector-cn22-right-1",
      },
      {
        parentAttachmentId: "connector-cn22-left-2",
        linkedAttachmentId: "connector-cn22-right-2",
      },
      {
        parentAttachmentId: "connector-cn22-left-3",
        linkedAttachmentId: "connector-cn22-right-3",
      },
    ]
  );
});

test("horizontal connector bbox creates evenly spaced top and bottom terminal pairs", () => {
  const result = buildConnectorRootAnnotation({
    id: "connector-cn23",
    bbox: { x: 100, y: 200, width: 300, height: 60 },
    pairCount: 2,
    pageNum: 8,
    zoom: 1,
    capturedAt,
    createId: (suffix) => `connector-cn23-${suffix}`,
  });

  assert.equal(result.status, "created");

  const connectionPoints = result.box.metadata.attachments.filter(
    (attachment) => attachment.relation === "connector_has_connection_point"
  );

  assert.deepEqual(
    connectionPoints.map((point) => ({
      id: point.id,
      centerX: point.bbox.x + point.bbox.width / 2,
      centerY: point.bbox.y + point.bbox.height / 2,
    })),
    [
      { id: "connector-cn23-top-1", centerX: 200, centerY: 200 },
      { id: "connector-cn23-bottom-1", centerX: 200, centerY: 260 },
      { id: "connector-cn23-top-2", centerX: 300, centerY: 200 },
      { id: "connector-cn23-bottom-2", centerX: 300, centerY: 260 },
    ]
  );
});
