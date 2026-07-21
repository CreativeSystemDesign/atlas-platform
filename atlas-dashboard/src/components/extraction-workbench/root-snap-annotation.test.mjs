import assert from "node:assert/strict";
import test from "node:test";

import {
  addGroundReferenceRootLinkedToWireToBoxes,
  addRootSnapAnnotationToBoxes,
  addWireRootLinkedToConnectionPointToBoxes,
} from "./root-snap-annotation.ts";

test("adds a canonical wire root with endpoints and touched connection links", () => {
  const component = annotationBox({
    id: "component-1",
    label: "F12",
    bbox: { x: 80, y: 30, width: 30, height: 40 },
    metadata: {
      rootType: "component",
      attachments: [
        attachment({
          id: "connection-1",
          type: "connection_point",
          text: "1",
          bbox: { x: 91, y: 41, width: 18, height: 18 },
          relation: "component_has_connection_point",
        }),
      ],
    },
  });

  const { boxes, createdBox } = addRootSnapAnnotationToBoxes([component], {
    candidate: {
      type: "wire_segment",
      text: "",
      bbox: { x: 100, y: 45, width: 80, height: 10 },
    },
    id: "wire-1",
    pageNum: 7,
    zoom: 1,
    source: "wire_snap",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [
      labelCandidate({
        text: "102L",
        normalizedText: "102L",
        bbox: { x: 125, y: 36, width: 20, height: 8 },
      }),
    ],
  });

  assert.equal(boxes.length, 2);
  assert.equal(createdBox.id, "wire-1");
  assert.equal(createdBox.label, "102l");
  assert.equal(createdBox.metadata.rootType, "wire_segment");
  assert.equal(createdBox.metadata.wireGeometry.segments.length, 1);
  assert.equal(
    createdBox.metadata.attachments.filter((item) => item.type === "wire_endpoint")
      .length,
    2
  );
  const connectionLink = createdBox.metadata.attachments.find(
    (item) => item.relation === "wire_segment_endpoint_to_connection_point"
  );
  assert.equal(connectionLink.linkedBoxId, "component-1");
  assert.equal(connectionLink.linkedAttachmentId, "connection-1");
  assert.match(connectionLink.parentAttachmentId, /^wire-1-wire-endpoint-start-/);
});

test("normalizes root class labels to lowercase spaced words", () => {
  const { createdBox } = addRootSnapAnnotationToBoxes([], {
    candidate: {
      type: "wire_label",
      text: "wirelabel",
      bbox: { x: 10, y: 20, width: 30, height: 12 },
    },
    id: "wire-label-1",
    pageNum: 3,
    zoom: 1,
    source: "root_wire_label_object_snap",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [],
  });

  assert.equal(createdBox.label, "wire label");
  assert.equal(createdBox.metadata.rootType, "wire_label");
});

test("preserves signed voltage wire-label class names", () => {
  const { createdBox } = addRootSnapAnnotationToBoxes([], {
    candidate: {
      type: "wire_label",
      text: "-24v wire label",
      bbox: { x: 10, y: 20, width: 30, height: 12 },
    },
    id: "wire-label-2",
    pageNum: 3,
    zoom: 1,
    source: "root_wire_label_object_snap",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [],
  });

  assert.equal(createdBox.label, "-24v wire label");
});

test("creates terminal roots with the terminal class label", () => {
  const { createdBox } = addRootSnapAnnotationToBoxes([], {
    candidate: {
      type: "terminal",
      text: "terminal",
      bbox: { x: 50, y: 60, width: 18, height: 18 },
    },
    id: "terminal-1",
    pageNum: 4,
    zoom: 1,
    source: "dataset_component_terminal_ctrl_click_root",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [],
  });

  assert.equal(createdBox.label, "terminal");
  assert.equal(createdBox.metadata.rootType, "terminal");
});

