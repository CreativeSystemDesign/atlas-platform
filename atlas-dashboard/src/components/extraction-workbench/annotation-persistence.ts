import { dedupeExistingAttachmentLinks } from "./existing-attachment-link.ts";
import {
  normalizeRelation,
  type AnnotationRelation,
  type AttachmentKind,
  type LegacyAnnotationRelation,
  type RootObjectKind,
} from "./annotation-model.ts";
import type { ContinuationReference } from "./continuation-symbol.ts";

const DOCUMENT_ID = "schematic_<drawing-no>";
const PROJECT_ID = "00000000-0000-4000-8000-000000001650";
const PAGE_WIDTH_PX = 2481;
const PAGE_HEIGHT_PX = 3509;

type LabelSource =
  | "bbox_text"
  | "parts_symbol_match"
  | "wire_label_bank_match"
  | "text_proximity"
  | "manual";

type BoxSource = "human" | "ai-proposal";

type SymbolBankEntry = {
  symbol: string;
  family: string;
  suffix: string;
  suffix_semantics: "opaque_identifier";
  description: string;
  part_number: string;
  location: string;
  source_page: string;
};

export type BBoxPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

type WireSegmentGeometry = {
  id: string;
  bbox: BBoxPx;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type WireGeometry = {
  segments: WireSegmentGeometry[];
};

type LabelCandidate = {
  text: string;
  normalizedText: string;
  bbox: BBoxPx;
  textFragments?: Array<{
    text: string;
    normalizedText?: string;
    bbox: BBoxPx;
  }>;
  score: number;
  distance: number;
  source: LabelSource;
  reason: string;
  symbol?: SymbolBankEntry;
};

export type StudioAnnotationAttachmentInput = {
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
  source?: "ctrl_click";
  snapped?: boolean;
  createdAt?: string;
};

export type StudioAnnotationAttachment = StudioAnnotationAttachmentInput & {
  parentAttachmentId: string | null;
  relation: AnnotationRelation;
  provenance: SpatialProvenance;
  physicalSizePx: PhysicalSizePx;
  source: "ctrl_click";
  snapped: boolean;
  createdAt: string;
};

export type StudioAnnotationMetadataInput = {
  attachments?: StudioAnnotationAttachmentInput[];
  rootType?: RootObjectKind;
  wireGeometry?: WireGeometry;
  continuationReference?: ContinuationReference;
  provenance?: SpatialProvenance;
  physicalSizePx?: PhysicalSizePx;
  [key: string]: unknown;
};

export type StudioAnnotationMetadata = Omit<
  StudioAnnotationMetadataInput,
  "attachments" | "provenance" | "physicalSizePx"
> & {
  attachments: StudioAnnotationAttachment[];
  rootType: RootObjectKind;
  provenance: SpatialProvenance;
  physicalSizePx: PhysicalSizePx;
};

export type StudioAnnotationInput = {
  id: string;
  pageNum?: number;
  label?: string;
  bbox: BBoxPx;
  labelBbox?: BBoxPx | null;
  labelSource?: LabelSource;
  labelCandidateIndex?: number;
  labelCandidates?: LabelCandidate[];
  source?: BoxSource;
  snapped?: boolean;
  metadata?: StudioAnnotationMetadataInput;
  createdAt?: string;
  updatedAt?: string;
};

export type StudioAnnotation = Omit<
  StudioAnnotationInput,
  | "pageNum"
  | "label"
  | "labelBbox"
  | "labelSource"
  | "labelCandidateIndex"
  | "labelCandidates"
  | "source"
  | "snapped"
  | "metadata"
  | "createdAt"
  | "updatedAt"
> & {
  pageNum: number;
  label: string;
  labelBbox: BBoxPx | null;
  labelSource: LabelSource;
  labelCandidateIndex: number;
  labelCandidates: LabelCandidate[];
  source: BoxSource;
  snapped: boolean;
  metadata: StudioAnnotationMetadata;
  createdAt: string;
  updatedAt: string;
};

export type AnnotationPayload = {
  annotations: StudioAnnotation[];
};

export function normalizeStudioAnnotations(
  annotations: StudioAnnotationInput[],
  pageNum: number,
  options: { now?: string } = {}
): StudioAnnotation[] {
  return annotations.map((annotation) => {
    const now = options.now ?? new Date().toISOString();
    const rootType = rootTypeOf(annotation);
    const attachments = Array.isArray(annotation.metadata?.attachments)
      ? dedupeExistingAttachmentLinks(
          annotation.metadata.attachments.map((attachment) =>
            normalizeStudioAttachment(attachment, pageNum, rootType, now)
          )
        )
      : [];
    return {
      ...annotation,
      pageNum,
      label: annotation.label || "component",
      labelBbox: annotation.labelBbox ?? null,
      labelSource: annotation.labelSource ?? "manual",
      labelCandidateIndex: annotation.labelCandidateIndex ?? -1,
      labelCandidates: annotation.labelCandidates ?? [],
      source: annotation.source ?? "human",
      snapped: Boolean(annotation.snapped),
      metadata: {
        ...(annotation.metadata ?? {}),
        rootType,
        attachments,
        provenance: normalizedProvenanceForAnnotation(annotation, pageNum, now),
        physicalSizePx: physicalSizeOf(annotation.bbox),
      },
      createdAt: annotation.createdAt ?? now,
      updatedAt: annotation.updatedAt ?? annotation.createdAt ?? now,
    };
  });
}

function normalizedProvenanceForAnnotation(
  annotation: StudioAnnotationInput,
  pageNum: number,
  now: string
): SpatialProvenance {
  const provenance = annotation.metadata?.provenance;
  if (!provenance) {
    return buildSpatialProvenance(
      annotation.bbox,
      pageNum,
      "loaded_component",
      annotation.createdAt ?? now
    );
  }
  return {
    ...provenance,
    pageNum,
    bbox: annotation.bbox,
  };
}

export function normalizeStudioAttachment(
  attachment: StudioAnnotationAttachmentInput,
  pageNum: number,
  ownerRootType: RootObjectKind,
  now = new Date().toISOString()
): StudioAnnotationAttachment {
  const normalized = {
    ...attachment,
    parentAttachmentId: attachment.parentAttachmentId ?? null,
    source: attachment.source ?? "ctrl_click",
    snapped: Boolean(attachment.snapped),
    createdAt: attachment.createdAt ?? now,
  };
  return {
    ...normalized,
    relation: normalizeRelation(ownerRootType, normalized),
    provenance:
      attachment.provenance ??
      buildSpatialProvenance(
        attachment.bbox,
        pageNum,
        attachment.snapped ? "loaded_snap" : "loaded_manual",
        attachment.createdAt ?? now
      ),
    physicalSizePx: attachment.physicalSizePx ?? physicalSizeOf(attachment.bbox),
  };
}

export function physicalSizeOf(bbox: BBoxPx): PhysicalSizePx {
  return {
    width: bbox.width,
    height: bbox.height,
    area: bbox.width * bbox.height,
  };
}

export function buildSpatialProvenance(
  bbox: BBoxPx,
  pageNum: number,
  source: string,
  capturedAt: string
): SpatialProvenance {
  return {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    pageNum,
    coordinateSpace: "page_px",
    pageSizePx: {
      width: PAGE_WIDTH_PX,
      height: PAGE_HEIGHT_PX,
    },
    bbox,
    source,
    capturedAt,
  };
}

function rootTypeOf(annotation: StudioAnnotationInput): RootObjectKind {
  return annotation.metadata?.rootType ?? "component";
}
