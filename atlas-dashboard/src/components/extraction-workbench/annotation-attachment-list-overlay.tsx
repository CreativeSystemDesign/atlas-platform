"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { type AttachmentKind } from "./annotation-model";
import { AnnotationAttachmentOverlay } from "./annotation-attachment-overlay";
import type { RelationshipHighlight } from "./relationship-highlight";
import type {
  AnnotationAttachment,
  AnnotationBox,
  AnnotationWorkspaceMode,
} from "./studio-types";
import type { ResizeHandle } from "./annotation-styles";

type AnnotationAttachmentListOverlayProps = {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  selectedAttachmentId: string | null;
  visibleAttachments: AnnotationAttachment[];
  canEdit: boolean;
  overlayPillsVisible: boolean;
  typeMenuAttachmentId: string | null;
  relationshipAttachmentHighlights: Map<string, RelationshipHighlight>;
  datasetClassAttachmentIds: Set<string>;
  onAttachmentPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment
  ) => void;
  onAttachmentResizePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment,
    handle: ResizeHandle
  ) => void;
  onAttachmentContextMenu: (
    event:
      | ReactMouseEvent<HTMLDivElement>
      | ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment
  ) => void;
  onAttachmentTypeMenuToggle: (attachmentId: string) => void;
  onAttachmentTypeChange: (
    attachmentId: string,
    type: AttachmentKind
  ) => void;
};

export function AnnotationAttachmentListOverlay({
  box,
  annotationWorkspaceMode,
  zoom,
  selectedAttachmentId,
  visibleAttachments,
  canEdit,
  overlayPillsVisible,
  typeMenuAttachmentId,
  relationshipAttachmentHighlights,
  datasetClassAttachmentIds,
  onAttachmentPointerDown,
  onAttachmentResizePointerDown,
  onAttachmentContextMenu,
  onAttachmentTypeMenuToggle,
  onAttachmentTypeChange,
}: AnnotationAttachmentListOverlayProps) {
  return (
    <>
      {visibleAttachments.map((attachment) => {
        const attachmentHighlight =
          relationshipAttachmentHighlights.get(attachment.id) ?? null;
        return (
          <AnnotationAttachmentOverlay
            key={attachment.id}
            box={box}
            annotationWorkspaceMode={annotationWorkspaceMode}
            attachment={attachment}
            zoom={zoom}
            selected={selectedAttachmentId === attachment.id}
            canEdit={canEdit}
            overlayPillsVisible={overlayPillsVisible}
            typeMenuOpen={typeMenuAttachmentId === attachment.id}
            attachmentHighlight={attachmentHighlight}
            datasetClassHighlighted={datasetClassAttachmentIds.has(
              attachment.id
            )}
            onAttachmentPointerDown={onAttachmentPointerDown}
            onAttachmentResizePointerDown={onAttachmentResizePointerDown}
            onAttachmentContextMenu={onAttachmentContextMenu}
            onAttachmentTypeMenuToggle={onAttachmentTypeMenuToggle}
            onAttachmentTypeChange={onAttachmentTypeChange}
          />
        );
      })}
    </>
  );
}
