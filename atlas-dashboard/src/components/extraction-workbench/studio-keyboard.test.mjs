import assert from "node:assert/strict";
import test from "node:test";

import {
  handleStageKeyDown,
  handleWindowKeyDown,
  isTextInputEventTarget,
} from "./studio-keyboard.ts";

function createStageEvent(overrides = {}) {
  return {
    key: "Tab",
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...overrides,
  };
}

function createWindowEvent(overrides = {}) {
  return {
    key: "Tab",
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}

test("stage delete key triggers annotation deletion and consumes keyboard event", () => {
  const event = createStageEvent({
    key: "Delete",
    repeat: true,
  });
  const history = { deleteCalled: false };
  handleStageKeyDown(event, {
    canCycleHoverTargets: false,
    canCycleLabelCandidates: false,
    cycleHoverStackSelection: () => false,
    cycleSelectedLabelCandidate: () => {
      throw new Error("unexpected candidate cycle");
    },
    deleteSelectedAnnotation: (isRepeat) => {
      history.deleteCalled = isRepeat;
      return true;
    },
    redoLastEdit: () => {
      throw new Error("unexpected redo");
    },
    undoLastEdit: () => {
      throw new Error("unexpected undo");
    },
    isTextInputTarget: () => false,
  });
  assert.equal(history.deleteCalled, true);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});

test("stage tab cycles hovered overlay stack when allowed", () => {
  const event = createStageEvent({ key: "Tab", shiftKey: true });
  const history = { cycles: 0 };
  handleStageKeyDown(event, {
    canCycleHoverTargets: true,
    canCycleLabelCandidates: false,
    cycleHoverStackSelection: (direction) => {
      history.cycles += 1;
      assert.equal(direction, -1);
      return true;
    },
    cycleSelectedLabelCandidate: () => {
      throw new Error("unexpected label cycle");
    },
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {},
    undoLastEdit: () => {},
    isTextInputTarget: () => false,
  });
  assert.equal(history.cycles, 1);
  assert.equal(event.prevented, true);
});

test("stage tab cycles label candidates when no hover cycle is active", () => {
  const event = createStageEvent({ key: "Tab" });
  const history = { candidates: 0 };
  handleStageKeyDown(event, {
    canCycleHoverTargets: false,
    canCycleLabelCandidates: true,
    cycleHoverStackSelection: () => {
      throw new Error("unexpected hover cycle");
    },
    cycleSelectedLabelCandidate: (direction) => {
      history.candidates += 1;
      assert.equal(direction, 1);
    },
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {},
    undoLastEdit: () => {},
    isTextInputTarget: () => false,
  });
  assert.equal(history.candidates, 1);
  assert.equal(event.prevented, true);
});

test("stage ctrl+z and ctrl+shift+z map to undo/redo correctly", () => {
  const eventUndo = createStageEvent({ key: "z", ctrlKey: true });
  let undoCount = 0;
  let redoCount = 0;
  handleStageKeyDown(eventUndo, {
    canCycleHoverTargets: false,
    canCycleLabelCandidates: false,
    cycleHoverStackSelection: () => false,
    cycleSelectedLabelCandidate: () => {},
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {
      redoCount += 1;
    },
    undoLastEdit: () => {
      undoCount += 1;
    },
    isTextInputTarget: () => false,
  });
  const eventRedo = createStageEvent({ key: "z", ctrlKey: true, shiftKey: true });
  handleStageKeyDown(eventRedo, {
    canCycleHoverTargets: false,
    canCycleLabelCandidates: false,
    cycleHoverStackSelection: () => false,
    cycleSelectedLabelCandidate: () => {},
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {
      redoCount += 1;
    },
    undoLastEdit: () => {
      undoCount += 1;
    },
    isTextInputTarget: () => false,
  });
  assert.equal(undoCount, 1);
  assert.equal(redoCount, 1);
});

test("window keyboard shortcuts still route delete and global tab cycle", () => {
  const event = createWindowEvent({
    key: "Backspace",
  });
  const history = { deleteCalled: false, tabCycles: 0 };
  handleWindowKeyDown(event, {
    canCycleHoverTargets: true,
    canCycleLabelCandidates: false,
    isWindowTargetForGlobalCycles: true,
    cycleHoverStackSelection: (direction) => {
      history.tabCycles += 1;
      assert.equal(direction, 1);
      return true;
    },
    cycleSelectedLabelCandidate: () => {
      throw new Error("unexpected label cycle");
    },
    createConnectionPointForSelectedRoot: () => {
      throw new Error("unexpected connection point");
    },
    deleteSelectedAnnotation: (isRepeat) => {
      history.deleteCalled = isRepeat;
      return true;
    },
    redoLastEdit: () => {},
    undoLastEdit: () => {},
    isTextInputTarget: () => false,
  });
  assert.equal(history.deleteCalled, false);
  assert.equal(event.prevented, true);
});

test("window tab cycles hover stack only when global target is active", () => {
  const event = createWindowEvent({ key: "Tab" });
  const history = { tabCycles: 0 };
  handleWindowKeyDown(event, {
    canCycleHoverTargets: true,
    canCycleLabelCandidates: false,
    isWindowTargetForGlobalCycles: true,
    cycleHoverStackSelection: (direction) => {
      history.tabCycles += 1;
      assert.equal(direction, 1);
      return true;
    },
    cycleSelectedLabelCandidate: () => {
      throw new Error("unexpected label cycle");
    },
    createConnectionPointForSelectedRoot: () => {
      throw new Error("unexpected connection point");
    },
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {},
    undoLastEdit: () => {},
    isTextInputTarget: () => false,
  });
  assert.equal(event.prevented, true);
  assert.equal(history.tabCycles, 1);
});

test("window tab cycles selected label candidates when no global hover cycle is active", () => {
  const event = createWindowEvent({ key: "Tab", shiftKey: true });
  const history = { candidates: 0 };
  handleWindowKeyDown(event, {
    canCycleHoverTargets: false,
    canCycleLabelCandidates: true,
    isWindowTargetForGlobalCycles: true,
    cycleHoverStackSelection: () => {
      throw new Error("unexpected hover cycle");
    },
    cycleSelectedLabelCandidate: (direction) => {
      history.candidates += 1;
      assert.equal(direction, -1);
    },
    createConnectionPointForSelectedRoot: () => {
      throw new Error("unexpected connection point");
    },
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {},
    undoLastEdit: () => {},
    isTextInputTarget: () => false,
  });
  assert.equal(event.prevented, true);
  assert.equal(history.candidates, 1);
});

test("window shortcut c creates connection point only for non-input targets", () => {
  const event = createWindowEvent({ key: "c" });
  const history = { created: 0 };
  handleWindowKeyDown(event, {
    canCycleHoverTargets: false,
    canCycleLabelCandidates: false,
    isWindowTargetForGlobalCycles: true,
    cycleHoverStackSelection: () => false,
    cycleSelectedLabelCandidate: () => {
      throw new Error("unexpected label cycle");
    },
    createConnectionPointForSelectedRoot: () => {
      history.created += 1;
    },
    deleteSelectedAnnotation: () => false,
    redoLastEdit: () => {},
    undoLastEdit: () => {},
    isTextInputTarget: () => true,
  });
  assert.equal(history.created, 0);
});

test("window keyboard handler ignores events without a string key", () => {
  const event = createWindowEvent({ key: undefined });
  const history = { created: 0, deleted: 0, cycled: 0, undo: 0, redo: 0 };
  handleWindowKeyDown(event, {
    canCycleHoverTargets: true,
    canCycleLabelCandidates: true,
    isWindowTargetForGlobalCycles: true,
    cycleHoverStackSelection: () => {
      history.cycled += 1;
      return true;
    },
    cycleSelectedLabelCandidate: () => {
      history.cycled += 1;
    },
    createConnectionPointForSelectedRoot: () => {
      history.created += 1;
    },
    deleteSelectedAnnotation: () => {
      history.deleted += 1;
      return true;
    },
    redoLastEdit: () => {
      history.redo += 1;
    },
    undoLastEdit: () => {
      history.undo += 1;
    },
    isTextInputTarget: () => false,
  });
  assert.deepEqual(history, { created: 0, deleted: 0, cycled: 0, undo: 0, redo: 0 });
  assert.equal(event.prevented, false);
});

test("isTextInputEventTarget handles null targets", () => {
  assert.equal(isTextInputEventTarget(null), false);
});
