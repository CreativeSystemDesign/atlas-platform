import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExistingWireConnectionPointEdit,
  buildExistingWireConnectionPointEdit,
} from "./wire-connection-authoring.ts";

test("builds and applies an existing-wire connection edit with generated endpoints", () => {
  const wire = annotationBox({
    id: "wire-1",
    label: "102L",
    bbox: { x: 100, y: 45, width: 80, height: 10 },
    metadata: {
      rootType: "wire_segment",
      wireGeometry: {
        segments: [
          {
            id: "segment-1",
            bbox: { x: 100, y: 45, width: 80, height: 10 },
            x1: 100,
            y1: 50,
            x2: 180,
            y2: 50,
          },
        ],
      },
      attachments: [],
    },
  });
  const owner = annotationBox({
    id: "component-1",
    label: "F12",
    metadata: { rootType: "component", attachments: [] },
  });
  const connectionPoint = attachment({
    id: "connection-1",
    type: "connection_point",
    text: "1",
    bbox: { x: 91, y: 41, width: 18, height: 18 },
    relation: "component_has_connection_point",
  });

  const edit = buildExistingWireConnectionPointEdit({
    wireBox: wire,
    ownerBox: owner,
    connectionPoint,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });
  assert.ok(edit);
  assert.equal(edit.createdEndpoints.length, 2);
  assert.match(edit.link.parentAttachmentId, /^wire-1-wire-endpoint-start-/);

  const updated = applyExistingWireConnectionPointEdit(wire, edit);
  assert.equal(updated.metadata.attachments.length, 3);
  assert.equal(
    updated.metadata.attachments.filter((item) => item.type === "wire_endpoint")
      .length,
    2
  );
  const link = updated.metadata.attachments.find(
    (item) => item.relation === "wire_segment_endpoint_to_connection_point"
  );
  assert.equal(link.linkedBoxId, "component-1");
  assert.equal(link.linkedAttachmentId, "connection-1");
});

test("replaces an existing link to the same connection point", () => {
  const endpoint = attachment({
    id: "endpoint-1",
    type: "wire_endpoint",
    text: "start",
    bbox: { x: 91, y: 41, width: 18, height: 18 },
    relation: "wire_segment_has_endpoint",
  });
  const staleLink = attachment({
    id: "stale-link",
    type: "connection_point",
    text: "old",
    bbox: { x: 91, y: 41, width: 18, height: 18 },
    linkedBoxId: "component-1",
    linkedAttachmentId: "connection-1",
    parentAttachmentId: "endpoint-1",
    relation: "wire_segment_endpoint_to_connection_point",
  });
  const wire = annotationBox({
    id: "wire-1",
    label: "102L",
    metadata: {
      rootType: "wire_segment",
      attachments: [endpoint, staleLink],
    },
  });
  const owner = annotationBox({
    id: "component-1",
    label: "F12",
    metadata: { rootType: "component", attachments: [] },
  });
  const connectionPoint = attachment({
    id: "connection-1",
    type: "connection_point",
    text: "1",
    bbox: { x: 91, y: 41, width: 18, height: 18 },
    relation: "component_has_connection_point",
  });

  const edit = buildExistingWireConnectionPointEdit({
    wireBox: wire,
    ownerBox: owner,
    connectionPoint,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });
  const updated = applyExistingWireConnectionPointEdit(wire, edit);

  assert.equal(
    updated.metadata.attachments.filter(
      (item) => item.linkedAttachmentId === "connection-1"
    ).length,
    1
  );
  assert.equal(
    updated.metadata.attachments.some((item) => item.id === "stale-link"),
    false
  );
});

test("rejects non-canonical existing-wire link inputs", () => {
  const wire = annotationBox({
    metadata: { rootType: "component", attachments: [] },
  });
  const owner = annotationBox({
    metadata: { rootType: "component", attachments: [] },
  });
  const connectionPoint = attachment({
    type: "connection_point",
    relation: "component_has_terminal",
  });

  assert.equal(
    buildExistingWireConnectionPointEdit({
      wireBox: wire,
      ownerBox: owner,
      connectionPoint,
      zoom: 1,
      pageNum: 7,
      capturedAt: "2026-05-10T12:00:00.000Z",
    }),
    null
  );
});

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 7,
    label: "box",
    bbox: { x: 0, y: 0, width: 20, height: 20 },
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
    createdAt: "2026-05-10T11:00:00.000Z",
    updatedAt: "2026-05-10T11:00:00.000Z",
    ...overrides,
  };
}

function attachment(overrides = {}) {
  return {
    id: "attachment-1",
    type: "text",
    text: "",
    bbox: { x: 1, y: 1, width: 4, height: 4 },
    parentAttachmentId: null,
    relation: "object_has_text",
    source: "ctrl_click",
    snapped: true,
    createdAt: "2026-05-10T11:00:00.000Z",
    ...overrides,
  };
}
