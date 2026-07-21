import {
  useEffect,
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useStudioCanvasHandlers } from "./studio-canvas-handlers";
import { useStudioElementPointerHandlers } from "./studio-element-handlers";
import { useStudioSelectionKeyboardHandlers } from "./studio-selection-keyboard-handlers";
import { isAnnotationControlPointerTarget } from "./annotation-control-target";
import {
  isPenEraserPointer,
  isTouchPointer,
  markPenPointer,
  shouldSuppressTouchAfterPen,
} from "./studio-pointer-input";
import { rootTypeOf } from "./annotation-box-helpers";
import { componentIdentityMetadataFromSymbol } from "./component-parts-tag";
import {
  yoloComponentDisplayLabel,
  yoloComponentLabelCandidates,
} from "./yolo-label-candidates";
import {
  beginTouchGesture,
  createTouchGestureState,
  finishTouchGesture,
  moveTouchGesture,
} from "./studio-touch-gestures";
import type {
  WorkspaceBoxHandlers,
  WorkspaceStageHandlers,
} from "./studio-workspace-stage";
import type { AnnotationBox, LabelCandidate, YoloTool } from "./studio-types";

type StudioCanvasHandlersArgs = Parameters<typeof useStudioCanvasHandlers>[0];
type StudioElementHandlersArgs = Parameters<typeof useStudioElementPointerHandlers>[0];
type StudioSelectionHandlersReturn = ReturnType<typeof useStudioSelectionKeyboardHandlers>;
type StudioSelectionHandlersArgs = Parameters<typeof useStudioSelectionKeyboardHandlers>[0];

type StudioWorkspaceInteractionDependencies = StudioCanvasHandlersArgs &
  StudioElementHandlersArgs &
  StudioSelectionHandlersArgs & {
    changePage: (delta: number) => void;
    detectDatasetRoiFromPoint: (point: { x: number; y: number }) => void;
    yoloTool: YoloTool;
    addYoloAutosnapComponentFromPoint: (point: { x: number; y: number }) => void;
    addYoloContinuationFromPoint: (point: { x: number; y: number }) => void;
    addYoloManualContinuationBox: (roughBox: { x: number; y: number; width: number; height: number }) => void;
    addYoloGroundReferenceFromPoint: (point: { x: number; y: number }) => void;
    addYoloManualComponentBox: (roughBox: { x: number; y: number; width: number; height: number }) => void;
    detectYolov26Area: (roi: { x: number; y: number; width: number; height: number }) => void;
    selectYoloBulkExpandBoxes: (roi: { x: number; y: number; width: number; height: number }) => void;
  };

type WorkspaceInteractionHandlers = {
  stageHandlers: WorkspaceStageHandlers;
  boxHandlers: WorkspaceBoxHandlers;
  handleKeyDown: StudioSelectionHandlersReturn["handleKeyDown"];
  cycleSelectedLabelCandidate: StudioSelectionHandlersReturn["cycleSelectedLabelCandidate"];
  deleteSelectedBox: StudioSelectionHandlersReturn["deleteSelectedBox"];
  deleteSelectedAttachment: StudioSelectionHandlersReturn["deleteSelectedAttachment"];
};

function boxContainsPoint(box: AnnotationBox, point: { x: number; y: number }) {
  return (
    point.x >= box.bbox.x &&
    point.x <= box.bbox.x + box.bbox.width &&
    point.y >= box.bbox.y &&
    point.y <= box.bbox.y + box.bbox.height
  );
}

function sameLabelCandidate(left: LabelCandidate, right: LabelCandidate) {
  return (
    left.normalizedText === right.normalizedText &&
    left.text === right.text &&
    left.source === right.source &&
    left.bbox.x === right.bbox.x &&
    left.bbox.y === right.bbox.y &&
    left.bbox.width === right.bbox.width &&
    left.bbox.height === right.bbox.height
  );
}

