import assert from "node:assert/strict";
import test from "node:test";

import { retypeRootAnnotationBox } from "./studio-root-retyping.ts";

test("preserves a manual component mark when retyping a root to component", () => {
  const box = annotationBox({
    label: "F12",
    labelBbox: { x: 4, y: 4, width: 16, height: 8 },
    metadata: {
      rootType: "text",
      attachments: [
        attachment({
          type: "terminal",
          relation: "object_has_attachment",
        }),
      ],
    },
  });

  const next = retypeRootAnnotationBox(box, "component", {
    labelCandidates: [
      labelCandidate({
        text: "K9",
        normalizedText: "K9",
        bbox: { x: 50, y: 50, width: 10, height: 8 },
      }),
    ],
    updatedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(next.label, "F12");
  assert.deepEqual(next.labelBbox, { x: 4, y: 4, width: 16, height: 8 });
  assert.equal(next.labelSource, "manual");
  assert.equal(next.labelCandidateIndex, -1);
  assert.equal(next.metadata.rootType, "component");
  assert.equal(next.metadata.attachments[0].relation, "component_has_terminal");
  assert.equal(next.updatedAt, "2026-05-10T12:00:00.000Z");
});

test("uses the best label candidate when a component root has no manual mark", () => {
  const box = annotationBox({
    label: "wire segment",
    labelBbox: null,
    metadata: {
      rootType: "wire_segment",
      attachments: [],
    },
  });
  const candidate = labelCandidate({
    text: "S1",
    normalizedText: "S1",
    bbox: { x: 10, y: 20, width: 15, height: 8 },
  });

  const next = retypeRootAnnotationBox(box, "component", {
    labelCandidates: [candidate],
    updatedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(next.label, "S1");
  assert.deepEqual(next.labelBbox, candidate.bbox);
  assert.equal(next.labelSource, "text_proximity");
  assert.equal(next.labelCandidateIndex, 0);
  assert.deepEqual(next.labelCandidates, [candidate]);
});

test("falls back to the root type label when an unnamed root has no candidates", () => {
  const box = annotationBox({
    label: "text",
    metadata: {
      rootType: "text",
      attachments: [
        attachment({
          type: "wire_label",
          relation: "component_has_wire_label",
        }),
      ],
    },
  });

  const next = retypeRootAnnotationBox(box, "ground_reference", {
    labelCandidates: [],
    updatedAt: "2026-05-10T12:00:00.000Z",
  });

  assert.equal(next.label, "ground reference");
  assert.equal(next.metadata.rootType, "ground_reference");
  assert.equal(next.metadata.attachments[0].relation, "component_has_wire_label");
});

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 7,
    label: "text",
    bbox: { x: 0, y: 0, width: 20, height: 20 },
    labelBbox: { x: 0, y: 0, width: 20, height: 8 },
    labelSource: "manual",
    labelCandidateIndex: -1,
    labelCandidates: [],
    source: "human",
    snapped: true,
    metadata: {
      rootType: "text",
      attachments: [],
    },
    createdAt: "2026-05-10T11:00:00.000Z",
    updatedAt: "2026-05-10T11:00:00.000Z",
    ...overrides,
  };
}

function attachment(overrides = {}) {
  return {
    id: `attachment-${overrides.type ?? "text"}`,
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

function labelCandidate(overrides = {}) {
  return {
    text: "F12",
    normalizedText: "F12",
    bbox: { x: 0, y: 0, width: 10, height: 8 },
    score: 1,
    distance: 0,
    source: "text_proximity",
    reason: "test",
    ...overrides,
  };
}
