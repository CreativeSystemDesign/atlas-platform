import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { agentBaseUrl } from "@/lib/agent-base-url";
import type { ComponentSnapResult } from "./component-snap";
import { applyAnnotationModeChange } from "./studio-mode";
import { type AnnotationBox, type AnnotationMode, type AnnotationStatus, type AnnotationWorkspaceMode, type ConnectionPointEditorState, type LabelCandidate, type PageMetadata, type RootSnapCandidate, type SnapStrength, type StudioTool, type SymbolBankEntry, type WireLabelBankEntry, DOCUMENT_ID, PAGE_HEIGHT_PX, PAGE_WIDTH_PX, PROJECT_ID, isObjectDetectionWorkspace } from "./studio-types";
import { annotationsForPageSave, replacePageAnnotations } from "./studio-page-annotations";
import {
  googleObjectDetectionExportUrl,
  pageTruthUrl,
  qwen3vlColabDatasetExportUrl,
  savePageAnnotations as savePageAnnotationsRequest,
  yolov26ExportUrl,
} from "./studio-api";
import { type BBoxPx, type PageSizePx,} from "./studio-geometry";
import {
  attachmentCandidateAtPoint,
  continuationCandidatesAtPoint,
  continuationCandidateAtPoint,
  groundReferenceCandidateAtPoint,
  wireSegmentCandidateAtPoint,
} from "./studio-root-candidates";
import {
  componentLabelCandidates,
  textForLabelBox,
  wireLabelCandidatesForSegment,
} from "./studio-label-candidates";
import type { InteractionSession } from "./studio-types";
import { rootTypeOf } from "./annotation-box-helpers";

const STUDIO_PAGE_SIZE: PageSizePx = {
  width: PAGE_WIDTH_PX,
  height: PAGE_HEIGHT_PX,
};

type LoadStatus = "loading" | "ready" | "error";

type ResolveTextForLabelBox = (
  labelBox: BBoxPx,
  options?: { mergeLines?: boolean; mergeScale?: number }
) =>
  | {
      text: string;
      normalizedText?: string;
      bbox: BBoxPx;
      score?: number;
      overlap?: number;
      insideCenter?: boolean;
    }
  | null;

type LabelLookup = (componentBox: BBoxPx) => LabelCandidate[];
type WireLabelLookup = (wireBox: BBoxPx) => LabelCandidate[];
type CandidateLookup = (point: { x: number; y: number }) => RootSnapCandidate | null;

type UseStudioWorkspaceOperationsArgs = {
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  selectedBox: AnnotationBox | null;
  pageMetadata: PageMetadata | null;
  symbolBank: SymbolBankEntry[];
  wireLabelBank: WireLabelBankEntry[];
  zoom: number;
  snapStrength: SnapStrength;
  getVisiblePageBox: () => BBoxPx | null;
  setPageNum: Dispatch<SetStateAction<number>>;
  setImageStatus: Dispatch<SetStateAction<LoadStatus>>;
  setMetadataStatus: Dispatch<SetStateAction<LoadStatus>>;
  setAnnotationStatus: Dispatch<SetStateAction<AnnotationStatus>>;
  setPageMetadata: Dispatch<SetStateAction<PageMetadata | null>>;
  setCursorPx: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setSelectedBoxId: (boxId: string | null) => void;
  setSelectedAttachmentId: Dispatch<SetStateAction<string | null>>;
  interactionRef: MutableRefObject<InteractionSession | null>;
  setDraftBox: Dispatch<SetStateAction<BBoxPx | null>>;
  setTool: (tool: StudioTool) => void;
  setActiveMode: (mode: AnnotationMode) => void;
  setConnectionPointEditor: (state: ConnectionPointEditorState | null) => void;
  setTypeMenuAttachmentId: (attachmentId: string | null) => void;
  setTypeMenuBoxId: (boxId: string | null) => void;
  undoSnapshot: (snapshot: AnnotationBox[]) => void;
  boxesRef: MutableRefObject<AnnotationBox[]>;
  setBoxes: Dispatch<SetStateAction<AnnotationBox[]>>;
  refreshHistoryControls: () => void;
  setLastSavedAt: Dispatch<SetStateAction<string | null>>;
  snapComponentBox: (
    roughBox: BBoxPx,
    options?: { requireEnclosedComponent?: boolean; snapPaddingPdf?: number }
  ) => ComponentSnapResult;
  undoStackRef: MutableRefObject<AnnotationBox[][]>;
  redoStackRef: MutableRefObject<AnnotationBox[][]>;
  refreshClassTracker: () => void | Promise<void>;
};

