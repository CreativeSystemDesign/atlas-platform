import {
  useCallback,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type CableAuthoringMode,
  type ComponentAuthoringMode,
  type InteractionSession,
  type RootSnapCandidate,
  type StudioTool,
  type WireAuthoringMode,
} from "./studio-types";
import { type BBoxPx } from "./studio-geometry";
import { handlePointerDown as handlePointerDownCore } from "./studio-pointer-handlers";
import { type AttachmentKind } from "./annotation-model";

type GroundReferenceCandidate = {
  bbox: BBoxPx;
  text: string;
  type: AttachmentKind;
};

type PagePoint = {
  x: number;
  y: number;
};

type ClientPoint = {
  clientX: number;
  clientY: number;
};

export type StudioCanvasPointerDownContext = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  tool: StudioTool;
  pan: {
    x: number;
    y: number;
  };
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  interactionRef: MutableRefObject<InteractionSession | null>;
  getPagePoint: (event: ClientPoint) => PagePoint | null;
  setConnectionPointEditor: (state: null) => void;
  setRelationNotice: (notice: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setDraftBox: (draft: BBoxPx | null) => void;
  undoLastEdit: () => void;
  addRootSnapBox: (candidate: RootSnapCandidate, source: string) => void;
  addCircuitDescriptorRoot: (candidate: RootSnapCandidate) => void;
  addPageDescriptorRoot: (candidate: RootSnapCandidate) => void;
  addWireRootLinkedToConnectionPoint: (
    selectedBox: AnnotationBox,
    selectedAttachment: AnnotationAttachment,
    candidate: RootSnapCandidate
  ) => void;
  linkExistingWireToConnectionPoint: (
    wireBox: AnnotationBox,
    ownerBox: AnnotationBox,
    connectionPoint: AnnotationAttachment
  ) => boolean;
  addGroundReferenceRootLinkedToWire: (
    wireBox: AnnotationBox,
    candidate: GroundReferenceCandidate
  ) => void;
  addAttachmentFromExisting: (
    targetBox: AnnotationBox,
    candidate: RootSnapCandidate,
    source: string
  ) => void;
  addAttachmentFromPoint: (
    box: AnnotationBox,
    point: { x: number; y: number }
  ) => void;
  extendWireGeometry: (boxId: string, segmentBox: BBoxPx) => void;
  boxesForPage: AnnotationBox[];
  resolveAttachmentCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveContinuationCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveContinuationSymbolCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveGroundReferenceCandidate: (point: { x: number; y: number }) => GroundReferenceCandidate | null;
  resolveWireSegmentCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveWireLabelObjectCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
};

export function useStudioCanvasPointerDownHandlers({
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
}: StudioCanvasPointerDownContext) {
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      handlePointerDownCore(event, {
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
    },
    [
      activeMode,
      annotationWorkspaceMode,
      componentAuthoringMode,
      wireAuthoringMode,
      cableAuthoringMode,
      addAttachmentFromExisting,
      addAttachmentFromPoint,
      addCircuitDescriptorRoot,
      addGroundReferenceRootLinkedToWire,
      addPageDescriptorRoot,
      addRootSnapBox,
      addWireRootLinkedToConnectionPoint,
      linkExistingWireToConnectionPoint,
      boxesForPage,
      extendWireGeometry,
      getPagePoint,
      pan,
      resolveAttachmentCandidate,
      resolveContinuationCandidate,
      resolveContinuationSymbolCandidate,
      resolveGroundReferenceCandidate,
      resolveWireSegmentCandidate,
      resolveWireLabelObjectCandidate,
      selectedAttachment,
      selectedBox,
      setConnectionPointEditor,
      setDraftBox,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      tool,
      undoLastEdit,
      interactionRef,
    ]
  );

  return {
    handlePointerDown,
  };
}
