import { useCallback, type MutableRefObject } from "react";

import { attachmentsOf } from "./annotation-box-helpers";
import { resolveAttachmentReclassification } from "./attachment-reclassification";
import { retypeRootAnnotationBox } from "./studio-root-retyping";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationWorkspaceMode,
  type LabelCandidate,
} from "./studio-types";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";
import { type BBoxPx } from "./studio-geometry";

type AnnotationTypeActionContext = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  updateAttachment: (
    boxId: string,
    attachmentId: string,
    updater: (attachment: AnnotationAttachment) => AnnotationAttachment,
    options: { recordHistory?: boolean }
  ) => void;
  updateBox: (
    boxId: string,
    updater: (box: AnnotationBox) => AnnotationBox,
    options: { recordHistory?: boolean }
  ) => void;
  resolveLabelCandidates: (componentBox: BBoxPx) => LabelCandidate[];
  setRelationNotice: (notice: string | null) => void;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
};

export function useStudioAnnotationTypeActions({
  annotationWorkspaceMode,
  selectedBox,
  selectedAttachment,
  boxesRef,
  updateAttachment,
  updateBox,
  resolveLabelCandidates,
  setRelationNotice,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
}: AnnotationTypeActionContext) {
  const changeSelectedAttachmentType = useCallback(
    (type: AttachmentKind) => {
      if (!selectedBox || !selectedAttachment) return;
      const reclassification = resolveAttachmentReclassification({
        owner: selectedBox,
        attachment: selectedAttachment,
        type,
      });
      if (!reclassification.ok) {
        setRelationNotice(reclassification.notice);
        return;
      }
      updateAttachment(
        selectedBox.id,
        selectedAttachment.id,
        (attachment) => ({
          ...attachment,
          type,
          relation: reclassification.relation,
        }),
        { recordHistory: true }
      );
      setTypeMenuAttachmentId(null);
      setRelationNotice(null);
    },
    [selectedAttachment, selectedBox, setRelationNotice, setTypeMenuAttachmentId, updateAttachment]
  );

  const changeAttachmentType = useCallback(
    (boxId: string, attachmentId: string, type: AttachmentKind) => {
      const owner = boxesRef.current.find((box) => box.id === boxId);
      const attachment = owner ? attachmentsOf(owner).find((item) => item.id === attachmentId) : null;
      const reclassification = resolveAttachmentReclassification({
        owner,
        attachment,
        type,
      });
      if (!reclassification.ok) {
        setRelationNotice(reclassification.notice);
        return;
      }
      updateAttachment(
        boxId,
        attachmentId,
        (currentAttachment) => ({
          ...currentAttachment,
          type,
          relation: reclassification.relation,
        }),
        { recordHistory: true }
      );
      setSelectedBoxId(boxId);
      setSelectedAttachmentId(attachmentId);
      setTypeMenuAttachmentId(null);
      setRelationNotice(null);
    },
    [
      boxesRef,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      updateAttachment,
    ]
  );

  const changeRootType = useCallback(
    (boxId: string, type: RootObjectKind) => {
      const now = new Date().toISOString();
      updateBox(
        boxId,
        (box) => {
          const labelCandidates = type === "component"
            ? resolveLabelCandidates(box.bbox)
            : box.labelCandidates;
          return retypeRootAnnotationBox(box, type, {
            labelCandidates,
            annotationWorkspaceMode,
            updatedAt: now,
          });
        },
        { recordHistory: true }
      );
      setSelectedBoxId(boxId);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
    },
    [
      resolveLabelCandidates,
      annotationWorkspaceMode,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
    ]
  );

  return {
    changeSelectedAttachmentType,
    changeAttachmentType,
    changeRootType,
  };
}

export type AnnotationTypeActionHookResult = ReturnType<typeof useStudioAnnotationTypeActions>;
