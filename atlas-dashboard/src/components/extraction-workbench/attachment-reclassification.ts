import { rootTypeOf } from "./annotation-box-helpers.ts";
import {
  attachmentTypeLabel,
  rootObjectTypeLabel,
  strictAttachmentRelation,
  type AnnotationRelation,
  type AttachmentKind,
  type RootObjectKind,
} from "./annotation-model.ts";
import { canAuthorWireAttachment } from "./studio-selection-helpers.ts";

type ReclassificationOwner = {
  label: string;
  metadata?: {
    rootType?: RootObjectKind | null;
  } | null;
};

type ReclassificationAttachment = {
  parentAttachmentId?: string | null;
};

export type AttachmentReclassificationResult =
  | {
      ok: true;
      relation: AnnotationRelation;
    }
  | {
      ok: false;
      notice: string;
    };

export function resolveAttachmentReclassification({
  owner,
  attachment,
  type,
}: {
  owner: ReclassificationOwner | null | undefined;
  attachment: ReclassificationAttachment | null | undefined;
  type: AttachmentKind;
}): AttachmentReclassificationResult {
  const ownerType = owner ? rootTypeOf(owner) : "component";
  const parentAttachmentId = attachment?.parentAttachmentId ?? null;
  if (!canAuthorWireAttachment(ownerType, type, parentAttachmentId)) {
    return {
      ok: false,
      notice:
        "Blocked legacy wire reclass. Wire connections must stay endpoint-owned.",
    };
  }

  const relation = strictAttachmentRelation(ownerType, type, parentAttachmentId);
  if (!relation) {
    return {
      ok: false,
      notice: `Blocked ambiguous reclass: ${rootObjectTypeLabel(ownerType)} ${owner?.label ?? "object"} -> ${attachmentTypeLabel(type)}`,
    };
  }

  return {
    ok: true,
    relation,
  };
}
