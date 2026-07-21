"use client";

import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import {
  datasetClassHighlightForBoxes,
  type DatasetClassHighlight,
} from "./dataset-class-tracker";
import type { ValidationIssue } from "./page-validation-issues";
import type { RelationshipTruthRow } from "./relationship-truth-rows";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { isObjectDetectionWorkspace, type AnnotationBox, type ClassTrackerEntry } from "./studio-types";
import { type WorkspacePaneProps } from "./studio-workspace-pane";
import { StudioWorkspaceInspector } from "./studio-workspace-inspector";
import { StudioWorkspacePane } from "./studio-workspace-pane";
import { StudioWorkspaceRailControls } from "./studio-workspace-rail-controls";

type ReconcileWireEndpointContacts = (
  scope?: Record<string, unknown>,
  options?: { recordHistory?: boolean },
) => void;

type UpdateBox = (
  boxId: string,
  updater: (box: AnnotationBox) => AnnotationBox,
  options?: { recordHistory?: boolean },
) => void;

export type StudioWorkspaceScreenProps = WorkspacePaneProps & {
  relationshipTruthRows: RelationshipTruthRow[];
  validationIssues: ValidationIssue[];
  symbolBankSource: string;
  wireLabelBankSource: string;
  wireLabelBankStatus: "loading" | "ready" | "error";
  wireLabelBankCount: number;
  classTrackerStatus: "loading" | "ready" | "error";
  classTrackerCounts: ClassTrackerEntry[];
  classTrackerTotal: number;
  lastSavedAt: string | null;
  exportTruthUrl: string;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setSelectedBoxId: Dispatch<SetStateAction<string | null>>;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuAttachmentId: Dispatch<SetStateAction<string | null>>;
  setTypeMenuBoxId: Dispatch<SetStateAction<string | null>>;
  onChangeRootType: (boxId: string, type: RootObjectKind) => void;
  changeSelectedAttachmentType: (type: AttachmentKind) => void;
  updateBox: UpdateBox;
  deleteSelectedBox: () => void;
  deleteSelectedAttachment: () => void;
  reconcileTouchedWireEndpointContacts: ReconcileWireEndpointContacts;
};

