import type { ComponentType } from "react";
import {
  Cable,
  CircleDot,
  FileText,
  GitBranch,
  Link2,
  ScanSearch,
  SquareDashedMousePointer,
  Tags,
  Type,
} from "lucide-react";

import type {
  AnnotationRelation,
  AttachmentKind,
  LegacyAnnotationRelation,
  RootObjectKind,
} from "./annotation-model.ts";
import type { ContinuationReference } from "./continuation-symbol.ts";
import type { ResizeHandle } from "./annotation-styles.ts";
import type { BBoxPx } from "./studio-geometry.ts";

export const DOCUMENT_ID = "schematic_<drawing-no>";
export const PROJECT_ID = "00000000-0000-4000-8000-000000001650";
export const DEFAULT_PAGE = 7;
export const PAGE_WIDTH_PX = 2481;
export const PAGE_HEIGHT_PX = 3509;
export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 2.4;
export const CONTINUATION_LINK_ANCHOR_SIZE = 10;
export const SNAP_PADDING_PDF = 1;

export type StudioTool = "select" | "box" | "pan";

export type YoloTool =
  | "manual_bbox"
  | "continuation_symbol"
  | "detect_page"
  | "detect_area"
  | "bulk_expand"
  | "clear_all"
  | "clear_ai"
  | "clear_human";

export type SnapStrength = "off" | "low" | "normal" | "high";

export const SNAP_STRENGTH_OPTIONS: Array<{
  id: SnapStrength;
  label: string;
  shortLabel: string;
}> = [
  { id: "off", label: "Snap off", shortLabel: "OFF" },
  { id: "low", label: "Low snap", shortLabel: "LOW" },
  { id: "normal", label: "Medium snap", shortLabel: "MED" },
  { id: "high", label: "High snap", shortLabel: "HIGH" },
];

export type WireAuthoringMode = "auto" | "manual";

export type ComponentAuthoringMode =
  | "component"
  | "component_manual_label"
  | "connector";

export type CableAuthoringMode = "geometry" | "reference";

export type AnnotationMode =
  | "component"
  | "terminal-block"
  | "terminal"
  | "wire"
  | "cable"
  | "wire-label"
  | "continuation-symbol"
  | "junction"
  | "continuation"
  | "descriptor"
  | "page-descriptor"
  | "part-spec"
  | "note"
  | "trace"
  | "relationship";

export type BoxSource = "human" | "ai-proposal";

export type LabelSource =
  | "bbox_text"
  | "parts_symbol_match"
  | "wire_label_bank_match"
  | "text_proximity"
  | "manual";

export type SpatialProvenance = {
  projectId: string;
  documentId: string;
  pageNum: number;
  coordinateSpace: "page_px";
  pageSizePx: {
    width: number;
    height: number;
  };
  bbox: BBoxPx;
  source: string;
  capturedAt: string;
};

export type PhysicalSizePx = {
  width: number;
  height: number;
  area: number;
};

