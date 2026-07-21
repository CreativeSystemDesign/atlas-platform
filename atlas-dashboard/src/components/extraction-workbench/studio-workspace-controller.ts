import { useCallback, useEffect, useRef, useState } from "react";

import { agentBaseUrl } from "@/lib/agent-base-url";
import {
  detectQwenRoi,
  detectYolov26Page,
  fetchClassTracker,
  savePageAnnotations as savePageAnnotationsRequest,
} from "./studio-api";
import { replacePageAnnotations } from "./studio-page-annotations";
import { useStudioHistory } from "./studio-history-handler";
import { useStudioViewport } from "./studio-viewport-state";
import { useStudioPageData } from "./studio-page-data";
import { useStudioWorkspaceMutations } from "./studio-workspace-mutations";
import { useStudioWorkspaceDerivations } from "./studio-workspace-derivations";
import { useStudioWorkspaceEffects } from "./studio-workspace-effects";
import { useStudioWorkspaceState } from "./studio-workspace-state";
import type { StudioWorkspaceScreenProps } from "./studio-workspace-screen";
import { useStudioWorkspaceCommands } from "./studio-workspace-commands";
import { useStudioWorkspaceInteractionHandlers } from "./studio-workspace-interaction-handlers";
import type { WorkspacePaneProps } from "./studio-workspace-pane";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence";
import { detectTerminalBlockFromText } from "./terminal-block-authoring";
import {
  type BBoxPx,
} from "./studio-geometry";
import {
  type AnnotationWorkspaceMode,
  type AnnotationBox,
  type YoloTool,
  type Yolov26DetectSettings,
  DOCUMENT_ID,
  PROJECT_ID,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
} from "./studio-types";

/** Tracks a pending cable-to-terminal connection initiated by shift-click */
type PendingCableConnection = {
  cableBoxId: string;
  cableEndpointId: string;
  terminalBlockId: string;
  terminalPositionId: string;
} | null;

const DEFAULT_YOLOV26_DETECT_SETTINGS: Yolov26DetectSettings = {
  conf: 0.55,
  iou: 0.25,
  imgsz: 1280,
  agnosticNms: true,
};

function boxesIntersect(a: BBoxPx, b: BBoxPx) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function resizeBoxFromCenter(box: BBoxPx, delta: number): BBoxPx {
  const nextWidth = Math.max(1, box.width + delta * 2);
  const nextHeight = Math.max(1, box.height + delta * 2);
  const nextX = Math.max(0, Math.min(PAGE_WIDTH_PX - nextWidth, box.x - delta));
  const nextY = Math.max(0, Math.min(PAGE_HEIGHT_PX - nextHeight, box.y - delta));
  return {
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  };
}

