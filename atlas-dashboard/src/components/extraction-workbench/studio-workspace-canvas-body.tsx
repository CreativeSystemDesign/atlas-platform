"use client";

import type { WorkspaceViewportShellProps } from "./studio-workspace-viewport-props";

import { WorkspaceStatusBar } from "./studio-workspace-status";
import { StudioWorkspaceStage } from "./studio-workspace-stage";
import type { BBoxStrokeWidths } from "./bbox-display-controls";

type WorkspaceCanvasBodyProps = Pick<
  WorkspaceViewportShellProps,
  | "pageNum"
  | "annotationWorkspaceMode"
  | "pan"
  | "zoom"
  | "activeMode"
  | "tool"
  | "selectedBoxId"
  | "yoloBulkSelectedBoxIds"
  | "selectedAttachmentId"
  | "boxesForPage"
  | "relationshipHighlights"
  | "datasetClassHighlight"
  | "connectionPointEditor"
  | "connectionPointEditorTarget"
  | "overlayLabels"
  | "draftBox"
  | "imageSrc"
  | "imageStatus"
  | "cursorPx"
  | "typeMenuAttachmentId"
  | "typeMenuBoxId"
  | "onUndo"
  | "onChangeRootType"
  | "onChangeAttachmentType"
  | "onCommitConnectionPointEditor"
  | "onCancelConnectionPointEditor"
  | "setSelectedBoxId"
  | "setSelectedAttachmentId"
  | "setTypeMenuAttachmentId"
  | "setTypeMenuBoxId"
  | "setConnectionPointEditor"
  | "setCursorPx"
  | "setHoverStack"
  | "hoverStackCyclingRef"
  | "hoverStackIndexRef"
  | "stageRef"
  | "stageHandlers"
  | "boxHandlers"
  | "onChangeImageReady"
  | "onChangeImageError"
> & {
  bboxStrokeWidths: BBoxStrokeWidths;
};

export function StudioWorkspaceCanvasBody({
  annotationWorkspaceMode,
  bboxStrokeWidths,
  pageNum,
  pan,
  zoom,
  activeMode,
  tool,
  selectedBoxId,
  yoloBulkSelectedBoxIds,
  selectedAttachmentId,
  boxesForPage,
  relationshipHighlights,
  datasetClassHighlight,
  connectionPointEditor,
  connectionPointEditorTarget,
  overlayLabels,
  draftBox,
  imageSrc,
  imageStatus,
  cursorPx,
  typeMenuAttachmentId,
  typeMenuBoxId,
  onUndo,
  onChangeRootType,
  onChangeAttachmentType,
  onCommitConnectionPointEditor,
  onCancelConnectionPointEditor,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setConnectionPointEditor,
  setCursorPx,
  setHoverStack,
  hoverStackCyclingRef,
  hoverStackIndexRef,
  stageRef,
  stageHandlers,
  boxHandlers,
  onChangeImageReady,
  onChangeImageError,
}: WorkspaceCanvasBodyProps) {
  return (
    <>
      <StudioWorkspaceStage
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

      <WorkspaceStatusBar
        pageNum={pageNum}
        boxesCount={boxesForPage.length}
        cursorPx={cursorPx}
      />
    </>
  );
}
