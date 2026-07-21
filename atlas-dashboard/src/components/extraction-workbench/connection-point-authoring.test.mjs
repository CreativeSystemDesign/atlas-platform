import assert from "node:assert/strict";
import test from "node:test";

import { buildConnectionPointAuthoring } from "./connection-point-authoring.ts";

test("blocks connection point creation without selected root and cursor", () => {
  assert.deepEqual(
    buildConnectionPointAuthoring({
      selectedBox: null,
      cursorPx: null,
      zoom: 1,
      pageNum: 7,
      capturedAt: "2026-05-10T12:00:00.000Z",
    }),
    {
      status: "blocked",
      notice:
        "Select a component, connector, cable reference, or wire and place the cursor before pressing C.",
    }
  );
});

test("blocks manual connection point creation on wire roots", () => {
  const result = buildConnectionPointAuthoring({
    selectedBox: annotationBox({
      metadata: { rootType: "wire_segment", attachments: [] },
    }),
    cursorPx: { x: 10, y: 10 },
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "blocked",
    notice:
      "Wire endpoints are automatic. Link wires through endpoint-to-component connection links instead of creating manual wire connection points.",
  });
});

test("returns an existing nearby component connection point", () => {
  const existing = attachment({
    id: "connection-1",
    type: "connection_point",
    text: "R1",
    bbox: { x: 41, y: 41, width: 18, height: 18 },
    relation: "component_has_connection_point",
  });

  const result = buildConnectionPointAuthoring({
    selectedBox: annotationBox({
      id: "component-1",
      bbox: { x: 30, y: 30, width: 80, height: 80 },
      metadata: { rootType: "component", attachments: [existing] },
    }),
    cursorPx: { x: 50, y: 50 },
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "existing");
  assert.equal(result.attachment.id, "connection-1");
});

test("creates a component connection point at the clamped cursor point", () => {
  const result = buildConnectionPointAuthoring({
    selectedBox: annotationBox({
      id: "component-1",
      bbox: { x: 30, y: 30, width: 80, height: 80 },
      metadata: { rootType: "component", attachments: [] },
    }),
    cursorPx: { x: 50, y: 50 },
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "connection_point");
  assert.equal(result.attachment.relation, "component_has_connection_point");
  assert.deepEqual(result.attachment.bbox, {
    x: 41,
    y: 41,
    width: 18,
    height: 18,
  });
  assert.equal(result.attachment.provenance.source, "manual_connection_point");
});

test("creates a cable-reference connection point at the clamped cursor point", () => {
  const result = buildConnectionPointAuthoring({
    selectedBox: annotationBox({
      id: "cable-ref-1",
      bbox: { x: 30, y: 30, width: 80, height: 80 },
      metadata: { rootType: "cable_reference", attachments: [] },
    }),
    cursorPx: { x: 50, y: 50 },
    zoom: 1,
    pageNum: 8,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "connection_point");
  assert.equal(result.attachment.relation, "cable_reference_has_connection_point");
  assert.deepEqual(result.attachment.bbox, {
    x: 41,
    y: 41,
    width: 18,
    height: 18,
  });
  assert.equal(
    result.attachment.provenance.source,
    "manual_cable_reference_connection_point"
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
