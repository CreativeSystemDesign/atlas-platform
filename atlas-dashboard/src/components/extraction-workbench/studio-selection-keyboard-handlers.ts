import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";

import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationWorkspaceMode,
} from "./studio-types";
import { rootTypeOf } from "./annotation-box-helpers";
import { componentIdentityMetadataFromSymbol } from "./component-parts-tag";
import { toTrainingDatasetComponentLabelCandidate } from "./component-label-prefix";
import {
  yoloComponentDisplayLabel,
  yoloComponentLabelCandidates,
} from "./yolo-label-candidates";
import { deleteAttachmentWithDescendants, resolveDeleteAction } from "./selection-delete";
import {
  handleStageKeyDown,
  handleWindowKeyDown,
  isTextInputEventTarget,
} from "./studio-keyboard";
import { type HoverStackTarget } from "./overlay-label-layout";
import { type BBoxPx } from "./studio-geometry";

type UseSelectionKeyboardArgs = {
  selectedBox: AnnotationBox | null;
  selectedBoxId: string | null;
  selectedAttachment: AnnotationAttachment | null;
  selectedAttachmentId: string | null;
  hoverStack: HoverStackTarget[];
  hoverStackCyclingRef: MutableRefObject<boolean>;
  hoverStackIndexRef: MutableRefObject<number>;
  stageRef: MutableRefObject<HTMLElement | null>;
  setBoxes: (updater: (current: AnnotationBox[]) => AnnotationBox[]) => void;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setTool: (tool: "box" | "select") => void;
  setAnnotationStatus: (status: "loading" | "dirty" | "saving" | "saved" | "error") => void;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  pushHistorySnapshotFrom: (snapshot: AnnotationBox[]) => void;
  undoLastEdit: () => void;
  redoLastEdit: () => void;
  updateBox: (boxId: string, updater: (box: AnnotationBox) => AnnotationBox, options?: { recordHistory?: boolean }) => void;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  createConnectionPointForSelectedRoot: () => void;
  getVisiblePageBox: () => BBoxPx | null;
};

