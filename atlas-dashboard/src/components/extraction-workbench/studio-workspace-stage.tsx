"use client";

import type {
  Dispatch,
  SetStateAction,
  MutableRefObject,
  MouseEvent,
  PointerEvent,
  RefObject,
} from "react";

import { type BBoxPx } from "./studio-geometry";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type ConnectionPointEditorState,
  type LabelCandidate,
  type StudioTool,
} from "./studio-types";
import { type ResizeHandle } from "./annotation-styles";
import { type HoverStackTarget, type OverlayLabelTarget } from "./overlay-label-layout";
import type { RelationshipHighlightMap } from "./relationship-highlight";
import type { DatasetClassHighlight } from "./dataset-class-tracker";
import type { BBoxStrokeWidths } from "./bbox-display-controls";
import { StudioWorkspacePageCanvas } from "./studio-workspace-page-canvas";
import { StudioWorkspaceStageShell } from "./studio-workspace-stage-shell";

type PanOffset = {
  x: number;
  y: number;
};

type PointerPoint = {
  x: number;
  y: number;
};

export type WorkspaceAttachmentEditorTarget = {
  box: AnnotationBox;
  attachment: AnnotationAttachment;
};

export type WorkspaceStageHandlers = {
  onPointerDownCapture?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
};

export type WorkspaceBoxHandlers = {
  onPointerDown: (
    event: PointerEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLElement>,
    box: AnnotationBox,
    handle: ResizeHandle
  ) => void;
  onLabelPointerDown: (
    event: PointerEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onLabelResizePointerDown: (
    event: PointerEvent<HTMLElement>,
    box: AnnotationBox,
    handle: ResizeHandle
  ) => void;
  onAttachmentPointerDown: (
    event: PointerEvent<HTMLDivElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment
  ) => void;
  onAttachmentResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment,
    handle: ResizeHandle
  ) => void;
  onContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onLabelCandidateSelect: (
    box: AnnotationBox,
    candidate: LabelCandidate
  ) => void;
};

type WorkspaceStageProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  bboxStrokeWidths: BBoxStrokeWidths;
  pageNum: number;
  pan: PanOffset;
  zoom: number;
  activeMode: AnnotationMode;
  tool: StudioTool;
  selectedBoxId: string | null;
  yoloBulkSelectedBoxIds: string[];
  selectedAttachmentId: string | null;
  boxesForPage: AnnotationBox[];
  relationshipHighlights: RelationshipHighlightMap;
  datasetClassHighlight: DatasetClassHighlight;
  connectionPointEditor: ConnectionPointEditorState | null;
  connectionPointEditorTarget: WorkspaceAttachmentEditorTarget | null;
  overlayLabels: OverlayLabelTarget[];
  draftBox: BBoxPx | null;
  imageSrc: string;
  imageStatus: "loading" | "ready" | "error";
  typeMenuAttachmentId: string | null;
  typeMenuBoxId: string | null;
  setSelectedBoxId: Dispatch<SetStateAction<string | null>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuBoxId: Dispatch<SetStateAction<string | null>>;
  onUndo: () => void;
  onChangeRootType: (boxId: string, type: RootObjectKind) => void;
  onChangeAttachmentType: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  onCommitConnectionPointEditor: () => void;
  onCancelConnectionPointEditor: () => void;
  setConnectionPointEditor: Dispatch<
    SetStateAction<ConnectionPointEditorState | null>
  >;
  setCursorPx: (cursor: PointerPoint | null) => void;
  setHoverStack: (target: HoverStackTarget[]) => void;
  hoverStackCyclingRef: MutableRefObject<boolean>;
  hoverStackIndexRef: MutableRefObject<number>;
  stageRef: RefObject<HTMLDivElement | null>;
  stageHandlers: WorkspaceStageHandlers;
  boxHandlers: WorkspaceBoxHandlers;
  onChangeImageReady: () => void;
  onChangeImageError: () => void;
};

export function StudioWorkspaceStage({
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
  typeMenuAttachmentId,
  typeMenuBoxId,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  onUndo,
  onChangeRootType,
  onChangeAttachmentType,
  onCommitConnectionPointEditor,
  onCancelConnectionPointEditor,
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
}: WorkspaceStageProps) {
  return (
    <StudioWorkspaceStageShell
      tool={tool}
      activeMode={activeMode}
      stageRef={stageRef}
      onPointerDownCapture={stageHandlers.onPointerDownCapture}
      onPointerDown={stageHandlers.onPointerDown}
      onPointerMove={stageHandlers.onPointerMove}
      onPointerUp={stageHandlers.onPointerUp}
      onPointerCancel={stageHandlers.onPointerCancel}
      onWheel={stageHandlers.onWheel}
      onKeyDown={stageHandlers.onKeyDown}
      onContextMenu={stageHandlers.onContextMenu}
      setCursorPx={setCursorPx}
      setHoverStack={setHoverStack}
      hoverStackCyclingRef={hoverStackCyclingRef}
      hoverStackIndexRef={hoverStackIndexRef}
    >
      <StudioWorkspacePageCanvas
        annotationWorkspaceMode={annotationWorkspaceMode}
        bboxStrokeWidths={bboxStrokeWidths}
        pageNum={pageNum}
        pan={pan}
        zoom={zoom}
        activeMode={activeMode}
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
        onChangeImageReady={onChangeImageReady}
        onChangeImageError={onChangeImageError}
        boxHandlers={boxHandlers}
      />
    </StudioWorkspaceStageShell>
  );
}