export type WireSegmentGeometry = {
  id: string;
  bbox: BBoxPx;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type WireGeometry = {
  segments: WireSegmentGeometry[];
};

export type ShapeMeta = {
  bbox: [number, number, number, number];
};

export type PageMetadata = {
  scale: number;
  shapes: ShapeMeta[];
  text_blocks: Array<{
    text: string;
    bbox: [number, number, number, number];
  }>;
};

export type LabelTextFragment = {
  text: string;
  normalizedText?: string;
  bbox: BBoxPx;
};

export type SymbolBankEntry = {
  symbol: string;
  family: string;
  suffix: string;
  suffix_semantics: "opaque_identifier";
  description: string;
  part_number: string;
  location: string;
  source_page: string;
};

export type SymbolBankResponse = {
  source: string;
  symbols: SymbolBankEntry[];
};

export type WireLabelBankEntry = {
  wire_label: string;
  raw_label: string;
  cable_number: string;
  originating_point: string;
  termination_point: string;
  source_page: string;
  extraction_id: string;
};

export type WireLabelBankResponse = {
  source: string;
  wire_labels: WireLabelBankEntry[];
};

export type ClassTrackerEntry = {
  className: string;
  mark: string;
  rootType: string;
  count: number;
  source?: string;
};

export type ClassTrackerResponse = {
  source: string;
  total: number;
  target_total?: number;
  zero_count?: number;
  classes: ClassTrackerEntry[];
};

export type QwenRoiDetection = {
  bbox: BBoxPx;
  crop_bbox: BBoxPx;
  label?: string | null;
  text?: string | null;
  confidence?: number | null;
};

export type QwenRoiDetectResponse = {
  source: string;
  mode: "component_center_click" | "manual_roi";
  roi: BBoxPx;
  detection: QwenRoiDetection | null;
  rawText: string;
  elapsedMs: number;
};

export type Yolov26PageDetectResponse = {
  status: string;
  runId: string;
  pageNum: number;
  predictionCount: number;
  outputDir: string;
  predictionsPath: string;
  elapsedMs: number;
  annotations: AnnotationBox[];
};

export type Yolov26DetectSettings = {
  conf: number;
  iou: number;
  imgsz: number;
  agnosticNms: boolean;
  roi?: BBoxPx;
};

export type VisionTrainingDefaults = {
  trainer: string;
  modelId: string;
  datasetKind: string;
  launchMode: "local_preflight" | "stage_preflight" | "execute";
  classes: string;
  region: string;
  gcsBucket: string;
  gcsPrefix: string;
  runtimeTemplate: string;
  userEmail: string;
  serviceAccount: string;
  executionTimeout: string;
};

export type VisionTrainingRuntimeTemplate = {
  id: string;
  name: string;
  displayName: string;
  machineType: string;
  acceleratorType: string;
  acceleratorCount: number;
  dataDiskType: string;
  dataDiskSizeGb: number;
  idleTimeout: string;
  createTime: string;
  updateTime: string;
  cost: {
    status: string;
    estimatedHourlyCostUsd: number | null;
    estimatedRunCostUsd: number | null;
  };
  quota: {
    status: string;
    gpuHoursRemaining: number | null;
    computeUnitsRemaining: number | null;
  };
};

export type VisionTrainingRuntimeTemplatesResponse = {
  source: string;
  status: "ready" | "unavailable" | string;
  region?: string;
  error?: string;
  items: VisionTrainingRuntimeTemplate[];
};

export type VisionTrainingRun = {
  training_run_id: string;
  trainer: string;
  model_id: string | null;
  dataset_kind: string;
  annotation_mode: AnnotationWorkspaceMode;
  class_filter: string;
  status: string;
  phase: string;
  display_name: string;
  region: string;
  runtime_template: string;
  gcs_bucket: string;
  gcs_prefix: string;
  dataset_uri: string | null;
  notebook_uri: string | null;
  output_uri: string | null;
  execution_name: string | null;
  execution_id: string | null;
  user_email: string | null;
  service_account: string | null;
  stdout?: string | null;
  stderr?: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  execution_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type VisionTrainingDatasetAuditBlocker = {
  annotation_id?: string | null;
  page_num?: number | string | null;
  class?: string | null;
  schematic_class?: string | null;
  component_label?: string | null;
  component_part_number?: string | null;
  issues?: string[];
};

export type VisionTrainingDatasetAudit = {
  annotation_count?: number;
  training_record_count?: number;
  blocker_count?: number;
  blockers?: VisionTrainingDatasetAuditBlocker[];
  class_counts?: Record<string, number>;
};

export type VisionTrainingConfigResponse = {
  enabled: boolean;
  script: string;
  defaults: VisionTrainingDefaults;
  runtimeTemplates: VisionTrainingRuntimeTemplatesResponse;
  budget?: {
    gpuHoursRemaining?: number | null;
    estimatedCostUsd?: number | null;
    source?: string;
    note?: string;
  };
  recentRuns: VisionTrainingRun[];
};

export type Qwen3vlDriveExportResponse = {
  status: string;
  driveFolder: string;
  folder?: {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  datasetFolder?: {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    webViewLink?: string;
    webContentLink?: string;
  }>;
  manifest?: Record<string, unknown>;
};

export type LabelCandidate = {
  text: string;
  normalizedText: string;
  bbox: BBoxPx;
  textFragments?: LabelTextFragment[];
  score: number;
  distance: number;
  source: LabelSource;
  reason: string;
  symbol?: SymbolBankEntry;
};

export type RootSnapCandidate = {
  bbox: BBoxPx;
  text: string;
  type: AttachmentKind;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  labelBbox?: BBoxPx | null;
  continuationReference?: ContinuationReference;
};

export type AnnotationAttachment = {
  id: string;
  type: AttachmentKind;
  text: string;
  bbox: BBoxPx;
  parentAttachmentId?: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  relation?: AnnotationRelation | LegacyAnnotationRelation;
  provenance?: SpatialProvenance;
  physicalSizePx?: PhysicalSizePx;
  source: "ctrl_click";
  snapped: boolean;
  createdAt: string;
};

export type AnnotationMetadata = {
  attachments?: AnnotationAttachment[];
  rootType?: RootObjectKind;
  wireGeometry?: WireGeometry;
  continuationReference?: ContinuationReference;
  provenance?: SpatialProvenance;
  physicalSizePx?: PhysicalSizePx;
  [key: string]: unknown;
};

export type AnnotationBox = {
  id: string;
  pageNum: number;
  label: string;
  bbox: BBoxPx;
  labelBbox: BBoxPx | null;
  labelSource: LabelSource;
  labelCandidateIndex: number;
  labelCandidates: LabelCandidate[];
  source: BoxSource;
  snapped: boolean;
  metadata: AnnotationMetadata;
  createdAt: string;
  updatedAt: string;
};

export type AnnotationPayload = {
  annotationMode?: AnnotationWorkspaceMode;
  annotations: AnnotationBox[];
};

export type AnnotationStatus = "loading" | "saved" | "dirty" | "saving" | "error";

export type AnnotationWorkspaceMode = "digital_twin" | "training_dataset" | "yolo";

export const ANNOTATION_WORKSPACE_MODES: Array<{
  id: AnnotationWorkspaceMode;
  label: string;
  shortLabel: string;
}> = [
  { id: "digital_twin", label: "Digital Twin", shortLabel: "Twin" },
  { id: "training_dataset", label: "Training Dataset", shortLabel: "Dataset" },
  { id: "yolo", label: "YOLO", shortLabel: "YOLO" },
];

export function isObjectDetectionWorkspace(
  annotationWorkspaceMode: AnnotationWorkspaceMode
) {
  return annotationWorkspaceMode === "training_dataset";
}

export function isYoloWorkspace(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  return annotationWorkspaceMode === "yolo";
}

export const ANNOTATION_MODES: Array<{
  id: AnnotationMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    id: "component",
    label: "Component",
    shortLabel: "CMP",
    description: "Component bodies and schematic marks",
    icon: SquareDashedMousePointer,
  },
  {
    id: "terminal-block",
    label: "Terminal Block",
    shortLabel: "TB",
    description: "Terminal breakout board with multiple positions",
    icon: SquareDashedMousePointer,
  },
  {
    id: "wire-label",
    label: "Wire Label",
    shortLabel: "LBL",
    description: "Wire label OCR text boxes and inline identifiers",
    icon: Tags,
  },
  {
    id: "continuation-symbol",
    label: "Continuation Symbol",
    shortLabel: "HREF",
    description: "H-shaped continuation symbol with top and bottom numbers",
    icon: Link2,
  },
  {
    id: "terminal",
    label: "Terminal",
    shortLabel: "TRM",
    description: "Pins, contacts, and terminal points",
    icon: CircleDot,
  },
  {
    id: "wire",
    label: "Wire",
    shortLabel: "WIRE",
    description: "Segments, bends, and wire paths",
    icon: Cable,
  },
  {
    id: "cable",
    label: "Cable",
    shortLabel: "CAB",
    description: "Cable runs and cable-number labels",
    icon: Cable,
  },
  {
    id: "junction",
    label: "Junction",
    shortLabel: "JNC",
    description: "Connected dots and crossing decisions",
    icon: GitBranch,
  },
  {
    id: "continuation",
    label: "Continuation",
    shortLabel: "REF",
    description: "Page jumps and continuation references",
    icon: Link2,
  },
  {
    id: "descriptor",
    label: "Descriptor",
    shortLabel: "DESC",
    description: "Circuit function text and applied component groups",
    icon: FileText,
  },
  {
    id: "page-descriptor",
    label: "Page Descriptor",
    shortLabel: "PAGE",
    description: "Whole-page title text and page-wide component context",
    icon: FileText,
  },
  {
    id: "part-spec",
    label: "Part / Spec",
    shortLabel: "SPEC",
    description: "Part numbers and specification text",
    icon: FileText,
  },
  {
    id: "note",
    label: "Note",
    shortLabel: "NOTE",
    description: "Instructions, legends, and page notes",
    icon: Type,
  },
  {
    id: "trace",
    label: "Trace",
    shortLabel: "TRC",
    description: "Read-only connected-path validation",
    icon: ScanSearch,
  },
  {
    id: "relationship",
    label: "Relationship",
    shortLabel: "REL",
    description: "Object links and provenance edges",
    icon: Link2,
  },
];

export type InteractionSession =
  | {
      type: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      type: "draw";
      pointerId: number;
      start: { x: number; y: number };
      current: { x: number; y: number };
      targetBoxId?: string | null;
      source?:
        | "yolo_manual_bbox"
        | "yolo_detect_area"
        | "yolo_bulk_expand"
        | "yolo_continuation_symbol";
    }
  | {
      type: "draw-attachment";
      pointerId: number;
      boxId: string;
      start: { x: number; y: number };
      current: { x: number; y: number };
    }
  | {
      type: "move";
      pointerId: number;
      boxId: string;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "move-label";
      pointerId: number;
      boxId: string;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "resize-label";
      pointerId: number;
      boxId: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "resize";
      pointerId: number;
      boxId: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "move-attachment";
      pointerId: number;
      boxId: string;
      attachmentId: string;
      startX: number;
      startY: number;
      original: BBoxPx;
    }
  | {
      type: "resize-attachment";
      pointerId: number;
      boxId: string;
      attachmentId: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      original: BBoxPx;
    };

export type ConnectionPointEditorState = {
  boxId: string;
  attachmentId: string;
  value: string;
  queue?: Array<{
    boxId: string;
    attachmentId: string;
  }>;
};

export type ConnectorTerminalPromptState = {
  bbox: BBoxPx;
  value: string;
};

export type ComponentLabelPromptState = {
  bbox: BBoxPx;
  value: string;
};
