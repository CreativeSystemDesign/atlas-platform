import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRelationshipHighlightMap,
  relationshipPathColor,
} from "./relationship-highlight.ts";

test("uses path number color for root and attachment highlights", () => {
  const highlights = buildRelationshipHighlightMap([
    row({
      id: "row-whm10-1",
      pathNumber: 1,
      label: "WHM10:1 -> wire 101K -> CT10:k",
      tone: "open",
      status: "complete",
      rootIds: ["component-whm10", "wire-101k", "component-ct10"],
      attachmentIds: ["whm10-1", "ct10-k"],
    }),
  ]);

  assert.deepEqual(highlights.rootById.get("wire-101k"), {
    rowIds: ["row-whm10-1"],
    pathNumbers: [1],
    primaryPathNumber: 1,
    color: relationshipPathColor(1),
  });
  assert.deepEqual(highlights.attachmentById.get("whm10-1"), {
    rowIds: ["row-whm10-1"],
    pathNumbers: [1],
    primaryPathNumber: 1,
    color: relationshipPathColor(1),
  });
  assert.equal("tone" in highlights.rootById.get("wire-101k"), false);
});

test("keeps every path number when an item appears in multiple rows", () => {
  const highlights = buildRelationshipHighlightMap([
    row({
      id: "row-complete",
      pathNumber: 1,
      label: "WHM10:1 -> wire 101K -> CT10:k",
      tone: "complete",
      status: "complete",
      rootIds: ["component-whm10"],
      attachmentIds: ["whm10-1"],
    }),
    row({
      id: "row-open",
      pathNumber: 2,
      label: "WHM10:2 -> open end",
      tone: "open",
      status: "open end",
      rootIds: ["component-whm10"],
      attachmentIds: ["whm10-2"],
    }),
  ]);

  assert.deepEqual(highlights.rootById.get("component-whm10"), {
    rowIds: ["row-complete", "row-open"],
    pathNumbers: [1, 2],
    primaryPathNumber: 1,
    color: relationshipPathColor(1),
  });
});

test("returns empty maps when no truth rows exist", () => {
  const highlights = buildRelationshipHighlightMap([]);

  assert.equal(highlights.rootById.size, 0);
  assert.equal(highlights.attachmentById.size, 0);
});

function row(overrides) {
  return {
    id: "row",
    pathNumber: 1,
    items: [],
    label: "",
    kind: "connection_path",
    tone: "complete",
    status: "complete",
    rootIds: [],
    attachmentIds: [],
    ...overrides,
  };
}
