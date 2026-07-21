import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers.ts";
import {
  attachmentTypeLabel,
  inferAttachmentRelation,
  rootObjectTypeLabel,
  strictAttachmentRelation,
  type AttachmentKind,
  type RootObjectKind,
} from "./annotation-model.ts";
import {
  isWireColorText,
  normalizeWireLabelText,
} from "./annotation-labeling.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import { hasExistingAttachmentLink } from "./existing-attachment-link.ts";
import { canAuthorWireAttachment } from "./studio-selection-helpers.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
  RootSnapCandidate,
} from "./studio-types.ts";
import type { BBoxPx } from "./studio-geometry.ts";

type ExistingRootCandidate = Pick<
  RootSnapCandidate,
  "bbox" | "linkedAttachmentId" | "linkedBoxId" | "text"
> & {
  type: AttachmentKind;
};

export type ExistingRootAttachmentResult =
  | {
      status: "created";
      attachment: AnnotationAttachment;
    }
  | {
      status: "blocked" | "duplicate";
      notice: string;
    };

type PointAttachmentCandidate = {
  type: AttachmentKind;
  text: string;
  bbox: BBoxPx;
};

export type PointAttachmentAuthoringResult =
  | {
      status: "wireLabel";
      label: string;
      labelBbox: BBoxPx;
    }
  | {
      status: "created";
      attachment: AnnotationAttachment;
    }
  | {
      status: "blocked";
      notice: string;
    };

export function buildExistingRootAttachment({
  targetBox,
  candidate,
  bbox,
  pageNum,
  source,
  capturedAt,
}: {
  targetBox: AnnotationBox;
  candidate: ExistingRootCandidate;
  bbox: BBoxPx;
  pageNum: number;
  source: string;
  capturedAt: string;
}): ExistingRootAttachmentResult {
  const targetRootType = rootTypeOf(targetBox);
  if (!canAuthorWireAttachment(targetRootType, candidate.type, null)) {
    return {
      status: "blocked",
      notice:
        targetRootType === "cable_segment"
          ? "Blocked direct cable link. Select the cable endpoint before linking it to a component connection point."
          : "Blocked legacy wire link. Select the component connection point and connect it through the nearest wire endpoint.",
    };
  }
  const relation = strictAttachmentRelation(targetRootType, candidate.type);
  if (!relation) {
    return {
      status: "blocked",
      notice: `Blocked ambiguous link: ${rootObjectTypeLabel(targetRootType)} ${targetBox.label} -> ${attachmentTypeLabel(candidate.type)} ${candidate.text || "object"}`,
    };
  }
  if (
    candidate.linkedBoxId &&
    hasExistingAttachmentLink({
      attachments: attachmentsOf(targetBox),
      candidate: {
        bbox,
        text: candidate.text,
        type: candidate.type,
        linkedBoxId: candidate.linkedBoxId,
        linkedAttachmentId: candidate.linkedAttachmentId ?? null,
      },
      relation,
    })
  ) {
    return {
      status: "duplicate",
      notice: "Link already exists.",
    };
  }

  return {
    status: "created",
    attachment: {
      id: `${targetBox.id}-attachment-${crypto.randomUUID()}`,
      type: candidate.type,
      text: candidate.text,
      bbox,
      linkedBoxId: candidate.linkedBoxId ?? null,
      linkedAttachmentId: candidate.linkedAttachmentId ?? null,
      parentAttachmentId: null,
      relation,
      provenance: buildSpatialProvenance(bbox, pageNum, source, capturedAt),
      physicalSizePx: physicalSizeOf(bbox),
      source: "ctrl_click",
      snapped: true,
      createdAt: capturedAt,
    },
  };
}

