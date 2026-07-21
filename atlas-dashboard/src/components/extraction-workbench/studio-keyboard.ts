type KeyboardTarget = unknown;

export type KeyboardInputPredicate = (target: KeyboardTarget | null) => boolean;

export type StudioKeyDownEvent = {
  key?: string;
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: KeyboardTarget | null;
  preventDefault: () => void;
};

export type StageKeyboardEvent = StudioKeyDownEvent & {
  stopPropagation: () => void;
};

export type WindowKeyboardEvent = StudioKeyDownEvent;

export type StudioStageKeyDownContext = {
  cycleHoverStackSelection: (direction: 1 | -1) => boolean;
  cycleSelectedLabelCandidate: (direction: 1 | -1) => void;
  deleteSelectedAnnotation: (isRepeat: boolean) => boolean;
  redoLastEdit: () => void;
  undoLastEdit: () => void;
  isTextInputTarget: KeyboardInputPredicate;
  canCycleHoverTargets: boolean;
  canCycleLabelCandidates: boolean;
};

export type StudioWindowKeyDownContext = {
  cycleHoverStackSelection: (direction: 1 | -1) => boolean;
  cycleSelectedLabelCandidate: (direction: 1 | -1) => void;
  createConnectionPointForSelectedRoot: () => void;
  deleteSelectedAnnotation: (isRepeat: boolean) => boolean;
  redoLastEdit: () => void;
  undoLastEdit: () => void;
  isTextInputTarget: KeyboardInputPredicate;
  isWindowTargetForGlobalCycles: boolean;
  canCycleHoverTargets: boolean;
  canCycleLabelCandidates: boolean;
};

export function handleStageKeyDown(
  event: StageKeyboardEvent,
  context: StudioStageKeyDownContext
) {
  const key = normalizeKeyboardKey(event.key);
  if (!key) return;
  const lowerKey = key.toLowerCase();
  if (key === "Delete" || key === "Backspace") {
    if (context.isTextInputTarget(event.target)) return;
    if (context.deleteSelectedAnnotation(event.repeat)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && lowerKey === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      context.redoLastEdit();
    } else {
      context.undoLastEdit();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && lowerKey === "y") {
    event.preventDefault();
    context.redoLastEdit();
    return;
  }
  if (
    key === "Tab" &&
    !(event.ctrlKey || event.metaKey || event.altKey) &&
    context.canCycleHoverTargets &&
    context.cycleHoverStackSelection(event.shiftKey ? -1 : 1)
  ) {
    event.preventDefault();
    return;
  }
  if (key === "Tab" && context.canCycleLabelCandidates) {
    event.preventDefault();
    event.stopPropagation();
    context.cycleSelectedLabelCandidate(event.shiftKey ? -1 : 1);
    return;
  }
}

export function handleWindowKeyDown(
  event: WindowKeyboardEvent,
  context: StudioWindowKeyDownContext
) {
  const key = normalizeKeyboardKey(event.key);
  if (!key) return;
  const lowerKey = key.toLowerCase();
  if (key === "Delete" || key === "Backspace") {
    if (context.isTextInputTarget(event.target)) return;
    if (context.deleteSelectedAnnotation(event.repeat)) {
      event.preventDefault();
      return;
    }
  }
  if (
    key === "Tab" &&
    context.isWindowTargetForGlobalCycles &&
    !(event.ctrlKey || event.metaKey || event.altKey) &&
    context.canCycleHoverTargets &&
    context.cycleHoverStackSelection(event.shiftKey ? -1 : 1)
  ) {
    event.preventDefault();
    return;
  }
  if (
    key === "Tab" &&
    !(event.ctrlKey || event.metaKey || event.altKey) &&
    context.canCycleLabelCandidates
  ) {
    event.preventDefault();
    context.cycleSelectedLabelCandidate(event.shiftKey ? -1 : 1);
    return;
  }
  if (
    lowerKey === "c" &&
    !(event.ctrlKey || event.metaKey || event.altKey) &&
    !context.isTextInputTarget(event.target)
  ) {
    event.preventDefault();
    context.createConnectionPointForSelectedRoot();
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  const shortcutKey = lowerKey;
  if (shortcutKey === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      context.redoLastEdit();
    } else {
      context.undoLastEdit();
    }
  }
  if (shortcutKey === "y") {
    event.preventDefault();
    context.redoLastEdit();
  }
}

function normalizeKeyboardKey(key: unknown) {
  return typeof key === "string" ? key : "";
}

export function isTextInputEventTarget(target: KeyboardTarget) {
  if (target === null) return false;
  const isInput =
    typeof HTMLInputElement !== "undefined" &&
    target instanceof HTMLInputElement;
  const isTextarea =
    typeof HTMLTextAreaElement !== "undefined" &&
    target instanceof HTMLTextAreaElement;
  const isSelect =
    typeof HTMLSelectElement !== "undefined" &&
    target instanceof HTMLSelectElement;
  return (
    isInput ||
    isTextarea ||
    isSelect
  );
}
