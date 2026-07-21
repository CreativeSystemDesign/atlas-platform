import { useCallback, type MutableRefObject } from "react";

import { buildExistingAttachmentLinkCandidate } from "./existing-attachment-link";
import { pointAnchorBox } from "./studio-geometry";
import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type InteractionSession,
  type RootSnapCandidate,
  type StudioTool,
  CONTINUATION_LINK_ANCHOR_SIZE,
} from "./studio-types";
import { type ResizeHandle } from "./annotation-styles";
import { rootObjectTypeLabel } from "./annotation-model";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  isPrimaryAnnotationPointerActivation,
  isSecondaryPointerActivation,
} from "./studio-pointer-input";

type ClientPoint = {
  clientX: number;
  clientY: number;
};

type UpdateBox = (
  boxId: string,
  updater: (box: AnnotationBox) => AnnotationBox,
  options?: { recordHistory?: boolean }
) => void;

type StudioAttachmentHandlerContext = {
  activeMode: AnnotationMode;
  selectedBox: AnnotationBox | null;
  interactionRef: MutableRefObject<InteractionSession | null>;
  getPagePoint: (event: ClientPoint) => { x: number; y: number } | null;
  setRelationNotice: (notice: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTool: (tool: StudioTool) => void;
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

export function useStudioAttachmentPointerHandlers({
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
}: StudioAttachmentHandlerContext) {
  const handleAttachmentPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>,
      box: AnnotationBox,
      attachment: AnnotationAttachment
    ) => {
      if (isSecondaryPointerActivation(event) && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        undoLastEdit();
        return;
      }
      if (!isPrimaryAnnotationPointerActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeMode === "trace") {
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(attachment.id);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        setRelationNotice(null);
        setTool("select");
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (selectedBox && selectedBox.id !== box.id) {
          const selectedRootType = rootTypeOf(selectedBox);
          if (
            selectedRootType === "wire_segment" &&
            attachment.type === "connection_point" &&
            linkExistingWireToConnectionPoint(selectedBox, box, attachment)
          ) {
            return;
          }
          if (
            activeMode === "wire" &&
            selectedRootType !== "wire_segment" &&
            selectedRootType !== "continuation"
          ) {
            setRelationNotice(
              `Wire mode is active, but the selected root is ${rootObjectTypeLabel(rootTypeOf(selectedBox))} ${selectedBox.label}. Select the wire segment before linking terminals.`
            );
            return;
          }
          const point = getPagePoint(event);
          addAttachmentFromExisting(
            selectedBox,
            buildExistingAttachmentLinkCandidate({
              ownerBox: {
                id: box.id,
                label: box.label,
                bbox: box.bbox,
              },
              attachment: {
                id: attachment.id,
                text: attachment.text,
                type: attachment.type,
                bbox: attachment.bbox,
              },
              anchorBbox:
                selectedRootType === "continuation" && point
                  ? pointAnchorBox(point, CONTINUATION_LINK_ANCHOR_SIZE)
                  : null,
            }),
            "existing_attachment_link"
          );
          return;
        }
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(attachment.id);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      pushHistorySnapshot();
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(attachment.id);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      interactionRef.current = {
        type: "move-attachment",
        pointerId: event.pointerId,
        boxId: box.id,
        attachmentId: attachment.id,
        startX: event.clientX,
        startY: event.clientY,
        original: attachment.bbox,
      };
    },
    [
      activeMode,
      addAttachmentFromExisting,
      getPagePoint,
      interactionRef,
      linkExistingWireToConnectionPoint,
      pushHistorySnapshot,
      selectedBox,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTool,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      setRelationNotice,
      undoLastEdit,
    ]
  );

  const handleAttachmentResizePointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      box: AnnotationBox,
      attachment: AnnotationAttachment,
      handle: ResizeHandle
    ) => {
      if (isSecondaryPointerActivation(event) && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        undoLastEdit();
        return;
      }
      if (!isPrimaryAnnotationPointerActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeMode === "trace") return;
      if (event.ctrlKey || event.metaKey) {
        updateBox(
          box.id,
          (current) => ({
            ...current,
            metadata: {
              ...current.metadata,
              attachments: attachmentsOf(current).filter(
                (currentAttachment) => currentAttachment.id !== attachment.id
              ),
            },
            updatedAt: new Date().toISOString(),
          }),
          { recordHistory: true }
        );
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      pushHistorySnapshot();
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(attachment.id);
      setTypeMenuAttachmentId(null);
      interactionRef.current = {
        type: "resize-attachment",
        pointerId: event.pointerId,
        boxId: box.id,
        attachmentId: attachment.id,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        original: attachment.bbox,
      };
    },
    [
      activeMode,
      interactionRef,
      pushHistorySnapshot,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoLastEdit,
      updateBox,
    ]
  );

  return {
    handleAttachmentPointerDown,
    handleAttachmentResizePointerDown,
  };
}

export type StudioAttachmentPointerHandlersResult = ReturnType<typeof useStudioAttachmentPointerHandlers>;