export function buildPointAttachmentAuthoring({
  ownerBox,
  candidate,
  selectedAttachment,
  pageNum,
  capturedAt,
}: {
  ownerBox: AnnotationBox;
  candidate: PointAttachmentCandidate;
  selectedAttachment: AnnotationAttachment | null;
  pageNum: number;
  capturedAt: string;
}): PointAttachmentAuthoringResult {
  const rootType = rootTypeOf(ownerBox);
  if (rootType === "wire_segment" && candidate.type === "wire_label") {
    return {
      status: "wireLabel",
      label: normalizeWireLabelText(candidate.text) || candidate.text,
      labelBbox: candidate.bbox,
    };
  }

  const candidateType = resolvePointCandidateType({
    rootType,
    candidate,
    selectedAttachment,
  });
  const parentAttachmentId = resolvePointParentAttachmentId({
    rootType,
    candidateType,
    selectedAttachment,
  });

  if (!canAuthorWireAttachment(rootType, candidateType, parentAttachmentId)) {
    return {
      status: "blocked",
      notice:
        rootType === "cable_segment"
          ? "Blocked direct cable link. Select the cable endpoint before linking it to a component connection point."
          : rootType === "cable_reference"
            ? "Blocked direct cable-reference link. Select the cable-reference connection point before linking it to another connection point."
          : "Blocked legacy wire link. Select the component connection point and link it to the wire endpoint so the trace data stays canonical.",
    };
  }

  const relation = strictAttachmentRelation(
    rootType,
    candidateType,
    parentAttachmentId
  );
  if (!relation) {
    return {
      status: "blocked",
      notice: `Blocked ambiguous attachment: ${rootObjectTypeLabel(rootType)} ${ownerBox.label} -> ${attachmentTypeLabel(candidateType)} ${candidate.text || "object"}`,
    };
  }

  return {
    status: "created",
    attachment: {
      id: `${ownerBox.id}-attachment-${crypto.randomUUID()}`,
      type: candidateType,
      text: candidate.text,
      bbox: candidate.bbox,
      parentAttachmentId,
      relation,
      provenance: buildSpatialProvenance(
        candidate.bbox,
        pageNum,
        provenanceSourceForPointAttachment({ rootType, candidateType, candidate }),
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(candidate.bbox),
      source: "ctrl_click",
      snapped: true,
      createdAt: capturedAt,
    },
  };
}

export function buildManualTextAttachment({
  ownerBox,
  bbox,
  pageNum,
  capturedAt,
}: {
  ownerBox: AnnotationBox;
  bbox: BBoxPx;
  pageNum: number;
  capturedAt: string;
}): AnnotationAttachment {
  const ownerRootType = rootTypeOf(ownerBox);
  const attachmentType = ownerRootType === "cable_segment" ? "cable_label" : "text";
  const provenanceSource =
    attachmentType === "cable_label" ? "manual_cable_label" : "manual_attachment";
  return {
    id: `${ownerBox.id}-attachment-${crypto.randomUUID()}`,
    type: attachmentType,
    text: "",
    bbox,
    parentAttachmentId: null,
    relation: inferAttachmentRelation(ownerRootType, attachmentType),
    provenance: buildSpatialProvenance(
      bbox,
      pageNum,
      provenanceSource,
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(bbox),
    source: "ctrl_click",
    snapped: false,
    createdAt: capturedAt,
  };
}

function resolvePointCandidateType({
  rootType,
  candidate,
  selectedAttachment,
}: {
  rootType: RootObjectKind;
  candidate: PointAttachmentCandidate;
  selectedAttachment: AnnotationAttachment | null;
}): AttachmentKind {
  if (
    rootType === "cable_segment" &&
    selectedAttachment?.type === "cable_endpoint" &&
    candidate.type === "connection_point"
  ) {
    return "connection_point";
  }
  if (
    rootType === "cable_reference" &&
    selectedAttachment?.type === "connection_point" &&
    candidate.type === "connection_point"
  ) {
    return "connection_point";
  }
  if (
    (rootType === "cable_segment" || rootType === "cable_reference") &&
    candidate.text
  ) {
    return candidate.type === "part_number" ? "part_number" : "cable_label";
  }
  if (
    rootType === "wire_segment" &&
    candidate.text &&
    isWireColorText(candidate.text)
  ) {
    return "wire_color";
  }
  if (selectedAttachment?.type === "terminal" && candidate.text) {
    return "terminal_label";
  }
  return candidate.type;
}

function resolvePointParentAttachmentId({
  rootType,
  candidateType,
  selectedAttachment,
}: {
  rootType: RootObjectKind;
  candidateType: AttachmentKind;
  selectedAttachment: AnnotationAttachment | null;
}): string | null {
  if (
    selectedAttachment?.type === "terminal" &&
    candidateType === "terminal_label"
  ) {
    return selectedAttachment.id;
  }
  if (
    selectedAttachment?.type === "cable_endpoint" &&
    candidateType === "connection_point"
  ) {
    return selectedAttachment.id;
  }
  if (
    rootType === "cable_reference" &&
    selectedAttachment?.type === "connection_point" &&
    candidateType === "connection_point"
  ) {
    return selectedAttachment.id;
  }
  return null;
}

function provenanceSourceForPointAttachment({
  rootType,
  candidateType,
  candidate,
}: {
  rootType: RootObjectKind;
  candidateType: AttachmentKind;
  candidate: PointAttachmentCandidate;
}) {
  if (!candidate.text) return "shape_snap";
  if (candidateType === "terminal_label") return "terminal_label_text_snap";
  if (candidateType === "connection_point" && rootType === "cable_segment") {
    return "cable_endpoint_connection_point_snap";
  }
  if (candidateType === "connection_point" && rootType === "cable_reference") {
    return "cable_reference_connection_point_snap";
  }
  if (candidateType === "cable_label") return "cable_label_text_snap";
  return "text_snap";
}