export function useStudioWorkspaceInteractionHandlers(
  dependencies: StudioWorkspaceInteractionDependencies
): WorkspaceInteractionHandlers {
  const {
    activeMode,
    componentAuthoringMode,
    wireAuthoringMode,
    cableAuthoringMode,
    annotationWorkspaceMode,
    tool,
    pan,
    selectedBox,
    selectedAttachment,
    interactionRef,
    getPagePoint,
    setConnectionPointEditor,
    setRelationNotice,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    setSelectedBoxId,
    setSelectedAttachmentId,
    setDraftBox,
    undoLastEdit,
    addRootSnapBox,
    addCircuitDescriptorRoot,
    addPageDescriptorRoot,
    addWireRootLinkedToConnectionPoint,
    linkExistingWireToConnectionPoint,
    addGroundReferenceRootLinkedToWire,
    addAttachmentFromExisting,
    extendWireGeometry,
    boxesForPage,
    resolveLabelCandidates,
    resolveAttachmentCandidate,
    resolveContinuationCandidate,
    resolveContinuationSymbolCandidate,
    resolveGroundReferenceCandidate,
    resolveWireSegmentCandidate,
    resolveWireLabelObjectCandidate,
    setPan,
    clampBox,
    normalizeBox,
    updateCursorPosition,
    getVisiblePageBox,
    pageNum,
    zoom,
    boxesRef,
    updateBox,
    updateAttachment,
    addBox,
    openConnectorTerminalPrompt,
    addTerminalBlockBox,
    openComponentLabelPrompt,
    addCableSegmentBox,
    addCableReferenceBox,
    addManualWireSegmentBox,
    addAttachmentFromPoint,
    addCircuitDescriptorRegion,
    addManualAttachment,
    resolveTextForLabelBox,
    reconcileTouchedWireEndpointContacts,
    reconcileTouchedCableReferenceConnectionPoints,
    setZoomAtClientPoint,
    selectedBoxId,
    selectedAttachmentId,
    hoverStack,
    hoverStackCyclingRef,
    hoverStackIndexRef,
    stageRef,
    setBoxes,
    setTool,
    setAnnotationStatus,
    pushHistorySnapshotFrom,
    redoLastEdit,
    pushHistorySnapshot,
    createConnectionPointForSelectedRoot,
    changePage,
    detectDatasetRoiFromPoint,
    yoloTool,
    addYoloAutosnapComponentFromPoint,
    addYoloContinuationFromPoint,
    addYoloManualContinuationBox,
    addYoloGroundReferenceFromPoint,
    addYoloManualComponentBox,
    detectYolov26Area,
    selectYoloBulkExpandBoxes,
  } = dependencies;

  const touchGestureRef = useRef(createTouchGestureState());
  const qAssistHeldRef = useRef(false);
  const lastPenPointerAtRef = useRef(0);

  useEffect(() => {
    if (annotationWorkspaceMode !== "training_dataset") {
      qAssistHeldRef.current = false;
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (typeof event.key === "string" && event.key.toLowerCase() === "q") {
        qAssistHeldRef.current = true;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (typeof event.key === "string" && event.key.toLowerCase() === "q") {
        qAssistHeldRef.current = false;
      }
    };
    const handleBlur = () => {
      qAssistHeldRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [annotationWorkspaceMode]);

  const {
    handlePointerDown,
    handlePointerMove,
    finishInteraction,
    handleWheel,
    handleStageContextMenu,
  } = useStudioCanvasHandlers({
    activeMode,
    componentAuthoringMode,
    wireAuthoringMode,
    cableAuthoringMode,
    annotationWorkspaceMode,
    tool,
    pan,
    selectedBox,
    selectedAttachment,
    interactionRef,
    getPagePoint,
    setConnectionPointEditor,
    setRelationNotice,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    setSelectedBoxId,
    setSelectedAttachmentId,
    setDraftBox,
    undoLastEdit,
    addRootSnapBox,
    addCircuitDescriptorRoot,
    addPageDescriptorRoot,
    addWireRootLinkedToConnectionPoint,
    linkExistingWireToConnectionPoint,
    addGroundReferenceRootLinkedToWire,
    addAttachmentFromExisting,
    extendWireGeometry,
    boxesForPage,
    resolveAttachmentCandidate,
    resolveContinuationCandidate,
    resolveContinuationSymbolCandidate,
    resolveGroundReferenceCandidate,
    resolveWireSegmentCandidate,
    resolveWireLabelObjectCandidate,
    setPan,
    clampBox,
    normalizeBox,
    updateCursorPosition,
    pageNum,
    zoom,
    boxesRef,
    updateBox,
    updateAttachment,
    addBox,
    addYoloManualComponentBox,
    addYoloContinuationFromPoint,
    addYoloManualContinuationBox,
    detectYolov26Area,
    selectYoloBulkExpandBoxes,
    openConnectorTerminalPrompt,
    addTerminalBlockBox,
    openComponentLabelPrompt,
    addCableSegmentBox,
    addCableReferenceBox,
    addManualWireSegmentBox,
    addAttachmentFromPoint,
    addCircuitDescriptorRegion,
    addManualAttachment,
    resolveTextForLabelBox,
    reconcileTouchedWireEndpointContacts,
    reconcileTouchedCableReferenceConnectionPoints,
    setZoomAtClientPoint,
  });

  const {
    handleBoxPointerDown,
    handleResizePointerDown,
    handleLabelPointerDown,
    handleLabelResizePointerDown,
    handleAttachmentPointerDown,
    handleAttachmentResizePointerDown,
    handleBoxContextMenu,
    handleLabelCandidateSelect,
  } = useStudioElementPointerHandlers({
    activeMode,
    annotationWorkspaceMode,
    selectedBox,
    selectedAttachment,
    interactionRef,
    getPagePoint,
    setRelationNotice,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    setSelectedAttachmentId,
    setSelectedBoxId,
    setTool,
    resolveLabelCandidates,
    addAttachmentFromExisting,
    linkExistingWireToConnectionPoint,
    undoLastEdit,
    pushHistorySnapshot,
    updateBox,
  });

  const {
    handleKeyDown,
    cycleSelectedLabelCandidate,
    deleteSelectedBox,
    deleteSelectedAttachment,
  } = useStudioSelectionKeyboardHandlers({
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
  });

  const cycleYoloBoxLabelCandidate = useCallback(
    (box: AnnotationBox, direction: 1 | -1) => {
      if (annotationWorkspaceMode !== "yolo") return false;
      if (rootTypeOf(box) !== "component") {
        setRelationNotice("Only component bboxes have YOLO label candidates.");
        return false;
      }
      const cycleCandidates = yoloComponentLabelCandidates(
        box.labelCandidates,
        box.bbox,
        { visiblePageBox: getVisiblePageBox() }
      );
      if (cycleCandidates.length < 2) {
        setRelationNotice(`No alternate label candidates for ${box.label}.`);
        return false;
      }
      const selectedCandidate =
        box.labelCandidateIndex >= 0
          ? box.labelCandidates[box.labelCandidateIndex]
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
      const candidate = cycleCandidates[nextIndex];
      const sourceCandidateIndex = box.labelCandidates.findIndex((item) =>
        sameLabelCandidate(item, candidate)
      );
      const componentIdentity = componentIdentityMetadataFromSymbol(
        candidate.symbol
      );

      setSelectedBoxId(box.id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      updateBox(
        box.id,
        (current) => ({
          ...current,
          label: yoloComponentDisplayLabel(candidate),
          labelBbox: candidate.bbox,
          labelSource: candidate.source,
          labelCandidateIndex: sourceCandidateIndex,
          metadata: {
            ...current.metadata,
            ...(componentIdentity ? { componentIdentity } : {}),
          },
          updatedAt: new Date().toISOString(),
        }),
        { recordHistory: true }
      );
      setRelationNotice(
        `YOLO label candidate selected: ${candidate.normalizedText || candidate.text}.`
      );
      return true;
    },
    [
      annotationWorkspaceMode,
      getVisiblePageBox,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
    ]
  );

  const tryHandleQAssistPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      markPenPointer(event, lastPenPointerAtRef);
      if (shouldSuppressTouchAfterPen(event, lastPenPointerAtRef)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (
        annotationWorkspaceMode !== "training_dataset" ||
        !qAssistHeldRef.current ||
        event.button !== 0 ||
        isTouchPointer(event)
      ) {
        return false;
      }
      const point = getPagePoint(event);
      if (!point) return false;

      event.preventDefault();
      event.stopPropagation();
      setDraftBox(null);
      detectDatasetRoiFromPoint(point);
      return true;
    },
    [
      annotationWorkspaceMode,
      detectDatasetRoiFromPoint,
      getPagePoint,
      setDraftBox,
    ]
  );

  const tryHandleYoloToolPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      markPenPointer(event, lastPenPointerAtRef);
      if (shouldSuppressTouchAfterPen(event, lastPenPointerAtRef)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (annotationWorkspaceMode !== "yolo" || isTouchPointer(event)) {
        return false;
      }
      if (isPenEraserPointer(event)) {
        event.preventDefault();
        event.stopPropagation();
        setDraftBox(null);
        event.currentTarget.focus();
        const point = getPagePoint(event);
        const targetBox =
          point
            ? [...boxesForPage].reverse().find((box) => boxContainsPoint(box, point))
            : null;
        const cycleTarget = targetBox ?? selectedBox;
        if (!cycleTarget) {
          setRelationNotice("No YOLO bbox selected for eraser candidate cycling.");
          return true;
        }
        cycleYoloBoxLabelCandidate(cycleTarget, event.shiftKey ? -1 : 1);
        return true;
      }
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        setDraftBox(null);
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        interactionRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: pan.x,
          originY: pan.y,
        };
        return true;
      }
      if (isAnnotationControlPointerTarget(event.target)) {
        return false;
      }
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) {
        return false;
      }
      const point = getPagePoint(event);
      if (!point) return false;

      event.preventDefault();
      event.stopPropagation();
      setDraftBox(null);
      event.currentTarget.focus();
      if (yoloTool === "continuation_symbol") {
        if (event.shiftKey) {
          addYoloGroundReferenceFromPoint(point);
        } else {
          event.currentTarget.setPointerCapture(event.pointerId);
          interactionRef.current = {
            type: "draw",
            pointerId: event.pointerId,
            start: point,
            current: point,
            source: "yolo_continuation_symbol",
          };
          setDraftBox({ x: point.x, y: point.y, width: 1, height: 1 });
        }
        return true;
      }
      if (event.shiftKey) {
        if (yoloTool !== "manual_bbox") {
          setRelationNotice(
            "YOLO autosnap only runs in Manual mode. Use Area mode to draw a focus box."
          );
          return true;
        }
        addYoloAutosnapComponentFromPoint(point);
        return true;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = {
        type: "draw",
        pointerId: event.pointerId,
        start: point,
        current: point,
        source:
          yoloTool === "detect_area"
            ? "yolo_detect_area"
            : yoloTool === "bulk_expand"
              ? "yolo_bulk_expand"
              : "yolo_manual_bbox",
      };
      setDraftBox({ x: point.x, y: point.y, width: 1, height: 1 });
      return true;
    },
    [
      addYoloAutosnapComponentFromPoint,
      addYoloContinuationFromPoint,
      addYoloManualContinuationBox,
      addYoloGroundReferenceFromPoint,
      annotationWorkspaceMode,
      boxesForPage,
      cycleYoloBoxLabelCandidate,
      getPagePoint,
      interactionRef,
      pan.x,
      pan.y,
      selectedBox,
      setDraftBox,
      setRelationNotice,
      yoloTool,
    ]
  );

  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      markPenPointer(event, lastPenPointerAtRef);
      if (shouldSuppressTouchAfterPen(event, lastPenPointerAtRef)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (tryHandleQAssistPointerDown(event)) return;
      if (tryHandleYoloToolPointerDown(event)) return;
      if (!isTouchPointer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (interactionRef.current) return;

      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);

      const result = beginTouchGesture(
        touchGestureRef.current,
        event,
        event.currentTarget.getBoundingClientRect(),
        pan
      );
      if (result.startedPan) {
        setDraftBox(null);
      }
    },
    [
      interactionRef,
      pan,
      setDraftBox,
      tryHandleQAssistPointerDown,
      tryHandleYoloToolPointerDown,
    ]
  );

  const handleTouchPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (shouldSuppressTouchAfterPen(event, lastPenPointerAtRef)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (!isTouchPointer(event)) return false;
      const state = touchGestureRef.current;
      const result = moveTouchGesture(state, event, pan);
      if (!result.handled) return false;

      event.preventDefault();
      event.stopPropagation();
      if (result.nextPan) {
        setPan(result.nextPan);
      }

      return true;
    },
    [pan, setPan]
  );

  const finishTouchPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, navigate: boolean) => {
      if (shouldSuppressTouchAfterPen(event, lastPenPointerAtRef)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return true;
      }
      if (!isTouchPointer(event)) return false;
      const result = finishTouchGesture(touchGestureRef.current, event, {
        navigate,
      });
      if (!result.handled) return false;

      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (result.pageDelta) {
        changePage(result.pageDelta);
      }

      return true;
    },
    [changePage]
  );

  const handleStagePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (handleTouchPointerMove(event)) return;
      handlePointerMove(event);
    },
    [handlePointerMove, handleTouchPointerMove]
  );

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (tryHandleQAssistPointerDown(event)) return;
      if (tryHandleYoloToolPointerDown(event)) return;
      handlePointerDown(event);
    },
    [handlePointerDown, tryHandleQAssistPointerDown, tryHandleYoloToolPointerDown]
  );

  const handleStagePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (finishTouchPointer(event, true)) return;
      finishInteraction(event);
    },
    [finishInteraction, finishTouchPointer]
  );

  const handleStagePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (finishTouchPointer(event, false)) return;
      finishInteraction(event);
    },
    [finishInteraction, finishTouchPointer]
  );

  return {
    stageHandlers: {
      onPointerDownCapture: handlePointerDownCapture,
      onPointerDown: handleStagePointerDown,
      onPointerMove: handleStagePointerMove,
      onPointerUp: handleStagePointerUp,
      onPointerCancel: handleStagePointerCancel,
      onWheel: handleWheel,
      onKeyDown: handleKeyDown,
      onContextMenu: handleStageContextMenu,
    },
    boxHandlers: {
      onPointerDown: handleBoxPointerDown,
      onResizePointerDown: handleResizePointerDown,
      onLabelPointerDown: handleLabelPointerDown,
      onLabelResizePointerDown: handleLabelResizePointerDown,
      onAttachmentPointerDown: handleAttachmentPointerDown,
      onAttachmentResizePointerDown: handleAttachmentResizePointerDown,
      onContextMenu: handleBoxContextMenu,
      onLabelCandidateSelect: handleLabelCandidateSelect,
    },
    handleKeyDown,
    cycleSelectedLabelCandidate,
    deleteSelectedBox,
    deleteSelectedAttachment,
  };
}
