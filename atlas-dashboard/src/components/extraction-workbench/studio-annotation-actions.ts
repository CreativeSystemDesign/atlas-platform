import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { buildComponentRootAnnotation } from "./component-root-authoring";
import type { ComponentSnapResult } from "./component-snap";
import { buildConnectorRootAnnotation } from "./connector-authoring";
import {
  addRootSnapAnnotationToBoxes,
} from "./root-snap-annotation";
import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers";
import { normalizeManualWireSegmentBox } from "./manual-wire-geometry";
import { extendWireGeometryInBoxes } from "./wire-geometry-extension";
import { reconcileTouchedCableReferenceConnectionPointsInBoxes } from "./cable-reference-connection-point";
import { reconcileTouchedWireEndpointContactsInBoxes } from "./wire-link-reconciliation";
import { useStudioDescriptorAnnotationActions } from "./studio-annotation-descriptor-actions";
import { useStudioAnnotationLinkingActions } from "./studio-annotation-linking-actions";
import { useStudioAnnotationTypeActions } from "./studio-annotation-type-actions";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { fetchPageMetadata } from "./studio-api";
import { snapComponentBoxToShapes } from "./component-snap";
import { type BBoxPx, MIN_BOX_SIZE } from "./studio-geometry";
import { yoloComponentLabelCandidates } from "./yolo-label-candidates";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationStatus,
  type AnnotationWorkspaceMode,
  type ConnectionPointEditorState,
  type LabelCandidate,
  type PageMetadata,
  type RootSnapCandidate,
  type StudioTool,
  DOCUMENT_ID,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  PROJECT_ID,
  SNAP_PADDING_PDF,
  type SnapStrength,
} from "./studio-types";

const YOLO_CENTER_CLICK_SEARCH_SIZE_PX = 520;

type SetStateValue<T> = Dispatch<SetStateAction<T>>;

function yoloAutosnapExpandedBeyondSearch(snappedBox: BBoxPx, searchBox: BBoxPx) {
  const tolerancePx = 6;
  return (
    snappedBox.x < searchBox.x - tolerancePx ||
    snappedBox.y < searchBox.y - tolerancePx ||
    snappedBox.x + snappedBox.width >
      searchBox.x + searchBox.width + tolerancePx ||
    snappedBox.y + snappedBox.height >
      searchBox.y + searchBox.height + tolerancePx
  );
}

type AnnotationActionContext = {
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  pageMetadata: PageMetadata | null;
  snapStrength: SnapStrength;
  zoom: number;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  cursorPx: { x: number; y: number } | null;
  setBoxes: SetStateValue<AnnotationBox[]>;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  undoSnapshot: (snapshot: AnnotationBox[]) => void;
  setAnnotationStatus: SetStateValue<AnnotationStatus>;
  setMetadataStatus: SetStateValue<"loading" | "ready" | "error">;
  setPageMetadata: SetStateValue<PageMetadata | null>;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setRelationNotice: (notice: string | null) => void;
  setTool: (tool: StudioTool) => void;
  connectionPointEditor: ConnectionPointEditorState | null;
  setConnectionPointEditor: (state: ConnectionPointEditorState | null) => void;
  resolveLabelCandidates: (componentBox: BBoxPx) => LabelCandidate[];
  resolveWireLabelCandidates: (wireBox: BBoxPx) => LabelCandidate[];
  resolveAttachmentCandidate: (
    point: { x: number; y: number }
  ) => RootSnapCandidate | null;
  resolveContinuationCandidate: (
    point: { x: number; y: number }
  ) => RootSnapCandidate | null;
  resolveGroundReferenceCandidate: (
    point: { x: number; y: number }
  ) => RootSnapCandidate | null;
  snapComponentBox: (
    roughBox: BBoxPx,
    options?: { requireEnclosedComponent?: boolean }
  ) => ComponentSnapResult;
  clampBox: (box: BBoxPx) => BBoxPx;
};

