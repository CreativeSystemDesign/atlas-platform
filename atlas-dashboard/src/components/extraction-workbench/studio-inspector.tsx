"use client";

import type { AttachmentKind, RootObjectKind } from "./annotation-model";
import type { ValidationIssue } from "./page-validation-issues";
import type { RelationshipTruthRow } from "./relationship-truth-rows";
import { DatasetExportPreview } from "./studio-dataset-export-preview";
import { ActiveAnnotationPanel } from "./studio-inspector-active";
import { AnnotationListPanel } from "./studio-inspector-annotations";
import {
  InspectorStatusPanel,
  RelationReviewPanel,
} from "./studio-inspector-panels";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationStatus,
  type AnnotationWorkspaceMode,
} from "./studio-types";
import { TruthRowsPanel } from "./truth-rows-panel";
import { TruthVisualizerPanel } from "./truth-visualizer-panel";

export function StudioInspector({
  annotationWorkspaceMode,
  readOnly,
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
  onSelectBox,
  onLabelChange,
  onSnapSelected,
  onCycleLabelCandidate,
  onDeleteSelected,
  onAttachmentSelect,
  onAttachmentTypeChange,
  onRootTypeChange,
  onAttachmentDelete,
  onUndo,
  onRedo,
  onSavePage,
  onReconcileEndpointContacts,
}: {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  readOnly: boolean;
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
  onSelectBox: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
  onSnapSelected: () => void;
  onCycleLabelCandidate: (direction: 1 | -1) => void;
  onDeleteSelected: () => void;
  onAttachmentSelect: (id: string | null) => void;
  onAttachmentTypeChange: (type: AttachmentKind) => void;
  onRootTypeChange: (type: RootObjectKind) => void;
  onAttachmentDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSavePage: () => void;
  onReconcileEndpointContacts: () => void;
}) {
  if (annotationWorkspaceMode === "training_dataset") {
    return (
      <DatasetExportPreview
        boxesForPage={boxesForPage}
      />
    );
  }

  return (
    <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
      <InspectorStatusPanel
        annotationWorkspaceMode={annotationWorkspaceMode}
        readOnly={readOnly}
        boxesCount={boxesForPage.length}
        selectedBoxLabel={selectedBox?.label ?? null}
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
        onUndo={onUndo}
        onRedo={onRedo}
        onSavePage={onSavePage}
      />

      <RelationReviewPanel
        readOnly={readOnly}
        validationIssues={validationIssues}
        onReconcileEndpointContacts={onReconcileEndpointContacts}
      />

      <TruthVisualizerPanel
        truthRows={relationshipTruthRows}
      />

      {relationshipTruthRows.length > 0 ? (
        <TruthRowsPanel rows={relationshipTruthRows} />
      ) : null}

      <ActiveAnnotationPanel
        readOnly={readOnly}
        selectedBox={selectedBox}
        selectedAttachment={selectedAttachment}
        metadataStatus={metadataStatus}
        onLabelChange={onLabelChange}
        onSnapSelected={onSnapSelected}
        onCycleLabelCandidate={onCycleLabelCandidate}
        onDeleteSelected={onDeleteSelected}
        onAttachmentSelect={onAttachmentSelect}
        onAttachmentTypeChange={onAttachmentTypeChange}
        onRootTypeChange={onRootTypeChange}
        onAttachmentDelete={onAttachmentDelete}
      />

      <AnnotationListPanel
        annotationWorkspaceMode={annotationWorkspaceMode}
        boxesForPage={boxesForPage}
        selectedBoxId={selectedBox?.id ?? null}
        onSelectBox={onSelectBox}
      />
    </aside>
  );
}
