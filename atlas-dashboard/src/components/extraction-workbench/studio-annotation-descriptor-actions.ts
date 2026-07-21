import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers";
import { buildCircuitDescriptorRegionAttachments } from "./circuit-descriptor";
import {
  buildCircuitDescriptorRootAnnotation,
  buildPageDescriptorRootAnnotation,
} from "./circuit-descriptor";
import { type BBoxPx, MIN_BOX_SIZE } from "./studio-geometry";
import { type AnnotationStatus, type AnnotationBox, type RootSnapCandidate, type StudioTool } from "./studio-types";

type SetStateValue<T> = Dispatch<SetStateAction<T>>;

type DescriptorActionContext = {
  pageNum: number;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  clampBox: (box: BBoxPx) => BBoxPx;
  setBoxes: SetStateValue<AnnotationBox[]>;
  undoSnapshot: (snapshot: AnnotationBox[]) => void;
  setAnnotationStatus: SetStateValue<AnnotationStatus>;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setTool: (tool: StudioTool) => void;
  setRelationNotice: (notice: string | null) => void;
  updateBox: (
    boxId: string,
    updater: (box: AnnotationBox) => AnnotationBox,
    options: { recordHistory?: boolean }
  ) => void;
};

export function useStudioDescriptorAnnotationActions({
  pageNum,
  boxesRef,
  clampBox,
  setBoxes,
  undoSnapshot,
  setAnnotationStatus,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setTool,
  setRelationNotice,
  updateBox,
}: DescriptorActionContext) {
  const addCircuitDescriptorRoot = useCallback(
    (candidate: RootSnapCandidate) => {
      const now = new Date().toISOString();
      const id = `page-${pageNum}-descriptor-${crypto.randomUUID()}`;
      const authored = buildCircuitDescriptorRootAnnotation({
        candidate,
        id,
        pageNum,
        capturedAt: now,
      });
      if (authored.status === "blocked") {
        setRelationNotice(authored.notice);
        return;
      }
      setBoxes((current) => {
        undoSnapshot(current);
        const next = [...current, authored.box];
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      setRelationNotice(authored.notice);
    },
    [
      pageNum,
      boxesRef,
      setBoxes,
      setAnnotationStatus,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      setTool,
      undoSnapshot,
    ]
  );

  const addCircuitDescriptorRegion = useCallback(
    (descriptorBox: AnnotationBox, bbox: BBoxPx) => {
      if (bbox.width < MIN_BOX_SIZE || bbox.height < MIN_BOX_SIZE) return;
      const now = new Date().toISOString();
      const regionBbox = clampBox(bbox);
      const attachments = buildCircuitDescriptorRegionAttachments({
        descriptorBoxId: descriptorBox.id,
        regionBbox,
        pageNum,
        capturedAt: now,
        boxes: boxesRef.current.map((box) => ({
          id: box.id,
          label: box.label,
          rootType: rootTypeOf(box),
          bbox: box.bbox,
        })),
      });
      const linkedComponentIds = new Set(
        attachments
          .filter((attachment) => attachment.relation === "circuit_descriptor_applies_to_component")
          .map((attachment) => attachment.linkedBoxId)
      );
      updateBox(
        descriptorBox.id,
        (current) => ({
          ...current,
          metadata: {
            ...current.metadata,
            attachments: [
              ...attachmentsOf(current).filter(
                (attachment) =>
                  attachment.relation !== "circuit_descriptor_applies_to_component" ||
                  !linkedComponentIds.has(attachment.linkedBoxId ?? null)
              ),
              ...attachments,
            ],
          },
          updatedAt: now,
        }),
        { recordHistory: true }
      );
      setSelectedBoxId(descriptorBox.id);
      setSelectedAttachmentId(attachments[0]?.id ?? null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setRelationNotice(
        `Descriptor region linked ${Math.max(0, attachments.length - 1)} components`
      );
    },
    [
      clampBox,
      pageNum,
      boxesRef,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
    ]
  );

  const addPageDescriptorRoot = useCallback(
    (candidate: RootSnapCandidate) => {
      const now = new Date().toISOString();
      const id = `page-${pageNum}-page-descriptor-${crypto.randomUUID()}`;
      const authored = buildPageDescriptorRootAnnotation({
        candidate,
        id,
        pageNum,
        capturedAt: now,
        boxes: boxesRef.current.map((box) => ({
          id: box.id,
          label: box.label,
          rootType: rootTypeOf(box),
          bbox: box.bbox,
        })),
      });
      if (authored.status === "blocked") {
        setRelationNotice(authored.notice);
        return;
      }
      setBoxes((current) => {
        undoSnapshot(current);
        const next = [...current, authored.box];
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
      setRelationNotice(authored.notice);
    },
    [
      pageNum,
      boxesRef,
      setBoxes,
      setAnnotationStatus,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      setTool,
      undoSnapshot,
    ]
  );

  return {
    addCircuitDescriptorRoot,
    addCircuitDescriptorRegion,
    addPageDescriptorRoot,
  } as const;
}
