import { descendantAttachmentIds } from "./annotation-box-helpers.ts";

export type DeleteAction =
  | "delete-attachment"
  | "clear-stale-attachment"
  | "delete-root"
  | "ignore";

type AttachmentWithParent = {
  id: string;
  parentAttachmentId?: string | null;
};

type BoxWithAttachments<Attachment extends AttachmentWithParent> = {
  metadata: {
    attachments?: Attachment[] | null;
    [key: string]: unknown;
  };
  updatedAt?: string;
  [key: string]: unknown;
};

export function resolveDeleteAction({
  selectedBoxId,
  selectedAttachmentId,
  selectedAttachmentExists,
  isRepeat,
}: {
  selectedBoxId: string | null;
  selectedAttachmentId: string | null;
  selectedAttachmentExists: boolean;
  isRepeat: boolean;
}): { action: DeleteAction; preventDefault: boolean } {
  if (isRepeat) {
    return {
      action: "ignore",
      preventDefault: Boolean(selectedBoxId || selectedAttachmentId),
    };
  }

  if (selectedAttachmentId) {
    return {
      action: selectedAttachmentExists
        ? "delete-attachment"
        : "clear-stale-attachment",
      preventDefault: true,
    };
  }

  if (selectedBoxId) {
    return { action: "delete-root", preventDefault: true };
  }

  return { action: "ignore", preventDefault: false };
}

export function deleteAttachmentWithDescendants<
  Attachment extends AttachmentWithParent,
  Box extends BoxWithAttachments<Attachment>,
>(box: Box, attachmentId: string, updatedAt: string): Box {
  const attachments = Array.isArray(box.metadata.attachments)
    ? box.metadata.attachments
    : [];
  const deletedIds = descendantAttachmentIds(attachments, attachmentId);
  deletedIds.add(attachmentId);
  return {
    ...box,
    metadata: {
      ...box.metadata,
      attachments: attachments.filter(
        (attachment) => !deletedIds.has(attachment.id)
      ),
    },
    updatedAt,
  };
}
