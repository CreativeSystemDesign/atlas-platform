"use client";

import type { Dispatch, SetStateAction } from "react";

import {
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type ConnectionPointEditorState,
} from "./studio-types";
import type { RelationshipHighlightMap } from "./relationship-highlight";
import type { DatasetClassHighlight } from "./dataset-class-tracker";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import { type OverlayLabelTarget } from "./overlay-label-layout";
import {
  type WorkspaceAttachmentEditorTarget,
  type WorkspaceBoxHandlers,
} from "./studio-workspace-stage";
import { StudioWorkspaceAnnotationLayer } from "./studio-workspace-annotation-layer";

type WorkspacePageAnnotationLayerProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
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
  typeMenuAttachmentId: string | null;
  typeMenuBoxId: string | null;
  onUndo: () => void;
  onCommitConnectionPointEditor: () => void;
  onCancelConnectionPointEditor: () => void;
  setConnectionPointEditor: Dispatch<
    SetStateAction<ConnectionPointEditorState | null>
  >;
  boxHandlers: WorkspaceBoxHandlers;
  onChangeRootType: (boxId: string, type: RootObjectKind) => void;
  onChangeAttachmentType: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  setSelectedBoxId: Dispatch<SetStateAction<string | null>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuBoxId: Dispatch<SetStateAction<string | null>>;
};

export function StudioWorkspacePageAnnotationLayer({
  annotationWorkspaceMode,
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
  typeMenuAttachmentId,
  typeMenuBoxId,
  onUndo,
  onCommitConnectionPointEditor,
  onCancelConnectionPointEditor,
  setConnectionPointEditor,
  onChangeRootType,
  onChangeAttachmentType,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  boxHandlers,
}: WorkspacePageAnnotationLayerProps) {
  const handleAttachmentTypeMenuToggle = (boxId: string, attachmentId: string) => {
    setSelectedBoxId(boxId);
    setSelectedAttachmentId(attachmentId);
    setTypeMenuBoxId(null);
    setTypeMenuAttachmentId((current) =>
      current === attachmentId ? null : attachmentId
    );
  };

  const handleRootTypeMenuToggle = (boxId: string) => {
    setSelectedBoxId(boxId);
    setSelectedAttachmentId(null);
    setTypeMenuAttachmentId(null);
    setTypeMenuBoxId((current) => (current === boxId ? null : boxId));
  };

  return (
    <StudioWorkspaceAnnotationLayer
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
      onAttachPointerMenuToggle={handleAttachmentTypeMenuToggle}
      onAttachTypeChange={onChangeAttachmentType}
      onRootPointerMenuToggle={handleRootTypeMenuToggle}
      onRootTypeChange={onChangeRootType}
    />
  );
}