export function useStudioSelectionKeyboardHandlers({
  selectedBox,
  selectedBoxId,
  selectedAttachment,
  selectedAttachmentId,
  hoverStack,
  hoverStackCyclingRef,
  hoverStackIndexRef,
  stageRef,
  setBoxes,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setTool,
  setAnnotationStatus,
  boxesRef,
  pushHistorySnapshotFrom,
  undoLastEdit,
  redoLastEdit,
  updateBox,
  annotationWorkspaceMode,
  createConnectionPointForSelectedRoot,
  getVisiblePageBox,
}: UseSelectionKeyboardArgs) {
  const deleteSelectedAttachment = useCallback(() => {
    if (!selectedBox || !selectedAttachment) return;
    updateBox(
      selectedBox.id,
      (box) =>
        deleteAttachmentWithDescendants(
          box,
          selectedAttachment.id,
          new Date().toISOString()
        ),
      { recordHistory: true }
    );
    setSelectedAttachmentId(null);
    setTypeMenuAttachmentId(null);
    setTypeMenuBoxId(null);
  }, [selectedAttachment, selectedBox, updateBox, setSelectedAttachmentId, setTypeMenuAttachmentId, setTypeMenuBoxId]);

  const deleteSelectedBox = useCallback(() => {
    if (!selectedBox) return;
    setBoxes((current) => {
      pushHistorySnapshotFrom(current);
      const next = current.filter((box) => box.id !== selectedBox.id);
      boxesRef.current = next;
      return next;
    });
    setAnnotationStatus("dirty");
    setSelectedBoxId(null);
    setSelectedAttachmentId(null);
    setTypeMenuAttachmentId(null);
    setTypeMenuBoxId(null);
  }, [pushHistorySnapshotFrom, selectedBox, setBoxes, setAnnotationStatus, setSelectedAttachmentId, setSelectedBoxId, setTypeMenuAttachmentId, setTypeMenuBoxId, boxesRef]);

  const deleteSelectedAnnotation = useCallback(
    (isRepeat: boolean) => {
      const resolution = resolveDeleteAction({
        selectedBoxId,
        selectedAttachmentId,
        selectedAttachmentExists: Boolean(selectedAttachment),
        isRepeat,
      });

      if (resolution.action === "delete-attachment") {
        deleteSelectedAttachment();
      } else if (resolution.action === "clear-stale-attachment") {
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
      } else if (resolution.action === "delete-root") {
        deleteSelectedBox();
      }

      return resolution.preventDefault;
    },
    [
      selectedBoxId,
      selectedAttachmentId,
      selectedAttachment,
      deleteSelectedAttachment,
      deleteSelectedBox,
      setSelectedAttachmentId,
      setTypeMenuAttachmentId,
    ]
  );

  const cycleSelectedLabelCandidate = useCallback(
    (direction: 1 | -1) => {
      if (!selectedBox) return;
      const cycleCandidates =
        annotationWorkspaceMode === "yolo"
          ? visibleYoloLabelCandidates(selectedBox, getVisiblePageBox())
          : selectedBox.labelCandidates;
      if (cycleCandidates.length < 2) return;
      const selectedCandidate =
        selectedBox.labelCandidateIndex >= 0
          ? selectedBox.labelCandidates[selectedBox.labelCandidateIndex]
          : null;
      const selectedCycleIndex = selectedCandidate
        ? cycleCandidates.findIndex((candidate) =>
            sameLabelCandidate(candidate, selectedCandidate)
          )
        : -1;
      const nextIndex =
        selectedCycleIndex >= 0
          ? (selectedCycleIndex + direction + cycleCandidates.length) %
            cycleCandidates.length
          : direction > 0
            ? 0
            : cycleCandidates.length - 1;
      const candidate =
        annotationWorkspaceMode === "training_dataset" &&
        rootTypeOf(selectedBox) === "component"
          ? toTrainingDatasetComponentLabelCandidate(
              cycleCandidates[nextIndex]
            )
          : cycleCandidates[nextIndex];
      const sourceCandidateIndex = selectedBox.labelCandidates.findIndex(
        (item) => sameLabelCandidate(item, candidate)
      );
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      updateBox(
        selectedBox.id,
        (box) => {
          const componentIdentity = componentIdentityMetadataFromSymbol(
            candidate.symbol
          );
          return {
            ...box,
            label:
              annotationWorkspaceMode === "yolo"
                ? yoloComponentDisplayLabel(candidate)
                : candidate.normalizedText,
            labelBbox: candidate.bbox,
            labelSource: candidate.source,
            labelCandidateIndex: sourceCandidateIndex,
            metadata: {
              ...box.metadata,
              ...(annotationWorkspaceMode === "yolo" && componentIdentity
                ? { componentIdentity }
                : {}),
            },
            updatedAt: new Date().toISOString(),
          };
        },
        { recordHistory: true }
      );
    },
    [
      annotationWorkspaceMode,
      getVisiblePageBox,
      selectedBox,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
    ]
  );

  const closeSelectedYoloCandidatePicker = useCallback(() => {
    if (
      annotationWorkspaceMode !== "yolo" ||
      !selectedBox ||
      selectedBox.metadata.yoloCandidateMenuOpen !== true
    ) {
      return false;
    }
    setBoxes((current) => {
      const next = current.map((box) =>
        box.id === selectedBox.id
          ? {
              ...box,
              metadata: {
                ...box.metadata,
                yoloCandidateMenuOpen: false,
              },
              updatedAt: new Date().toISOString(),
            }
          : box
      );
      boxesRef.current = next;
      return next;
    });
    return true;
  }, [annotationWorkspaceMode, boxesRef, selectedBox, setBoxes]);

  const selectedHoverStackIndex = useCallback(
    (stack: HoverStackTarget[]) =>
      stack.findIndex((target) => {
        if (target.kind === "root") {
          return selectedBoxId === target.boxId && !selectedAttachmentId;
        }
        return (
          selectedBoxId === target.boxId &&
          selectedAttachmentId === target.attachmentId
        );
      }),
    [selectedAttachmentId, selectedBoxId]
  );

  const cycleHoverStackSelection = useCallback(
    (direction: 1 | -1) => {
      if (hoverStack.length < 2) return false;
      const selectedIndex = selectedHoverStackIndex(hoverStack);
      const baseIndex =
        selectedIndex >= 0 ? selectedIndex : hoverStackIndexRef.current;
      const nextIndex =
        baseIndex >= 0
          ? (baseIndex + direction + hoverStack.length) % hoverStack.length
          : direction > 0
            ? 0
            : hoverStack.length - 1;
      const target = hoverStack[nextIndex];
      setSelectedBoxId(target.boxId);
      setSelectedAttachmentId(
        target.kind === "attachment" ? target.attachmentId : null
      );
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      hoverStackCyclingRef.current = true;
      hoverStackIndexRef.current = nextIndex;
      return true;
    },
    [hoverStack, selectedHoverStackIndex, setSelectedBoxId, setSelectedAttachmentId, setTool, setTypeMenuAttachmentId, setTypeMenuBoxId, hoverStackCyclingRef, hoverStackIndexRef]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape" && closeSelectedYoloCandidatePicker()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handleStageKeyDown(event, {
        isTextInputTarget: isTextInputEventTarget,
        canCycleHoverTargets: !selectedBox || hoverStackCyclingRef.current,
        canCycleLabelCandidates:
          annotationWorkspaceMode === "yolo"
            ? Boolean(selectedBox)
            : (selectedBox?.labelCandidates.length ?? 0) > 0,
        cycleHoverStackSelection,
        cycleSelectedLabelCandidate,
        deleteSelectedAnnotation,
        redoLastEdit,
        undoLastEdit,
      });
    },
    [
      annotationWorkspaceMode,
      selectedBox,
      closeSelectedYoloCandidatePicker,
      cycleSelectedLabelCandidate,
      cycleHoverStackSelection,
      deleteSelectedAnnotation,
      redoLastEdit,
      undoLastEdit,
      hoverStackCyclingRef,
    ]
  );

  useEffect(() => {
    const handleWindowKeyDownEvent = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && closeSelectedYoloCandidatePicker()) {
        event.preventDefault();
        return;
      }
      handleWindowKeyDown(event, {
        isTextInputTarget: isTextInputEventTarget,
        createConnectionPointForSelectedRoot,
        canCycleHoverTargets: !selectedBox || hoverStackCyclingRef.current,
        canCycleLabelCandidates:
          annotationWorkspaceMode === "yolo"
            ? Boolean(selectedBox)
            : (selectedBox?.labelCandidates.length ?? 0) > 0,
        isWindowTargetForGlobalCycles: document.activeElement !== stageRef.current,
        cycleHoverStackSelection,
        cycleSelectedLabelCandidate,
        deleteSelectedAnnotation,
        redoLastEdit,
        undoLastEdit,
      });
    };
    window.addEventListener("keydown", handleWindowKeyDownEvent);
    return () => window.removeEventListener("keydown", handleWindowKeyDownEvent);
  }, [
    createConnectionPointForSelectedRoot,
    annotationWorkspaceMode,
    cycleSelectedLabelCandidate,
    closeSelectedYoloCandidatePicker,
    cycleHoverStackSelection,
    deleteSelectedAnnotation,
    redoLastEdit,
    selectedBox,
    undoLastEdit,
    hoverStackCyclingRef,
    stageRef,
  ]);

  return {
    deleteSelectedAnnotation,
    deleteSelectedAttachment,
    deleteSelectedBox,
    cycleSelectedLabelCandidate,
    handleKeyDown,
  };
}

function visibleYoloLabelCandidates(
  selectedBox: AnnotationBox,
  visiblePageBox: BBoxPx | null
) {
  return yoloComponentLabelCandidates(selectedBox.labelCandidates, selectedBox.bbox, {
    visiblePageBox,
  });
}

function sameLabelCandidate(left: AnnotationBox["labelCandidates"][number], right: AnnotationBox["labelCandidates"][number]) {
  return (
    left.normalizedText === right.normalizedText &&
    left.source === right.source &&
    left.symbol?.symbol === right.symbol?.symbol &&
    left.bbox.x === right.bbox.x &&
    left.bbox.y === right.bbox.y &&
    left.bbox.width === right.bbox.width &&
    left.bbox.height === right.bbox.height
  );
}
