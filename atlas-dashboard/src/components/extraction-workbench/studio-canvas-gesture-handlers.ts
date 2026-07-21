import { useCallback, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";

import {
  finishInteraction as finishInteractionCore,
  handlePointerMove as handlePointerMoveCore,
} from "./studio-stage-handlers";
import { type BBoxPx } from "./studio-geometry";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type CableAuthoringMode,
  type ComponentAuthoringMode,
  type InteractionSession,
  type WireAuthoringMode,
} from "./studio-types";

type UpdateBox = (
  boxId: string,
  updater: (box: AnnotationBox) => AnnotationBox,
  options?: { recordHistory?: boolean }
) => void;

type UpdateAttachment = (
  boxId: string,
  attachmentId: string,
  updater: (attachment: AnnotationAttachment) => AnnotationAttachment,
  options?: { recordHistory?: boolean }
) => void;

type ReconcileTouchedContacts = (
  scope?: { wireBoxId?: string; endpointId?: string },
  options?: { recordHistory?: boolean }
) => void;

type ReconcileCableReferenceConnectionPoints = (
  options?: { recordHistory?: boolean }
) => void;

type ResolveLabelForText = (
  labelBox: BBoxPx,
  options?: { mergeLines?: boolean; mergeScale?: number }
) =>
  | {
      text: string;
      normalizedText?: string;
      bbox: BBoxPx;
      score?: number;
      overlap?: number;
      insideCenter?: boolean;
    }
  | null;

type ClientPoint = {
  clientX: number;
  clientY: number;
};

type PointerPoint = {
  x: number;
  y: number;
};

export type StudioCanvasGestureContext = {
  interactionRef: MutableRefObject<InteractionSession | null>;
  setPan: (pan: { x: number; y: number }) => void;
  setDraftBox: (draft: BBoxPx | null) => void;
  getPagePoint: (event: ClientPoint, options?: { clampToPage?: boolean }) => PointerPoint | null;
  normalizeBox: (start: PointerPoint, end: PointerPoint) => BBoxPx;
  updateCursorPosition: (event: ClientPoint) => void;
  clampBox: (box: BBoxPx) => BBoxPx;
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  updateBox: UpdateBox;
  updateAttachment: UpdateAttachment;
  addBox: (roughBox: BBoxPx, options?: { manualLabel?: string }) => void;
  addYoloManualComponentBox: (roughBox: BBoxPx) => void;
  addYoloContinuationFromPoint: (point: { x: number; y: number }) => void;
  addYoloManualContinuationBox: (roughBox: BBoxPx) => void;
  detectYolov26Area: (roi: BBoxPx) => void;
  selectYoloBulkExpandBoxes: (roi: BBoxPx) => void;
  openConnectorTerminalPrompt: (roughBox: BBoxPx) => void;
  addTerminalBlockBox: (roughBox: BBoxPx) => void;
  openComponentLabelPrompt: (roughBox: BBoxPx) => void;
  addCableSegmentBox: (roughBox: BBoxPx) => void;
  addCableReferenceBox: (roughBox: BBoxPx) => void;
  addManualWireSegmentBox: (roughBox: BBoxPx, targetBoxId?: string | null) => void;
  addAttachmentFromPoint: (box: AnnotationBox, point: { x: number; y: number }) => void;
  addCircuitDescriptorRegion: (descriptorBox: AnnotationBox, bbox: BBoxPx) => void;
  addManualAttachment: (box: AnnotationBox, bbox: BBoxPx) => void;
  resolveTextForLabelBox: ResolveLabelForText;
  reconcileTouchedWireEndpointContacts: ReconcileTouchedContacts;
  reconcileTouchedCableReferenceConnectionPoints: ReconcileCableReferenceConnectionPoints;
};

export function useStudioCanvasGestureHandlers({
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
}: StudioCanvasGestureContext) {
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      handlePointerMoveCore(event, {
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
    },
    [
      activeMode,
      componentAuthoringMode,
      wireAuthoringMode,
      cableAuthoringMode,
      addAttachmentFromPoint,
      addBox,
      addYoloManualComponentBox,
      addYoloContinuationFromPoint,
      addYoloManualContinuationBox,
      detectYolov26Area,
      selectYoloBulkExpandBoxes,
      openConnectorTerminalPrompt,
      addTerminalBlockBox,
      openComponentLabelPrompt,
      addCableReferenceBox,
      addCableSegmentBox,
      addManualWireSegmentBox,
      addCircuitDescriptorRegion,
      addManualAttachment,
      clampBox,
      getPagePoint,
      interactionRef,
      normalizeBox,
      pageNum,
      annotationWorkspaceMode,
      reconcileTouchedWireEndpointContacts,
      reconcileTouchedCableReferenceConnectionPoints,
      resolveTextForLabelBox,
      setDraftBox,
      setPan,
      updateAttachment,
      updateBox,
      updateCursorPosition,
      zoom,
      boxesRef,
    ]
  );

  const finishInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishInteractionCore(event, {
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
    },
    [
      activeMode,
      componentAuthoringMode,
      wireAuthoringMode,
      cableAuthoringMode,
      addAttachmentFromPoint,
      addBox,
      addYoloManualComponentBox,
      addYoloContinuationFromPoint,
      addYoloManualContinuationBox,
      detectYolov26Area,
      selectYoloBulkExpandBoxes,
      openConnectorTerminalPrompt,
      addTerminalBlockBox,
      openComponentLabelPrompt,
      addCableReferenceBox,
      addCableSegmentBox,
      addManualWireSegmentBox,
      addCircuitDescriptorRegion,
      addManualAttachment,
      clampBox,
      getPagePoint,
      interactionRef,
      normalizeBox,
      pageNum,
      annotationWorkspaceMode,
      reconcileTouchedWireEndpointContacts,
      reconcileTouchedCableReferenceConnectionPoints,
      resolveTextForLabelBox,
      setDraftBox,
      setPan,
      updateAttachment,
      updateBox,
      updateCursorPosition,
      zoom,
      boxesRef,
    ]
  );

  return {
    handlePointerMove,
    finishInteraction,
  };
}