export function StudioWorkspaceScreen({
  relationshipTruthRows,
  validationIssues,
  symbolBankSource,
  wireLabelBankSource,
  wireLabelBankStatus,
  wireLabelBankCount,
  classTrackerStatus,
  classTrackerCounts,
  classTrackerTotal,
  lastSavedAt,
  exportTruthUrl,
  onRedo,
  canUndo,
  canRedo,
  changeSelectedAttachmentType,
  updateBox,
  deleteSelectedBox,
  deleteSelectedAttachment,
  reconcileTouchedWireEndpointContacts,
  ...workspaceProps
}: StudioWorkspaceScreenProps) {
  const [activeDatasetClassName, setActiveDatasetClassName] = useState<
    string | null
  >(null);
  const datasetClassHighlight: DatasetClassHighlight = useMemo(
    () =>
      isObjectDetectionWorkspace(workspaceProps.annotationWorkspaceMode)
        ? datasetClassHighlightForBoxes(
            workspaceProps.boxesForPage,
            activeDatasetClassName
          )
        : datasetClassHighlightForBoxes(workspaceProps.boxesForPage, null),
    [
      activeDatasetClassName,
      workspaceProps.annotationWorkspaceMode,
      workspaceProps.boxesForPage,
    ]
  );

  return (
    <>
      <StudioWorkspaceRailControls
        annotationWorkspaceMode={workspaceProps.annotationWorkspaceMode}
        activeMode={workspaceProps.activeMode}
        componentAuthoringMode={workspaceProps.componentAuthoringMode}
        wireAuthoringMode={workspaceProps.wireAuthoringMode}
        cableAuthoringMode={workspaceProps.cableAuthoringMode}
        tool={workspaceProps.tool}
        snapStrength={workspaceProps.snapStrength}
        selectedBox={workspaceProps.selectedBox}
        metadataStatus={workspaceProps.metadataStatus}
        symbolBankStatus={workspaceProps.symbolBankStatus}
        annotationStatus={workspaceProps.annotationStatus}
        exportYolov26Url={workspaceProps.exportYolov26Url}
        exportGoogleObjectDetectionUrl={workspaceProps.exportGoogleObjectDetectionUrl}
        exportQwen3vlColabDatasetUrl={workspaceProps.exportQwen3vlColabDatasetUrl}
        readOnly={workspaceProps.activeMode === "trace"}
        boxesForPage={workspaceProps.boxesForPage}
        classTrackerStatus={classTrackerStatus}
        classTrackerCounts={classTrackerCounts}
        classTrackerTotal={classTrackerTotal}
        activeDatasetClassName={activeDatasetClassName}
        onDatasetClassSelect={setActiveDatasetClassName}
        onModeChange={workspaceProps.onModeChange}
        onComponentAuthoringModeChange={workspaceProps.onComponentAuthoringModeChange}
        onWireAuthoringModeChange={workspaceProps.onWireAuthoringModeChange}
        onCableAuthoringModeChange={workspaceProps.onCableAuthoringModeChange}
        onToolChange={workspaceProps.onToolChange}
        onSnapStrengthChange={workspaceProps.onSnapStrengthChange}
        onSnapSelected={workspaceProps.onSnapSelected}
        onCycleLabelCandidate={workspaceProps.onCycleLabelCandidate}
        onSavePage={workspaceProps.onSavePage}
        onDetectYoloPage={workspaceProps.onDetectYoloPage}
        yoloTool={workspaceProps.yoloTool}
        onYoloToolChange={workspaceProps.onYoloToolChange}
        onYolov26DetectSettingsChange={workspaceProps.onYolov26DetectSettingsChange}
        yolov26DetectSettings={workspaceProps.yolov26DetectSettings}
        onClearYoloPage={workspaceProps.onClearYoloPage}
        onClearYoloAiPage={workspaceProps.onClearYoloAiPage}
        onClearYoloHumanPage={workspaceProps.onClearYoloHumanPage}
      />
      <StudioWorkspacePane
        {...workspaceProps}
        datasetClassHighlight={datasetClassHighlight}
      >
        <StudioWorkspaceInspector
          annotationWorkspaceMode={workspaceProps.annotationWorkspaceMode}
          activeMode={workspaceProps.activeMode}
          selectedBox={workspaceProps.selectedBox}
          selectedAttachment={workspaceProps.selectedAttachment}
          boxesForPage={workspaceProps.boxesForPage}
          relationshipTruthRows={relationshipTruthRows}
          validationIssues={validationIssues}
          metadataStatus={workspaceProps.metadataStatus}
          symbolBankStatus={workspaceProps.symbolBankStatus}
          symbolBankSource={symbolBankSource}
          wireLabelBankStatus={wireLabelBankStatus}
          wireLabelBankSource={wireLabelBankSource}
          wireLabelBankCount={wireLabelBankCount}
          annotationStatus={workspaceProps.annotationStatus}
          lastSavedAt={lastSavedAt}
          exportTruthUrl={exportTruthUrl}
          canUndo={canUndo}
          canRedo={canRedo}
          setSelectedBoxId={workspaceProps.setSelectedBoxId}
          setSelectedAttachmentId={workspaceProps.setSelectedAttachmentId}
          setTypeMenuAttachmentId={workspaceProps.setTypeMenuAttachmentId}
          setTypeMenuBoxId={workspaceProps.setTypeMenuBoxId}
          updateBox={updateBox}
          changeSelectedAttachmentType={changeSelectedAttachmentType}
          changeRootType={workspaceProps.onChangeRootType}
          deleteSelectedBox={deleteSelectedBox}
          deleteSelectedAttachment={deleteSelectedAttachment}
          snapSelectedBox={workspaceProps.onSnapSelected}
          cycleSelectedLabelCandidate={workspaceProps.onCycleLabelCandidate}
          undoLastEdit={workspaceProps.onUndo}
          redoLastEdit={onRedo}
          savePageAnnotations={workspaceProps.onSavePage}
          reconcileTouchedWireEndpointContacts={reconcileTouchedWireEndpointContacts}
        />
      </StudioWorkspacePane>
    </>
  );
}
