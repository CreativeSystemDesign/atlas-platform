import assert from "node:assert/strict";
import test from "node:test";

import { resolveAttachmentReclassification } from "./attachment-reclassification.ts";

test("allows strict component attachment reclassification", () => {
  const result = resolveAttachmentReclassification({
    owner: annotationBox({
      label: "F12",
      metadata: { rootType: "component", attachments: [] },
    }),
    attachment: attachment({ type: "text" }),
    type: "terminal",
  });

  assert.deepEqual(result, {
    ok: true,
    relation: "component_has_terminal",
  });
});

test("blocks legacy wire reclassification that would bypass endpoints", () => {
  const result = resolveAttachmentReclassification({
    owner: annotationBox({
      label: "102L",
      metadata: { rootType: "wire_segment", attachments: [] },
    }),
    attachment: attachment({ type: "text" }),
    type: "connection_point",
  });

  assert.deepEqual(result, {
    ok: false,
    notice:
      "Blocked legacy wire reclass. Wire connections must stay endpoint-owned.",
  });
});

test("allows endpoint-owned wire connection-point reclassification", () => {
  const result = resolveAttachmentReclassification({
    owner: annotationBox({
      label: "102L",
      metadata: { rootType: "wire_segment", attachments: [] },
    }),
    attachment: attachment({
      type: "connection_point",
      parentAttachmentId: "wire-endpoint-1",
    }),
    type: "connection_point",
  });

  assert.deepEqual(result, {
    ok: true,
    relation: "wire_segment_endpoint_to_connection_point",
  });
});

test("blocks ambiguous non-text attachment reclassification", () => {
  const result = resolveAttachmentReclassification({
    owner: annotationBox({
      label: "GRD",
      metadata: { rootType: "ground_reference", attachments: [] },
    }),
    attachment: attachment({ type: "text" }),
    type: "wire_label",
  });

  assert.deepEqual(result, {
    ok: false,
    notice: "Blocked ambiguous reclass: ground reference GRD -> wire label",
  });
});

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 7,
    label: "F12",
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
