import assert from "node:assert/strict";
import test from "node:test";

import { finishInteraction, handlePointerMove } from "./studio-stage-handlers.ts";

test("moves attachments from the pointer-down bbox instead of compounding each move event", () => {
  let attachment = {
    id: "attachment-1",
    type: "part_number",
    text: "PL12",
    bbox: { x: 100, y: 50, width: 30, height: 12 },
    parentAttachmentId: null,
    relation: "component_has_part_number",
    source: "ctrl_click",
    snapped: true,
    createdAt: "2026-05-10T12:00:00.000Z",
  };
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "move-attachment",
        pointerId: 7,
        boxId: "box-1",
        attachmentId: attachment.id,
        startX: 0,
        startY: 0,
        original: attachment.bbox,
      },
    },
    updateAttachment: (_boxId, _attachmentId, updater) => {
      attachment = updater(attachment);
    },
  });

  handlePointerMove(pointerEvent({ pointerId: 7, clientX: 10, clientY: 4 }), context);
  handlePointerMove(pointerEvent({ pointerId: 7, clientX: 20, clientY: 8 }), context);

  assert.deepEqual(attachment.bbox, { x: 120, y: 58, width: 30, height: 12 });
});

test("refreshes moved dataset text attachments without enabling multi-line merge", () => {
  let box = annotationBox({
    metadata: {
      rootType: "component",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "part_number",
          text: "L",
          bbox: { x: 18.5, y: 10, width: 8, height: 8 },
          relation: "component_has_part_number",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    annotationWorkspaceMode: "training_dataset",
    interactionRef: {
      current: {
        type: "move-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 18.5, y: 10, width: 8, height: 8 },
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "PL12",
        normalizedText: "PL12",
        bbox: { x: 10, y: 10, width: 33, height: 8 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(resolverOptions.mergeLines, false);
  assert.equal(attachment.type, "part_number");
  assert.equal(attachment.text, "PL12");
  assert.deepEqual(attachment.bbox, { x: 10, y: 10, width: 33, height: 8 });
});

test("preserves component attachment bbox after manual resize text refresh", () => {
  let box = annotationBox({
    metadata: {
      rootType: "component",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "spec",
          text: "PR300-",
          bbox: { x: 10, y: 10, width: 80, height: 22 },
          relation: "component_has_spec",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 48, height: 8 },
        handle: "se",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "PR300- 32333-6R-0",
        normalizedText: "PR300-32333-6R-0",
        bbox: { x: 10, y: 10, width: 80, height: 22 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(resolverOptions.mergeLines, false);
  assert.equal(attachment.text, "PR300-32333-6R-0");
  assert.deepEqual(attachment.bbox, { x: 10, y: 10, width: 80, height: 22 });
});

test("allows component part-number attachments to merge lines after manual resize", () => {
  let box = annotationBox({
    metadata: {
      rootType: "component",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "part_number",
          text: "JP100K24E4K-S1",
          bbox: { x: 2179, y: 513, width: 141, height: 42 },
          relation: "component_has_part_number",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 2179, y: 538, width: 141, height: 18 },
        handle: "nw",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (_boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "HA- JP100K24E4K-S1",
        normalizedText: "HA-JP100K24E4K-S1",
        bbox: { x: 2179, y: 513, width: 141, height: 42 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(resolverOptions.mergeLines, true);
  assert.equal(attachment.text, "HA-JP100K24E4K-S1");
  assert.deepEqual(attachment.bbox, { x: 2179, y: 513, width: 141, height: 42 });
});

test("allows component text attachments to merge lines after manual resize", () => {
  let box = annotationBox({
    metadata: {
      rootType: "component",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "text",
          text: "SERVO",
          bbox: { x: 2199, y: 429, width: 84, height: 41 },
          relation: "object_has_text",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 2199, y: 429, width: 84, height: 20 },
        handle: "s",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (_boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "SERVO MOTOR",
        normalizedText: "SERVOMOTOR",
        bbox: { x: 2199, y: 429, width: 84, height: 41 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(resolverOptions.mergeLines, true);
  assert.equal(attachment.text, "SERVOMOTOR");
  assert.deepEqual(attachment.bbox, { x: 2199, y: 429, width: 84, height: 41 });
});

test("does not reshape component attachment to resolved OCR bbox", () => {
  let box = annotationBox({
    metadata: {
      rootType: "component",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "spec",
          text: "PR300",
          bbox: { x: 10, y: 30, width: 50, height: 10 },
          relation: "component_has_spec",
        }),
      ],
    },
  });
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 10, y: 30, width: 50, height: 10 },
        handle: "e",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (_boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: () => ({
      text: "PR300",
      normalizedText: "PR300",
      bbox: { x: 10, y: 10, width: 80, height: 30 },
    }),
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(attachment.text, "PR300");
  assert.deepEqual(attachment.bbox, { x: 10, y: 30, width: 50, height: 10 });
});

test("does not merge lines for resized non-component text attachments", () => {
  let box = annotationBox({
    metadata: {
      rootType: "wire_segment",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "wire_label",
          text: "R1",
          bbox: { x: 10, y: 10, width: 80, height: 22 },
          relation: "wire_segment_has_wire_label",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 48, height: 8 },
        handle: "se",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "R1",
        normalizedText: "R1",
        bbox: { x: 10, y: 10, width: 16, height: 8 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(resolverOptions.mergeLines, false);
});

test("allows multi-line cable-reference part numbers after manual attachment resize", () => {
  let box = annotationBox({
    metadata: {
      rootType: "cable_reference",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "part_number",
          text: "151-",
          bbox: { x: 10, y: 10, width: 80, height: 22 },
          relation: "cable_reference_has_part_number",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 48, height: 8 },
        handle: "se",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "151-E7712-123-0",
        normalizedText: "151-E7712-123-0",
        bbox: { x: 10, y: 10, width: 80, height: 22 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(resolverOptions.mergeLines, true);
  assert.equal(attachment.text, "151-E7712-123-0");
  assert.deepEqual(attachment.bbox, { x: 10, y: 10, width: 80, height: 22 });
});

test("allows multi-line cable-segment part numbers after manual attachment resize", () => {
  let box = annotationBox({
    metadata: {
      rootType: "cable_segment",
      attachments: [
        annotationAttachment({
          id: "attachment-1",
          type: "part_number",
          text: "151-",
          bbox: { x: 10, y: 10, width: 80, height: 22 },
          relation: "cable_segment_has_part_number",
        }),
      ],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-attachment",
        pointerId: 7,
        boxId: box.id,
        attachmentId: "attachment-1",
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 48, height: 8 },
        handle: "se",
      },
    },
    boxesRef: { current: [box] },
    updateAttachment: (boxId, attachmentId, updater) => {
      box = {
        ...box,
        metadata: {
          ...box.metadata,
          attachments: box.metadata.attachments.map((attachment) =>
            attachment.id === attachmentId ? updater(attachment) : attachment
          ),
        },
      };
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "151-E7712-123-0",
        normalizedText: "151-E7712-123-0",
        bbox: { x: 10, y: 10, width: 80, height: 22 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  const attachment = box.metadata.attachments[0];
  assert.equal(resolverOptions.mergeLines, true);
  assert.equal(attachment.text, "151-E7712-123-0");
  assert.deepEqual(attachment.bbox, { x: 10, y: 10, width: 80, height: 22 });
});

test("finishes cable-mode root draws through the cable authoring path", () => {
  let componentRootCreated = false;
  let cableRootBox = null;
  let cableReferenceBox = null;
  const context = gestureContext({
    activeMode: "cable",
    cableAuthoringMode: "geometry",
    interactionRef: {
      current: {
        type: "draw",
        pointerId: 7,
        start: { x: 12, y: 18 },
        current: { x: 80, y: 30 },
      },
    },
    normalizeBox: () => ({ x: 12, y: 18, width: 68, height: 12 }),
    addBox: () => {
      componentRootCreated = true;
    },
    addCableSegmentBox: (roughBox) => {
      cableRootBox = roughBox;
    },
    addCableReferenceBox: (roughBox) => {
      cableReferenceBox = roughBox;
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(componentRootCreated, false);
  assert.deepEqual(cableRootBox, { x: 12, y: 18, width: 68, height: 12 });
  assert.equal(cableReferenceBox, null);
});

test("finishes cable-reference root draws through the cable reference path", () => {
  let componentRootCreated = false;
  let cableRootBox = null;
  let cableReferenceBox = null;
  const context = gestureContext({
    activeMode: "cable",
    cableAuthoringMode: "reference",
    interactionRef: {
      current: {
        type: "draw",
        pointerId: 7,
        start: { x: 12, y: 18 },
        current: { x: 80, y: 46 },
      },
    },
    normalizeBox: () => ({ x: 12, y: 18, width: 68, height: 28 }),
    addBox: () => {
      componentRootCreated = true;
    },
    addCableSegmentBox: (roughBox) => {
      cableRootBox = roughBox;
    },
    addCableReferenceBox: (roughBox) => {
      cableReferenceBox = roughBox;
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(componentRootCreated, false);
  assert.equal(cableRootBox, null);
  assert.deepEqual(cableReferenceBox, { x: 12, y: 18, width: 68, height: 28 });
});

test("finishes connector draws by opening the connector terminal-count prompt", () => {
  let componentRootCreated = false;
  let connectorPromptBox = null;
  const context = gestureContext({
    activeMode: "component",
    componentAuthoringMode: "connector",
    interactionRef: {
      current: {
        type: "draw",
        pointerId: 7,
        start: { x: 100, y: 120 },
        current: { x: 180, y: 320 },
      },
    },
    normalizeBox: () => ({ x: 100, y: 120, width: 80, height: 200 }),
    addBox: () => {
      componentRootCreated = true;
    },
    openConnectorTerminalPrompt: (roughBox) => {
      connectorPromptBox = roughBox;
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(componentRootCreated, false);
  assert.deepEqual(connectorPromptBox, { x: 100, y: 120, width: 80, height: 200 });
});

test("finishes normal component draws through the component root path", () => {
  let componentRootBox = null;
  let connectorPromptOpened = false;
  const context = gestureContext({
    activeMode: "component",
    componentAuthoringMode: "component",
    interactionRef: {
      current: {
        type: "draw",
        pointerId: 7,
        start: { x: 40, y: 50 },
        current: { x: 140, y: 90 },
      },
    },
    normalizeBox: () => ({ x: 40, y: 50, width: 100, height: 40 }),
    addBox: (roughBox) => {
      componentRootBox = roughBox;
    },
    openConnectorTerminalPrompt: () => {
      connectorPromptOpened = true;
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.deepEqual(componentRootBox, { x: 40, y: 50, width: 100, height: 40 });
  assert.equal(connectorPromptOpened, false);
});

test("finishes manual wire draws through the canonical manual wire path", () => {
  let manualWire = null;
  let componentRootCreated = false;
  const context = gestureContext({
    activeMode: "wire",
    wireAuthoringMode: "manual",
    interactionRef: {
      current: {
        type: "draw",
        pointerId: 7,
        start: { x: 100, y: 120 },
        current: { x: 180, y: 144 },
        targetBoxId: "wire-6022",
      },
    },
    normalizeBox: () => ({ x: 100, y: 120, width: 80, height: 24 }),
    addManualWireSegmentBox: (roughBox, targetBoxId) => {
      manualWire = { roughBox, targetBoxId };
    },
    addBox: () => {
      componentRootCreated = true;
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(componentRootCreated, false);
  assert.deepEqual(manualWire, {
    roughBox: { x: 100, y: 120, width: 80, height: 24 },
    targetBoxId: "wire-6022",
  });
});

test("allows multi-line component labels only after manual label resize", () => {
  let box = annotationBox({
    label: "CMP",
    labelBbox: { x: 10, y: 10, width: 80, height: 22 },
    labelCandidates: [],
    metadata: {
      rootType: "component",
      attachments: [],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    interactionRef: {
      current: {
        type: "resize-label",
        pointerId: 7,
        boxId: box.id,
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 40, height: 8 },
        handle: "se",
      },
    },
    boxesRef: { current: [box] },
    updateBox: (boxId, updater) => {
      box = updater(box);
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return {
        text: "MAIN UNIT",
        normalizedText: "MAINUNIT",
        bbox: { x: 10, y: 10, width: 80, height: 22 },
      };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(resolverOptions.mergeLines, true);
  assert.equal(box.label, "MAINUNIT");
  assert.deepEqual(box.labelBbox, { x: 10, y: 10, width: 80, height: 22 });
});

test("keeps component label autosnap single-line unless label height is enlarged", () => {
  let box = annotationBox({
    label: "WHM",
    labelBbox: { x: 10, y: 10, width: 80, height: 10 },
    labelCandidates: [],
    metadata: {
      rootType: "component",
      attachments: [],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    annotationWorkspaceMode: "training_dataset",
    interactionRef: {
      current: {
        type: "resize-label",
        pointerId: 7,
        boxId: box.id,
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 50, height: 10 },
        handle: "e",
      },
    },
    boxesRef: { current: [box] },
    updateBox: (boxId, updater) => {
      box = updater(box);
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return options?.mergeLines
        ? {
            text: "WHM10\nHIGH TEMP",
            normalizedText: "WHM10HIGHTEMP",
            bbox: { x: 10, y: 10, width: 80, height: 22 },
          }
        : {
            text: "WHM10",
            normalizedText: "WHM10",
            bbox: { x: 10, y: 10, width: 50, height: 10 },
          };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(resolverOptions.mergeLines, false);
  assert.equal(resolverOptions.includeAdjacentOutsideBox, false);
  assert.equal(box.label, "WHM");
  assert.deepEqual(box.labelBbox, { x: 10, y: 10, width: 50, height: 10 });
});

test("snaps dataset component label right-edge resize to the character edge", () => {
  let box = annotationBox({
    label: "WHM10",
    labelBbox: { x: 10, y: 10, width: 50, height: 10 },
    labelCandidates: [],
    metadata: {
      rootType: "component",
      attachments: [],
    },
  });
  let resolverOptions = null;
  const context = gestureContext({
    annotationWorkspaceMode: "training_dataset",
    interactionRef: {
      current: {
        type: "resize-label",
        pointerId: 7,
        boxId: box.id,
        startX: 0,
        startY: 0,
        original: { x: 10, y: 10, width: 50, height: 10 },
        handle: "se",
      },
    },
    boxesRef: { current: [box] },
    updateBox: (boxId, updater) => {
      box = updater(box);
      context.boxesRef.current = [box];
    },
    resolveTextForLabelBox: (_labelBox, options) => {
      resolverOptions = options;
      return options?.mergeLines
        ? {
            text: "WHM10 HIGH",
            normalizedText: "WHM10HIGH",
            bbox: { x: 10, y: 10, width: 80, height: 22 },
            textFragments: [
              {
                text: "WHM10",
                normalizedText: "WHM10",
                bbox: { x: 10, y: 10, width: 50, height: 10 },
              },
              {
                text: "HIGH",
                normalizedText: "HIGH",
                bbox: { x: 10, y: 22, width: 80, height: 10 },
              },
            ],
          }
        : {
            text: "WHM10",
            normalizedText: "WHM10",
            bbox: { x: 10, y: 10, width: 50, height: 10 },
          };
    },
  });

  finishInteraction(pointerEvent({ pointerId: 7, clientX: 0, clientY: 0 }), context);

  assert.equal(resolverOptions.mergeLines, false);
  assert.equal(box.label, "WHM");
  assert.deepEqual(box.labelBbox, { x: 10, y: 10, width: 50, height: 10 });
});

function pointerEvent({ pointerId, clientX, clientY }) {
  return { pointerId, clientX, clientY };
}

function gestureContext(overrides = {}) {
  return {
    interactionRef: { current: null },
    setPan: () => {},
    setDraftBox: () => {},
    getPagePoint: () => null,
    normalizeBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    updateCursorPosition: () => {},
    clampBox: (box) => box,
    pageNum: 8,
    annotationWorkspaceMode: "digital_twin",
    zoom: 1,
    activeMode: "component",
    componentAuthoringMode: "component",
    wireAuthoringMode: "auto",
    cableAuthoringMode: "geometry",
    boxesRef: { current: [] },
    updateBox: () => {},
    updateAttachment: () => {},
    addBox: () => {},
    addCableSegmentBox: () => {},
    addCableReferenceBox: () => {},
    openConnectorTerminalPrompt: () => {},
    addManualWireSegmentBox: () => {},
    addAttachmentFromPoint: () => {},
    addCircuitDescriptorRegion: () => {},
    addManualAttachment: () => {},
    resolveTextForLabelBox: () => null,
    reconcileTouchedWireEndpointContacts: () => {},
    reconcileTouchedCableReferenceConnectionPoints: () => {},
    ...overrides,
  };
}

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 8,
    label: "SAMPLE",
    bbox: { x: 0, y: 0, width: 100, height: 80 },
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
    type: "part_number",
    text: "PL12",
    bbox: { x: 10, y: 10, width: 33, height: 8 },
    parentAttachmentId: null,
    relation: "component_has_part_number",
    source: "ctrl_click",
    snapped: true,
    createdAt: "2026-05-10T12:00:00.000Z",
    ...overrides,
  };
}
