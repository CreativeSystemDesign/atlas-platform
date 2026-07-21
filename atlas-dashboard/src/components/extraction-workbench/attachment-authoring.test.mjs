import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExistingRootAttachment,
  buildManualTextAttachment,
  buildPointAttachmentAuthoring,
} from "./attachment-authoring.ts";

test("builds an existing-root attachment with strict relation and provenance", () => {
  const targetBox = annotationBox({
    id: "component-1",
    label: "F12",
    metadata: { rootType: "component", attachments: [] },
  });

  const result = buildExistingRootAttachment({
    targetBox,
    candidate: {
      type: "terminal",
      text: "1",
      bbox: { x: 10, y: 20, width: 12, height: 12 },
    },
    bbox: { x: 10, y: 20, width: 12, height: 12 },
    pageNum: 7,
    source: "existing_terminal_link",
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "terminal");
  assert.equal(result.attachment.relation, "component_has_terminal");
  assert.equal(result.attachment.provenance.source, "existing_terminal_link");
});

test("blocks unsafe existing-root wire links that bypass endpoints", () => {
  const targetBox = annotationBox({
    id: "wire-1",
    label: "102L",
    metadata: { rootType: "wire_segment", attachments: [] },
  });

  const result = buildExistingRootAttachment({
    targetBox,
    candidate: {
      type: "connection_point",
      text: "F12:1",
      bbox: { x: 10, y: 20, width: 12, height: 12 },
    },
    bbox: { x: 10, y: 20, width: 12, height: 12 },
    pageNum: 7,
    source: "existing_connection_link",
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "blocked",
    notice:
      "Blocked legacy wire link. Select the component connection point and connect it through the nearest wire endpoint.",
  });
});

test("blocks existing-root cable links that bypass endpoints", () => {
  const targetBox = annotationBox({
    id: "cable-1",
    label: "cable",
    metadata: { rootType: "cable_segment", attachments: [] },
  });

  const result = buildExistingRootAttachment({
    targetBox,
    candidate: {
      type: "connection_point",
      text: "CN12:A",
      bbox: { x: 10, y: 20, width: 12, height: 12 },
    },
    bbox: { x: 10, y: 20, width: 12, height: 12 },
    pageNum: 8,
    source: "existing_connection_link",
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "blocked",
    notice:
      "Blocked direct cable link. Select the cable endpoint before linking it to a component connection point.",
  });
});

test("reports duplicate linked existing-root attachments", () => {
  const targetBox = annotationBox({
    id: "component-1",
    label: "F12",
    metadata: {
      rootType: "component",
      attachments: [
        attachment({
          type: "terminal",
          text: "1",
          bbox: { x: 10, y: 20, width: 12, height: 12 },
          linkedBoxId: "terminal-1",
          linkedAttachmentId: null,
          relation: "component_has_terminal",
        }),
      ],
    },
  });

  const result = buildExistingRootAttachment({
    targetBox,
    candidate: {
      type: "terminal",
      text: "1",
      bbox: { x: 10, y: 20, width: 12, height: 12 },
      linkedBoxId: "terminal-1",
      linkedAttachmentId: null,
    },
    bbox: { x: 10, y: 20, width: 12, height: 12 },
    pageNum: 7,
    source: "existing_terminal_link",
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "duplicate",
    notice: "Link already exists.",
  });
});

test("turns clicked wire-label text into a wire root label update", () => {
  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "wire-1",
      label: "wire",
      metadata: { rootType: "wire_segment", attachments: [] },
    }),
    candidate: {
      type: "wire_label",
      text: "102 L",
      bbox: { x: 20, y: 30, width: 24, height: 8 },
    },
    selectedAttachment: null,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "wireLabel",
    label: "102L",
    labelBbox: { x: 20, y: 30, width: 24, height: 8 },
  });
});

test("builds cable-label text attachments for cable segment roots", () => {
  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "cable-1",
      label: "cable",
      metadata: { rootType: "cable_segment", attachments: [] },
    }),
    candidate: {
      type: "text",
      text: "CAB 12",
      bbox: { x: 20, y: 30, width: 34, height: 8 },
    },
    selectedAttachment: null,
    pageNum: 8,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "cable_label");
  assert.equal(result.attachment.text, "CAB 12");
  assert.equal(result.attachment.relation, "cable_segment_has_cable_label");
});

