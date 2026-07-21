import { useCallback, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";

import { handleStageContextMenu as handleStageContextMenuCore, handleStageWheel } from "./studio-stage-handlers";
import {
  useStudioCanvasGestureHandlers,
  type StudioCanvasGestureContext,
} from "./studio-canvas-gesture-handlers";
import {
  type StudioCanvasPointerDownContext,
  useStudioCanvasPointerDownHandlers,
} from "./studio-canvas-pointer-down-handlers";

type StageWheelContext = {
  setZoomAtClientPoint: (nextZoom: number, clientPoint: { clientX: number; clientY: number }) => void;
};

type UseStudioCanvasHandlersArgs = StudioCanvasPointerDownContext &
  StudioCanvasGestureContext &
  StageWheelContext;

export function useStudioCanvasHandlers({
  activeMode,
  componentAuthoringMode,
  wireAuthoringMode,
  cableAuthoringMode,
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
  annotationWorkspaceMode,
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
}: UseStudioCanvasHandlersArgs) {
  const { handlePointerDown } = useStudioCanvasPointerDownHandlers({
    annotationWorkspaceMode,
    activeMode,
    componentAuthoringMode,
    wireAuthoringMode,
    cableAuthoringMode,
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
    addAttachmentFromPoint,
    extendWireGeometry,
    boxesForPage,
    resolveAttachmentCandidate,
    resolveContinuationCandidate,
    resolveContinuationSymbolCandidate,
    resolveGroundReferenceCandidate,
    resolveWireSegmentCandidate,
    resolveWireLabelObjectCandidate,
  });

  const { handlePointerMove, finishInteraction } = useStudioCanvasGestureHandlers({
    interactionRef,
    setPan,
    setDraftBox,
    getPagePoint,
    normalizeBox,
    updateCursorPosition,
    clampBox,
    pageNum,
    annotationWorkspaceMode,
    zoom,
    boxesRef,
    activeMode,
    componentAuthoringMode,
    wireAuthoringMode,
    cableAuthoringMode,
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
  });

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      handleStageWheel(event, {
        zoom,
        setZoomAtClientPoint,
      });
    },
    [setZoomAtClientPoint, zoom]
  );

  const handleStageContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      handleStageContextMenuCore(event, { undoLastEdit });
    },
    [undoLastEdit]
  );

  return {
    handlePointerDown,
    handlePointerMove,
    finishInteraction,
    handleWheel,
    handleStageContextMenu,
  };
}
