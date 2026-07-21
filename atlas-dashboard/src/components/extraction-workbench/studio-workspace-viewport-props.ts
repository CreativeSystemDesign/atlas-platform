import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";

import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type AnnotationStatus,
  type AnnotationWorkspaceMode,
  type CableAuthoringMode,
  type ComponentLabelPromptState,
  type ComponentAuthoringMode,
  type ConnectionPointEditorState,
  type ConnectorTerminalPromptState,
  type SnapStrength,
  type StudioTool,
  type WireAuthoringMode,
  type YoloTool,
  type Yolov26DetectSettings,
} from "./studio-types";
import { type HoverStackTarget, type OverlayLabelTarget } from "./overlay-label-layout";
import { type RelationshipHighlightMap } from "./relationship-highlight";
import type { DatasetClassHighlight } from "./dataset-class-tracker";
import { type WorkspaceAttachmentEditorTarget, type WorkspaceBoxHandlers, type WorkspaceStageHandlers } from "./studio-workspace-stage";

import { type BBoxPx } from "./studio-geometry";

export type PanOffset = {
  x: number;
  y: number;
};

export type PointerPoint = {
  x: number;
  y: number;
};

export type WorkspaceViewportShellProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  pageNum: number;
  zoom: number;
  pan: PanOffset;
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  tool: StudioTool;
  snapStrength: SnapStrength;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  selectedBoxId: string | null;
  yoloBulkSelectedBoxIds: string[];
  selectedAttachmentId: string | null;
  boxesForPage: AnnotationBox[];
  relationshipHighlights: RelationshipHighlightMap;
  datasetClassHighlight: DatasetClassHighlight;
  connectionPointEditor: ConnectionPointEditorState | null;
  connectorTerminalPrompt: ConnectorTerminalPromptState | null;
  componentLabelPrompt: ComponentLabelPromptState | null;
  connectionPointEditorTarget: WorkspaceAttachmentEditorTarget | null;
  overlayLabels: OverlayLabelTarget[];
  draftBox: BBoxPx | null;
  imageSrc: string;
  imageStatus: "loading" | "ready" | "error";
  cursorPx: PointerPoint | null;
  symbolBankStatus: "loading" | "ready" | "error";
  metadataStatus: "loading" | "ready" | "error";
  annotationStatus: AnnotationStatus;
  relationNotice: string | null;
  overlayPillsVisible: boolean;
  yoloAnnotationsVisible: boolean;
  yoloHumanAnnotationsVisible: boolean;
  exportYolov26Url: string;
  exportGoogleObjectDetectionUrl: string;
  exportQwen3vlColabDatasetUrl: string;
  typeMenuAttachmentId: string | null;
  typeMenuBoxId: string | null;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onModeChange: (mode: AnnotationMode) => void;
  onComponentAuthoringModeChange: (mode: ComponentAuthoringMode) => void;
  onWireAuthoringModeChange: (mode: WireAuthoringMode) => void;
  onCableAuthoringModeChange: (mode: CableAuthoringMode) => void;
  onToolChange: (tool: StudioTool) => void;
  onSnapStrengthChange: (strength: SnapStrength) => void;
  onSnapSelected: () => void;
  onCycleLabelCandidate: (direction: 1 | -1) => void;
  onSavePage: () => void;
  onDetectYoloPage: () => void;
  yoloTool: YoloTool;
  onYoloToolChange: (tool: YoloTool) => void;
  onYolov26DetectSettingsChange: (settings: Yolov26DetectSettings) => void;
  yolov26DetectSettings: Yolov26DetectSettings;
  onClearYoloPage: () => void;
  onClearYoloAiPage: () => void;
  onClearYoloHumanPage: () => void;
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
  setOverlayPillsVisible: Dispatch<SetStateAction<boolean>>;
  setYoloAnnotationsVisible: Dispatch<SetStateAction<boolean>>;
  setYoloHumanAnnotationsVisible: Dispatch<SetStateAction<boolean>>;
  setConnectionPointEditor: Dispatch<
    SetStateAction<ConnectionPointEditorState | null>
  >;
  setConnectorTerminalPrompt: Dispatch<
    SetStateAction<ConnectorTerminalPromptState | null>
  >;
  setComponentLabelPrompt: Dispatch<
    SetStateAction<ComponentLabelPromptState | null>
  >;
  onConfirmConnectorTerminalPrompt: () => void;
  onCancelConnectorTerminalPrompt: () => void;
  onConfirmComponentLabelPrompt: () => void;
  onCancelComponentLabelPrompt: () => void;
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
