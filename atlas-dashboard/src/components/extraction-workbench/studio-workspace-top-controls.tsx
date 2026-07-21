"use client";

import type { AnnotationAttachment, AnnotationBox, AnnotationWorkspaceMode } from "./studio-types";
import {
  type AnnotationMode,
  type AnnotationStatus,
  type CableAuthoringMode,
  type ComponentAuthoringMode,
  type SnapStrength,
  type StudioTool,
  type WireAuthoringMode,
} from "./studio-types";
import { activeSelectionLabel } from "./studio-selection-helpers";
import { ViewportToolbar } from "./studio-toolbars";
import type {
  BBoxStrokeTarget,
  BBoxStrokeWidths,
} from "./bbox-display-controls";

type WorkspaceTopControlsProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  pageNum: number;
  zoom: number;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  tool: StudioTool;
  snapStrength: SnapStrength;
  relationNotice: string | null;
  overlayPillsVisible: boolean;
  yoloAnnotationsVisible: boolean;
  yoloHumanAnnotationsVisible: boolean;
  bboxStrokeTarget: BBoxStrokeTarget;
  bboxStrokeWidths: BBoxStrokeWidths;
  symbolBankStatus: "loading" | "ready" | "error";
  metadataStatus: "loading" | "ready" | "error";
  annotationStatus: AnnotationStatus;
  exportYolov26Url: string;
  exportGoogleObjectDetectionUrl: string;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onModeChange: (mode: AnnotationMode) => void;
  onComponentAuthoringModeChange: (mode: ComponentAuthoringMode) => void;
  onWireAuthoringModeChange: (mode: WireAuthoringMode) => void;
  onCableAuthoringModeChange: (mode: CableAuthoringMode) => void;
  onToolChange: (tool: StudioTool) => void;
  onSnapStrengthChange: (strength: SnapStrength) => void;
  onSnapSelected: () => void;
  onCycleLabelCandidate: (direction: 1 | -1) => void;
  onSavePage: () => void;
  onDetectYoloPage: () => void;
  onClearYoloPage: () => void;
  onToggleOverlayPills: () => void;
  onToggleYoloAnnotations: () => void;
  onToggleYoloHumanAnnotations: () => void;
  onBBoxStrokeTargetChange: (target: BBoxStrokeTarget) => void;
  onBBoxStrokeWidthChange: (value: number) => void;
};

export function StudioWorkspaceTopControls({
  annotationWorkspaceMode,
  pageNum,
  zoom,
  selectedBox,
  selectedAttachment,
  relationNotice,
  overlayPillsVisible,
  yoloAnnotationsVisible,
  yoloHumanAnnotationsVisible,
  bboxStrokeTarget,
  bboxStrokeWidths,
  metadataStatus,
  onPreviousPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleOverlayPills,
  onToggleYoloAnnotations,
  onToggleYoloHumanAnnotations,
  onDetectYoloPage,
  onClearYoloPage,
  onBBoxStrokeTargetChange,
  onBBoxStrokeWidthChange,
}: WorkspaceTopControlsProps) {
  const activeSelection = activeSelectionLabel(selectedBox, selectedAttachment);

  return (
    <>
      <ViewportToolbar
        annotationWorkspaceMode={annotationWorkspaceMode}
        pageNum={pageNum}
        zoom={zoom}
        metadataStatus={metadataStatus}
        activeSelectionLabel={activeSelection}
        relationNotice={relationNotice}
        overlayPillsVisible={overlayPillsVisible}
        yoloAnnotationsVisible={yoloAnnotationsVisible}
        bboxStrokeTarget={bboxStrokeTarget}
        bboxStrokeWidths={bboxStrokeWidths}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onResetView={onResetView}
        onToggleOverlayPills={onToggleOverlayPills}
        onToggleYoloAnnotations={onToggleYoloAnnotations}
        yoloHumanAnnotationsVisible={yoloHumanAnnotationsVisible}
        onToggleYoloHumanAnnotations={onToggleYoloHumanAnnotations}
        onDetectYoloPage={onDetectYoloPage}
        onClearYoloPage={onClearYoloPage}
        onBBoxStrokeTargetChange={onBBoxStrokeTargetChange}
        onBBoxStrokeWidthChange={onBBoxStrokeWidthChange}
      />
    </>
  );
}
