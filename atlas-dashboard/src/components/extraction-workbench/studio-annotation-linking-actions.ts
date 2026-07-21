import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { applyExistingWireConnectionPointEdit, buildExistingWireConnectionPointEdit } from "./wire-connection-authoring";
import {
  buildExistingRootAttachment,
  buildManualTextAttachment,
  buildPointAttachmentAuthoring,
} from "./attachment-authoring";
import { extendWireGeometryInBoxes } from "./wire-geometry-extension";
import {
  addGroundReferenceRootLinkedToWireToBoxes,
  addRootSnapAnnotationToBoxes,
  addWireRootLinkedToConnectionPointToBoxes,
} from "./root-snap-annotation";
import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers";
import { reconcileTouchedWireEndpointContactsInBoxes } from "./wire-link-reconciliation";
import { reconcileTouchedCableReferenceConnectionPointsInBoxes } from "./cable-reference-connection-point";
import { buildConnectionPointAuthoring } from "./connection-point-authoring";
import { type BBoxPx, MIN_BOX_SIZE } from "./studio-geometry";
import { type AttachmentKind } from "./annotation-model";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationWorkspaceMode,
  type AnnotationStatus,
  type ConnectionPointEditorState,
  type LabelCandidate,
  type RootSnapCandidate,
} from "./studio-types";

type SetStateValue<T> = Dispatch<SetStateAction<T>>;

type AnnotationLinkingActionContext = {
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  cursorPx: { x: number; y: number } | null;
  setBoxes: SetStateValue<AnnotationBox[]>;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  undoSnapshot: (snapshot: AnnotationBox[]) => void;
  setAnnotationStatus: SetStateValue<AnnotationStatus>;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setRelationNotice: (notice: string | null) => void;
  setConnectionPointEditor: (state: ConnectionPointEditorState | null) => void;
  resolveWireLabelCandidates: (wireBox: BBoxPx) => LabelCandidate[];
  resolveAttachmentCandidate: (
    point: { x: number; y: number }
  ) => RootSnapCandidate | null;
  clampBox: (box: BBoxPx) => BBoxPx;
  updateBox: (
    boxId: string,
    updater: (box: AnnotationBox) => AnnotationBox,
    options: { recordHistory?: boolean }
  ) => void;
  updateAttachment: (
    boxId: string,
    attachmentId: string,
    updater: (attachment: AnnotationAttachment) => AnnotationAttachment,
    options: { recordHistory?: boolean }
  ) => void;
  connectionPointEditor: ConnectionPointEditorState | null;
};

