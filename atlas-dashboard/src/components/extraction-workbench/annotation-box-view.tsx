"use client";

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  type AttachmentKind,
  type RootObjectKind,
} from "./annotation-model";
import { type ResizeHandle } from "./annotation-styles";
import {
  attachmentsOf,
  isReferenceOnlyAttachment,
  wireSegmentsOf,
} from "./annotation-box-helpers";
import { AnnotationLabelOverlay } from "./annotation-label-overlay";
import { AnnotationRelationshipOverlay } from "./annotation-relationship-overlay";
import { AnnotationRootOverlay } from "./annotation-root-overlay";
import { AnnotationAttachmentListOverlay } from "./annotation-attachment-list-overlay";
import type { RelationshipHighlight } from "./relationship-highlight";
import {
  relationshipRootHighlightClass,
  relationshipRootHighlightStyle,
} from "./relationship-visuals";
import {
  centerOfBox,
} from "./studio-geometry";
import type {
  AnnotationAttachment,
  AnnotationBox,
  AnnotationWorkspaceMode,
  LabelCandidate,
} from "./studio-types";

export function AnnotationBoxView({
  box,
  annotationWorkspaceMode,
  zoom,
  selected,
  selectedAttachmentId,
  relationshipRootHighlight,
  relationshipAttachmentHighlights,
  datasetClassRootHighlighted,
  datasetClassLabelHighlighted,
  datasetClassAttachmentIds,
  canEdit,
  typeMenuAttachmentId,
  typeMenuBoxId,
  overlayPillsVisible,
  onPointerDown,
  onResizePointerDown,
  onLabelPointerDown,
  onLabelResizePointerDown,
  onAttachmentPointerDown,
  onAttachmentResizePointerDown,
  onContextMenu,
  onLabelCandidateSelect,
  onAttachmentContextMenu,
  onAttachmentTypeMenuToggle,
  onAttachmentTypeChange,
  onRootTypeMenuToggle,
  onRootTypeChange,
}: {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  selected: boolean;
  selectedAttachmentId: string | null;
  relationshipRootHighlight: RelationshipHighlight | null;
  relationshipAttachmentHighlights: Map<string, RelationshipHighlight>;
  datasetClassRootHighlighted: boolean;
  datasetClassLabelHighlighted: boolean;
  datasetClassAttachmentIds: Set<string>;
  canEdit: boolean;
  typeMenuAttachmentId: string | null;
  typeMenuBoxId: string | null;
  overlayPillsVisible: boolean;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onResizePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    box: AnnotationBox,
    handle: ResizeHandle
  ) => void;
  onLabelPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onLabelResizePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    box: AnnotationBox,
    handle: ResizeHandle
  ) => void;
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
  onContextMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onLabelCandidateSelect: (
    box: AnnotationBox,
    candidate: LabelCandidate
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
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
}) {
  const componentCenter = centerOfBox(box.bbox);
  const labelCenter = box.labelBbox ? centerOfBox(box.labelBbox) : null;
  const rootType = box.metadata.rootType;
  const wireSegments = wireSegmentsOf(box);
  const isWireRoot = rootType === "wire_segment" && wireSegments.length > 0;
  const rootAnchorCenter = isWireRoot ? centerOfBox(wireSegments[0].bbox) : componentCenter;
  const labelIsRootText =
    rootType === "text" ||
    rootType === "wire_label" ||
    rootType === "terminal_label" ||
    rootType === "part_number" ||
    rootType === "spec";
  const attachments = attachmentsOf(box);
  const visibleAttachments = attachments.filter(
    (attachment) => !isReferenceOnlyAttachment(attachment)
  );
  const attachmentsById = new Map(
    attachments.map((attachment) => [attachment.id, attachment])
  );
  const rootHighlightClass = relationshipRootHighlight
    ? relationshipRootHighlightClass()
    : "";
  const rootHighlightStyle =
    relationshipRootHighlightStyle(relationshipRootHighlight);

  return (
    <>
      <AnnotationRelationshipOverlay
        zoom={zoom}
        annotationWorkspaceMode={annotationWorkspaceMode}
        labelCenter={labelCenter}
        rootAnchorCenter={rootAnchorCenter}
        wireSegments={wireSegments}
        attachments={attachments}
        attachmentsById={attachmentsById}
        relationshipRootHighlight={relationshipRootHighlight}
        relationshipAttachmentHighlights={relationshipAttachmentHighlights}
      />

      <AnnotationRootOverlay
        box={box}
        annotationWorkspaceMode={annotationWorkspaceMode}
        zoom={zoom}
        selected={selected}
        selectedAttachmentId={selectedAttachmentId}
        rootType={rootType}
        wireSegments={wireSegments}
        canEdit={canEdit}
        overlayPillsVisible={overlayPillsVisible}
        rootHighlightClass={rootHighlightClass}
        rootHighlightStyle={rootHighlightStyle}
        datasetClassHighlighted={datasetClassRootHighlighted}
        typeMenuBoxId={typeMenuBoxId}
        onPointerDown={onPointerDown}
        onResizePointerDown={onResizePointerDown}
        onContextMenu={onContextMenu}
        onLabelCandidateSelect={onLabelCandidateSelect}
        onRootTypeMenuToggle={onRootTypeMenuToggle}
        onRootTypeChange={onRootTypeChange}
      />

      <AnnotationLabelOverlay
        box={box}
        annotationWorkspaceMode={annotationWorkspaceMode}
        zoom={zoom}
        selected={selected}
        selectedAttachmentId={selectedAttachmentId}
        canEdit={canEdit}
        overlayPillsVisible={overlayPillsVisible}
        labelIsRootText={labelIsRootText}
        datasetClassHighlighted={datasetClassLabelHighlighted}
        onLabelPointerDown={onLabelPointerDown}
        onLabelResizePointerDown={onLabelResizePointerDown}
      />

      <AnnotationAttachmentListOverlay
        box={box}
        annotationWorkspaceMode={annotationWorkspaceMode}
        zoom={zoom}
        selectedAttachmentId={selectedAttachmentId}
        visibleAttachments={visibleAttachments}
        canEdit={canEdit}
        overlayPillsVisible={overlayPillsVisible}
        typeMenuAttachmentId={typeMenuAttachmentId}
        relationshipAttachmentHighlights={relationshipAttachmentHighlights}
        datasetClassAttachmentIds={datasetClassAttachmentIds}
        onAttachmentPointerDown={onAttachmentPointerDown}
        onAttachmentResizePointerDown={onAttachmentResizePointerDown}
        onAttachmentContextMenu={onAttachmentContextMenu}
        onAttachmentTypeMenuToggle={onAttachmentTypeMenuToggle}
        onAttachmentTypeChange={onAttachmentTypeChange}
      />
    </>
  );
}