function markYoloBoxHumanEdited(box: AnnotationBox, bbox: BBoxPx): AnnotationBox {
  const capturedAt = new Date().toISOString();
  return {
    ...box,
    source: "human",
    bbox,
    snapped: false,
    metadata: {
      ...box.metadata,
      reviewStatus: "human-edited",
      provenance: buildSpatialProvenance(
        bbox,
        box.pageNum,
        "human_yolo_bulk_expand",
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(bbox),
    },
  };
}

export function useStudioWorkspaceController(): StudioWorkspaceScreenProps {
  const [annotationWorkspaceMode, setAnnotationWorkspaceMode] =
    useState<AnnotationWorkspaceMode>("digital_twin");
  const [lastComponentManualLabel, setLastComponentManualLabel] = useState("");
  const [yoloAnnotationsVisible, setYoloAnnotationsVisible] = useState(true);
  const [yoloHumanAnnotationsVisible, setYoloHumanAnnotationsVisible] =
    useState(false);
  const [yoloTool, setYoloTool] = useState<YoloTool>("manual_bbox");
  const [yoloBulkSelectedBoxIds, setYoloBulkSelectedBoxIds] = useState<string[]>(
    []
  );
  const [yolov26DetectSettings, setYolov26DetectSettings] =
    useState<Yolov26DetectSettings>(DEFAULT_YOLOV26_DETECT_SETTINGS);
  const [pendingCableConnection, setPendingCableConnection] = useState<PendingCableConnection>(
    null
  );
  const {
    activeMode,
    setActiveMode,
    componentAuthoringMode,
    setComponentAuthoringMode,
    wireAuthoringMode,
    setWireAuthoringMode,
    cableAuthoringMode,
    setCableAuthoringMode,
    pageNum,
    setPageNum,
    zoom,
    setZoom,
    pan,
    setPan,
    tool,
    setTool,
    snapStrength,
    setSnapStrength,
    overlayPillsVisible,
    setOverlayPillsVisible,
    imageStatus,
    setImageStatus,
    metadataStatus,
    setMetadataStatus,
    symbolBankStatus,
    setSymbolBankStatus,
    symbolBankSource,
    setSymbolBankSource,
    symbolBank,
    setSymbolBank,
    wireLabelBankStatus,
    setWireLabelBankStatus,
    wireLabelBankSource,
    setWireLabelBankSource,
    wireLabelBank,
    setWireLabelBank,
    classTrackerStatus,
    setClassTrackerStatus,
    classTrackerCounts,
    setClassTrackerCounts,
    classTrackerTotal,
    setClassTrackerTotal,
    pageMetadata,
    setPageMetadata,
    cursorPx,
    setCursorPx,
    hoverStack,
    setHoverStack,
    boxes,
    setBoxes,
    selectedBoxId,
    setSelectedBoxId,
    selectedAttachmentId,
    setSelectedAttachmentId,
    connectionPointEditor,
    setConnectionPointEditor,
    connectorTerminalPrompt,
    setConnectorTerminalPrompt,
    componentLabelPrompt,
    setComponentLabelPrompt,
    typeMenuAttachmentId,
    setTypeMenuAttachmentId,
    typeMenuBoxId,
    setTypeMenuBoxId,
    relationNotice,
    setRelationNotice,
    draftBox,
    setDraftBox,
    annotationStatus,
    setAnnotationStatus,
    lastSavedAt,
    setLastSavedAt,
    stageRef,
    interactionRef,
    hoverStackCyclingRef,
    hoverStackIndexRef,
    boxesRef,
    undoStackRef,
    redoStackRef,
  } = useStudioWorkspaceState();

  const refreshClassTracker = useCallback(async () => {
    setClassTrackerStatus("loading");
    try {
      const payload = await fetchClassTracker(
        fetch,
        agentBaseUrl(),
        PROJECT_ID,
        DOCUMENT_ID,
        annotationWorkspaceMode
      );
      setClassTrackerCounts(payload.classes ?? []);
      setClassTrackerTotal(payload.total ?? 0);
      setClassTrackerStatus("ready");
    } catch {
      setClassTrackerCounts([]);
      setClassTrackerTotal(0);
      setClassTrackerStatus("error");
    }
  }, [
    annotationWorkspaceMode,
    setClassTrackerCounts,
    setClassTrackerStatus,
    setClassTrackerTotal,
  ]);

  useEffect(() => {
    void refreshClassTracker();
  }, [refreshClassTracker]);

  const {
    historyControls,
    refreshHistoryControls,
    pushHistorySnapshotFrom,
    pushHistorySnapshot,
    undoLastEdit,
    redoLastEdit,
  } = useStudioHistory({
    boxesRef,
    undoStackRef,
    redoStackRef,
    setBoxes,
    setAnnotationStatus,
    setSelectedAttachmentId,
    setTypeMenuAttachmentId,
  });

  const changeAnnotationWorkspaceMode = useCallback(
    (mode: AnnotationWorkspaceMode) => {
      if (mode === annotationWorkspaceMode) return;
      if (annotationStatus === "dirty") {
        const confirmed = window.confirm(
          "Switch annotation workspace? Unsaved edits in the current workspace will be discarded."
        );
        if (!confirmed) return;
      }
      setAnnotationWorkspaceMode(mode);
      setAnnotationStatus("loading");
      setBoxes([]);
      boxesRef.current = [];
      undoStackRef.current = [];
      redoStackRef.current = [];
      refreshHistoryControls();
      setSelectedBoxId(null);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setTypeMenuBoxId(null);
      setConnectionPointEditor(null);
      setConnectorTerminalPrompt(null);
      setComponentLabelPrompt(null);
      setDraftBox(null);
      setRelationNotice(null);
      setLastSavedAt(null);
      if (mode === "yolo") {
        setActiveMode("component");
        setComponentAuthoringMode("component");
        setTool("box");
        setYoloAnnotationsVisible(true);
        setYoloHumanAnnotationsVisible(false);
      }
    },
    [
      annotationStatus,
      annotationWorkspaceMode,
      boxesRef,
      redoStackRef,
      refreshHistoryControls,
      setAnnotationStatus,
      setBoxes,
      setConnectorTerminalPrompt,
      setComponentLabelPrompt,
      setConnectionPointEditor,
      setDraftBox,
      setLastSavedAt,
      setRelationNotice,
      setActiveMode,
      setComponentAuthoringMode,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTool,
      setYoloAnnotationsVisible,
      setYoloHumanAnnotationsVisible,
      setTypeMenuAttachmentId,
      setTypeMenuBoxId,
      undoStackRef,
    ]
  );

  const {
    boxesForPage,
    selectedBox,
    selectedAttachment,
    relationshipTruthRows,
    relationshipHighlights,
    connectionPointEditorTarget,
    validationIssues,
    overlayLabels,
    imageSrc,
  } = useStudioWorkspaceDerivations({
    boxes,
    pageNum,
    annotationWorkspaceMode,
    yoloAnnotationsVisible,
    yoloHumanAnnotationsVisible,
    selectedBoxId,
    selectedAttachmentId,
    activeMode,
    overlayPillsVisible,
    zoom,
    connectionPointEditor,
  });

  useStudioWorkspaceEffects({
    relationNotice,
    setRelationNotice,
    boxes,
    boxesRef,
  });

  useEffect(() => {
    if (
      annotationWorkspaceMode === "yolo" &&
      !yoloHumanAnnotationsVisible &&
      selectedBox?.source === "human"
    ) {
      setSelectedBoxId(null);
      setSelectedAttachmentId(null);
    }
  }, [
    annotationWorkspaceMode,
    selectedBox,
    setSelectedAttachmentId,
    setSelectedBoxId,
    yoloHumanAnnotationsVisible,
  ]);

  useEffect(() => {
    if (
      annotationWorkspaceMode === "yolo" &&
      !yoloAnnotationsVisible &&
      selectedBox?.source === "ai-proposal"
    ) {
      setSelectedBoxId(null);
      setSelectedAttachmentId(null);
    }
  }, [
    annotationWorkspaceMode,
    selectedBox,
    setSelectedAttachmentId,
    setSelectedBoxId,
    yoloAnnotationsVisible,
  ]);

  useEffect(() => {
    setYoloBulkSelectedBoxIds([]);
  }, [annotationWorkspaceMode, pageNum]);

  useStudioPageData({
    pageNum,
    annotationWorkspaceMode,
    setMetadataStatus,
    setSymbolBankStatus,
    setSymbolBankSource,
    setWireLabelBankStatus,
    setWireLabelBankSource,
    setPageMetadata,
    setSymbolBank,
    setWireLabelBank,
    setBoxes,
    setAnnotationStatus,
    setSelectedAttachmentId,
    setTypeMenuAttachmentId,
    refreshHistoryControls,
    boxesRef,
    undoStackRef,
    redoStackRef,
  });

  const {
    setBoundedZoom,
    setZoomAtClientPoint,
    resetView,
    getPagePoint,
    getVisiblePageBox,
    updateCursorPosition,
    clampBox,
    normalizeBox,
    snapComponentBox,
  } = useStudioViewport({
    stageRef,
    pageMetadata,
    pan,
    zoom,
    snapStrength,
    boxesForPage,
    hoverStackCyclingRef,
    hoverStackIndexRef,
    setPan,
    setZoom,
    setCursorPx,
    setHoverStack,
  });

  const selectYoloBulkExpandBoxes = useCallback(
    (roi: BBoxPx) => {
      if (annotationWorkspaceMode !== "yolo") return;
      const selectedIds = boxesForPage
        .filter((box) => boxesIntersect(box.bbox, roi))
        .map((box) => box.id);
      setYoloBulkSelectedBoxIds(selectedIds);
      setSelectedAttachmentId(null);
      setSelectedBoxId(selectedIds[0] ?? null);
      setRelationNotice(
        selectedIds.length
          ? `Bulk expand active: ${selectedIds.length} YOLO bboxes selected. ArrowUp expands; ArrowDown contracts.`
          : "Bulk expand selected no bboxes."
      );
    },
    [
      annotationWorkspaceMode,
      boxesForPage,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
    ]
  );

  const resizeYoloBulkSelectedBoxes = useCallback(
    (delta: number) => {
      if (
        annotationWorkspaceMode !== "yolo" ||
        yoloBulkSelectedBoxIds.length === 0
      ) {
        return;
      }
      const selectedIds = new Set(yoloBulkSelectedBoxIds);
      setBoxes((current) => {
        const targetCount = current.filter(
          (box) => box.pageNum === pageNum && selectedIds.has(box.id)
        ).length;
        if (targetCount === 0) return current;
        pushHistorySnapshotFrom(current);
        const next = current.map((box) => {
          if (box.pageNum !== pageNum || !selectedIds.has(box.id)) return box;
          return markYoloBoxHumanEdited(
            box,
            clampBox(resizeBoxFromCenter(box.bbox, delta))
          );
        });
        boxesRef.current = next;
        setAnnotationStatus("dirty");
        setRelationNotice(
          `${targetCount} YOLO bboxes ${
            delta > 0 ? "expanded" : "contracted"
          } by 1 px.`
        );
        return next;
      });
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      clampBox,
      pageNum,
      pushHistorySnapshotFrom,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      yoloBulkSelectedBoxIds,
    ]
  );

  useEffect(() => {
    if (annotationWorkspaceMode !== "yolo") return;
    const handleBulkResizeKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        resizeYoloBulkSelectedBoxes(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        resizeYoloBulkSelectedBoxes(-1);
      }
    };
    window.addEventListener("keydown", handleBulkResizeKeyDown);
    return () => window.removeEventListener("keydown", handleBulkResizeKeyDown);
  }, [annotationWorkspaceMode, resizeYoloBulkSelectedBoxes]);

  const {
    changePage,
    resolveLabelCandidates,
    resolveTextForLabelBox,
    resolveGroundReferenceCandidate,
    resolveContinuationCandidate,
    resolveContinuationCandidates,
    resolveAttachmentCandidate,
    resolveWireSegmentCandidate,
    snapSelectedBox,
    handleModeChange,
    savePageAnnotations,
    exportTruthUrl,
    exportYolov26Url,
    exportGoogleObjectDetectionUrl,
    exportQwen3vlColabDatasetUrl,
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
  } = useStudioWorkspaceMutations({
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
    setPageMetadata,
    setCursorPx,
    setPan,
    selectedAttachment,
    cursorPx,
    setSelectedBoxId,
    setSelectedAttachmentId,
    interactionRef,
    setDraftBox,
    setTool,
    setActiveMode,
    setConnectionPointEditor,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    boxesRef,
    undoSnapshot: pushHistorySnapshotFrom,
    setAnnotationStatus,
    refreshHistoryControls,
    setLastSavedAt,
    snapComponentBox,
    undoStackRef,
    redoStackRef,
    setBoxes,
    refreshClassTracker,
    connectionPointEditor,
    clampBox,
    setRelationNotice,
  });

  const detectDatasetRoiFromPoint = useCallback(
    async (point: { x: number; y: number }) => {
      if (annotationWorkspaceMode !== "training_dataset") return;
      const cropSize = 768;
      const roi = clampBox({
        x: point.x - cropSize / 2,
        y: point.y - cropSize / 2,
        width: cropSize,
        height: cropSize,
      });
      setRelationNotice("Qwen ROI assist scanning the selected component area.");
      try {
        const result = await detectQwenRoi(
          fetch,
          agentBaseUrl(),
          PROJECT_ID,
          DOCUMENT_ID,
          pageNum,
          roi
        );
        if (!result.detection) {
          setRelationNotice("Qwen ROI assist did not find a centered component body.");
          return;
        }
        addBox(result.detection.bbox);
        const elapsed = result.elapsedMs > 0 ? ` in ${(result.elapsedMs / 1000).toFixed(1)}s` : "";
        setRelationNotice(`Qwen ROI assist added a component bbox${elapsed}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        setRelationNotice(`Qwen ROI assist failed: ${message}`);
      }
    },
    [
      addBox,
      annotationWorkspaceMode,
      clampBox,
      pageNum,
      setRelationNotice,
    ]
  );

  const detectYolov26CurrentPage = useCallback(async () => {
    if (annotationWorkspaceMode !== "yolo") return;
    setRelationNotice(
      `YOLOv26 detecting page ${pageNum} at conf ${yolov26DetectSettings.conf.toFixed(
        2
      )}, IoU ${yolov26DetectSettings.iou.toFixed(2)}.`
    );
    setAnnotationStatus("loading");
    try {
      const result = await detectYolov26Page(
        fetch,
        agentBaseUrl(),
        PROJECT_ID,
        DOCUMENT_ID,
        pageNum,
        yolov26DetectSettings
      );
      setBoxes((current) => {
        const next = replacePageAnnotations(
          current,
          pageNum,
          result.annotations ?? []
        );
        boxesRef.current = next;
        return next;
      });
      undoStackRef.current = [];
      redoStackRef.current = [];
      refreshHistoryControls();
      setSelectedBoxId(null);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setAnnotationStatus("saved");
      await refreshClassTracker();
      setRelationNotice(
        `YOLOv26 returned ${result.predictionCount} model boxes on page ${pageNum}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setAnnotationStatus("error");
      setRelationNotice(`YOLOv26 detection failed: ${message}`);
    }
  }, [
    annotationWorkspaceMode,
    boxesRef,
    pageNum,
    redoStackRef,
    refreshClassTracker,
    refreshHistoryControls,
    setAnnotationStatus,
    setBoxes,
    setRelationNotice,
    setSelectedAttachmentId,
    setSelectedBoxId,
    setTypeMenuAttachmentId,
    yolov26DetectSettings,
    undoStackRef,
  ]);

  const detectYolov26Area = useCallback(
    async (roi: { x: number; y: number; width: number; height: number }) => {
      if (annotationWorkspaceMode !== "yolo") return;
      setRelationNotice(
        `YOLOv26 detecting selected area on page ${pageNum}.`
      );
      setAnnotationStatus("loading");
      try {
        const result = await detectYolov26Page(
          fetch,
          agentBaseUrl(),
          PROJECT_ID,
          DOCUMENT_ID,
          pageNum,
          {
            ...yolov26DetectSettings,
            roi,
          }
        );
        setBoxes((current) => {
          const next = replacePageAnnotations(
            current,
            pageNum,
            result.annotations ?? []
          );
          boxesRef.current = next;
          return next;
        });
        undoStackRef.current = [];
        redoStackRef.current = [];
        refreshHistoryControls();
        setSelectedBoxId(null);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setAnnotationStatus("saved");
        setDraftBox(null);
        await refreshClassTracker();
        setRelationNotice(
          `YOLOv26 returned ${result.predictionCount} model boxes in selected area.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        setAnnotationStatus("error");
        setRelationNotice(`YOLOv26 area detection failed: ${message}`);
      } finally {
        setDraftBox(null);
      }
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      pageNum,
      redoStackRef,
      refreshClassTracker,
      refreshHistoryControls,
      setAnnotationStatus,
      setBoxes,
      setDraftBox,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoStackRef,
      yolov26DetectSettings,
    ]
  );

  const clearYoloCurrentPage = useCallback(async () => {
    if (annotationWorkspaceMode !== "yolo") return;
    const confirmed = window.confirm(
      `Remove all YOLO bboxes from page ${pageNum}?`
    );
    if (!confirmed) return;
    setRelationNotice(`Removing YOLO bboxes from page ${pageNum}.`);
    setAnnotationStatus("saving");
    try {
      const payload = await savePageAnnotationsRequest(
        fetch,
        agentBaseUrl(),
        PROJECT_ID,
        DOCUMENT_ID,
        pageNum,
        [],
        "yolo"
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
      setSelectedBoxId(null);
      setSelectedAttachmentId(null);
      setTypeMenuAttachmentId(null);
      setAnnotationStatus("saved");
      await refreshClassTracker();
      setRelationNotice(`Removed all YOLO bboxes from page ${pageNum}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setAnnotationStatus("error");
      setRelationNotice(`YOLO page clear failed: ${message}`);
    }
  }, [
    annotationWorkspaceMode,
    boxesRef,
    pageNum,
    redoStackRef,
    refreshClassTracker,
    refreshHistoryControls,
    setAnnotationStatus,
    setBoxes,
    setRelationNotice,
    setSelectedAttachmentId,
    setSelectedBoxId,
    setTypeMenuAttachmentId,
    undoStackRef,
  ]);

  const clearYoloCurrentPageBySource = useCallback(
    async (source: "ai-proposal" | "human") => {
      if (annotationWorkspaceMode !== "yolo") return;
      const label = source === "ai-proposal" ? "model" : "human";
      const confirmed = window.confirm(
        `Remove ${label} YOLO bboxes from page ${pageNum}?`
      );
      if (!confirmed) return;
      const remaining = boxesRef.current.filter(
        (box) => box.pageNum !== pageNum || box.source !== source
      );
      const pageRemaining = remaining.filter((box) => box.pageNum === pageNum);
      setRelationNotice(`Removing ${label} YOLO bboxes from page ${pageNum}.`);
      setAnnotationStatus("saving");
      try {
        const payload = await savePageAnnotationsRequest(
          fetch,
          agentBaseUrl(),
          PROJECT_ID,
          DOCUMENT_ID,
          pageNum,
          pageRemaining,
          "yolo"
        );
        setBoxes((current) => {
          const next = replacePageAnnotations(
            current.filter((box) => box.pageNum !== pageNum),
            pageNum,
            payload.annotations ?? []
          );
          boxesRef.current = next;
          return next;
        });
        undoStackRef.current = [];
        redoStackRef.current = [];
        refreshHistoryControls();
        setSelectedBoxId(null);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
        setAnnotationStatus("saved");
        await refreshClassTracker();
        setRelationNotice(`Removed ${label} YOLO bboxes from page ${pageNum}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        setAnnotationStatus("error");
        setRelationNotice(`YOLO ${label} bbox clear failed: ${message}`);
      }
    },
    [
      annotationWorkspaceMode,
      boxesRef,
      pageNum,
      redoStackRef,
      refreshClassTracker,
      refreshHistoryControls,
      setAnnotationStatus,
      setBoxes,
      setRelationNotice,
      setSelectedAttachmentId,
      setSelectedBoxId,
      setTypeMenuAttachmentId,
      undoStackRef,
    ]
  );

  const {
    stageHandlers,
    boxHandlers,
    cycleSelectedLabelCandidate,
    deleteSelectedBox,
    deleteSelectedAttachment,
  } = useStudioWorkspaceInteractionHandlers({
    activeMode,
    componentAuthoringMode,
    wireAuthoringMode,
    cableAuthoringMode,
    annotationWorkspaceMode,
    yoloTool,
    tool,
    pan,
    selectedBox,
    selectedAttachment,
    interactionRef,
    getPagePoint,
    getVisiblePageBox,
    setConnectionPointEditor,
    setRelationNotice,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    setSelectedBoxId,
    setSelectedAttachmentId,
    setDraftBox,
    undoLastEdit,
    addRootSnapBox,
    addCircuitDescriptorRoot,
    addPageDescriptorRoot,
    addWireRootLinkedToConnectionPoint,
    addGroundReferenceRootLinkedToWire,
    addAttachmentFromExisting,
    extendWireGeometry,
    boxesForPage,
    resolveLabelCandidates,
    resolveAttachmentCandidate,
    resolveContinuationCandidate,
    resolveContinuationSymbolCandidate: resolveContinuationCandidate,
    resolveGroundReferenceCandidate,
    resolveWireSegmentCandidate,
    resolveWireLabelObjectCandidate: resolveAttachmentCandidate,
    setPan,
    clampBox,
    normalizeBox,
    updateCursorPosition,
    pageNum,
    zoom,
    boxesRef,
    updateBox,
    updateAttachment,
    addBox,
    openConnectorTerminalPrompt: (roughBox) => {
      setConnectorTerminalPrompt({ bbox: roughBox, value: "3" });
    },
    addTerminalBlockBox: (roughBox) => {
      // Forward the bounding box to the terminal block authoring module
      const result = detectTerminalBlockFromText({
        boxBbox: roughBox,
        textBlocks: pageMetadata?.text_blocks ?? [],
        scale: pageMetadata?.scale ?? 1,
        pageNum,
        capturedAt: new Date().toISOString(),
      });
      if (result.status === "created") {
        const box = result.box;
        setBoxes((current) => {
          pushHistorySnapshotFrom(current);
          const next = [...current, box];
          boxesRef.current = next;
          return next;
        });
        setAnnotationStatus("dirty");
        setSelectedBoxId(box.id);
        setSelectedAttachmentId(null);
        setTypeMenuAttachmentId(null);
      }
    },
    openComponentLabelPrompt: (roughBox) => {
      if (annotationWorkspaceMode !== "training_dataset") {
        addBox(roughBox);
        return;
      }
      setComponentLabelPrompt({
        bbox: roughBox,
        value: lastComponentManualLabel,
      });
    },
    addCableSegmentBox,
    addCableReferenceBox,
    addManualWireSegmentBox,
    addAttachmentFromPoint,
    addCircuitDescriptorRegion,
    addManualAttachment,
    resolveTextForLabelBox,
    reconcileTouchedWireEndpointContacts,
    reconcileTouchedCableReferenceConnectionPoints,
    setZoomAtClientPoint,
    linkExistingWireToConnectionPoint,
    selectedBoxId,
    selectedAttachmentId,
    hoverStack,
    hoverStackCyclingRef,
    hoverStackIndexRef,
    stageRef,
    setBoxes,
    setTool,
    setAnnotationStatus,
    pushHistorySnapshotFrom,
    redoLastEdit,
    pushHistorySnapshot,
    createConnectionPointForSelectedRoot,
    changePage,
    detectDatasetRoiFromPoint,
    addYoloAutosnapComponentFromPoint,
    addYoloManualComponentBox,
    addYoloContinuationFromPoint,
    addYoloManualContinuationBox,
    addYoloGroundReferenceFromPoint,
    detectYolov26Area,
    selectYoloBulkExpandBoxes,
  });

  const {
    onPreviousPage,
    onNextPage,
    onZoomIn,
    onZoomOut,
    onResetView,
    onModeChange,
    onToolChange,
    onSnapSelected,
    onSavePage,
    onCycleLabelCandidate,
    onUndo,
    onRedo,
    onChangeRootType,
    onChangeAttachmentType,
    onCommitConnectionPointEditor,
    onCancelConnectionPointEditor,
    onChangeImageReady,
    onChangeImageError,
    canUndo,
    canRedo,
  } = useStudioWorkspaceCommands({
    zoom,
    changePage,
    setBoundedZoom,
    resetView,
    handleModeChange,
    setTool,
    snapSelectedBox,
    savePageAnnotations,
    cycleSelectedLabelCandidate,
    setImageStatus,
    undoLastEdit,
    redoLastEdit,
    canUndo: historyControls.canUndo,
    canRedo: historyControls.canRedo,
    changeRootType,
    changeAttachmentType,
    onCommitConnectionPointEditor: commitConnectionPointEditor,
    onCancelConnectionPointEditor: cancelConnectionPointEditor,
  });

  const workspacePaneProps: WorkspacePaneProps = {
    annotationWorkspaceMode,
    pageNum,
    zoom,
    pan,
    activeMode,
    componentAuthoringMode,
    wireAuthoringMode,
    cableAuthoringMode,
    tool,
    snapStrength,
    selectedBox,
    selectedAttachment,
    selectedBoxId,
    yoloBulkSelectedBoxIds,
    selectedAttachmentId,
    boxesForPage,
    relationshipHighlights,
    datasetClassHighlight: {
      className: null,
      rootBoxIds: new Set(),
      labelBoxIds: new Set(),
      attachmentIds: new Set(),
    },
    connectionPointEditor,
    connectorTerminalPrompt,
    componentLabelPrompt,
    connectionPointEditorTarget,
    overlayLabels,
    draftBox,
    imageSrc,
    imageStatus,
    cursorPx,
    symbolBankStatus,
    metadataStatus,
    annotationStatus,
    relationNotice,
    overlayPillsVisible,
    yoloAnnotationsVisible,
    yoloHumanAnnotationsVisible,
    yolov26DetectSettings,
    typeMenuAttachmentId,
    typeMenuBoxId,
    exportYolov26Url,
    exportGoogleObjectDetectionUrl,
    exportQwen3vlColabDatasetUrl,
    onPreviousPage,
    onNextPage,
    onZoomIn,
    onZoomOut,
    onResetView,
    onModeChange: (mode) => {
      setConnectorTerminalPrompt(null);
      setComponentLabelPrompt(null);
      onModeChange(mode);
    },
    onComponentAuthoringModeChange: (mode) => {
      setConnectorTerminalPrompt(null);
      setComponentLabelPrompt(null);
      setComponentAuthoringMode(mode);
    },
    onToolChange,
    onSnapStrengthChange: setSnapStrength,
    onCableAuthoringModeChange: setCableAuthoringMode,
    onWireAuthoringModeChange: setWireAuthoringMode,
    onSnapSelected,
    onCycleLabelCandidate,
    onSavePage,
    onDetectYoloPage: detectYolov26CurrentPage,
    yoloTool,
    onYoloToolChange: setYoloTool,
    onYolov26DetectSettingsChange: setYolov26DetectSettings,
    onClearYoloPage: clearYoloCurrentPage,
    onClearYoloAiPage: () => clearYoloCurrentPageBySource("ai-proposal"),
    onClearYoloHumanPage: () => clearYoloCurrentPageBySource("human"),
    onUndo,
    setSelectedBoxId,
    setSelectedAttachmentId,
    setTypeMenuAttachmentId,
    setTypeMenuBoxId,
    setOverlayPillsVisible,
    setYoloAnnotationsVisible,
    setYoloHumanAnnotationsVisible,
    setConnectionPointEditor,
    setConnectorTerminalPrompt,
    setComponentLabelPrompt,
    onConfirmConnectorTerminalPrompt: () => {
      if (!connectorTerminalPrompt) return;
      const pairCount = Number.parseInt(connectorTerminalPrompt.value, 10);
      if (!Number.isFinite(pairCount) || pairCount < 1 || pairCount > 64) {
        setRelationNotice(
          "Connector terminal-pair count must be between 1 and 64."
        );
        return;
      }
      addConnectorBox(connectorTerminalPrompt.bbox, pairCount);
      setConnectorTerminalPrompt(null);
    },
    onCancelConnectorTerminalPrompt: () => {
      setConnectorTerminalPrompt(null);
    },
    onConfirmComponentLabelPrompt: () => {
      if (!componentLabelPrompt) return;
      const manualLabel = componentLabelPrompt.value.trim();
      if (!manualLabel) {
        setRelationNotice("Component label text is required.");
        return;
      }
      addBox(componentLabelPrompt.bbox, { manualLabel });
      setLastComponentManualLabel(manualLabel);
      setComponentLabelPrompt(null);
    },
    onCancelComponentLabelPrompt: () => {
      setComponentLabelPrompt(null);
    },
    onChangeRootType,
    onChangeAttachmentType,
    onCommitConnectionPointEditor,
    onCancelConnectionPointEditor,
    setCursorPx,
    setHoverStack,
    hoverStackCyclingRef,
    hoverStackIndexRef,
    stageRef,
    stageHandlers,
    boxHandlers,
    onChangeImageReady,
    onChangeImageError,
    onAnnotationWorkspaceModeChange: changeAnnotationWorkspaceMode,
  };

  return {
    ...workspacePaneProps,
    relationshipTruthRows,
    validationIssues,
    symbolBankSource,
    wireLabelBankSource,
    wireLabelBankStatus,
    wireLabelBankCount: wireLabelBank.length,
    classTrackerStatus,
    classTrackerCounts,
    classTrackerTotal,
    lastSavedAt,
    exportTruthUrl,
    onRedo,
    canUndo,
    canRedo,
    changeSelectedAttachmentType,
    updateBox,
    deleteSelectedBox,
    deleteSelectedAttachment,
    reconcileTouchedWireEndpointContacts,
  };
}
