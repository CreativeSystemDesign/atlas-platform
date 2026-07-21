import type {
  AttachmentKind,
  RootObjectKind,
} from "./annotation-model.ts";
import {
  attachmentTypeLabel,
  rootObjectTypeLabel,
} from "./annotation-model.ts";
import { rootTypeOf } from "./annotation-box-helpers.ts";
import type { ResizeHandle } from "./annotation-styles.ts";

type SelectionAttachmentLike = {
  type: AttachmentKind;
  text?: string | null;
};

type SelectionBoxLike = {
  label: string;
  metadata?: {
    rootType?: RootObjectKind | null;
  } | null;
};

type LabelCandidateLike = {
  normalizedText: string;
  distance: number;
};

export const RESIZE_HANDLES: ResizeHandle[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
];

export function attachmentDisplayText(
  attachment: SelectionAttachmentLike | undefined
) {
  if (!attachment) return "selected parent";
  const text = attachment.text || attachmentTypeLabel(attachment.type);
  return `${attachmentTypeLabel(attachment.type)} ${text}`;
}

export function activeSelectionLabel(
  selectedBox: SelectionBoxLike | null,
  selectedAttachment: SelectionAttachmentLike | null
) {
  if (!selectedBox) return "no active bbox";
  if (selectedAttachment) {
    const source = `${rootObjectTypeLabel(rootTypeOf(selectedBox))} · ${selectedBox.label}`;
    const target = `${attachmentTypeLabel(selectedAttachment.type)} · ${
      selectedAttachment.text || "linked object"
    }`;
    return `${source} -> ${target}`;
  }
  return `${rootObjectTypeLabel(rootTypeOf(selectedBox))} · ${selectedBox.label}`;
}

export function compareCandidatesByProximity(
  left: LabelCandidateLike,
  right: LabelCandidateLike
) {
  const distanceDelta = left.distance - right.distance;
  if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
  return left.normalizedText.localeCompare(right.normalizedText);
}

export function canAuthorWireAttachment(
  ownerRootType: RootObjectKind,
  attachmentType: AttachmentKind,
  parentAttachmentId?: string | null
) {
  if (ownerRootType === "cable_segment") {
    if (
      attachmentType === "cable_endpoint" ||
      attachmentType === "cable_label" ||
      attachmentType === "part_number" ||
      attachmentType === "text"
    ) {
      return true;
    }
    return attachmentType === "connection_point" && Boolean(parentAttachmentId);
  }

  if (ownerRootType === "cable_reference") {
    if (
      attachmentType === "connection_point" ||
      attachmentType === "cable_label" ||
      attachmentType === "part_number" ||
      attachmentType === "text"
    ) {
      return true;
    }
    return false;
  }

  if (ownerRootType !== "wire_segment") return true;
  if (
    attachmentType === "wire_endpoint" ||
    attachmentType === "wire_label" ||
    attachmentType === "wire_color" ||
    attachmentType === "junction" ||
    attachmentType === "wire_segment" ||
    attachmentType === "ground_reference" ||
    attachmentType === "text"
  ) {
    return true;
  }
  return attachmentType === "connection_point" && Boolean(parentAttachmentId);
}
