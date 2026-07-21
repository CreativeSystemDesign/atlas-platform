import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteAttachmentWithDescendants,
  resolveDeleteAction,
} from "./selection-delete.ts";

test("delete removes the selected attachment before the selected root", () => {
  assert.deepEqual(
    resolveDeleteAction({
      selectedBoxId: "component-pl10",
      selectedAttachmentId: "attachment-location",
      selectedAttachmentExists: true,
      isRepeat: false,
    }),
    { action: "delete-attachment", preventDefault: true }
  );
});

test("delete never falls through to the root when an attachment selection is stale", () => {
  assert.deepEqual(
    resolveDeleteAction({
      selectedBoxId: "component-pl10",
      selectedAttachmentId: "attachment-location",
      selectedAttachmentExists: false,
      isRepeat: false,
    }),
    { action: "clear-stale-attachment", preventDefault: true }
  );
});

test("held delete keys are ignored while a selection exists", () => {
  assert.deepEqual(
    resolveDeleteAction({
      selectedBoxId: "component-pl10",
      selectedAttachmentId: null,
      selectedAttachmentExists: false,
      isRepeat: true,
    }),
    { action: "ignore", preventDefault: true }
  );
});

test("delete removes the selected root only when no attachment is selected", () => {
  assert.deepEqual(
    resolveDeleteAction({
      selectedBoxId: "component-pl10",
      selectedAttachmentId: null,
      selectedAttachmentExists: false,
      isRepeat: false,
    }),
    { action: "delete-root", preventDefault: true }
  );
});

test("delete removes an attachment and its descendant attachments", () => {
  const box = {
    id: "component-1",
    metadata: {
      attachments: [
        { id: "terminal-1", parentAttachmentId: null },
        { id: "label-1", parentAttachmentId: "terminal-1" },
        { id: "note-1", parentAttachmentId: "label-1" },
        { id: "terminal-2", parentAttachmentId: null },
      ],
    },
    updatedAt: "before",
  };

  const next = deleteAttachmentWithDescendants(
    box,
    "terminal-1",
    "2026-05-10T12:00:00.000Z"
  );

  assert.deepEqual(
    next.metadata.attachments.map((attachment) => attachment.id),
    ["terminal-2"]
  );
  assert.equal(next.updatedAt, "2026-05-10T12:00:00.000Z");
});