test("adds a cable root with cable endpoints and no wire trace geometry", () => {
  const component = annotationBox({
    id: "component-1",
    label: "CN12",
    bbox: { x: 80, y: 30, width: 30, height: 40 },
    metadata: {
      rootType: "component",
      attachments: [
        attachment({
          id: "connection-1",
          type: "connection_point",
          text: "A",
          bbox: { x: 91, y: 48, width: 18, height: 18 },
          relation: "component_has_connection_point",
        }),
      ],
    },
  });

  const { createdBox } = addRootSnapAnnotationToBoxes([component], {
    candidate: {
      type: "cable_segment",
      text: "cable",
      bbox: { x: 100, y: 45, width: 80, height: 20 },
    },
    id: "cable-1",
    pageNum: 8,
    zoom: 1,
    source: "root_cable_segment_snap",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [],
  });

  assert.equal(createdBox.id, "cable-1");
  assert.equal(createdBox.label, "cable");
  assert.equal(createdBox.metadata.rootType, "cable_segment");
  assert.equal(createdBox.metadata.wireGeometry, undefined);
  assert.equal(
    createdBox.metadata.attachments.filter((item) => item.type === "cable_endpoint")
      .length,
    2
  );
  assert.equal(
    createdBox.metadata.attachments.some((item) => item.type === "wire_endpoint"),
    false
  );
  const connectionLink = createdBox.metadata.attachments.find(
    (item) => item.relation === "cable_segment_endpoint_to_connection_point"
  );
  assert.equal(connectionLink.linkedBoxId, "component-1");
  assert.equal(connectionLink.linkedAttachmentId, "connection-1");
  assert.match(connectionLink.parentAttachmentId, /^cable-1-cable-endpoint-start-/);
  assert.equal(createdBox.metadata.provenance.source, "root_cable_segment_snap");
});

test("adds a ground root and links touched existing wire endpoints", () => {
  const wire = annotationBox({
    id: "wire-1",
    label: "PE",
    bbox: { x: 100, y: 45, width: 80, height: 10 },
    metadata: {
      rootType: "wire_segment",
      attachments: [
        attachment({
          id: "endpoint-1",
          type: "wire_endpoint",
          text: "start",
          bbox: { x: 91, y: 41, width: 18, height: 18 },
          relation: "wire_segment_has_endpoint",
        }),
      ],
    },
  });

  const { boxes, createdBox } = addRootSnapAnnotationToBoxes([wire], {
    candidate: {
      type: "ground_reference",
      text: "PE",
      bbox: { x: 90, y: 40, width: 22, height: 22 },
    },
    id: "ground-1",
    pageNum: 7,
    zoom: 1,
    source: "ground_reference_snap",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [],
  });

  assert.equal(createdBox.id, "ground-1");
  assert.equal(createdBox.metadata.rootType, "ground_reference");
  const updatedWire = boxes.find((box) => box.id === "wire-1");
  const groundLink = updatedWire.metadata.attachments.find(
    (item) => item.relation === "wire_segment_to_ground_reference"
  );
  assert.equal(groundLink.linkedBoxId, "ground-1");
  assert.equal(groundLink.parentAttachmentId, "endpoint-1");
});

test("preserves structured continuation references on continuation roots", () => {
  const continuationReference = {
    page: 8,
    row: 3,
    label: "P2",
    rawText: "8-3/P2",
  };

  const { createdBox } = addRootSnapAnnotationToBoxes([], {
    candidate: {
      type: "continuation",
      text: "8-3/P2",
      bbox: { x: 20, y: 30, width: 24, height: 16 },
      continuationReference,
    },
    id: "continuation-1",
    pageNum: 7,
    zoom: 1,
    source: "continuation_snap",
    capturedAt: "2026-05-10T12:00:00.000Z",
    labelCandidates: [],
  });

  assert.equal(createdBox.metadata.rootType, "continuation");
  assert.deepEqual(
    createdBox.metadata.continuationReference,
    continuationReference
  );
});

