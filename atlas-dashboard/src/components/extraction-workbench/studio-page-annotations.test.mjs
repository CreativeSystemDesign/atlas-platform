import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationsForPageSave,
  replacePageAnnotations,
} from "./studio-page-annotations.ts";

test("replaces only the active page annotations and normalizes incoming payloads", () => {
  const pageEight = box("page-8", 8);
  const next = replacePageAnnotations(
    [box("old-page-7", 7), pageEight],
    7,
    [box("fresh-page-7", 99)]
  );

  assert.deepEqual(next.map((annotation) => annotation.id), [
    "page-8",
    "fresh-page-7",
  ]);
  assert.equal(next[0], pageEight);
  assert.equal(next[1].pageNum, 7);
  assert.deepEqual(next[1].metadata.physicalSizePx, {
    width: 20,
    height: 10,
    area: 200,
  });
});

test("prepares only the active page annotations for saving", () => {
  const annotations = annotationsForPageSave(
    [box("page-7", 7), box("page-8", 8)],
    7
  );

  assert.deepEqual(annotations.map((annotation) => annotation.id), ["page-7"]);
  assert.equal(annotations[0].pageNum, 7);
});

function box(id, pageNum) {
  return {
    id,
    pageNum,
    label: id,
    bbox: { x: 10, y: 20, width: 20, height: 10 },
    metadata: { attachments: [] },
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
  };
}
