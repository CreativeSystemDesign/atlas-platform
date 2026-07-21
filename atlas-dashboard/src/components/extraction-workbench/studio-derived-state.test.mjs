import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationSelectionKey,
  boxesForPage,
  relationNoticeShouldClearForSelection,
  selectedAttachmentForBox,
  selectedBoxById,
  selectedConnectionPointEditorTarget,
  studioImageSrc,
  trackRelationNotice,
} from "./studio-derived-state.ts";

test("selects page boxes, active root, and active attachment without mutating inputs", () => {
  const boxes = [
    box("box-1", 7, [{ id: "a-1", type: "terminal" }]),
    box("box-2", 8, [{ id: "a-2", type: "wire_label" }]),
  ];

  assert.deepEqual(boxesForPage(boxes, 7).map((item) => item.id), ["box-1"]);
  assert.equal(selectedBoxById(boxes, "box-2")?.id, "box-2");
  assert.equal(selectedBoxById(boxes, null), null);
  assert.equal(selectedAttachmentForBox(boxes[0], "a-1")?.id, "a-1");
  assert.equal(selectedAttachmentForBox(boxes[0], "missing"), null);
  assert.equal(selectedAttachmentForBox(null, "a-1"), null);
});

test("resolves inline connection point editor targets only when both ids are valid", () => {
  const boxes = [box("component-f12", 7, [{ id: "cp-r1", type: "connection_point" }])];

  assert.deepEqual(
    selectedConnectionPointEditorTarget(boxes, {
      boxId: "component-f12",
      attachmentId: "cp-r1",
      value: "R1",
    }),
    { box: boxes[0], attachment: boxes[0].metadata.attachments[0] }
  );
  assert.equal(
    selectedConnectionPointEditorTarget(boxes, {
      boxId: "component-f12",
      attachmentId: "missing",
      value: "",
    }),
    null
  );
  assert.equal(selectedConnectionPointEditorTarget(boxes, null), null);
});

test("builds stable selection keys and page image URLs", () => {
  assert.equal(annotationSelectionKey(null, null), "none:none");
  assert.equal(annotationSelectionKey("box-1", null), "box-1:none");
  assert.equal(annotationSelectionKey("box-1", "attachment-1"), "box-1:attachment-1");
  assert.equal(
    studioImageSrc("https://agent.example", "project-1", "doc-1", 7),
    "https://agent.example/workbench/projects/project-1/documents/doc-1/pages/7/image"
  );
});

test("tracks relation notices against the selection that created them", () => {
  assert.deepEqual(
    trackRelationNotice({
      relationNotice: null,
      selectedAnnotationKey: "box-1:none",
      trackedSelectionKey: "old",
      trackedText: "old notice",
    }),
    { trackedSelectionKey: null, trackedText: null }
  );

  assert.deepEqual(
    trackRelationNotice({
      relationNotice: "linked wire",
      selectedAnnotationKey: "box-1:none",
      trackedSelectionKey: null,
      trackedText: null,
    }),
    { trackedSelectionKey: "box-1:none", trackedText: "linked wire" }
  );

  assert.deepEqual(
    trackRelationNotice({
      relationNotice: "linked wire",
      selectedAnnotationKey: "box-2:none",
      trackedSelectionKey: "box-1:none",
      trackedText: "linked wire",
    }),
    { trackedSelectionKey: "box-1:none", trackedText: "linked wire" }
  );

  assert.equal(
    relationNoticeShouldClearForSelection({
      relationNotice: "linked wire",
      selectedAnnotationKey: "box-2:none",
      trackedSelectionKey: "box-1:none",
    }),
    true
  );
  assert.equal(
    relationNoticeShouldClearForSelection({
      relationNotice: "linked wire",
      selectedAnnotationKey: "box-1:none",
      trackedSelectionKey: "box-1:none",
    }),
    false
  );
});

function box(id, pageNum, attachments = []) {
  return {
    id,
    pageNum,
    label: id,
    metadata: { attachments },
  };
}
