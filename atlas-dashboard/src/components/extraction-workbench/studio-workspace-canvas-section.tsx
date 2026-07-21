"use client";

import { useState } from "react";

import type { WorkspaceViewportShellProps } from "./studio-workspace-viewport-props";

import { StudioWorkspaceTopControls } from "./studio-workspace-top-controls";
import { StudioWorkspaceCanvasBody } from "./studio-workspace-canvas-body";
import { ConnectorTerminalPrompt } from "./connector-terminal-prompt";
import { ComponentLabelPrompt } from "./component-label-prompt";
import {
  clampBBoxStrokeWidth,
  DEFAULT_BBOX_STROKE_WIDTHS,
  type BBoxStrokeTarget,
} from "./bbox-display-controls";

type WorkspaceCanvasSectionProps = WorkspaceViewportShellProps;

export function StudioWorkspaceCanvasSection({
  annotationWorkspaceMode,
  pageNum,
  zoom,
  pan,
  activeMode,
  componentAuthoringMode,
  wireAuthoringMode,
  cableAuthoringMode,
  tool,
  snapStrength,
  selectedBox,
  selectedAttachment,
  selectedBoxId,
  yoloBulkSelectedBoxIds,
  selectedAttachmentId,
  boxesForPage,
  relationshipHighlights,
  datasetClassHighlight,
  connectionPointEditor,
  connectorTerminalPrompt,
  componentLabelPrompt,
  connectionPointEditorTarget,
  overlayLabels,
  draftBox,
  imageSrc,
  imageStatus,
  cursorPx,
  symbolBankStatus,
  metadataStatus,
  annotationStatus,
  relationNotice,
  overlayPillsVisible,
  yoloAnnotationsVisible,
  yoloHumanAnnotationsVisible,
  exportYolov26Url,
  exportGoogleObjectDetectionUrl,
  typeMenuAttachmentId,
  typeMenuBoxId,
  onPreviousPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onResetView,
  onModeChange,
  onComponentAuthoringModeChange,
  onWireAuthoringModeChange,
  onCableAuthoringModeChange,
  onToolChange,
  onSnapStrengthChange,
  onSnapSelected,
  onCycleLabelCandidate,
  onSavePage,
  onDetectYoloPage,
  onClearYoloPage,
  onUndo,
  onChangeRootType,
  onChangeAttachmentType,
  onCommitConnectionPointEditor,
  onCancelConnectionPointEditor,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setOverlayPillsVisible,
  setYoloAnnotationsVisible,
  setYoloHumanAnnotationsVisible,
  setConnectionPointEditor,
  setConnectorTerminalPrompt,
  setComponentLabelPrompt,
  onConfirmConnectorTerminalPrompt,
  onCancelConnectorTerminalPrompt,
  onConfirmComponentLabelPrompt,
  onCancelComponentLabelPrompt,
  setCursorPx,
  setHoverStack,
  hoverStackCyclingRef,
  hoverStackIndexRef,
  stageRef,
  stageHandlers,
  boxHandlers,
  onChangeImageReady,
  onChangeImageError,
}: WorkspaceCanvasSectionProps) {
  const [bboxStrokeTarget, setBBoxStrokeTarget] =
    useState<BBoxStrokeTarget>("root");
  const [bboxStrokeWidths, setBBoxStrokeWidths] = useState(
    DEFAULT_BBOX_STROKE_WIDTHS
  );

  return (
    <>
      <StudioWorkspaceTopControls
        annotationWorkspaceMode={annotationWorkspaceMode}
        pageNum={pageNum}
        zoom={zoom}
        selectedBox={selectedBox}
        selectedAttachment={selectedAttachment}
        activeMode={activeMode}
        componentAuthoringMode={componentAuthoringMode}
        wireAuthoringMode={wireAuthoringMode}
        cableAuthoringMode={cableAuthoringMode}
        tool={tool}
        snapStrength={snapStrength}
        relationNotice={relationNotice}
        overlayPillsVisible={overlayPillsVisible}
        yoloAnnotationsVisible={yoloAnnotationsVisible}
        yoloHumanAnnotationsVisible={yoloHumanAnnotationsVisible}
        bboxStrokeTarget={bboxStrokeTarget}
        bboxStrokeWidths={bboxStrokeWidths}
        symbolBankStatus={symbolBankStatus}
        metadataStatus={metadataStatus}
        annotationStatus={annotationStatus}
        exportYolov26Url={exportYolov26Url}
        exportGoogleObjectDetectionUrl={exportGoogleObjectDetectionUrl}
        onPreviousPage={onPreviousPage}
        onNextPage={onNextPage}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onResetView={onResetView}
        onModeChange={onModeChange}
        onComponentAuthoringModeChange={onComponentAuthoringModeChange}
        onWireAuthoringModeChange={onWireAuthoringModeChange}
        onCableAuthoringModeChange={onCableAuthoringModeChange}
        onToolChange={onToolChange}
        onSnapStrengthChange={onSnapStrengthChange}
        onSnapSelected={onSnapSelected}
        onCycleLabelCandidate={onCycleLabelCandidate}
        onSavePage={onSavePage}
        onDetectYoloPage={onDetectYoloPage}
        onClearYoloPage={onClearYoloPage}
        onToggleOverlayPills={() => {
          setOverlayPillsVisible((current) => !current);
          setTypeMenuAttachmentId(null);
          setTypeMenuBoxId(null);
        }}
        onToggleYoloAnnotations={() => {
          setYoloAnnotationsVisible((current) => !current);
          setTypeMenuAttachmentId(null);
          setTypeMenuBoxId(null);
        }}
        onToggleYoloHumanAnnotations={() => {
          setYoloHumanAnnotationsVisible((current) => !current);
          setTypeMenuAttachmentId(null);
          setTypeMenuBoxId(null);
        }}
        onBBoxStrokeTargetChange={setBBoxStrokeTarget}
        onBBoxStrokeWidthChange={(value) => {
          const nextWidth = clampBBoxStrokeWidth(value);
          setBBoxStrokeWidths((current) => ({
            ...current,
            [bboxStrokeTarget]: nextWidth,
          }));
        }}
      />
      <StudioWorkspaceCanvasBody
        annotationWorkspaceMode={annotationWorkspaceMode}
        bboxStrokeWidths={bboxStrokeWidths}
        pageNum={pageNum}
        pan={pan}
        zoom={zoom}
        activeMode={activeMode}
        tool={tool}
        selectedBoxId={selectedBoxId}
        yoloBulkSelectedBoxIds={yoloBulkSelectedBoxIds}
        selectedAttachmentId={selectedAttachmentId}
        boxesForPage={boxesForPage}
        relationshipHighlights={relationshipHighlights}
        datasetClassHighlight={datasetClassHighlight}
        connectionPointEditor={connectionPointEditor}
        connectionPointEditorTarget={connectionPointEditorTarget}
        overlayLabels={overlayLabels}
        draftBox={draftBox}
        imageSrc={imageSrc}
        imageStatus={imageStatus}
        cursorPx={cursorPx}
        typeMenuAttachmentId={typeMenuAttachmentId}
        typeMenuBoxId={typeMenuBoxId}
        onUndo={onUndo}
        onChangeRootType={onChangeRootType}
        onChangeAttachmentType={onChangeAttachmentType}
        onCommitConnectionPointEditor={onCommitConnectionPointEditor}
        onCancelConnectionPointEditor={onCancelConnectionPointEditor}
        setSelectedBoxId={setSelectedBoxId}
        setSelectedAttachmentId={setSelectedAttachmentId}
        setTypeMenuAttachmentId={setTypeMenuAttachmentId}
        setTypeMenuBoxId={setTypeMenuBoxId}
        setConnectionPointEditor={setConnectionPointEditor}
        setCursorPx={setCursorPx}
        setHoverStack={setHoverStack}
        hoverStackCyclingRef={hoverStackCyclingRef}
        hoverStackIndexRef={hoverStackIndexRef}
        stageRef={stageRef}
        stageHandlers={stageHandlers}
        boxHandlers={boxHandlers}
        onChangeImageReady={onChangeImageReady}
        onChangeImageError={onChangeImageError}
      />
      {connectorTerminalPrompt ? (
        <ConnectorTerminalPrompt
          value={connectorTerminalPrompt.value}
          onChange={(value) =>
            setConnectorTerminalPrompt((current) =>
              current ? { ...current, value } : current
            )
          }
          onConfirm={onConfirmConnectorTerminalPrompt}
          onCancel={onCancelConnectorTerminalPrompt}
        />
      ) : null}
      {componentLabelPrompt ? (
        <ComponentLabelPrompt
          value={componentLabelPrompt.value}
          onChange={(value) =>
            setComponentLabelPrompt((current) =>
              current ? { ...current, value } : current
            )
          }
          onConfirm={onConfirmComponentLabelPrompt}
          onCancel={onCancelComponentLabelPrompt}
        />
      ) : null}
    </>
  );
}
