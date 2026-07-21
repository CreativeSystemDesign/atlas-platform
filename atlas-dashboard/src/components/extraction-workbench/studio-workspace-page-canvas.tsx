"use client";

import type {
  Dispatch,
  SetStateAction,
} from "react";

import {
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type ConnectionPointEditorState,
} from "./studio-types";
import { type BBoxPx } from "./studio-geometry";
import { type RelationshipHighlightMap } from "./relationship-highlight";
import type { DatasetClassHighlight } from "./dataset-class-tracker";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import { type OverlayLabelTarget } from "./overlay-label-layout";
import {
  type WorkspaceBoxHandlers,
  type WorkspaceAttachmentEditorTarget,
} from "./studio-workspace-stage";
import type { BBoxStrokeWidths } from "./bbox-display-controls";
import { StudioWorkspacePageAnnotationLayer } from "./studio-workspace-page-annotation-layer";
import { StudioWorkspacePageSurface } from "./studio-workspace-page-surface";

type PanOffset = {
  x: number;
  y: number;
};

export type WorkspacePageCanvasProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  bboxStrokeWidths: BBoxStrokeWidths;
  pageNum: number;
  pan: PanOffset;
  zoom: number;
  activeMode: AnnotationMode;
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
  boxHandlers: WorkspaceBoxHandlers;
  onUndo: () => void;
  onChangeRootType: (boxId: string, type: RootObjectKind) => void;
  onChangeAttachmentType: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  onCommitConnectionPointEditor: () => void;
  onCancelConnectionPointEditor: () => void;
  setSelectedBoxId: Dispatch<SetStateAction<string | null>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuBoxId: Dispatch<SetStateAction<string | null>>;
  setConnectionPointEditor: Dispatch<
    SetStateAction<ConnectionPointEditorState | null>
  >;
  onChangeImageReady: () => void;
  onChangeImageError: () => void;
};

export function StudioWorkspacePageCanvas({
  annotationWorkspaceMode,
  bboxStrokeWidths,
  pageNum,
  pan,
  zoom,
  activeMode,
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
  boxHandlers,
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
  onChangeImageReady,
  onChangeImageError,
}: WorkspacePageCanvasProps) {
  return (
    <StudioWorkspacePageSurface
      annotationWorkspaceMode={annotationWorkspaceMode}
      bboxStrokeWidths={bboxStrokeWidths}
      pageNum={pageNum}
      pan={pan}
      zoom={zoom}
      draftBox={draftBox}
      imageSrc={imageSrc}
      imageStatus={imageStatus}
      onChangeImageReady={onChangeImageReady}
      onChangeImageError={onChangeImageError}
    >
      <StudioWorkspacePageAnnotationLayer
        annotationWorkspaceMode={annotationWorkspaceMode}
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
        typeMenuAttachmentId={typeMenuAttachmentId}
        typeMenuBoxId={typeMenuBoxId}
        onUndo={onUndo}
        onCommitConnectionPointEditor={onCommitConnectionPointEditor}
        onCancelConnectionPointEditor={onCancelConnectionPointEditor}
        setConnectionPointEditor={setConnectionPointEditor}
        boxHandlers={boxHandlers}
        onChangeAttachmentType={onChangeAttachmentType}
        onChangeRootType={onChangeRootType}
        setSelectedBoxId={setSelectedBoxId}
        setSelectedAttachmentId={setSelectedAttachmentId}
        setTypeMenuAttachmentId={setTypeMenuAttachmentId}
        setTypeMenuBoxId={setTypeMenuBoxId}
      />
    </StudioWorkspacePageSurface>
  );
}
