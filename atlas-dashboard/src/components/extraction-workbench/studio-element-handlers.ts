import {
  useCallback,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { attachmentKindOfRoot, rootTypeOf } from "./annotation-box-helpers";
import { componentIdentityMetadataFromSymbol } from "./component-parts-tag";
import { pointAnchorBox } from "./studio-geometry";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type InteractionSession,
  type LabelCandidate,
  type RootSnapCandidate,
  type StudioTool,
  CONTINUATION_LINK_ANCHOR_SIZE,
  isYoloWorkspace,
} from "./studio-types";
import { type ResizeHandle } from "./annotation-styles";
import { rootObjectTypeLabel } from "./annotation-model";
import { useStudioAttachmentPointerHandlers } from "./studio-attachment-pointer-handlers";
import { isPrimaryAnnotationPointerActivation } from "./studio-pointer-input";
import {
  yoloComponentDisplayLabel,
  yoloComponentLabelCandidates,
} from "./yolo-label-candidates";

type ClientPoint = {
  clientX: number;
  clientY: number;
};

type UpdateBox = (
  boxId: string,
  updater: (box: AnnotationBox) => AnnotationBox,
  options?: { recordHistory?: boolean }
) => void;

type StudioElementHandlerContext = {
  activeMode: AnnotationMode;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  interactionRef: MutableRefObject<InteractionSession | null>;
  getPagePoint: (event: ClientPoint) => { x: number; y: number } | null;
  setRelationNotice: (notice: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTool: (tool: StudioTool) => void;
  resolveLabelCandidates: (componentBox: AnnotationBox["bbox"]) => LabelCandidate[];
  addAttachmentFromExisting: (
    targetBox: AnnotationBox,
    candidate: RootSnapCandidate,
    source: string
  ) => void;
  linkExistingWireToConnectionPoint: (
    wireBox: AnnotationBox,
    ownerBox: AnnotationBox,
    connectionPoint: AnnotationAttachment
  ) => boolean;
  undoLastEdit: () => void;
  pushHistorySnapshot: () => void;
  updateBox: UpdateBox;
};

export function useStudioElementPointerHandlers({
  activeMode,
  annotationWorkspaceMode,
  selectedBox,
  selectedAttachment,
  interactionRef,
  getPagePoint,
  setRelationNotice,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTool,
  resolveLabelCandidates,
  addAttachmentFromExisting,
  linkExistingWireToConnectionPoint,
  undoLastEdit,
  pushHistorySnapshot,
  updateBox,
}: StudioElementHandlerContext) {
  const handleBoxPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, box: AnnotationBox) => {
      if (!isPrimaryAnnotationPointerActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (
        isYoloWorkspace(annotationWorkspaceMode) &&
        box.metadata.yoloCandidateMenuOpen === true
      ) {
        updateBox(
          box.id,
          (current) => ({
            ...current,
            metadata: {
              ...current.metadata,
              yoloCandidateMenuOpen: false,
            },
            updatedAt: new Date().toISOString(),
          }),
          { recordHistory: false }
        );
      }
      if (activeMode === "trace") {
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        setRelationNotice(null);
        setTool("select");
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (selectedBox && selectedBox.id !== box.id) {
          if (
            selectedAttachment?.type === "connection_point" &&
            linkExistingWireToConnectionPoint(
              box,
              selectedBox,
              selectedAttachment
            )
          ) {
            return;
          }
          if (activeMode === "wire" && rootTypeOf(selectedBox) !== "wire_segment") {
            if (rootTypeOf(box) === "wire_segment") {
              setSelectedBoxId(box.id);
              setSelectedAttachmentId(null);
              setTypeMenuAttachmentId(null);
              setTypeMenuBoxId(null);
              setRelationNotice(null);
            } else {
              setRelationNotice(
                `Wire mode is active, but the selected root is ${rootObjectTypeLabel(rootTypeOf(selectedBox))} ${selectedBox.label}. Select the wire segment before linking terminals.`
              );
            }
            return;
          }
          const point = getPagePoint(event);
          const selectedIsContinuation = rootTypeOf(selectedBox) === "continuation";
          const targetType = attachmentKindOfRoot(box);
          if (!targetType) return;
          addAttachmentFromExisting(
            selectedBox,
            {
              bbox:
                selectedIsContinuation && point
                  ? pointAnchorBox(point, CONTINUATION_LINK_ANCHOR_SIZE)
                  : box.bbox,
              text: box.label,
              type: targetType,
              linkedBoxId: box.id,
            },
            "existing_root_attachment"
          );
          return;
        }
        const point = getPagePoint(event);
        if (point) {
          event.currentTarget.setPointerCapture(event.pointerId);
          setSelectedBoxId(box.id);
          interactionRef.current = {
            type: "draw-attachment",
            pointerId: event.pointerId,
            boxId: box.id,
            start: point,
            current: point,
          };
        }
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      interactionRef.current = {
        type: "move",
        pointerId: event.pointerId,
        boxId: box.id,
        startX: event.clientX,
        startY: event.clientY,
        original: box.bbox,
      };
    },
    [
      activeMode,
      addAttachmentFromExisting,
      annotationWorkspaceMode,
      getPagePoint,
      interactionRef,
      linkExistingWireToConnectionPoint,
      selectedAttachment,
      selectedBox,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      setRelationNotice,
      setTool,
      updateBox,
    ]
  );

  const handleResizePointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      box: AnnotationBox,
      handle: ResizeHandle
    ) => {
      if (!isPrimaryAnnotationPointerActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeMode === "trace") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      interactionRef.current = {
        type: "resize",
        pointerId: event.pointerId,
        boxId: box.id,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        original: box.bbox,
      };
    },
    [
      activeMode,
      interactionRef,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
    ]
  );

  const handleLabelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, box: AnnotationBox) => {
      if (!isPrimaryAnnotationPointerActivation(event) || !box.labelBbox) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeMode === "trace") {
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        setRelationNotice(null);
        setTool("select");
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      interactionRef.current = {
        type: "move-label",
        pointerId: event.pointerId,
        boxId: box.id,
        startX: event.clientX,
        startY: event.clientY,
        original: box.labelBbox,
      };
    },
    [
      activeMode,
      interactionRef,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      setRelationNotice,
      setTool,
    ]
  );

  const handleLabelResizePointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      box: AnnotationBox,
      handle: ResizeHandle
    ) => {
      if (!isPrimaryAnnotationPointerActivation(event) || !box.labelBbox) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeMode === "trace") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      interactionRef.current = {
        type: "resize-label",
        pointerId: event.pointerId,
        boxId: box.id,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        original: box.labelBbox,
      };
    },
    [
      activeMode,
      interactionRef,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
    ]
  );

  const { handleAttachmentPointerDown, handleAttachmentResizePointerDown } =
    useStudioAttachmentPointerHandlers({
      activeMode,
      selectedBox,
      interactionRef,
      getPagePoint,
      setRelationNotice,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      setSelectedBoxId,
      setSelectedAttachmentId,
      setTool,
      addAttachmentFromExisting,
      linkExistingWireToConnectionPoint,
      undoLastEdit,
      pushHistorySnapshot,
      updateBox,
    });

  const handleBoxContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, box: AnnotationBox) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      if (isYoloWorkspace(annotationWorkspaceMode)) {
        const refreshedCandidates = yoloComponentLabelCandidates(
          resolveLabelCandidates(box.bbox),
          box.bbox
        );
        updateBox(
          box.id,
          (current) => ({
            ...current,
            labelCandidates: refreshedCandidates,
            labelCandidateIndex: nextActiveCandidateIndex(
              refreshedCandidates,
              current.label
            ),
            metadata: {
              ...current.metadata,
              yoloCandidateMenuOpen: true,
            },
            updatedAt: new Date().toISOString(),
          }),
          { recordHistory: false }
        );
        setRelationNotice(
          refreshedCandidates.length
            ? "YOLO label candidates are available on the selected bbox."
            : "No PDF vector text candidates are available for this bbox."
        );
      } else {
        setRelationNotice(null);
      }
    },
    [
      annotationWorkspaceMode,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTool,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      resolveLabelCandidates,
      updateBox,
    ]
  );

  const handleLabelCandidateSelect = useCallback(
    (box: AnnotationBox, candidate: LabelCandidate) => {
      if (!isYoloWorkspace(annotationWorkspaceMode)) {
        throw new Error("label candidate selection is only valid in YOLO workspace");
      }
      const componentIdentity = componentIdentityMetadataFromSymbol(candidate.symbol);
      updateBox(
        box.id,
        (current) => ({
          ...current,
          label: yoloComponentDisplayLabel(candidate),
          labelBbox: candidate.bbox,
          labelSource: candidate.source,
          labelCandidateIndex: 0,
          labelCandidates: [
            candidate,
            ...current.labelCandidates.filter(
              (item) => !sameLabelCandidate(item, candidate)
            ),
          ],
          metadata: {
            ...current.metadata,
            ...(componentIdentity ? { componentIdentity } : {}),
            yoloCandidateMenuOpen: false,
          },
          updatedAt: new Date().toISOString(),
        }),
        { recordHistory: true }
      );
      setRelationNotice(
        `YOLO bbox label set from PDF vector text: ${candidate.text}`
      );
    },
    [annotationWorkspaceMode, setRelationNotice, updateBox]
  );

  return {
    handleBoxPointerDown,
    handleResizePointerDown,
    handleLabelPointerDown,
    handleLabelResizePointerDown,
    handleAttachmentPointerDown,
    handleAttachmentResizePointerDown,
    handleBoxContextMenu,
    handleLabelCandidateSelect,
  };
}

function sameLabelCandidate(left: LabelCandidate, right: LabelCandidate) {
  return (
    left.source === right.source &&
    left.normalizedText === right.normalizedText &&
    left.text === right.text &&
    left.bbox.x === right.bbox.x &&
    left.bbox.y === right.bbox.y &&
    left.bbox.width === right.bbox.width &&
    left.bbox.height === right.bbox.height
  );
}

function nextActiveCandidateIndex(
  candidates: LabelCandidate[],
  currentLabel: string
) {
  if (candidates.length === 0) return -1;
  const normalizedCurrent = currentLabel.trim().toUpperCase();
  const existingIndex = candidates.findIndex(
    (candidate) =>
      yoloComponentDisplayLabel(candidate).toUpperCase() === normalizedCurrent ||
      candidate.normalizedText.toUpperCase() === normalizedCurrent
  );
  return existingIndex >= 0 ? existingIndex : 0;
}
