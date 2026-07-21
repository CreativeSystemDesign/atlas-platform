import assert from "node:assert/strict";
import test from "node:test";

import { handlePointerDown } from "./studio-pointer-handlers.ts";

test("ctrl-clicking an existing annotated wire from a selected connection point uses saved wire geometry before raw detection", () => {
  const selectedBox = annotationBox({
    id: "component-1",
    label: "CON22",
    bbox: { x: 220, y: 80, width: 80, height: 120 },
    metadata: {
      rootType: "component",
      attachments: [
        annotationAttachment({
          id: "connection-1",
          type: "connection_point",
          text: "2",
          bbox: { x: 218, y: 126, width: 18, height: 18 },
          relation: "component_has_connection_point",
        }),
      ],
    },
  });
  const selectedAttachment = selectedBox.metadata.attachments[0];
  const existingWire = annotationBox({
    id: "wire-6022",
    label: "6022",
    bbox: { x: 100, y: 120, width: 120, height: 16 },
    metadata: {
      rootType: "wire_segment",
      wireSegments: [
        { bbox: { x: 100, y: 120, width: 120, height: 16 } },
      ],
      attachments: [],
    },
  });
  const linked = [];
  const notices = [];

  handlePointerDown(pointerEvent({ ctrlKey: true }), stageContext({
    selectedBox,
    selectedAttachment,
    boxesForPage: [selectedBox, existingWire],
    getPagePoint: () => ({ x: 150, y: 128 }),
    resolveWireSegmentCandidate: () => null,
    linkExistingWireToConnectionPoint: (wireBox, ownerBox, connectionPoint) => {
      linked.push({
        wireBoxId: wireBox.id,
        ownerBoxId: ownerBox.id,
        connectionPointId: connectionPoint.id,
      });
      return true;
    },
    setRelationNotice: (notice) => {
      notices.push(notice);
    },
  }));

  assert.deepEqual(linked, [
    {
      wireBoxId: "wire-6022",
      ownerBoxId: "component-1",
      connectionPointId: "connection-1",
    },
  ]);
  assert.deepEqual(notices, []);
});

test("manual wire mode starts a draw session against the selected wire without vector detection", () => {
  const selectedBox = annotationBox({
    id: "wire-6022",
    label: "6022",
    bbox: { x: 100, y: 120, width: 120, height: 16 },
    metadata: {
      rootType: "wire_segment",
      attachments: [],
    },
  });
  const interactionRef = { current: null };
  let resolveCalled = false;

  handlePointerDown(pointerEvent(), stageContext({
    activeMode: "wire",
    wireAuthoringMode: "manual",
    tool: "box",
    selectedBox,
    interactionRef,
    getPagePoint: () => ({ x: 140, y: 130 }),
    resolveWireSegmentCandidate: () => {
      resolveCalled = true;
      return null;
    },
  }));

  assert.equal(resolveCalled, false);
  assert.deepEqual(interactionRef.current, {
    type: "draw",
    pointerId: 7,
    start: { x: 140, y: 130 },
    current: { x: 140, y: 130 },
    targetBoxId: "wire-6022",
  });
});

test("primary pen input starts a component bounding-box draw session", () => {
  const interactionRef = { current: null };
  const draftBoxes = [];

  handlePointerDown(pointerEvent({
    pointerType: "pen",
    isPrimary: true,
    clientX: 22,
    clientY: 34,
  }), stageContext({
    activeMode: "component",
    tool: "box",
    interactionRef,
    getPagePoint: () => ({ x: 320, y: 240 }),
    setDraftBox: (draftBox) => draftBoxes.push(draftBox),
  }));

  assert.deepEqual(interactionRef.current, {
    type: "draw",
    pointerId: 7,
    start: { x: 320, y: 240 },
    current: { x: 320, y: 240 },
  });
  assert.deepEqual(draftBoxes, [{ x: 320, y: 240, width: 1, height: 1 }]);
});

test("non-primary touch input does not start an annotation session", () => {
  const interactionRef = { current: null };
  const prevented = [];

  handlePointerDown(pointerEvent({
    pointerType: "touch",
    isPrimary: false,
    preventDefault: () => prevented.push(true),
  }), stageContext({
    activeMode: "component",
    tool: "box",
    interactionRef,
  }));

  assert.equal(interactionRef.current, null);
  assert.deepEqual(prevented, []);
});

test("primary touch input is reserved for viewport gestures, not annotation drawing", () => {
  const interactionRef = { current: null };
  const draftBoxes = [];

  handlePointerDown(pointerEvent({
    pointerType: "touch",
    isPrimary: true,
    preventDefault: () => draftBoxes.push("prevented"),
  }), stageContext({
    activeMode: "component",
    tool: "box",
    interactionRef,
    getPagePoint: () => ({ x: 320, y: 240 }),
    setDraftBox: (draftBox) => draftBoxes.push(draftBox),
  }));

  assert.equal(interactionRef.current, null);
  assert.deepEqual(draftBoxes, []);
});