test("builds part-number attachments for cable segment roots", () => {
  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "cable-1",
      label: "cable",
      metadata: { rootType: "cable_segment", attachments: [] },
    }),
    candidate: {
      type: "part_number",
      text: "151-E7712-123-0",
      bbox: { x: 20, y: 44, width: 78, height: 8 },
    },
    selectedAttachment: null,
    pageNum: 8,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "part_number");
  assert.equal(result.attachment.text, "151-E7712-123-0");
  assert.equal(result.attachment.relation, "cable_segment_has_part_number");
});

test("blocks cable connection-point links that are not endpoint-owned", () => {
  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "cable-1",
      label: "cable",
      metadata: { rootType: "cable_segment", attachments: [] },
    }),
    candidate: {
      type: "connection_point",
      text: "",
      bbox: { x: 20, y: 44, width: 18, height: 18 },
    },
    selectedAttachment: null,
    pageNum: 8,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "blocked",
    notice:
      "Blocked direct cable link. Select the cable endpoint before linking it to a component connection point.",
  });
});

test("builds endpoint-owned cable connection-point attachments", () => {
  const selectedEndpoint = attachment({
    id: "cable-endpoint-1",
    type: "cable_endpoint",
    text: "start",
    relation: "cable_segment_has_endpoint",
  });

  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "cable-1",
      label: "cable",
      metadata: { rootType: "cable_segment", attachments: [selectedEndpoint] },
    }),
    candidate: {
      type: "connection_point",
      text: "CN12:A",
      bbox: { x: 20, y: 44, width: 18, height: 18 },
    },
    selectedAttachment: selectedEndpoint,
    pageNum: 8,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "connection_point");
  assert.equal(result.attachment.parentAttachmentId, "cable-endpoint-1");
  assert.equal(result.attachment.relation, "cable_segment_endpoint_to_connection_point");
  assert.equal(
    result.attachment.provenance.source,
    "cable_endpoint_connection_point_snap"
  );
});

test("builds terminal-label children when a terminal attachment is selected", () => {
  const selectedTerminal = attachment({
    id: "terminal-1",
    type: "terminal",
    text: "1",
  });

  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "component-1",
      label: "F12",
      metadata: {
        rootType: "component",
        attachments: [selectedTerminal],
      },
    }),
    candidate: {
      type: "text",
      text: "R1",
      bbox: { x: 20, y: 30, width: 24, height: 8 },
    },
    selectedAttachment: selectedTerminal,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.attachment.type, "terminal_label");
  assert.equal(result.attachment.parentAttachmentId, "terminal-1");
  assert.equal(result.attachment.relation, "terminal_has_terminal_label");
  assert.equal(result.attachment.provenance.source, "terminal_label_text_snap");
});

test("blocks point attachments that would create non-endpoint wire links", () => {
  const result = buildPointAttachmentAuthoring({
    ownerBox: annotationBox({
      id: "wire-1",
      label: "102L",
      metadata: { rootType: "wire_segment", attachments: [] },
    }),
    candidate: {
      type: "connection_point",
      text: "F12:1",
      bbox: { x: 20, y: 30, width: 24, height: 8 },
    },
    selectedAttachment: null,
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "blocked",
    notice:
      "Blocked legacy wire link. Select the component connection point and link it to the wire endpoint so the trace data stays canonical.",
  });
});

test("builds manual text attachments for the owner root type", () => {
  const result = buildManualTextAttachment({
    ownerBox: annotationBox({
      id: "ground-1",
      metadata: { rootType: "ground_reference", attachments: [] },
    }),
    bbox: { x: 12, y: 20, width: 30, height: 14 },
    pageNum: 7,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.type, "text");
  assert.equal(result.text, "");
  assert.equal(result.relation, "object_has_text");
  assert.equal(result.snapped, false);
  assert.equal(result.provenance.source, "manual_attachment");
});

test("builds manual cable-label attachments for cable segment roots", () => {
  const result = buildManualTextAttachment({
    ownerBox: annotationBox({
      id: "cable-1",
      metadata: { rootType: "cable_segment", attachments: [] },
    }),
    bbox: { x: 12, y: 20, width: 46, height: 14 },
    pageNum: 8,
    capturedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(result.type, "cable_label");
  assert.equal(result.text, "");
  assert.equal(result.relation, "cable_segment_has_cable_label");
  assert.equal(result.snapped, false);
  assert.equal(result.provenance.source, "manual_cable_label");
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
