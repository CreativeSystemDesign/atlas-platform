import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentKindOfRoot,
  attachmentsOf,
  cloneBoxes,
  descendantAttachmentIds,
  isReferenceOnlyAttachment,
  nearestWireEndpoint,
  rootTypeOf,
  wireEndpointAttachmentsOf,
  wireSegmentFromBox,
  wireSegmentsOf,
} from "./annotation-box-helpers.ts";

test("reads annotation root, attachment, and wire segment collections safely", () => {
  const wireBox = {
    id: "wire-1",
    metadata: {
      rootType: "wire_segment",
      wireGeometry: {
        segments: [{ id: "segment-1", bbox: { x: 10, y: 20, width: 100, height: 8 } }],
      },
      attachments: [
        { id: "endpoint-a", type: "wire_endpoint", bbox: { x: 10, y: 20, width: 8, height: 8 } },
        { id: "label-a", type: "wire_label", bbox: { x: 50, y: 20, width: 20, height: 8 } },
      ],
    },
  };

  assert.equal(rootTypeOf(wireBox), "wire_segment");
  assert.equal(rootTypeOf({ id: "legacy" }), "component");
  assert.equal(attachmentKindOfRoot(wireBox), "wire_segment");
  assert.equal(attachmentKindOfRoot({ id: "descriptor", metadata: { rootType: "page_descriptor" } }), null);
  assert.equal(attachmentsOf(wireBox).length, 2);
  assert.equal(wireEndpointAttachmentsOf(wireBox).length, 1);
  assert.equal(wireSegmentsOf(wireBox).length, 1);
});

test("builds wire segment geometry and finds nearest wire endpoint", () => {
  const horizontal = wireSegmentFromBox({ x: 10, y: 20, width: 80, height: 10 });
  const vertical = wireSegmentFromBox({ x: 10, y: 20, width: 10, height: 80 });

  assert.match(horizontal.id, /^wire-segment-/);
  assert.deepEqual(
    { x1: horizontal.x1, y1: horizontal.y1, x2: horizontal.x2, y2: horizontal.y2 },
    { x1: 10, y1: 25, x2: 90, y2: 25 }
  );
  assert.deepEqual(
    { x1: vertical.x1, y1: vertical.y1, x2: vertical.x2, y2: vertical.y2 },
    { x1: 15, y1: 20, x2: 15, y2: 100 }
  );

  const endpoints = [
    { id: "far", type: "wire_endpoint", bbox: { x: 100, y: 100, width: 10, height: 10 } },
    { id: "near", type: "wire_endpoint", bbox: { x: 10, y: 10, width: 10, height: 10 } },
  ];
  assert.equal(nearestWireEndpoint(endpoints, { x: 11, y: 12 })?.id, "near");
});

test("handles reference-only links, descendants, and structural cloning", () => {
  const attachments = [
    { id: "parent", type: "connection_point" },
    { id: "child", type: "terminal_label", parentAttachmentId: "parent" },
    { id: "grandchild", type: "text", parentAttachmentId: "child" },
  ];

  assert.equal(isReferenceOnlyAttachment({ relation: "continuation_to_object" }), true);
  assert.equal(isReferenceOnlyAttachment({ relation: "component_has_terminal" }), false);
  assert.deepEqual([...descendantAttachmentIds(attachments, "parent")], [
    "child",
    "grandchild",
  ]);

  const boxes = [{ id: "box", metadata: { attachments } }];
  const cloned = cloneBoxes(boxes);
  cloned[0].metadata.attachments[0].id = "changed";
  assert.equal(boxes[0].metadata.attachments[0].id, "parent");
});
