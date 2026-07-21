"use client";

import type { Dispatch, SetStateAction } from "react";

import {
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type ConnectionPointEditorState,
} from "./studio-types";
import { type OverlayLabelTarget } from "./overlay-label-layout";
import { type WorkspaceAttachmentEditorTarget, type WorkspaceBoxHandlers } from "./studio-workspace-stage";
import { type RelationshipHighlightMap } from "./relationship-highlight";
import type { DatasetClassHighlight } from "./dataset-class-tracker";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import { StudioWorkspaceAnnotationBoxList } from "./studio-workspace-annotation-box-list";
import { StudioWorkspaceConnectionPointOverlay } from "./studio-workspace-connection-point-overlay";

type AnnotationLayerProps = {
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
  onAttachPointerMenuToggle: (boxId: string, attachmentId: string) => void;
  onAttachTypeChange: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  onRootPointerMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
};

export function StudioWorkspaceAnnotationLayer({
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
  boxHandlers,
  onAttachPointerMenuToggle,
  onAttachTypeChange,
  onRootPointerMenuToggle,
  onRootTypeChange,
}: AnnotationLayerProps) {
  return (
    <div className="absolute inset-0">
      <StudioWorkspaceAnnotationBoxList
        annotationWorkspaceMode={annotationWorkspaceMode}
        zoom={zoom}
        activeMode={activeMode}
        selectedBoxId={selectedBoxId}
        yoloBulkSelectedBoxIds={yoloBulkSelectedBoxIds}
        selectedAttachmentId={selectedAttachmentId}
        boxesForPage={boxesForPage}
        relationshipHighlights={relationshipHighlights.rootById}
        relationshipAttachmentHighlights={relationshipHighlights.attachmentById}
        datasetClassHighlight={datasetClassHighlight}
        overlayLabels={overlayLabels}
        typeMenuAttachmentId={typeMenuAttachmentId}
        typeMenuBoxId={typeMenuBoxId}
        overlayPillsVisible={false}
        onUndo={onUndo}
        onAttachmentTypeMenuToggle={onAttachPointerMenuToggle}
        onAttachmentTypeChange={onAttachTypeChange}
        onRootTypeMenuToggle={onRootPointerMenuToggle}
        onRootTypeChange={onRootTypeChange}
        boxHandlers={boxHandlers}
      />
      {connectionPointEditor && connectionPointEditorTarget ? (
        <StudioWorkspaceConnectionPointOverlay
          connectionPointBbox={connectionPointEditorTarget.attachment.bbox}
          zoom={zoom}
          connectionPointEditorValue={connectionPointEditor.value}
          onChange={(value) =>
            setConnectionPointEditor((current) =>
              current ? { ...current, value } : current
            )
          }
          onCommit={onCommitConnectionPointEditor}
          onCancel={onCancelConnectionPointEditor}
        />
      ) : null}
    </div>
  );
}
