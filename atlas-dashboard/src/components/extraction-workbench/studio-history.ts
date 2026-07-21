export type HistoryMove<Snapshot> = {
  restoreSnapshot: Snapshot | null;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
};

export function cloneSnapshot<Snapshot>(snapshot: Snapshot): Snapshot {
  return structuredClone(snapshot);
}

export function nextHistoryPush<Snapshot>(input: {
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  snapshot: Snapshot;
  maxUndoDepth?: number;
}) {
  const { undoStack, snapshot, maxUndoDepth = 40 } = input;
  return {
    undoStack: [
      ...undoStack.slice(-(maxUndoDepth - 1)),
      cloneSnapshot(snapshot),
    ],
    redoStack: [],
  };
}

export function undoHistoryMove<Snapshot>({
  undoStack,
  redoStack,
  currentSnapshot,
}: {
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  currentSnapshot: Snapshot;
}): HistoryMove<Snapshot> {
  const previous = undoStack.at(-1) ?? null;
  if (!previous) {
    return { restoreSnapshot: null, undoStack, redoStack };
  }
  return {
    restoreSnapshot: previous,
    undoStack: undoStack.slice(0, -1),
    redoStack: [...redoStack, cloneSnapshot(currentSnapshot)],
  };
}

export function redoHistoryMove<Snapshot>({
  undoStack,
  redoStack,
  currentSnapshot,
}: {
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  currentSnapshot: Snapshot;
}): HistoryMove<Snapshot> {
  const next = redoStack.at(-1) ?? null;
  if (!next) {
    return { restoreSnapshot: null, undoStack, redoStack };
  }
  return {
    restoreSnapshot: next,
    undoStack: [...undoStack, cloneSnapshot(currentSnapshot)],
    redoStack: redoStack.slice(0, -1),
  };
}