test("adds a wire root with an explicit selected connection-point link", () => {
  const ownerBox = annotationBox({
    id: "component-1",
    label: "F12",
    metadata: {
      rootType: "component",
      attachments: [
        attachment({
          id: "connection-1",
          type: "connection_point",
          text: "2",
          bbox: { x: 91, y: 41, width: 18, height: 18 },
          relation: "component_has_connection_point",
        }),
      ],
    },
  });
  const groundBox = annotationBox({
    id: "ground-1",
    label: "PE",
    bbox: { x: 171, y: 41, width: 20, height: 20 },
    metadata: { rootType: "ground_reference", attachments: [] },
  });
  const connectionPoint = ownerBox.metadata.attachments[0];

  const { boxes, connectionAttachment, createdBox } =
    addWireRootLinkedToConnectionPointToBoxes([ownerBox, groundBox], {
      ownerBox,
      connectionPoint,
      candidate: {
        type: "wire_segment",
        text: "",
        bbox: { x: 100, y: 45, width: 80, height: 10 },
      },
      id: "wire-1",
      pageNum: 7,
      zoom: 1,
      capturedAt: "2026-05-10T12:00:00.000Z",
      labelCandidates: [
        labelCandidate({
          text: "102L",
          normalizedText: "102L",
        }),
      ],
    });

  assert.equal(boxes.length, 3);
  assert.equal(createdBox.label, "102L");
  assert.equal(connectionAttachment.linkedBoxId, "component-1");
  assert.equal(connectionAttachment.linkedAttachmentId, "connection-1");
  assert.match(
    connectionAttachment.parentAttachmentId,
    /^wire-1-wire-endpoint-start-/
  );
  const links = createdBox.metadata.attachments.filter(
    (item) => item.relation === "wire_segment_endpoint_to_connection_point"
  );
  assert.equal(links.length, 1);
  const groundLink = createdBox.metadata.attachments.find(
    (item) => item.relation === "wire_segment_to_ground_reference"
  );
  assert.equal(groundLink.linkedBoxId, "ground-1");
});

test("adds a ground root with an explicit selected wire link", () => {
  const wire = annotationBox({
    id: "wire-1",
    label: "PE",
    bbox: { x: 100, y: 45, width: 80, height: 10 },
    metadata: {
      rootType: "wire_segment",
      attachments: [
        attachment({
          id: "endpoint-1",
          type: "wire_endpoint",
          text: "start",
          bbox: { x: 91, y: 41, width: 18, height: 18 },
          relation: "wire_segment_has_endpoint",
        }),
      ],
    },
  });

  const { boxes, createdBox, attachment: groundAttachment } =
    addGroundReferenceRootLinkedToWireToBoxes([wire], {
      wireBox: wire,
      candidate: {
        type: "ground_reference",
        text: "PE",
        bbox: { x: 90, y: 40, width: 22, height: 22 },
      },
      bbox: { x: 90, y: 40, width: 22, height: 22 },
      id: "ground-1",
      pageNum: 7,
      capturedAt: "2026-05-10T12:00:00.000Z",
    });

  assert.equal(createdBox.id, "ground-1");
  assert.equal(createdBox.metadata.rootType, "ground_reference");
  assert.equal(groundAttachment.linkedBoxId, "ground-1");
  assert.equal(groundAttachment.parentAttachmentId, "endpoint-1");
  const updatedWire = boxes.find((box) => box.id === "wire-1");
  const groundLinks = updatedWire.metadata.attachments.filter(
    (item) => item.relation === "wire_segment_to_ground_reference"
  );
  assert.equal(groundLinks.length, 1);
  assert.equal(groundLinks[0].id, groundAttachment.id);
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

function labelCandidate(overrides = {}) {
  return {
    text: "102L",
    normalizedText: "102L",
    bbox: { x: 0, y: 0, width: 10, height: 8 },
    score: 1,
    distance: 0,
    source: "wire_label_bank_match",
    reason: "test",
    ...overrides,
  };
}