export function useStudioWorkspaceOperations({
  pageNum,
  annotationWorkspaceMode,
  selectedBox,
  pageMetadata,
  symbolBank,
  wireLabelBank,
  zoom,
  snapStrength,
  getVisiblePageBox,
  setPageNum,
  setImageStatus,
  setMetadataStatus,
  setAnnotationStatus,
  setPageMetadata,
  setCursorPx,
  setPan,
  setSelectedBoxId,
  setSelectedAttachmentId,
  interactionRef,
  setDraftBox,
  setTool,
  setActiveMode,
  setConnectionPointEditor,
  setTypeMenuAttachmentId,
  setTypeMenuBoxId,
  undoSnapshot,
  boxesRef,
  setBoxes,
  refreshHistoryControls,
  setLastSavedAt,
  snapComponentBox,
  undoStackRef,
  redoStackRef,
  refreshClassTracker,
}: UseStudioWorkspaceOperationsArgs) {
  const changePage = useCallback(
    (delta: number) => {
      setPageNum((current) => Math.max(1, Math.min(129, current + delta)));
      setImageStatus("loading");
      setMetadataStatus("loading");
      setAnnotationStatus("loading");
      setPageMetadata(null);
      setCursorPx(null);
      setPan({ x: 0, y: 0 });
      setSelectedBoxId(null);
      setSelectedAttachmentId(null);
      interactionRef.current = null;
      setDraftBox(null);
    },
    [
      interactionRef,
      setCursorPx,
      setDraftBox,
      setImageStatus,
      setMetadataStatus,
      setAnnotationStatus,
      setPageMetadata,
      setPageNum,
      setPan,
      setSelectedAttachmentId,
      setSelectedBoxId,
    ]
  );

  const resolveLabelCandidates: LabelLookup = useCallback(
    (componentBox: BBoxPx) => {
      return componentLabelCandidates({
        componentBox,
        pageMetadata,
        symbolBank,
        datasetClassLabels:
          isObjectDetectionWorkspace(annotationWorkspaceMode) ||
          annotationWorkspaceMode === "yolo",
        includeInsideTextCandidates: annotationWorkspaceMode === "yolo",
        visiblePageBox: getVisiblePageBox(),
      });
    },
    [annotationWorkspaceMode, getVisiblePageBox, pageMetadata, symbolBank]
  );

  const resolveTextForLabelBox: ResolveTextForLabelBox = useCallback(
    (
      labelBox: BBoxPx,
      options?: {
        mergeLines?: boolean;
        mergeScale?: number;
        includeAdjacentOutsideBox?: boolean;
      }
    ) => {
      return textForLabelBox({ labelBox, pageMetadata, ...options });
    },
    [pageMetadata]
  );

  const resolveWireLabelCandidates: WireLabelLookup = useCallback(
    (wireBox: BBoxPx) => {
      return wireLabelCandidatesForSegment({
        wireBox,
        pageMetadata,
        wireLabelBank,
        visiblePageBox: getVisiblePageBox(),
      });
    },
    [getVisiblePageBox, pageMetadata, wireLabelBank]
  );

  const resolveGroundReferenceCandidate: CandidateLookup = useCallback(
    (point: { x: number; y: number }) => {
      return groundReferenceCandidateAtPoint({
        point,
        pageMetadata,
        pageSize: STUDIO_PAGE_SIZE,
      });
    },
    [pageMetadata]
  );

  const resolveContinuationCandidate: CandidateLookup = useCallback(
    (point: { x: number; y: number }) => {
      return continuationCandidateAtPoint({
        point,
        pageMetadata,
        pageSize: STUDIO_PAGE_SIZE,
      });
    },
    [pageMetadata]
  );

  const resolveContinuationCandidates = useCallback(
    (point: { x: number; y: number }) => {
      return continuationCandidatesAtPoint({
        point,
        pageMetadata,
        pageSize: STUDIO_PAGE_SIZE,
      });
    },
    [pageMetadata]
  );

  const resolveAttachmentCandidate: CandidateLookup = useCallback(
    (point: { x: number; y: number }) => {
      const textSnap =
        isObjectDetectionWorkspace(annotationWorkspaceMode) &&
        selectedBox &&
        rootTypeOf(selectedBox) === "component"
          ? "tight"
          : "normal";
      return attachmentCandidateAtPoint({
        point,
        pageMetadata,
        zoom,
        pageSize: STUDIO_PAGE_SIZE,
        symbolBank,
        wireLabelBank,
        snapStrength,
        textSnap,
      });
    },
    [
      annotationWorkspaceMode,
      pageMetadata,
      selectedBox,
      snapStrength,
      symbolBank,
      wireLabelBank,
      zoom,
    ]
  );

  const resolveWireSegmentCandidate: CandidateLookup = useCallback(
    (point: { x: number; y: number }) => {
      return wireSegmentCandidateAtPoint({
        point,
        pageMetadata,
        zoom,
        pageSize: STUDIO_PAGE_SIZE,
        snapStrength,
      });
    },
    [pageMetadata, snapStrength, zoom]
  );

  const snapSelectedBox = useCallback(() => {
    if (!selectedBox) return;
    const snapped = snapComponentBox(selectedBox.bbox);
    setBoxes((current) => {
      const next = current.map((box) =>
        box.id === selectedBox.id
          ? {
              ...box,
              bbox: snapped.bbox,
              snapped: snapped.snapped,
              updatedAt: new Date().toISOString(),
            }
          : box
      );
      undoSnapshot(current);
      boxesRef.current = next;
      return next;
    });
  }, [boxesRef, selectedBox, setBoxes, snapComponentBox, undoSnapshot]);

  const handleModeChange = useCallback(
    (mode: AnnotationMode) => {
      applyAnnotationModeChange(mode, {
        setActiveMode,
        setTool,
        clearModeTransientState: () => {
          setConnectionPointEditor(null);
          setTypeMenuAttachmentId(null);
          setTypeMenuBoxId(null);
        },
      });
    },
    [
      setActiveMode,
      setConnectionPointEditor,
      setTool,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
    ]
  );

  const savePageAnnotations = useCallback(async () => {
    setAnnotationStatus("saving");
    try {
      const annotationsToSave = annotationsForPageSave(boxesRef.current, pageNum);
      const payload = await savePageAnnotationsRequest(
        fetch,
        agentBaseUrl(),
        PROJECT_ID,
        DOCUMENT_ID,
        pageNum,
        annotationsToSave,
        annotationWorkspaceMode
      );
      setBoxes((current) => {
        const next = replacePageAnnotations(
          current,
          pageNum,
          payload.annotations ?? []
        );
        boxesRef.current = next;
        return next;
      });
      undoStackRef.current = [];
      redoStackRef.current = [];
      refreshHistoryControls();
      setLastSavedAt(new Date().toISOString());
      setAnnotationStatus("saved");
      void refreshClassTracker();
    } catch {
      setAnnotationStatus("error");
    }
  }, [
    boxesRef,
    pageNum,
    annotationWorkspaceMode,
    refreshHistoryControls,
    setAnnotationStatus,
    setBoxes,
    setLastSavedAt,
    undoStackRef,
    redoStackRef,
    refreshClassTracker,
  ]);

  const exportTruthUrl = pageTruthUrl(
    agentBaseUrl(),
    PROJECT_ID,
    DOCUMENT_ID,
    pageNum,
    annotationWorkspaceMode
  );
  const exportYolov26Url = yolov26ExportUrl(
    agentBaseUrl(),
    PROJECT_ID,
    DOCUMENT_ID,
    annotationWorkspaceMode
  );
  const exportGoogleObjectDetectionUrl = googleObjectDetectionExportUrl(
    agentBaseUrl(),
    PROJECT_ID,
    DOCUMENT_ID,
    undefined,
    annotationWorkspaceMode
  );
  const exportQwen3vlColabDatasetUrl = qwen3vlColabDatasetExportUrl(
    agentBaseUrl(),
    PROJECT_ID,
    DOCUMENT_ID,
    annotationWorkspaceMode
  );

  return {
    changePage,
    resolveLabelCandidates,
    resolveTextForLabelBox,
    resolveGroundReferenceCandidate,
    resolveContinuationCandidate,
    resolveContinuationCandidates,
    resolveAttachmentCandidate,
    resolveWireSegmentCandidate,
    resolveWireLabelCandidates,
    snapSelectedBox,
    handleModeChange,
    savePageAnnotations,
    exportTruthUrl,
    exportYolov26Url,
    exportGoogleObjectDetectionUrl,
    exportQwen3vlColabDatasetUrl,
  };
}
