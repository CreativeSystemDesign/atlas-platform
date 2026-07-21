"use client";

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { RootObjectKind } from "./annotation-model";
import {
  annotationBboxStyle,
  bboxStrokeStyle,
  wireRootClass,
  wireRootShadowClass,
} from "./annotation-styles";
import { BoxEdgeHitTargets, RootTypeOverlay } from "./annotation-overlay-primitives";
import type {
  AnnotationBox,
  AnnotationWorkspaceMode,
  WireSegmentGeometry,
} from "./studio-types";

type AnnotationRootWireOverlayProps = {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  segment: WireSegmentGeometry;
  index: number;
  selected: boolean;
  rootType: RootObjectKind | null | undefined;
  canEdit: boolean;
  zoom: number;
  overlayPillsVisible: boolean;
  rootHighlightClass: string;
  rootHighlightStyle: CSSProperties;
  typeMenuBoxId: string | null;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onContextMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
};

export function AnnotationRootWireOverlay({
  box,
  annotationWorkspaceMode,
  segment,
  index,
  selected,
  rootType,
  canEdit,
  zoom,
  overlayPillsVisible,
  rootHighlightClass,
  rootHighlightStyle,
  typeMenuBoxId,
  onPointerDown,
  onContextMenu,
  onRootTypeMenuToggle,
  onRootTypeChange,
}: AnnotationRootWireOverlayProps) {
  return (
    <div
      className={`group/root pointer-events-none absolute border-2 ${
        selected ? "z-40" : rootHighlightClass ? "z-30" : "z-10"
      } ${wireRootClass(
        selected,
        rootHighlightClass,
        annotationWorkspaceMode
      )} ${wireRootShadowClass(annotationWorkspaceMode)} ${rootHighlightClass}`}
      style={{
        left: segment.bbox.x,
        top: segment.bbox.y,
        width: segment.bbox.width,
        height: segment.bbox.height,
        ...annotationBboxStyle(annotationWorkspaceMode),
        ...bboxStrokeStyle(
          annotationWorkspaceMode,
          "var(--atlas-root-bbox-width, 2px)"
        ),
        ...rootHighlightStyle,
      }}
    >
      <BoxEdgeHitTargets
        zoom={zoom}
        label="Select wire segment annotation"
        onPointerDown={(event) => onPointerDown(event, box)}
        onContextMenu={(event) => onContextMenu(event, box)}
      />
      {canEdit && index === 0 && rootType && overlayPillsVisible ? (
        <RootTypeOverlay
          boxId={box.id}
          rootType={rootType}
          zoom={zoom}
          typeMenuOpen={typeMenuBoxId === box.id}
          onRootTypeMenuToggle={onRootTypeMenuToggle}
          onRootTypeChange={onRootTypeChange}
        />
      ) : null}
    </div>
  );
}
