import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneSnapshot,
  nextHistoryPush,
  redoHistoryMove,
  undoHistoryMove,
} from "./studio-history.ts";

test("clones snapshots so future edits cannot mutate history", () => {
  const source = [{ id: "box-1", metadata: { attachments: [{ id: "a-1" }] } }];
  const clone = cloneSnapshot(source);

  clone[0].metadata.attachments[0].id = "changed";

  assert.equal(source[0].metadata.attachments[0].id, "a-1");
});

test("pushes undo history with a bounded stack and clears redo history", () => {
  const undoStack = Array.from({ length: 41 }, (_, index) => [{ id: `box-${index}` }]);
  const redoStack = [[{ id: "redo" }]];

  const next = nextHistoryPush({ undoStack, redoStack, snapshot: [{ id: "latest" }] });

  assert.equal(next.undoStack.length, 40);
  assert.equal(next.undoStack.at(0)[0].id, "box-2");
  assert.equal(next.undoStack.at(-1)[0].id, "latest");
  assert.deepEqual(next.redoStack, []);
});

test("moves through undo and redo history while preserving current snapshots", () => {
  const current = [{ id: "current" }];
  const undoStack = [[{ id: "previous-1" }], [{ id: "previous-2" }]];
  const undone = undoHistoryMove({ undoStack, redoStack: [], currentSnapshot: current });

  assert.equal(undone.restoreSnapshot?.[0].id, "previous-2");
  assert.deepEqual(undone.undoStack.map((snapshot) => snapshot[0].id), ["previous-1"]);
  assert.deepEqual(undone.redoStack.map((snapshot) => snapshot[0].id), ["current"]);

  const redone = redoHistoryMove({
    undoStack: undone.undoStack,
    redoStack: undone.redoStack,
    currentSnapshot: undone.restoreSnapshot,
  });

  assert.equal(redone.restoreSnapshot?.[0].id, "current");
  assert.deepEqual(redone.undoStack.map((snapshot) => snapshot[0].id), [
    "previous-1",
    "previous-2",
  ]);
  assert.deepEqual(redone.redoStack, []);
});

test("noops undo and redo when there is no history to restore", () => {
  assert.deepEqual(
    undoHistoryMove({ undoStack: [], redoStack: [], currentSnapshot: [] }),
    { restoreSnapshot: null, undoStack: [], redoStack: [] }
  );
  assert.deepEqual(
    redoHistoryMove({ undoStack: [], redoStack: [], currentSnapshot: [] }),
    { restoreSnapshot: null, undoStack: [], redoStack: [] }
  );
});
