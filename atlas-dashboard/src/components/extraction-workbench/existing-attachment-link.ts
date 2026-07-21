export type ExistingAttachmentLinkBox = {
  id: string;
  label: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type ExistingAttachmentLinkAttachment<TType extends string = string> = {
  id: string;
  type: TType;
  text: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type ExistingAttachmentLinkCandidate<TType extends string = string> = {
  bbox: ExistingAttachmentLinkAttachment<TType>["bbox"];
  text: string;
  type: TType;
  linkedBoxId: string;
  linkedAttachmentId: string | null;
};

export type ExistingLinkedAttachment<TType extends string = string> = {
  type: TType;
  relation?: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
};

export function buildExistingAttachmentLinkCandidate<TType extends string>({
  ownerBox,
  attachment,
  anchorBbox,
}: {
  ownerBox: ExistingAttachmentLinkBox;
  attachment: ExistingAttachmentLinkAttachment<TType>;
  anchorBbox?: ExistingAttachmentLinkAttachment<TType>["bbox"] | null;
}): ExistingAttachmentLinkCandidate<TType> {
  return {
    bbox: anchorBbox ?? attachment.bbox,
    text: existingAttachmentLinkText(ownerBox.label, attachment),
    type: attachment.type,
    linkedBoxId: ownerBox.id,
    linkedAttachmentId: attachment.id,
  };
}

export function hasExistingAttachmentLink<TType extends string>({
  attachments,
  candidate,
  relation,
}: {
  attachments: ExistingLinkedAttachment<TType>[];
  candidate: ExistingAttachmentLinkCandidate<TType>;
  relation: string;
}) {
  return attachments.some(
    (attachment) =>
      attachment.relation === relation &&
      attachment.type === candidate.type &&
      attachment.linkedBoxId === candidate.linkedBoxId &&
      attachment.linkedAttachmentId === candidate.linkedAttachmentId
  );
}

export function dedupeExistingAttachmentLinks<
  TAttachment extends ExistingLinkedAttachment,
>(attachments: TAttachment[]): TAttachment[] {
  const seen = new Set<string>();
  const deduped: TAttachment[] = [];
  for (const attachment of attachments) {
    if (!attachment.linkedBoxId) {
      deduped.push(attachment);
      continue;
    }
    const key = [
      attachment.relation ?? "",
      attachment.type,
      attachment.linkedBoxId,
      attachment.linkedAttachmentId ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(attachment);
  }
  return deduped;
}

function existingAttachmentLinkText(
  ownerLabel: string,
  attachment: ExistingAttachmentLinkAttachment
) {
  const owner = ownerLabel.trim();
  const text = attachment.text.trim();
  if (attachment.type === "wire_endpoint") return owner || text;
  if (attachment.type === "connection_point" && owner && text) {
    return `${owner}:${text}`;
  }
  return text || owner;
}
