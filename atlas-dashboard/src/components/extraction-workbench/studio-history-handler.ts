import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { cloneSnapshot, nextHistoryPush, redoHistoryMove, undoHistoryMove } from "./studio-history";
import {
  type AnnotationBox,
  type AnnotationStatus,
} from "./studio-types";

type UseStudioHistoryOptions = {
  boxesRef: MutableRefObject<AnnotationBox[]>;
  undoStackRef: MutableRefObject<AnnotationBox[][]>;
  redoStackRef: MutableRefObject<AnnotationBox[][]>;
  setBoxes: Dispatch<SetStateAction<AnnotationBox[]>>;
  setAnnotationStatus: Dispatch<SetStateAction<AnnotationStatus>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
};

export function useStudioHistory({
  boxesRef,
  undoStackRef,
  redoStackRef,
  setBoxes,
  setAnnotationStatus,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
}: UseStudioHistoryOptions) {
  const [historyControls, setHistoryControls] = useState({
    canUndo: false,
    canRedo: false,
  });

  const refreshHistoryControls = useCallback(() => {
    setHistoryControls((current) => {
      const next = {
        canUndo: undoStackRef.current.length > 0,
        canRedo: redoStackRef.current.length > 0,
      };
      return current.canUndo === next.canUndo && current.canRedo === next.canRedo
        ? current
        : next;
    });
  }, [redoStackRef, undoStackRef]);

  const restoreSnapshot = useCallback(
    (snapshot: AnnotationBox[]) => {
      const next = cloneSnapshot(snapshot);
      setBoxes(next);
      boxesRef.current = next;
      setAnnotationStatus("dirty");
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
    },
    [boxesRef, setAnnotationStatus, setBoxes, setSelectedAttachmentId, setTypeMenuAttachmentId]
  );

  const pushHistorySnapshotFrom = useCallback(
    (snapshot: AnnotationBox[]) => {
      const next = nextHistoryPush({
        undoStack: undoStackRef.current,
        redoStack: redoStackRef.current,
        snapshot,
      });
      undoStackRef.current = next.undoStack;
      redoStackRef.current = next.redoStack;
      refreshHistoryControls();
    },
    [redoStackRef, refreshHistoryControls, undoStackRef]
  );

  const pushHistorySnapshot = useCallback(() => {
    pushHistorySnapshotFrom(boxesRef.current);
  }, [boxesRef, pushHistorySnapshotFrom]);

  const undoLastEdit = useCallback(() => {
    const next = undoHistoryMove({
      undoStack: undoStackRef.current,
      redoStack: redoStackRef.current,
      currentSnapshot: boxesRef.current,
    });
    undoStackRef.current = next.undoStack;
    redoStackRef.current = next.redoStack;
    refreshHistoryControls();
    if (!next.restoreSnapshot) return;
    restoreSnapshot(next.restoreSnapshot);
  }, [boxesRef, refreshHistoryControls, redoStackRef, restoreSnapshot, undoStackRef]);

  const redoLastEdit = useCallback(() => {
    const next = redoHistoryMove({
      undoStack: undoStackRef.current,
      redoStack: redoStackRef.current,
      currentSnapshot: boxesRef.current,
    });
    undoStackRef.current = next.undoStack;
    redoStackRef.current = next.redoStack;
    refreshHistoryControls();
    if (!next.restoreSnapshot) return;
    restoreSnapshot(next.restoreSnapshot);
  }, [boxesRef, redoStackRef, refreshHistoryControls, restoreSnapshot, undoStackRef]);

  return {
    historyControls,
    refreshHistoryControls,
    pushHistorySnapshotFrom,
    pushHistorySnapshot,
    undoLastEdit,
    redoLastEdit,
  };
}