test("plain stage clicks clear a selected descriptor instead of starting a region draw", () => {
  const selectedBox = annotationBox({
    id: "descriptor-1",
    label: "VACUUM PUMP",
    metadata: {
      rootType: "circuit_descriptor",
      attachments: [],
    },
  });
  const selectedAttachment = annotationAttachment({
    id: "descriptor-region-1",
    type: "component",
  });
  const interactionRef = { current: null };
  const selectedBoxIds = [];
  const selectedAttachmentIds = [];
  const typeMenuAttachmentIds = [];
  const typeMenuBoxIds = [];
  const notices = ["previous notice"];

  handlePointerDown(pointerEvent(), stageContext({
    activeMode: "descriptor",
    tool: "select",
    selectedBox,
    selectedAttachment,
    interactionRef,
    getPagePoint: () => ({ x: 300, y: 240 }),
    setSelectedBoxId: (id) => selectedBoxIds.push(id),
    setSelectedAttachmentId: (id) => selectedAttachmentIds.push(id),
    setTypeMenuAttachmentId: (id) => typeMenuAttachmentIds.push(id),
    setTypeMenuBoxId: (id) => typeMenuBoxIds.push(id),
    setRelationNotice: (notice) => notices.push(notice),
  }));

  assert.equal(interactionRef.current, null);
  assert.deepEqual(selectedBoxIds, [null]);
  assert.deepEqual(selectedAttachmentIds, [null]);
  assert.equal(typeMenuAttachmentIds.at(-1), null);
  assert.equal(typeMenuBoxIds.at(-1), null);
  assert.equal(notices.at(-1), null);
});

test("descriptor autosnap still creates a root when nothing is selected", () => {
  const candidate = {
    bbox: { x: 120, y: 80, width: 90, height: 18 },
    text: "HYDRAULIC UNIT",
    type: "description",
  };
  const added = [];

  handlePointerDown(pointerEvent(), stageContext({
    activeMode: "descriptor",
    tool: "select",
    selectedBox: null,
    getPagePoint: () => ({ x: 130, y: 86 }),
    resolveAttachmentCandidate: () => candidate,
    addCircuitDescriptorRoot: (nextCandidate) => added.push(nextCandidate),
  }));

  assert.deepEqual(added, [candidate]);
});

test("modified clicks on a selected descriptor keep the explicit region draw gesture", () => {
  const selectedBox = annotationBox({
    id: "descriptor-1",
    label: "VACUUM PUMP",
    metadata: {
      rootType: "circuit_descriptor",
      attachments: [],
    },
  });
  const interactionRef = { current: null };
  const draftBoxes = [];

  handlePointerDown(pointerEvent({ ctrlKey: true }), stageContext({
    activeMode: "descriptor",
    tool: "select",
    selectedBox,
    interactionRef,
    getPagePoint: () => ({ x: 300, y: 240 }),
    setDraftBox: (draftBox) => draftBoxes.push(draftBox),
  }));

  assert.deepEqual(interactionRef.current, {
    type: "draw-attachment",
    pointerId: 7,
    boxId: "descriptor-1",
    start: { x: 300, y: 240 },
    current: { x: 300, y: 240 },
  });
  assert.deepEqual(draftBoxes, [{ x: 300, y: 240, width: 1, height: 1 }]);
});

function stageContext(overrides = {}) {
  return {
    activeMode: "wire",
    wireAuthoringMode: "auto",
    cableAuthoringMode: "geometry",
    tool: "select",
    pan: { x: 0, y: 0 },
    selectedBox: null,
    selectedAttachment: null,
    interactionRef: { current: null },
    getPagePoint: () => ({ x: 0, y: 0 }),
    setConnectionPointEditor: () => {},
    setRelationNotice: () => {},
    setTypeMenuAttachmentId: () => {},
    setTypeMenuBoxId: () => {},
    setSelectedBoxId: () => {},
    setSelectedAttachmentId: () => {},
    setDraftBox: () => {},
    undoLastEdit: () => {},
    addRootSnapBox: () => {},
    addCircuitDescriptorRoot: () => {},
    addPageDescriptorRoot: () => {},
    addWireRootLinkedToConnectionPoint: () => {},
    addGroundReferenceRootLinkedToWire: () => {},
    addAttachmentFromExisting: () => {},
    extendWireGeometry: () => {},
    boxesForPage: [],
    resolveAttachmentCandidate: () => null,
    resolveContinuationCandidate: () => null,
    resolveGroundReferenceCandidate: () => null,
    resolveWireSegmentCandidate: () => null,
    linkExistingWireToConnectionPoint: () => false,
    ...overrides,
  };
}

function pointerEvent(overrides = {}) {
  return {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    pointerId: 7,
    clientX: 0,
    clientY: 0,
    preventDefault: () => {},
    currentTarget: {
      focus: () => {},
      setPointerCapture: () => {},
    },
    ...overrides,
  };
}

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    page: 8,
    label: "Box",
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    metadata: {
      rootType: "component",
      attachments: [],
    },
    ...overrides,
  };
}

function annotationAttachment(overrides = {}) {
  return {
    id: "attachment-1",
    type: "connection_point",
    text: "",
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    relation: "component_has_connection_point",
    source: "manual",
    snapped: false,
    createdAt: "2026-05-11T00:00:00.000Z",
    ...overrides,
  };
}