export function useStudioAnnotationActions({
  pageNum,
  annotationWorkspaceMode,
  pageMetadata,
  snapStrength,
  zoom,
  selectedBox,
  selectedAttachment,
  cursorPx,
  setBoxes,
  boxesRef,
  setAnnotationStatus,
  setMetadataStatus,
  setPageMetadata,
  undoSnapshot,
  setSelectedBoxId,
  setSelectedAttachmentId,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  setRelationNotice,
  setTool,
  connectionPointEditor,
  setConnectionPointEditor,
  resolveLabelCandidates,
  resolveWireLabelCandidates,
  resolveAttachmentCandidate,
  resolveContinuationCandidate,
  resolveGroundReferenceCandidate,
  snapComponentBox,
  clampBox,
}: AnnotationActionContext) {
  const updateBox = useCallback(
    (
      boxId: string,
      updater: (box: AnnotationBox) => AnnotationBox,
      options: { recordHistory?: boolean } = {}
    ) => {
      setAnnotationStatus("dirty");
      setBoxes((current) => {
        if (options.recordHistory) undoSnapshot(current);
        const next = current.map((box) => (box.id === boxId ? updater(box) : box));
        boxesRef.current = next;
        return next;
      });
    },
    [setBoxes, setAnnotationStatus, undoSnapshot, boxesRef]
  );

  const updateAttachment = useCallback(
    (
      boxId: string,
      attachmentId: string,
      updater: (attachment: AnnotationAttachment) => AnnotationAttachment,
      options: { recordHistory?: boolean } = {}
    ) => {
      updateBox(
        boxId,
        (box) => ({
          ...box,
          metadata: {
            ...box.metadata,
            attachments: attachmentsOf(box).map((attachment) =>
              attachment.id === attachmentId ? updater(attachment) : attachment
            ),
          },
          updatedAt: new Date().toISOString(),
        }),
        options
      );
    },
    [updateBox]
  );

  const addBox = useCallback(
    (roughBox: BBoxPx, options: { manualLabel?: string } = {}) => {
      const now = new Date().toISOString();
      const snapped = snapComponentBox(roughBox);
      const manualLabel = options.manualLabel?.trim();
      const labelCandidates = manualLabel
        ? []
        : resolveLabelCandidates(snapped.bbox);
      const id = `page-${pageNum}-box-${crypto.randomUUID()}`;
      const authored = buildComponentRootAnnotation({
        roughBox,
        snappedBox: snapped,
        labelCandidates,
        manualLabel,
        annotationWorkspaceMode,
        id,
        pageNum,
        capturedAt: now,
      });
      if (authored.status === "blocked") return;
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
    },
    [
      pageNum,
      annotationWorkspaceMode,
      resolveLabelCandidates,
      snapComponentBox,
      boxesRef,
      setBoxes,
      setAnnotationStatus,
      setSelectedBoxId,
      setSelectedAttachmentId,
      setTypeMenuAttachmentId,
      undoSnapshot,
    ]
  );

  const addYoloAutosnapComponentFromPoint = useCallback(
    async (point: { x: number; y: number }) => {
      if (annotationWorkspaceMode !== "yolo") return;
      const roughBox = clampBox({
        x: point.x - YOLO_CENTER_CLICK_SEARCH_SIZE_PX / 2,
        y: point.y - YOLO_CENTER_CLICK_SEARCH_SIZE_PX / 2,
        width: YOLO_CENTER_CLICK_SEARCH_SIZE_PX,
        height: YOLO_CENTER_CLICK_SEARCH_SIZE_PX,
      });
      let snapped = snapComponentBox(roughBox, {
        requireEnclosedComponent: true,
      });
      if (snapped.reason === "metadata_unavailable") {
        setMetadataStatus("loading");
        try {
          const metadata = await fetchPageMetadata(
            fetch,
            agentBaseUrl(),
            PROJECT_ID,
            DOCUMENT_ID,
            pageNum
          );
          setPageMetadata(metadata);
          setMetadataStatus("ready");
          snapped = snapComponentBoxToShapes({
            roughBox,
            scale: metadata.scale,
            shapes: metadata.shapes ?? [],
            pageSize: {
              width: PAGE_WIDTH_PX,
              height: PAGE_HEIGHT_PX,
            },
            snapPaddingPdf: SNAP_PADDING_PDF,
            snapStrength,
            requireEnclosedComponent: true,
          });
        } catch (error) {
          setMetadataStatus("error");
          const message =
            error instanceof Error ? error.message : "metadata request failed";
          setRelationNotice(`YOLO autosnap failed: ${message}.`);
          return;
        }
      }
      if (!snapped.snapped) {
        setRelationNotice(
          `YOLO autosnap failed: ${snapped.reason ?? "no_enclosed_component"}.`
        );
        return;
      }
      if (yoloAutosnapExpandedBeyondSearch(snapped.bbox, roughBox)) {
        setRelationNotice(
          "YOLO autosnap rejected: snapped bbox expanded outside the component search area."
        );
        return;
      }

      const labelCandidates = yoloComponentLabelCandidates(
        resolveLabelCandidates(snapped.bbox),
        snapped.bbox
      );
      if (labelCandidates.length === 0) {
        setRelationNotice("YOLO annotation blocked: no component label candidate found from OCR/metadata.");
        return;
      }

      const now = new Date().toISOString();
      const id = `page-${pageNum}-yolo-${crypto.randomUUID()}`;
      const authored = buildComponentRootAnnotation({
        roughBox,
        snappedBox: snapped,
        labelCandidates,
        annotationWorkspaceMode,
        id,
        pageNum,
        capturedAt: now,
      });
      if (authored.status === "blocked") return;

      const box = {
        ...authored.box,
        metadata: {
          ...authored.box.metadata,
          yolo: {
            authoringMode: "center_click_autosnap",
            clickedPoint: point,
            searchBox: roughBox,
            labelSource: "ocr_metadata",
          },
        },
      };
      setBoxes((current) => {
        undoSnapshot(current);
        const next = [...current, box];
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setRelationNotice(
        `YOLO component bbox added; metadata candidate ${labelCandidates[0].normalizedText}.`
      );
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      clampBox,
      pageNum,
      resolveLabelCandidates,
      setAnnotationStatus,
      setBoxes,
      setMetadataStatus,
      setPageMetadata,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      snapStrength,
      snapComponentBox,
      undoSnapshot,
    ]
  );

  const addYoloManualComponentBox = useCallback(
    (roughBox: BBoxPx) => {
      if (annotationWorkspaceMode !== "yolo") return;
      const bbox = clampBox(roughBox);
      if (bbox.width < MIN_BOX_SIZE || bbox.height < MIN_BOX_SIZE) return;

      const labelCandidates = yoloComponentLabelCandidates(
        resolveLabelCandidates(bbox),
        bbox
      );
      if (labelCandidates.length === 0) {
        setRelationNotice("YOLO annotation blocked: no component label candidate found from OCR/metadata.");
        return;
      }
      const now = new Date().toISOString();
      const id = `page-${pageNum}-yolo-${crypto.randomUUID()}`;
      const authored = buildComponentRootAnnotation({
        roughBox: bbox,
        snappedBox: {
          bbox,
          snapped: false,
        },
        labelCandidates,
        annotationWorkspaceMode,
        id,
        pageNum,
        capturedAt: now,
      });
      if (authored.status === "blocked") return;

      const box = {
        ...authored.box,
        labelCandidates,
        labelCandidateIndex: labelCandidates.length > 0 ? 0 : -1,
        labelSource:
          labelCandidates.length > 0
            ? labelCandidates[0].source
            : authored.box.labelSource,
        metadata: {
          ...authored.box.metadata,
          rootType: "component" as const,
          yolo: {
            authoringMode: "manual_bbox",
            exactDrawnBox: bbox,
            labelSource: "ocr_metadata",
          },
        },
      };

      setBoxes((current) => {
        undoSnapshot(current);
        const next = [...current, box];
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setRelationNotice(
        `YOLO component bbox added; metadata candidate ${labelCandidates[0].normalizedText}.`
      );
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      clampBox,
      pageNum,
      resolveLabelCandidates,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoSnapshot,
    ]
  );

  const addYoloContinuationFromPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (annotationWorkspaceMode !== "yolo") return;
      const candidate = resolveContinuationCandidate(point);
      if (!candidate || candidate.type !== "continuation") {
        setRelationNotice(
          "YOLO continuation tool failed: no continuation symbol at the clicked point."
        );
        return;
      }

      const now = new Date().toISOString();
      const id = `page-${pageNum}-yolo-${crypto.randomUUID()}`;
      setBoxes((current) => {
        undoSnapshot(current);
        const candidateForTraining: RootSnapCandidate = {
          ...candidate,
          text: "continuation",
        };
        const { boxes, createdBox } = addRootSnapAnnotationToBoxes(current, {
          candidate: candidateForTraining,
          id,
          pageNum,
          zoom,
          source: "yolo-continuation-symbol-tool",
          capturedAt: now,
          labelCandidates: [],
        });
        const next = boxes.map((box) =>
          box.id === id
            ? {
                ...createdBox,
                metadata: {
                  ...createdBox.metadata,
                  yolo: {
                    authoringMode: "continuation_symbol",
                    clickedPoint: point,
                    referenceLabel: candidate.text,
                    bankSize: 1,
                  },
                },
              }
            : box
        );
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setRelationNotice("YOLO continuation bbox added.");
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      pageNum,
      resolveContinuationCandidate,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoSnapshot,
      zoom,
    ]
  );

  const addYoloManualContinuationBox = useCallback(
    (roughBox: BBoxPx) => {
      if (annotationWorkspaceMode !== "yolo") return;
      const bbox = clampBox(roughBox);
      if (bbox.width < MIN_BOX_SIZE || bbox.height < MIN_BOX_SIZE) return;

      const now = new Date().toISOString();
      const id = `page-${pageNum}-yolo-${crypto.randomUUID()}`;
      const candidate: RootSnapCandidate = {
        bbox,
        text: "continuation",
        type: "continuation",
      };

      setBoxes((current) => {
        undoSnapshot(current);
        const { boxes, createdBox } = addRootSnapAnnotationToBoxes(current, {
          candidate,
          id,
          pageNum,
          zoom,
          source: "yolo-continuation-manual-box-tool",
          capturedAt: now,
          labelCandidates: [],
        });
        const next = boxes.map((box) =>
          box.id === id
            ? {
                ...createdBox,
                snapped: false,
                metadata: {
                  ...createdBox.metadata,
                  yolo: {
                    authoringMode: "continuation_manual_bbox",
                    exactDrawnBox: bbox,
                  },
                },
              }
            : box
        );
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setRelationNotice("YOLO continuation manual bbox added.");
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      clampBox,
      pageNum,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoSnapshot,
      zoom,
    ]
  );

  const addYoloGroundReferenceFromPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (annotationWorkspaceMode !== "yolo") return;
      const candidate = resolveGroundReferenceCandidate(point);
      if (!candidate || candidate.type !== "ground_reference") {
        setRelationNotice(
          "YOLO ground tool failed: no ground symbol at the clicked point."
        );
        return;
      }

      const now = new Date().toISOString();
      const id = `page-${pageNum}-yolo-${crypto.randomUUID()}`;
      setBoxes((current) => {
        undoSnapshot(current);
        const { boxes, createdBox } = addRootSnapAnnotationToBoxes(current, {
          candidate,
          id,
          pageNum,
          zoom,
          source: "yolo-continuation-shift-ground-tool",
          capturedAt: now,
          labelCandidates: [],
        });
        const next = boxes.map((box) =>
          box.id === id
            ? {
                ...createdBox,
                metadata: {
                  ...createdBox.metadata,
                  yolo: {
                    authoringMode: "continuation_shift_ground",
                    clickedPoint: point,
                  },
                },
              }
            : box
        );
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setRelationNotice("YOLO ground bbox added.");
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      pageNum,
      resolveGroundReferenceCandidate,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoSnapshot,
      zoom,
    ]
  );

  const addRootSnapBox = useCallback(
    (candidate: RootSnapCandidate, source: string) => {
      if (candidate.bbox.width < MIN_BOX_SIZE || candidate.bbox.height < MIN_BOX_SIZE) {
        return;
      }
      const now = new Date().toISOString();
      const id = `page-${pageNum}-root-${crypto.randomUUID()}`;
      const labelCandidates = candidate.type === "wire_segment"
        ? resolveWireLabelCandidates(candidate.bbox)
        : [];
      setBoxes((current) => {
        undoSnapshot(current);
        const { boxes: next } = addRootSnapAnnotationToBoxes(current, {
          candidate,
          id,
          pageNum,
          zoom,
          source,
          capturedAt: now,
          labelCandidates,
        });
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTool("select");
    },
    [
      pageNum,
      resolveWireLabelCandidates,
      boxesRef,
      setBoxes,
      setAnnotationStatus,
      setSelectedBoxId,
      setSelectedAttachmentId,
      setTypeMenuAttachmentId,
      setTool,
      undoSnapshot,
      zoom,
    ]
  );

  const addConnectorBox = useCallback(
    (roughBox: BBoxPx, pairCount: number) => {
      const bbox = clampBox(roughBox);
      const now = new Date().toISOString();
      const id = `page-${pageNum}-connector-${crypto.randomUUID()}`;
      const authored = buildConnectorRootAnnotation({
        id,
        bbox,
        pairCount,
        pageNum,
        zoom,
        capturedAt: now,
      });
      if (authored.status === "blocked") {
        setRelationNotice("Connector needs at least one terminal pair.");
        return;
      }
      setBoxes((current) => {
        undoSnapshot(current);
        const withConnector = [...current, authored.box];
        const wireResult = reconcileTouchedWireEndpointContactsInBoxes(
          withConnector,
          pageNum,
          now
        );
        const cableReferenceResult =
          reconcileTouchedCableReferenceConnectionPointsInBoxes(
            wireResult.boxes,
            pageNum,
            now
          );
        boxesRef.current = cableReferenceResult.boxes;
        return cableReferenceResult.boxes;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      const [firstConnectionPointId, ...remainingConnectionPointIds] =
        authored.connectionPointIds;
      setSelectedAttachmentId(firstConnectionPointId ?? null);
      if (firstConnectionPointId) {
        setConnectionPointEditor({
          boxId: id,
          attachmentId: firstConnectionPointId,
          value: "",
          queue: remainingConnectionPointIds.map((attachmentId) => ({
            boxId: id,
            attachmentId,
          })),
        });
      }
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setTool("select");
    },
    [
      boxesRef,
      clampBox,
      pageNum,
      setAnnotationStatus,
      setBoxes,
      setConnectionPointEditor,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTool,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      undoSnapshot,
      zoom,
    ]
  );

  const addCableSegmentBox = useCallback(
    (roughBox: BBoxPx) => {
      const bbox = clampBox(roughBox);
      if (bbox.width < MIN_BOX_SIZE || bbox.height < MIN_BOX_SIZE) {
        return;
      }
      const now = new Date().toISOString();
      const id = `page-${pageNum}-cable-${crypto.randomUUID()}`;
      setBoxes((current) => {
        undoSnapshot(current);
        const { boxes: next } = addRootSnapAnnotationToBoxes(current, {
          candidate: {
            bbox,
            text: "cable",
            type: "cable_segment",
          },
          id,
          pageNum,
          zoom,
          source: "manual_cable_segment",
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
      setTool("select");
    },
    [
      clampBox,
      pageNum,
      boxesRef,
      setBoxes,
      setAnnotationStatus,
      setSelectedBoxId,
      setSelectedAttachmentId,
      setTypeMenuAttachmentId,
      setTool,
      undoSnapshot,
      zoom,
    ]
  );

  const addCableReferenceBox = useCallback(
    (roughBox: BBoxPx) => {
      const bbox = clampBox(roughBox);
      if (bbox.width < MIN_BOX_SIZE || bbox.height < MIN_BOX_SIZE) {
        return;
      }
      const now = new Date().toISOString();
      const id = `page-${pageNum}-cable-reference-${crypto.randomUUID()}`;
      setBoxes((current) => {
        undoSnapshot(current);
        const { boxes: next } = addRootSnapAnnotationToBoxes(current, {
          candidate: {
            bbox,
            text: "cable reference",
            type: "cable_reference",
          },
          id,
          pageNum,
          zoom,
          source: "manual_cable_reference",
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
      setTool("select");
    },
    [
      clampBox,
      pageNum,
      boxesRef,
      setBoxes,
      setAnnotationStatus,
      setSelectedBoxId,
      setSelectedAttachmentId,
      setTypeMenuAttachmentId,
      setTool,
      undoSnapshot,
      zoom,
    ]
  );

  const addManualWireSegmentBox = useCallback(
    (roughBox: BBoxPx, targetBoxId: string | null = null) => {
      const bbox = normalizeManualWireSegmentBox(roughBox, { clampBox });
      if (!bbox) return;
      const now = new Date().toISOString();
      const targetWire = targetBoxId
        ? boxesRef.current.find(
            (box) => box.id === targetBoxId && rootTypeOf(box) === "wire_segment"
          )
        : null;
      if (targetWire) {
        setBoxes((current) => {
          undoSnapshot(current);
          const next = extendWireGeometryInBoxes(current, {
            boxId: targetWire.id,
            segmentBox: bbox,
            zoom,
            pageNum,
            capturedAt: now,
            source: "manual_wire_segment_extend",
          });
          boxesRef.current = next;
          return next;
        });
        setAnnotationStatus("dirty");
        setSelectedBoxId(targetWire.id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setTool("select");
        return;
      }

      const id = `page-${pageNum}-root-${crypto.randomUUID()}`;
      const labelCandidates = resolveWireLabelCandidates(bbox);
      setBoxes((current) => {
        undoSnapshot(current);
        const { boxes: next } = addRootSnapAnnotationToBoxes(current, {
          candidate: {
            bbox,
            text: "",
            type: "wire_segment",
          },
          id,
          pageNum,
          zoom,
          source: "manual_wire_segment",
          capturedAt: now,
          labelCandidates,
        });
        boxesRef.current = next;
        return next;
      });
      setAnnotationStatus("dirty");
      setSelectedBoxId(id);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTool("select");
    },
    [
      boxesRef,
      clampBox,
      pageNum,
      resolveWireLabelCandidates,
      setAnnotationStatus,
      setBoxes,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTool,
      setTypeMenuAttachmentId,
      undoSnapshot,
      zoom,
    ]
  );

  const { addCircuitDescriptorRoot, addCircuitDescriptorRegion, addPageDescriptorRoot } =
    useStudioDescriptorAnnotationActions({
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
  });

  const {
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
  } = useStudioAnnotationLinkingActions({
    annotationWorkspaceMode,
    pageNum,
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
  });

  const { changeSelectedAttachmentType, changeAttachmentType, changeRootType } =
    useStudioAnnotationTypeActions({
      annotationWorkspaceMode,
      selectedBox,
      selectedAttachment,
      boxesRef,
      resolveLabelCandidates,
      updateAttachment,
      updateBox,
      setRelationNotice,
      setSelectedBoxId,
      setSelectedAttachmentId,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
    });


  return {
    updateBox,
    updateAttachment,
    addBox,
    addYoloAutosnapComponentFromPoint,
    addYoloManualComponentBox,
    addYoloContinuationFromPoint,
    addYoloManualContinuationBox,
    addYoloGroundReferenceFromPoint,
    addConnectorBox,
    addCableSegmentBox,
    addCableReferenceBox,
    addManualWireSegmentBox,
    addRootSnapBox,
    addCircuitDescriptorRoot,
    addCircuitDescriptorRegion,
    addPageDescriptorRoot,
    addWireRootLinkedToConnectionPoint,
    linkExistingWireToConnectionPoint,
    addGroundReferenceRootLinkedToWire,
    addAttachmentFromPoint,
    addManualAttachment,
    addAttachmentFromExisting,
    extendWireGeometry,
    reconcileTouchedWireEndpointContacts,
    reconcileTouchedCableReferenceConnectionPoints,
    changeSelectedAttachmentType,
    changeAttachmentType,
    changeRootType,
    createConnectionPointForSelectedRoot,
    commitConnectionPointEditor,
    cancelConnectionPointEditor,
  };
}

export type AnnotationActionHookResult = ReturnType<typeof useStudioAnnotationActions>;
