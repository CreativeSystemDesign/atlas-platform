import assert from "node:assert/strict";
import test from "node:test";

import {
  moveAnnotationAttachment,
  moveAnnotationBox,
  moveAnnotationLabel,
  resizeAnnotationAttachment,
  resizeAnnotationBox,
  resizeAnnotationLabel,
} from "./interaction-drag-updates.ts";

test("moves a root annotation with refreshed provenance and physical size", () => {
  const moved = moveAnnotationBox(annotationBox(), {
    original: { x: 10, y: 20, width: 40, height: 30 },
    dx: 12,
    dy: -8,
    clampBox,
    pageNum: 7,
    capturedAt: "2026-05-10T13:00:00.000Z",
  });

  assert.deepEqual(moved.bbox, { x: 22, y: 12, width: 40, height: 30 });
  assert.equal(moved.snapped, false);
  assert.equal(moved.updatedAt, "2026-05-10T13:00:00.000Z");
  assert.equal(moved.metadata.provenance.source, "component_manual_move");
  assert.equal(moved.metadata.physicalSizePx.area, 1200);
});

test("resizes a root annotation through the shared resize rules", () => {
  const resized = resizeAnnotationBox(annotationBox(), {
    original: { x: 10, y: 20, width: 40, height: 30 },
    handle: "se",
    dx: 10,
    dy: 5,
    clampBox,
    pageNum: 7,
    capturedAt: "2026-05-10T13:00:00.000Z",
  });

  assert.deepEqual(resized.bbox, { x: 10, y: 20, width: 50, height: 35 });
  assert.equal(resized.metadata.provenance.source, "component_manual_resize");
});

test("moves and resizes manual label boxes", () => {
  const box = annotationBox();
  const moved = moveAnnotationLabel(box, {
    original: { x: 10, y: 20, width: 40, height: 30 },
    dx: 5,
    dy: 6,
    clampBox,
    capturedAt: "2026-05-10T13:00:00.000Z",
  });
  const resized = resizeAnnotationLabel(box, {
    original: { x: 10, y: 20, width: 40, height: 30 },
    handle: "e",
    dx: 7,
    dy: 0,
    clampBox,
    capturedAt: "2026-05-10T13:00:00.000Z",
  });

  assert.deepEqual(moved.labelBbox, { x: 15, y: 26, width: 40, height: 30 });
  assert.equal(moved.labelSource, "manual");
  assert.deepEqual(resized.labelBbox, { x: 10, y: 20, width: 47, height: 30 });
});

test("moves and resizes attachments with refreshed provenance", () => {
  const attachment = annotationAttachment();
  const moved = moveAnnotationAttachment(attachment, {
    original: { x: 10, y: 20, width: 20, height: 18 },
    dx: 2,
    dy: 3,
    clampBox,
    pageNum: 7,
    capturedAt: "2026-05-10T13:00:00.000Z",
  });
  const resized = resizeAnnotationAttachment(attachment, {
    original: { x: 10, y: 20, width: 20, height: 18 },
    handle: "s",
    dx: 0,
    dy: 9,
    clampBox,
    pageNum: 7,
    capturedAt: "2026-05-10T13:00:00.000Z",
  });

  assert.deepEqual(moved.bbox, { x: 12, y: 23, width: 20, height: 18 });
  assert.equal(moved.provenance.source, "attachment_manual_move");
  assert.equal(moved.snapped, false);
  assert.deepEqual(resized.bbox, { x: 10, y: 20, width: 20, height: 27 });
  assert.equal(resized.provenance.source, "attachment_manual_resize");
});

function clampBox(box) {
  return {
    ...box,
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
  };
}

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 7,
    label: "F12",
    bbox: { x: 10, y: 20, width: 40, height: 30 },
    labelBbox: null,
    labelSource: "manual",
    labelCandidateIndex: -1,
    labelCandidates: [],
    source: "human",
    snapped: true,
    metadata: {
      rootType: "component",
      attachments: [],
    },
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
    ...overrides,
  };
}

function annotationAttachment(overrides = {}) {
  return {
    id: "attachment-1",
    type: "connection_point",
    text: "R1",
    bbox: { x: 10, y: 20, width: 20, height: 18 },
    parentAttachmentId: null,
    relation: "component_has_connection_point",
    source: "ctrl_click",
    snapped: true,
    createdAt: "2026-05-10T12:00:00.000Z",
    ...overrides,
  };
}