export function useStudioAnnotationLinkingActions({
  pageNum,
  annotationWorkspaceMode,
  zoom,
  selectedBox,
  selectedAttachment,
  cursorPx,
  setBoxes,
  boxesRef,
  undoSnapshot,
  setAnnotationStatus,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setRelationNotice,
  setConnectionPointEditor,
  resolveWireLabelCandidates,
  resolveAttachmentCandidate,
  clampBox,
  updateBox,
  updateAttachment,
  connectionPointEditor,
}: AnnotationLinkingActionContext) {
  const addWireRootLinkedToConnectionPoint = useCallback(
    (
      ownerBox: AnnotationBox,
      connectionPoint: AnnotationAttachment,
      candidate: { bbox: BBoxPx; text: string; type: AttachmentKind }
    ) => {
      if (candidate.bbox.width < MIN_BOX_SIZE || candidate.bbox.height < MIN_BOX_SIZE) {
        return;
      }
      const now = new Date().toISOString();
      const id = `page-${pageNum}-root-${crypto.randomUUID()}`;
      const labelCandidates = resolveWireLabelCandidates(candidate.bbox);
      const current = boxesRef.current;
      undoSnapshot(current);
      const { boxes: next, connectionAttachment } =
        addWireRootLinkedToConnectionPointToBoxes(current, {
          ownerBox,
          connectionPoint,
          candidate,
          id,
          pageNum,
          zoom,
          capturedAt: now,
          labelCandidates,
        });
      boxesRef.current = next;
      setBoxes(next);
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(connectionAttachment.id);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setRelationNotice(
        `Linked wire segment to ${ownerBox.label}:${connectionPoint.text || "connection"}`
      );
    },
    [
      pageNum,
      resolveWireLabelCandidates,
      boxesRef,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      undoSnapshot,
      zoom,
    ]
  );

  const linkExistingWireToConnectionPoint = useCallback(
    (
      wireBox: AnnotationBox,
      ownerBox: AnnotationBox,
      connectionPoint: AnnotationAttachment
    ) => {
      const now = new Date().toISOString();
      const edit = buildExistingWireConnectionPointEdit({
        wireBox,
        ownerBox,
        connectionPoint,
        zoom,
        pageNum,
        capturedAt: now,
      });
      if (!edit) return false;
      updateBox(
        wireBox.id,
        (current) => applyExistingWireConnectionPointEdit(current, edit),
        { recordHistory: true }
      );
      setSelectedBoxId(wireBox.id);
      setSelectedAttachmentId(edit.link.id);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setRelationNotice(
        `Linked ${wireBox.label} to ${ownerBox.label}:${connectionPoint.text || "connection"}`
      );
      return true;
    },
    [
      pageNum,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
      zoom,
    ]
  );

  const addGroundReferenceRootLinkedToWire = useCallback(
    (wireBox: AnnotationBox, candidate: RootSnapCandidate) => {
      if (candidate.bbox.width < MIN_BOX_SIZE || candidate.bbox.height < MIN_BOX_SIZE) {
        return;
      }
      const now = new Date().toISOString();
      const id = `page-${pageNum}-root-${crypto.randomUUID()}`;
      const bbox = clampBox(candidate.bbox);
      const current = boxesRef.current;
      undoSnapshot(current);
      const { boxes: next, attachment } =
        addGroundReferenceRootLinkedToWireToBoxes(current, {
          wireBox,
          candidate,
          bbox,
          id,
          pageNum,
          capturedAt: now,
        });
      boxesRef.current = next;
      setBoxes(next);
      setAnnotationStatus("dirty");
      setSelectedBoxId(wireBox.id);
      setSelectedAttachmentId(attachment.id);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setRelationNotice(null);
    },
    [
      clampBox,
      pageNum,
      boxesRef,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      undoSnapshot,
    ]
  );

  const addAttachmentFromPoint = useCallback(
    (box: AnnotationBox, point: { x: number; y: number }) => {
      const candidate = resolveAttachmentCandidate(point);
      if (!candidate) return;
      const now = new Date().toISOString();
      if (
        annotationWorkspaceMode === "training_dataset" &&
        rootTypeOf(box) === "component" &&
        candidate.type === "terminal"
      ) {
        const id = `page-${pageNum}-root-${crypto.randomUUID()}`;
        setBoxes((current) => {
          undoSnapshot(current);
          const { boxes: next } = addRootSnapAnnotationToBoxes(current, {
            candidate: {
              ...candidate,
              bbox: clampBox(candidate.bbox),
              text: "terminal",
              type: "terminal",
            },
            id,
            pageNum,
            zoom,
            source: "dataset_component_terminal_ctrl_click_root",
            capturedAt: now,
            labelCandidates: [],
          });
          boxesRef.current = next;
          return next;
        });
        setAnnotationStatus("dirty");
        setSelectedBoxId(id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        setRelationNotice(null);
        return;
      }
      const authored = buildPointAttachmentAuthoring({
        ownerBox: box,
        candidate,
        selectedAttachment,
        pageNum,
        capturedAt: now,
      });
      if (authored.status === "wireLabel") {
        updateBox(
          box.id,
          (current) => ({
            ...current,
            label: authored.label,
            labelBbox: authored.labelBbox,
            labelSource: "text_proximity",
            labelCandidateIndex: -1,
            labelCandidates: [],
            updatedAt: now,
          }),
          { recordHistory: true }
        );
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        return;
      }
      if (authored.status === "blocked") {
        setRelationNotice(authored.notice);
        return;
      }
      const { attachment } = authored;
      updateBox(
        box.id,
        (current) => ({
          ...current,
          metadata: {
            ...current.metadata,
            attachments: [...attachmentsOf(current), attachment],
          },
          updatedAt: now,
        }),
        { recordHistory: true }
      );
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(attachment.id);
      setTypeMenuBoxId(null);
      setRelationNotice(null);
    },
    [
      pageNum,
      annotationWorkspaceMode,
      resolveAttachmentCandidate,
      selectedAttachment,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
      zoom,
      clampBox,
      setAnnotationStatus,
      setBoxes,
      undoSnapshot,
      boxesRef,
    ]
  );

  const addManualAttachment = useCallback(
    (box: AnnotationBox, bbox: BBoxPx) => {
      if (bbox.width < MIN_BOX_SIZE || bbox.height < MIN_BOX_SIZE) return;
      const now = new Date().toISOString();
      const attachmentBbox = clampBox(bbox);
      const attachment = buildManualTextAttachment({
        ownerBox: box,
        bbox: attachmentBbox,
        pageNum,
        capturedAt: now,
      });
      updateBox(
        box.id,
        (current) => ({
          ...current,
          metadata: {
            ...current.metadata,
            attachments: [...attachmentsOf(current), attachment],
          },
          updatedAt: now,
        }),
        { recordHistory: true }
      );
      setSelectedBoxId(box.id);
      setSelectedAttachmentId(attachment.id);
      setTypeMenuBoxId(null);
    },
    [
      clampBox,
      pageNum,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuBoxId,
      updateBox,
    ]
  );

  const addAttachmentFromExisting = useCallback(
    (targetBox: AnnotationBox, candidate: RootSnapCandidate, source: string) => {
      const now = new Date().toISOString();
      const attachmentBbox = clampBox(candidate.bbox);
      const authored = buildExistingRootAttachment({
        targetBox,
        candidate,
        bbox: attachmentBbox,
        pageNum,
        source,
        capturedAt: now,
      });
      if (authored.status !== "created") {
        setRelationNotice(authored.notice);
        setSelectedBoxId(targetBox.id);
        setTypeMenuAttachmentId(null);
        setTypeMenuBoxId(null);
        return;
      }
      const { attachment } = authored;
      updateBox(
        targetBox.id,
        (current) => ({
          ...current,
          metadata: {
            ...current.metadata,
            attachments: [...attachmentsOf(current), attachment],
          },
          updatedAt: now,
        }),
        { recordHistory: true }
      );
      setSelectedBoxId(targetBox.id);
      setSelectedAttachmentId(attachment.id);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setRelationNotice(null);
    },
    [
      clampBox,
      pageNum,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      updateBox,
    ]
  );

  const extendWireGeometry = useCallback(
    (boxId: string, segmentBox: BBoxPx) => {
      const now = new Date().toISOString();
      setAnnotationStatus("dirty");
      setBoxes((current) => {
        undoSnapshot(current);
        const next = extendWireGeometryInBoxes(current, {
          boxId,
          segmentBox,
          zoom,
          pageNum,
          capturedAt: now,
        });
        boxesRef.current = next;
        return next;
      });
      setSelectedBoxId(boxId);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
    },
    [
      pageNum,
      setAnnotationStatus,
      setBoxes,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      undoSnapshot,
      zoom,
      boxesRef,
    ]
  );

  const reconcileTouchedWireEndpointContacts = useCallback(
    (
      scope: { wireBoxId?: string; endpointId?: string } = {},
      options: { recordHistory?: boolean } = {}
    ) => {
      const current = boxesRef.current;
      const now = new Date().toISOString();
      const { boxes: next, addedCount } = reconcileTouchedWireEndpointContactsInBoxes(
        current,
        pageNum,
        now,
        scope
      );
      if (addedCount === 0) {
        setRelationNotice("No unlinked touching endpoints found.");
        return;
      }
      if (options.recordHistory) undoSnapshot(current);
      boxesRef.current = next;
      setBoxes(next);
      setAnnotationStatus("dirty");
      setRelationNotice(
        `Linked ${addedCount} touching wire endpoint${addedCount === 1 ? "" : "s"}.`
      );
    },
    [
      boxesRef,
      pageNum,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      undoSnapshot,
    ]
  );

  const reconcileTouchedCableReferenceConnectionPoints = useCallback(
    (options: { recordHistory?: boolean } = {}) => {
      const current = boxesRef.current;
      const now = new Date().toISOString();
      const { boxes: next, addedCount } =
        reconcileTouchedCableReferenceConnectionPointsInBoxes(
          current,
          pageNum,
          now
        );
      if (addedCount === 0) {
        return;
      }
      if (options.recordHistory) undoSnapshot(current);
      boxesRef.current = next;
      setBoxes(next);
      setAnnotationStatus("dirty");
      setRelationNotice(
        `Linked ${addedCount} touching cable-reference connection point${addedCount === 1 ? "" : "s"}.`
      );
    },
    [
      boxesRef,
      pageNum,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      undoSnapshot,
    ]
  );

  const createConnectionPointForSelectedRoot = useCallback(() => {
    const now = new Date().toISOString();
    const authored = buildConnectionPointAuthoring({
      selectedBox,
      cursorPx,
      zoom,
      pageNum,
      capturedAt: now,
    });
    if (authored.status === "blocked") {
      setRelationNotice(authored.notice);
      return;
    }
    if (!selectedBox) return;
    if (authored.status === "existing") {
      setSelectedAttachmentId(authored.attachment.id);
      setConnectionPointEditor({
        boxId: selectedBox.id,
        attachmentId: authored.attachment.id,
        value: authored.attachment.text === "connection"
          ? ""
          : authored.attachment.text,
      });
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setRelationNotice(null);
      return;
    }
    const { attachment } = authored;
    setAnnotationStatus("dirty");
    setBoxes((current) => {
      undoSnapshot(current);
      const withConnectionPoint = current.map((box) =>
        box.id === selectedBox.id
          ? {
              ...box,
              metadata: {
                ...box.metadata,
                attachments: [...attachmentsOf(box), attachment],
              },
              updatedAt: now,
            }
          : box
      );
      const wireResult = reconcileTouchedWireEndpointContactsInBoxes(
        withConnectionPoint,
        pageNum,
        now
      );
      const { boxes: next } =
        reconcileTouchedCableReferenceConnectionPointsInBoxes(
          wireResult.boxes,
          pageNum,
          now
        );
      boxesRef.current = next;
      return next;
    });
    setSelectedAttachmentId(attachment.id);
    setConnectionPointEditor({
      boxId: selectedBox.id,
      attachmentId: attachment.id,
      value: "",
    });
    setTypeMenuAttachmentId(null);
    setTypeMenuBoxId(null);
    setRelationNotice(null);
  }, [
    cursorPx,
    pageNum,
    selectedBox,
    setAnnotationStatus,
    setConnectionPointEditor,
    setRelationNotice,
    setSelectedAttachmentId,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    setBoxes,
    undoSnapshot,
    zoom,
    boxesRef,
  ]);

  const commitConnectionPointEditor = useCallback(() => {
    if (!connectionPointEditor) return;
    const text = connectionPointEditor.value.trim() || "connection";
    updateAttachment(
      connectionPointEditor.boxId,
      connectionPointEditor.attachmentId,
      (attachment) => ({
        ...attachment,
        text,
      }),
      { recordHistory: true }
    );
    const [nextEditorTarget, ...remainingQueue] =
      connectionPointEditor.queue ?? [];
    if (nextEditorTarget) {
      setSelectedAttachmentId(nextEditorTarget.attachmentId);
      setConnectionPointEditor({
        ...nextEditorTarget,
        value: "",
        queue: remainingQueue,
      });
      return;
    }
    setConnectionPointEditor(null);
  }, [
    connectionPointEditor,
    setConnectionPointEditor,
    setSelectedAttachmentId,
    updateAttachment,
  ]);

  const cancelConnectionPointEditor = useCallback(() => {
    setConnectionPointEditor(null);
  }, [setConnectionPointEditor]);

  return {
    addWireRootLinkedToConnectionPoint,
    linkExistingWireToConnectionPoint,
    addGroundReferenceRootLinkedToWire,
    addAttachmentFromPoint,
    addManualAttachment,
    addAttachmentFromExisting,
    extendWireGeometry,
    reconcileTouchedWireEndpointContacts,
    reconcileTouchedCableReferenceConnectionPoints,
    createConnectionPointForSelectedRoot,
    commitConnectionPointEditor,
    cancelConnectionPointEditor,
  } as const;
}

export type AnnotationLinkingActionHookResult = ReturnType<typeof useStudioAnnotationLinkingActions>;
