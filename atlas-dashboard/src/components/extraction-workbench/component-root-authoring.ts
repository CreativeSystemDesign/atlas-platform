import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import { normalizeSymbolText } from "./annotation-labeling.ts";
import { MIN_BOX_SIZE, type BBoxPx } from "./studio-geometry.ts";
import { toTrainingDatasetComponentLabelCandidate } from "./component-label-prefix.ts";
import { componentIdentityMetadataFromSymbol } from "./component-parts-tag.ts";
import { yoloComponentDisplayLabel } from "./yolo-label-candidates.ts";
import type {
  AnnotationBox,
  AnnotationWorkspaceMode,
  LabelCandidate,
} from "./studio-types.ts";
import { isObjectDetectionWorkspace, isYoloWorkspace } from "./studio-types.ts";

export type ComponentSnapResult = {
  bbox: BBoxPx;
  snapped: boolean;
};

export type ComponentRootAuthoringResult =
  | {
      status: "created";
      box: AnnotationBox;
    }
  | {
      status: "blocked";
    };

export function buildComponentRootAnnotation({
  roughBox,
  snappedBox,
  labelCandidates,
  manualLabel,
  annotationWorkspaceMode = "digital_twin",
  id,
  pageNum,
  capturedAt,
}: {
  roughBox: BBoxPx;
  snappedBox: ComponentSnapResult;
  labelCandidates: LabelCandidate[];
  manualLabel?: string;
  annotationWorkspaceMode?: AnnotationWorkspaceMode;
  id: string;
  pageNum: number;
  capturedAt: string;
}): ComponentRootAuthoringResult {
  if (roughBox.width < MIN_BOX_SIZE || roughBox.height < MIN_BOX_SIZE) {
    return { status: "blocked" };
  }

  const resolvedLabelCandidates =
    isObjectDetectionWorkspace(annotationWorkspaceMode)
      ? labelCandidates.map(toTrainingDatasetComponentLabelCandidate)
      : labelCandidates;
  const isYolo = isYoloWorkspace(annotationWorkspaceMode);
  const normalizedManualLabel = manualLabel
    && !isYolo
    ? normalizeSymbolText(manualLabel)
    : "";
  const activeLabel = resolvedLabelCandidates[0] ?? null;
  if (isYolo && !activeLabel) {
    return { status: "blocked" };
  }
  const componentIdentity = componentIdentityMetadataFromSymbol(
    activeLabel?.symbol
  );
  const yoloClassLabel = activeLabel ? yoloComponentDisplayLabel(activeLabel) : "";
  return {
    status: "created",
    box: {
      id,
      pageNum,
      label: isYolo
        ? yoloClassLabel
        : normalizedManualLabel || activeLabel?.normalizedText || "component",
      bbox: snappedBox.bbox,
      labelBbox: normalizedManualLabel ? null : activeLabel?.bbox ?? null,
      labelSource: normalizedManualLabel ? "manual" : activeLabel?.source ?? "manual",
      labelCandidateIndex: normalizedManualLabel ? -1 : activeLabel ? 0 : -1,
      labelCandidates: normalizedManualLabel ? [] : resolvedLabelCandidates,
      source: "human",
      snapped: snappedBox.snapped,
      metadata: {
        rootType: "component",
        attachments: [],
        ...(componentIdentity ? { componentIdentity } : {}),
        provenance: buildSpatialProvenance(
          snappedBox.bbox,
          pageNum,
          snappedBox.snapped ? "component_snap" : "component_manual",
          capturedAt
        ),
        physicalSizePx: physicalSizeOf(snappedBox.bbox),
      },
      createdAt: capturedAt,
      updatedAt: capturedAt,
    },
  };
}
