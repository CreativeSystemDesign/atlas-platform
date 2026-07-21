import { attachmentsOf } from "./annotation-box-helpers.ts";
import {
  inferRelationForAttachment,
  rootObjectTypeLabel,
  strictAttachmentRelation,
  type RootObjectKind,
} from "./annotation-model.ts";
import { normalizeSymbolText } from "./annotation-labeling.ts";
import type {
  AnnotationBox,
  AnnotationWorkspaceMode,
  LabelCandidate,
} from "./studio-types.ts";
import { isObjectDetectionWorkspace } from "./studio-types.ts";
import {
  toTrainingDatasetComponentLabelCandidate,
  trainingDatasetComponentLabelBboxForManualLabel,
} from "./component-label-prefix.ts";

export function retypeRootAnnotationBox(
  box: AnnotationBox,
  type: RootObjectKind,
  {
    labelCandidates,
    annotationWorkspaceMode = "digital_twin",
    updatedAt,
  }: {
    labelCandidates: LabelCandidate[];
    annotationWorkspaceMode?: AnnotationWorkspaceMode;
    updatedAt: string;
  }
): AnnotationBox {
  const resolvedLabelCandidates =
    isObjectDetectionWorkspace(annotationWorkspaceMode) && type === "component"
      ? labelCandidates.map(toTrainingDatasetComponentLabelCandidate)
      : labelCandidates;
  const activeLabel =
    type === "component" ? resolvedLabelCandidates[0] ?? null : null;
  const currentLabelText = normalizeSymbolText(box.label);
  const currentLabelLooksLikeMark = /^[A-Z]{1,8}\d+[A-Z]?$/.test(
    currentLabelText
  );
  const preserveCurrentComponentMark =
    !isObjectDetectionWorkspace(annotationWorkspaceMode) &&
    type === "component" &&
    currentLabelLooksLikeMark;
  const currentLabelCandidateIndex = resolvedLabelCandidates.findIndex(
    (candidate) => candidate.normalizedText === currentLabelText
  );
  const nextLabel =
    (preserveCurrentComponentMark ? currentLabelText : null) ||
    activeLabel?.normalizedText ||
    (isObjectDetectionWorkspace(annotationWorkspaceMode) && type === "component"
      ? currentLabelText.match(/^[A-Z]+/)?.[0]
      : null) ||
    (box.label && box.label !== "text" && box.label !== "wire segment"
      ? box.label
      : rootObjectTypeLabel(type));
  const trainingDatasetCurrentLabelBbox =
    isObjectDetectionWorkspace(annotationWorkspaceMode) && type === "component"
      ? trainingDatasetComponentLabelBboxForManualLabel(
          { ...box, labelCandidates: resolvedLabelCandidates },
          nextLabel
        )
      : null;
  const nextLabelBbox =
    (preserveCurrentComponentMark ? box.labelBbox ?? box.bbox : null) ||
    activeLabel?.bbox ||
    trainingDatasetCurrentLabelBbox ||
    box.labelBbox;

  return {
    ...box,
    label: nextLabel,
    labelBbox: nextLabelBbox,
    labelSource:
      preserveCurrentComponentMark
        ? "manual"
        : activeLabel?.source ?? box.labelSource,
    labelCandidateIndex:
      preserveCurrentComponentMark
        ? currentLabelCandidateIndex >= 0
          ? currentLabelCandidateIndex
          : -1
        : activeLabel
          ? 0
          : box.labelCandidateIndex,
    labelCandidates: resolvedLabelCandidates,
    metadata: {
      ...box.metadata,
      rootType: type,
      attachments: attachmentsOf(box).map((attachment) => ({
        ...attachment,
        relation:
          strictAttachmentRelation(
            type,
            attachment.type,
            attachment.parentAttachmentId
          ) ??
          attachment.relation ??
          inferRelationForAttachment(type, attachment),
      })),
    },
    updatedAt,
  };
}
