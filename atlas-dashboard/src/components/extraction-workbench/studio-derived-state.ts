import { attachmentsOf } from "./annotation-box-helpers.ts";

type AnnotationWithPage = {
  pageNum: number;
};

type AnnotationWithId = {
  id: string;
};

type AnnotationWithAttachments<Attachment> = {
  metadata?: {
    attachments?: Attachment[] | null;
  } | null;
};

type AttachmentWithId = {
  id: string;
};

type AttachmentForBox<Box> =
  Box extends AnnotationWithAttachments<infer Attachment>
    ? Attachment extends AttachmentWithId
      ? Attachment
      : never
    : never;

type ConnectionPointEditorLike = {
  boxId: string;
  attachmentId: string;
};

export function boxesForPage<Box extends AnnotationWithPage>(
  boxes: Box[],
  pageNum: number
) {
  return boxes.filter((box) => box.pageNum === pageNum);
}

export function selectedBoxById<Box extends AnnotationWithId>(
  boxes: Box[],
  selectedBoxId: string | null
) {
  if (!selectedBoxId) return null;
  return boxes.find((box) => box.id === selectedBoxId) ?? null;
}

export function selectedAttachmentForBox<
  Box extends AnnotationWithAttachments<AttachmentWithId>,
>(box: Box | null, selectedAttachmentId: string | null): AttachmentForBox<Box> | null {
  if (!box || !selectedAttachmentId) return null;
  const attachments = attachmentsOf(box) as AttachmentForBox<Box>[];
  return (
    attachments.find(
      (attachment) => attachment.id === selectedAttachmentId
    ) ?? null
  );
}

export function selectedConnectionPointEditorTarget<
  Box extends AnnotationWithId & AnnotationWithAttachments<AttachmentWithId>,
>(boxes: Box[], connectionPointEditor: ConnectionPointEditorLike | null) {
  if (!connectionPointEditor) return null;
  const box = selectedBoxById(boxes, connectionPointEditor.boxId);
  const attachment = selectedAttachmentForBox(
    box,
    connectionPointEditor.attachmentId
  );
  if (!box || !attachment) return null;
  return { box, attachment };
}

export function annotationSelectionKey(
  selectedBoxId: string | null,
  selectedAttachmentId: string | null
) {
  return `${selectedBoxId ?? "none"}:${selectedAttachmentId ?? "none"}`;
}

export function studioImageSrc(
  agentBase: string,
  _projectId: string,
  documentId: string,
  pageNum: number
) {
  return `${agentBase}/workbench/documents/${documentId}/pages/${pageNum}/image`;
}

export function trackRelationNotice({
  relationNotice,
  selectedAnnotationKey,
  trackedSelectionKey,
  trackedText,
}: {
  relationNotice: string | null;
  selectedAnnotationKey: string;
  trackedSelectionKey: string | null;
  trackedText: string | null;
}) {
  if (!relationNotice) {
    return { trackedSelectionKey: null, trackedText: null };
  }
  if (trackedText !== relationNotice && !trackedSelectionKey) {
    return {
      trackedSelectionKey: selectedAnnotationKey,
      trackedText: relationNotice,
    };
  }
  return { trackedSelectionKey, trackedText: relationNotice };
}

export function relationNoticeShouldClearForSelection({
  relationNotice,
  selectedAnnotationKey,
  trackedSelectionKey,
}: {
  relationNotice: string | null;
  selectedAnnotationKey: string;
  trackedSelectionKey: string | null;
}) {
  return Boolean(
    relationNotice &&
      trackedSelectionKey &&
      trackedSelectionKey !== selectedAnnotationKey
  );
}
