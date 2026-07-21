import { MIN_BOX_SIZE, clampBoxToPage } from "./studio-geometry.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
  LabelCandidate,
  RootSnapCandidate,
} from "./studio-types.ts";
import {
  DOCUMENT_ID,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  PROJECT_ID,
} from "./studio-types.ts";

export type CircuitDescriptorBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CircuitDescriptorSourceBox = {
  id: string;
  label: string;
  rootType: string;
  bbox: CircuitDescriptorBox;
};

export type CircuitDescriptorAttachment = {
  id: string;
  type: "component" | "text";
  text: string;
  bbox: CircuitDescriptorBox;
  parentAttachmentId: null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  relation:
    | "circuit_descriptor_applies_to_region"
    | "circuit_descriptor_applies_to_component"
    | "page_descriptor_applies_to_component";
  provenance: {
    projectId: string;
    documentId: string;
    pageNum: number;
    coordinateSpace: "page_px";
    pageSizePx: {
      width: number;
      height: number;
    };
    bbox: CircuitDescriptorBox;
    source: string;
    capturedAt: string;
  };
  physicalSizePx: {
    width: number;
    height: number;
    area: number;
  };
  source: "ctrl_click";
  snapped: boolean;
  createdAt: string;
};

export type DescriptorRootAuthoringResult =
  | {
      status: "created";
      box: AnnotationBox;
      notice: string | null;
    }
  | {
      status: "blocked";
      notice: string;
    };

export function buildCircuitDescriptorRootAnnotation({
  candidate,
  id,
  pageNum,
  capturedAt,
}: {
  candidate: RootSnapCandidate;
  id: string;
  pageNum: number;
  capturedAt: string;
}): DescriptorRootAuthoringResult {
  const text = candidate.text.trim();
  if (!text || candidate.bbox.width < MIN_BOX_SIZE || candidate.bbox.height < MIN_BOX_SIZE) {
    return {
      status: "blocked",
      notice: "No descriptor text detected under the pointer.",
    };
  }

  const bbox = clampDescriptorBox(candidate.bbox);
  return {
    status: "created",
    box: buildDescriptorRootBox({
      id,
      pageNum,
      text,
      bbox,
      rootType: "circuit_descriptor",
      labelReason: "descriptor_text",
      provenanceSource: "circuit_descriptor_text_snap",
      attachments: [],
      capturedAt,
    }),
    notice: null,
  };
}

export function buildPageDescriptorRootAnnotation({
  candidate,
  id,
  boxes,
  pageNum,
  capturedAt,
}: {
  candidate: RootSnapCandidate;
  id: string;
  boxes: CircuitDescriptorSourceBox[];
  pageNum: number;
  capturedAt: string;
}): DescriptorRootAuthoringResult {
  const text = candidate.text.trim();
  if (!text || candidate.bbox.width < MIN_BOX_SIZE || candidate.bbox.height < MIN_BOX_SIZE) {
    return {
      status: "blocked",
      notice: "No page descriptor text detected under the pointer.",
    };
  }

  const bbox = clampDescriptorBox(candidate.bbox);
  const attachments = buildPageDescriptorComponentAttachments({
    descriptorBoxId: id,
    pageNum,
    capturedAt,
    boxes,
  });
  return {
    status: "created",
    box: buildDescriptorRootBox({
      id,
      pageNum,
      text,
      bbox,
      rootType: "page_descriptor",
      labelReason: "page_descriptor_text",
      provenanceSource: "page_descriptor_text_snap",
      attachments,
      capturedAt,
    }),
    notice: "Page descriptor linked all page components",
  };
}

