"use client";

import { type Dispatch, type SetStateAction } from "react";
import type {
  AnnotationMode,
  AnnotationAttachment,
  AnnotationBox,
  AnnotationStatus,
  AnnotationWorkspaceMode,
} from "./studio-types";
import type { AttachmentKind, RootObjectKind } from "./annotation-model";
import { rootTypeOf } from "./annotation-box-helpers";
import { trainingDatasetComponentLabelBboxForManualLabel } from "./component-label-prefix";
import type { ValidationIssue } from "./page-validation-issues";
import type { RelationshipTruthRow } from "./relationship-truth-rows";
import { StudioInspector } from "./studio-inspector";

type UpdateBox = (
  boxId: string,
  updater: (box: AnnotationBox) => AnnotationBox,
  options?: {
    recordHistory?: boolean;
  }
) => void;

type WorkspaceInspectorProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  activeMode: AnnotationMode;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  boxesForPage: AnnotationBox[];
  relationshipTruthRows: RelationshipTruthRow[];
  validationIssues: ValidationIssue[];
  metadataStatus: "loading" | "ready" | "error";
  symbolBankStatus: "loading" | "ready" | "error";
  symbolBankSource: string;
  wireLabelBankStatus: "loading" | "ready" | "error";
  wireLabelBankSource: string;
  wireLabelBankCount: number;
  annotationStatus: AnnotationStatus;
  lastSavedAt: string | null;
  exportTruthUrl: string;
  canUndo: boolean;
  canRedo: boolean;
  setSelectedBoxId: Dispatch<SetStateAction<string | null>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuBoxId: Dispatch<SetStateAction<string | null>>;
  updateBox: UpdateBox;
  changeSelectedAttachmentType: (type: AttachmentKind) => void;
  changeRootType: (boxId: string, type: RootObjectKind) => void;
  deleteSelectedBox: () => void;
  deleteSelectedAttachment: () => void;
  snapSelectedBox: () => void;
  cycleSelectedLabelCandidate: (direction: 1 | -1) => void;
  undoLastEdit: () => void;
  redoLastEdit: () => void;
  savePageAnnotations: () => void;
  reconcileTouchedWireEndpointContacts: (
    scope?: Record<string, unknown>,
    options?: { recordHistory?: boolean }
  ) => void;
};

export function StudioWorkspaceInspector({
  annotationWorkspaceMode,
  activeMode,
  selectedBox,
  selectedAttachment,
  boxesForPage,
  relationshipTruthRows,
  validationIssues,
  metadataStatus,
  symbolBankStatus,
  symbolBankSource,
  wireLabelBankStatus,
  wireLabelBankSource,
  wireLabelBankCount,
  annotationStatus,
  lastSavedAt,
  exportTruthUrl,
  canUndo,
  canRedo,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  updateBox,
  changeSelectedAttachmentType,
  changeRootType,
  deleteSelectedBox,
  deleteSelectedAttachment,
  snapSelectedBox,
  cycleSelectedLabelCandidate,
  undoLastEdit,
  redoLastEdit,
  savePageAnnotations,
  reconcileTouchedWireEndpointContacts,
}: WorkspaceInspectorProps) {
  return (
    <StudioInspector
      annotationWorkspaceMode={annotationWorkspaceMode}
      readOnly={activeMode === "trace"}
      selectedBox={selectedBox}
      selectedAttachment={selectedAttachment}
      boxesForPage={boxesForPage}
      relationshipTruthRows={relationshipTruthRows}
      validationIssues={validationIssues}
      metadataStatus={metadataStatus}
      symbolBankStatus={symbolBankStatus}
      symbolBankSource={symbolBankSource}
      wireLabelBankStatus={wireLabelBankStatus}
      wireLabelBankSource={wireLabelBankSource}
      wireLabelBankCount={wireLabelBankCount}
      annotationStatus={annotationStatus}
      lastSavedAt={lastSavedAt}
      exportTruthUrl={exportTruthUrl}
      canUndo={canUndo}
      canRedo={canRedo}
      onSelectBox={(id) => {
        setSelectedBoxId(id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
      }}
      onLabelChange={(boxId, label) =>
        updateBox(
          boxId,
          (box) => {
            const labelBbox =
              annotationWorkspaceMode === "training_dataset" &&
              rootTypeOf(box) === "component"
                ? trainingDatasetComponentLabelBboxForManualLabel(box, label)
                : box.labelBbox;
            return {
              ...box,
              label,
              labelBbox,
              labelSource: "manual",
              updatedAt: new Date().toISOString(),
            };
          },
          { recordHistory: true }
        )
      }
      onSnapSelected={snapSelectedBox}
      onCycleLabelCandidate={cycleSelectedLabelCandidate}
      onDeleteSelected={deleteSelectedBox}
      onAttachmentSelect={(attachmentId) => {
        setSelectedAttachmentId(attachmentId);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
      }}
      onAttachmentTypeChange={changeSelectedAttachmentType}
      onRootTypeChange={(type) => {
        if (selectedBox) {
          changeRootType(selectedBox.id, type);
        }
      }}
      onAttachmentDelete={deleteSelectedAttachment}
      onUndo={undoLastEdit}
      onRedo={redoLastEdit}
      onSavePage={savePageAnnotations}
      onReconcileEndpointContacts={() =>
        reconcileTouchedWireEndpointContacts({}, { recordHistory: true })
      }
    />
  );
}
