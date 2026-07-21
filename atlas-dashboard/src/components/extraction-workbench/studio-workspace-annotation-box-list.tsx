"use client";

import { AnnotationBoxView } from "./annotation-box-view";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import type {
  AnnotationBox,
  AnnotationMode,
  AnnotationWorkspaceMode,
} from "./studio-types";
import type { RelationshipHighlight } from "./relationship-highlight";
import type { DatasetClassHighlight } from "./dataset-class-tracker";
import type { OverlayLabelTarget } from "./overlay-label-layout";
import type { WorkspaceBoxHandlers } from "./studio-workspace-stage";
import { SmartOverlayLabels } from "./smart-overlay-labels";

type WorkspaceAnnotationBoxListProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  activeMode: AnnotationMode;
  selectedBoxId: string | null;
  yoloBulkSelectedBoxIds: string[];
  selectedAttachmentId: string | null;
  boxesForPage: AnnotationBox[];
  relationshipHighlights: Map<string, RelationshipHighlight>;
  relationshipAttachmentHighlights: Map<string, RelationshipHighlight>;
  datasetClassHighlight: DatasetClassHighlight;
  overlayLabels: OverlayLabelTarget[];
  typeMenuAttachmentId: string | null;
  typeMenuBoxId: string | null;
  overlayPillsVisible: boolean;
  onUndo: () => void;
  onAttachmentTypeMenuToggle: (boxId: string, attachmentId: string) => void;
  onAttachmentTypeChange: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (
    boxId: string,
    type: RootObjectKind
  ) => void;
  boxHandlers: WorkspaceBoxHandlers;
};

export function StudioWorkspaceAnnotationBoxList({
  annotationWorkspaceMode,
  zoom,
  activeMode,
  selectedBoxId,
  yoloBulkSelectedBoxIds,
  selectedAttachmentId,
  boxesForPage,
  relationshipHighlights,
  relationshipAttachmentHighlights,
  datasetClassHighlight,
  overlayLabels,
  typeMenuAttachmentId,
  typeMenuBoxId,
  overlayPillsVisible,
  onUndo,
  onAttachmentTypeMenuToggle,
  onAttachmentTypeChange,
  onRootTypeMenuToggle,
  onRootTypeChange,
  boxHandlers,
}: WorkspaceAnnotationBoxListProps) {
  return (
    <>
      {boxesForPage.map((box) => (
        <AnnotationBoxView
          key={box.id}
          box={box}
          annotationWorkspaceMode={annotationWorkspaceMode}
          zoom={zoom}
          selected={
            box.id === selectedBoxId ||
            (annotationWorkspaceMode === "yolo" &&
              yoloBulkSelectedBoxIds.includes(box.id))
          }
          selectedAttachmentId={selectedAttachmentId}
          relationshipRootHighlight={relationshipHighlights.get(box.id) ?? null}
          relationshipAttachmentHighlights={relationshipAttachmentHighlights}
          datasetClassRootHighlighted={datasetClassHighlight.rootBoxIds.has(
            box.id
          )}
          datasetClassLabelHighlighted={datasetClassHighlight.labelBoxIds.has(
            box.id
          )}
          datasetClassAttachmentIds={datasetClassHighlight.attachmentIds}
          canEdit={activeMode !== "trace"}
          typeMenuAttachmentId={typeMenuAttachmentId}
          typeMenuBoxId={typeMenuBoxId}
          overlayPillsVisible={overlayPillsVisible}
          onPointerDown={boxHandlers.onPointerDown}
          onResizePointerDown={boxHandlers.onResizePointerDown}
          onLabelPointerDown={boxHandlers.onLabelPointerDown}
          onLabelResizePointerDown={boxHandlers.onLabelResizePointerDown}
          onAttachmentPointerDown={boxHandlers.onAttachmentPointerDown}
          onAttachmentResizePointerDown={boxHandlers.onAttachmentResizePointerDown}
          onContextMenu={boxHandlers.onContextMenu}
          onLabelCandidateSelect={boxHandlers.onLabelCandidateSelect}
          onAttachmentContextMenu={(event, _box, attachment) => {
            event.preventDefault();
            event.stopPropagation();
            if (activeMode !== "trace" && (event.ctrlKey || event.metaKey)) {
              onUndo();
              return;
            }
            if (activeMode !== "trace" && attachment.type !== "wire_endpoint") {
              onAttachmentTypeMenuToggle(box.id, attachment.id);
            }
          }}
          onAttachmentTypeMenuToggle={(attachmentId) => {
            onAttachmentTypeMenuToggle(box.id, attachmentId);
          }}
          onAttachmentTypeChange={(attachmentId, type) => {
            onAttachmentTypeChange(box.id, attachmentId, type);
          }}
          onRootTypeMenuToggle={() => onRootTypeMenuToggle(box.id)}
          onRootTypeChange={(_, type) => {
            onRootTypeChange(box.id, type);
          }}
        />
      ))}
      {overlayLabels.length > 0 ? (
        <SmartOverlayLabels
          labels={overlayLabels}
          zoom={zoom}
          typeMenuAttachmentId={typeMenuAttachmentId}
          typeMenuBoxId={typeMenuBoxId}
          onRootTypeMenuToggle={onRootTypeMenuToggle}
          onRootTypeChange={onRootTypeChange}
          onAttachmentTypeMenuToggle={onAttachmentTypeMenuToggle}
          onAttachmentTypeChange={onAttachmentTypeChange}
        />
      ) : null}
    </>
  );
}
