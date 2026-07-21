"use client";

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { RootObjectKind } from "./annotation-model";
import { type ResizeHandle } from "./annotation-styles";
import type {
  AnnotationWorkspaceMode,
  LabelCandidate,
  WireSegmentGeometry,
} from "./studio-types";
import type { AnnotationBox } from "./studio-types";
import { AnnotationRootWireOverlay } from "./annotation-root-wire-overlay";
import { AnnotationRootShapeOverlay } from "./annotation-root-shape-overlay";

type AnnotationRootOverlayProps = {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  selected: boolean;
  selectedAttachmentId: string | null;
  rootType: RootObjectKind | null | undefined;
  wireSegments: WireSegmentGeometry[];
  canEdit: boolean;
  overlayPillsVisible: boolean;
  rootHighlightClass: string;
  rootHighlightStyle: CSSProperties;
  datasetClassHighlighted: boolean;
  typeMenuBoxId: string | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, box: AnnotationBox) => void;
  onResizePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    box: AnnotationBox,
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
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
};

export function AnnotationRootOverlay({
  box,
  annotationWorkspaceMode,
  zoom,
  selected,
  selectedAttachmentId,
  rootType,
  wireSegments,
  canEdit,
  overlayPillsVisible,
  rootHighlightClass,
  rootHighlightStyle,
  datasetClassHighlighted,
  typeMenuBoxId,
  onPointerDown,
  onResizePointerDown,
  onContextMenu,
  onLabelCandidateSelect,
  onRootTypeMenuToggle,
  onRootTypeChange,
}: AnnotationRootOverlayProps) {
  const isWireRoot = rootType === "wire_segment" && wireSegments.length > 0;

  if (isWireRoot) {
    return (
      <>
        {wireSegments.map((segment, index) => (
          <AnnotationRootWireOverlay
            key={segment.id}
            box={box}
            annotationWorkspaceMode={annotationWorkspaceMode}
            segment={segment}
            index={index}
            selected={selected}
            rootType={rootType}
            canEdit={canEdit}
            zoom={zoom}
            overlayPillsVisible={overlayPillsVisible}
            rootHighlightClass={rootHighlightClass}
            rootHighlightStyle={rootHighlightStyle}
            typeMenuBoxId={typeMenuBoxId}
            onPointerDown={onPointerDown}
            onContextMenu={onContextMenu}
            onRootTypeMenuToggle={onRootTypeMenuToggle}
            onRootTypeChange={onRootTypeChange}
          />
        ))}
      </>
    );
  }

  return (
    <AnnotationRootShapeOverlay
      box={box}
      annotationWorkspaceMode={annotationWorkspaceMode}
      zoom={zoom}
      selected={selected}
      selectedAttachmentId={selectedAttachmentId}
      rootType={rootType}
      canEdit={canEdit}
      overlayPillsVisible={overlayPillsVisible}
      rootHighlightClass={rootHighlightClass}
      rootHighlightStyle={rootHighlightStyle}
      datasetClassHighlighted={datasetClassHighlighted}
      typeMenuBoxId={typeMenuBoxId}
      onPointerDown={onPointerDown}
      onResizePointerDown={onResizePointerDown}
      onContextMenu={onContextMenu}
      onLabelCandidateSelect={onLabelCandidateSelect}
      onRootTypeMenuToggle={onRootTypeMenuToggle}
      onRootTypeChange={onRootTypeChange}
    />
  );
}