function buildDescriptorRootBox({
  id,
  pageNum,
  text,
  bbox,
  rootType,
  labelReason,
  provenanceSource,
  attachments,
  capturedAt,
}: {
  id: string;
  pageNum: number;
  text: string;
  bbox: CircuitDescriptorBox;
  rootType: "circuit_descriptor" | "page_descriptor";
  labelReason: "descriptor_text" | "page_descriptor_text";
  provenanceSource: "circuit_descriptor_text_snap" | "page_descriptor_text_snap";
  attachments: AnnotationAttachment[];
  capturedAt: string;
}): AnnotationBox {
  const labelCandidate: LabelCandidate = {
    text,
    normalizedText: text,
    bbox,
    score: 0,
    distance: 0,
    source: "text_proximity",
    reason: labelReason,
  };

  return {
    id,
    pageNum,
    label: text,
    bbox,
    labelBbox: bbox,
    labelSource: "text_proximity",
    labelCandidateIndex: 0,
    labelCandidates: [labelCandidate],
    source: "human",
    snapped: true,
    metadata: {
      rootType,
      attachments,
      provenance: spatialProvenance(bbox, pageNum, provenanceSource, capturedAt),
      physicalSizePx: physicalSizeOf(bbox),
    },
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

function clampDescriptorBox(box: CircuitDescriptorBox): CircuitDescriptorBox {
  return clampBoxToPage(box, {
    width: PAGE_WIDTH_PX,
    height: PAGE_HEIGHT_PX,
  });
}

export function buildCircuitDescriptorRegionAttachments({
  descriptorBoxId,
  regionBbox,
  boxes,
  pageNum,
  capturedAt,
}: {
  descriptorBoxId: string;
  regionBbox: CircuitDescriptorBox;
  boxes: CircuitDescriptorSourceBox[];
  pageNum: number;
  capturedAt: string;
}): CircuitDescriptorAttachment[] {
  const regionAttachment: CircuitDescriptorAttachment = {
    id: `${descriptorBoxId}-descriptor-region-${crypto.randomUUID()}`,
    type: "text",
    text: "applies to region",
    bbox: regionBbox,
    parentAttachmentId: null,
    linkedBoxId: null,
    linkedAttachmentId: null,
    relation: "circuit_descriptor_applies_to_region",
    provenance: spatialProvenance(regionBbox, pageNum, "descriptor_region_manual", capturedAt),
    physicalSizePx: physicalSizeOf(regionBbox),
    source: "ctrl_click",
    snapped: false,
    createdAt: capturedAt,
  };

  const componentLinks = boxes
    .filter((box) => box.id !== descriptorBoxId)
    .filter((box) => box.rootType === "component")
    .filter((box) => pointInBox(centerOfBox(box.bbox), regionBbox))
    .map((box) => ({
      id: `${descriptorBoxId}-descriptor-component-link-${crypto.randomUUID()}`,
      type: "component" as const,
      text: box.label,
      bbox: box.bbox,
      parentAttachmentId: null,
      linkedBoxId: box.id,
      linkedAttachmentId: null,
      relation: "circuit_descriptor_applies_to_component" as const,
      provenance: spatialProvenance(
        box.bbox,
        pageNum,
        "descriptor_region_component_membership",
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(box.bbox),
      source: "ctrl_click" as const,
      snapped: true,
      createdAt: capturedAt,
    }));

  return [regionAttachment, ...componentLinks];
}

export function buildPageDescriptorComponentAttachments({
  descriptorBoxId,
  boxes,
  pageNum,
  capturedAt,
}: {
  descriptorBoxId: string;
  boxes: CircuitDescriptorSourceBox[];
  pageNum: number;
  capturedAt: string;
}): CircuitDescriptorAttachment[] {
  return boxes
    .filter((box) => box.id !== descriptorBoxId)
    .filter((box) => box.rootType === "component")
    .map((box) => ({
      id: `${descriptorBoxId}-page-component-link-${crypto.randomUUID()}`,
      type: "component" as const,
      text: box.label,
      bbox: box.bbox,
      parentAttachmentId: null,
      linkedBoxId: box.id,
      linkedAttachmentId: null,
      relation: "page_descriptor_applies_to_component" as const,
      provenance: spatialProvenance(
        box.bbox,
        pageNum,
        "page_descriptor_component_membership",
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(box.bbox),
      source: "ctrl_click" as const,
      snapped: true,
      createdAt: capturedAt,
    }));
}

function centerOfBox(box: CircuitDescriptorBox) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function pointInBox(point: { x: number; y: number }, box: CircuitDescriptorBox) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function physicalSizeOf(box: CircuitDescriptorBox) {
  return {
    width: box.width,
    height: box.height,
    area: box.width * box.height,
  };
}

function spatialProvenance(
  bbox: CircuitDescriptorBox,
  pageNum: number,
  source: string,
  capturedAt: string
) {
  return {
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    pageNum,
    coordinateSpace: "page_px" as const,
    pageSizePx: {
      width: PAGE_WIDTH_PX,
      height: PAGE_HEIGHT_PX,
    },
    bbox,
    source,
    capturedAt,
  };
}
