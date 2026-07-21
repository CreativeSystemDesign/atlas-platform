import { useMemo } from "react";

import { buildRelationshipGraph } from "./relationship-graph";
import { buildRelationshipHighlightMap } from "./relationship-highlight";
import { relationshipTruthRowsForSelection } from "./relationship-truth-rows";
import { pageValidationIssues } from "./page-validation-issues";
import { layoutOverlayLabels } from "./overlay-label-layout";
import { agentBaseUrl } from "@/lib/agent-base-url";
import {
  type AnnotationAttachment,
  type AnnotationBox,
  type AnnotationMode,
  type ConnectionPointEditorState,
  type AnnotationWorkspaceMode,
  isYoloWorkspace,
} from "./studio-types";
import {
  boxesForPage as selectBoxesForPage,
  selectedAttachmentForBox,
  selectedBoxById,
  studioImageSrc,
} from "./studio-derived-state";
import { DOCUMENT_ID, PROJECT_ID } from "./studio-types";

type WorkspaceDerivationInputs = {
  boxes: AnnotationBox[];
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  yoloAnnotationsVisible: boolean;
  yoloHumanAnnotationsVisible: boolean;
  selectedBoxId: string | null;
  selectedAttachmentId: string | null;
  activeMode: AnnotationMode;
  overlayPillsVisible: boolean;
  zoom: number;
  connectionPointEditor: ConnectionPointEditorState | null;
};

type WorkspaceDerivations = {
  boxesForPage: AnnotationBox[];
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  relationshipGraph: ReturnType<typeof buildRelationshipGraph>;
  relationshipTruthRows: ReturnType<typeof relationshipTruthRowsForSelection>;
  relationshipHighlights: ReturnType<typeof buildRelationshipHighlightMap>;
  connectionPointEditorTarget: {
    box: AnnotationBox;
    attachment: AnnotationAttachment;
  } | null;
  validationIssues: ReturnType<typeof pageValidationIssues>;
  overlayLabels: ReturnType<typeof layoutOverlayLabels>;
  imageSrc: string;
};

export function useStudioWorkspaceDerivations({
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
}: WorkspaceDerivationInputs): WorkspaceDerivations {
  const boxesForPage = useMemo(
    () => {
      const pageBoxes = selectBoxesForPage(boxes, pageNum);
      if (!isYoloWorkspace(annotationWorkspaceMode)) {
        return pageBoxes;
      }
      return pageBoxes.filter((box) => {
        if (!yoloHumanAnnotationsVisible && box.source === "human") return false;
        if (!yoloAnnotationsVisible && box.source === "ai-proposal") return false;
        return true;
      });
    },
    [
      annotationWorkspaceMode,
      boxes,
      pageNum,
      yoloAnnotationsVisible,
      yoloHumanAnnotationsVisible,
    ]
  );

  const selectedBox = useMemo(
    () => selectedBoxById(boxes, selectedBoxId),
    [boxes, selectedBoxId]
  );

  const selectedAttachment = useMemo(
    () => selectedAttachmentForBox(selectedBox, selectedAttachmentId),
    [selectedAttachmentId, selectedBox]
  );

  const relationshipGraph = useMemo(
    () => buildRelationshipGraph(boxesForPage),
    [boxesForPage]
  );

  const relationshipTruthRows = useMemo(
    () =>
      relationshipTruthRowsForSelection(
        relationshipGraph,
        {
          selectedBoxId,
          selectedAttachmentId,
        },
        { scope: activeMode === "trace" ? "trace" : "local" }
      ),
    [activeMode, relationshipGraph, selectedAttachmentId, selectedBoxId]
  );

  const relationshipHighlights = useMemo(
    () => buildRelationshipHighlightMap(relationshipTruthRows),
    [relationshipTruthRows]
  );

  const connectionPointEditorTarget = useMemo(
    () =>
      (() => {
        if (!connectionPointEditor) return null;
        const box = selectedBoxById<AnnotationBox>(boxes, connectionPointEditor.boxId);
        const attachment = selectedAttachmentForBox(box, connectionPointEditor.attachmentId);
        if (!box || !attachment) return null;
        return { box, attachment };
      })(),
    [boxes, connectionPointEditor]
  );

  const validationIssues = useMemo(
    () => pageValidationIssues(boxesForPage),
    [boxesForPage]
  );

  const overlayLabels = useMemo(
    () =>
      overlayPillsVisible && activeMode !== "trace"
        ? layoutOverlayLabels(boxesForPage, zoom)
        : [],
    [activeMode, boxesForPage, overlayPillsVisible, zoom]
  );

  const imageSrc = useMemo(
    () => studioImageSrc(agentBaseUrl(), PROJECT_ID, DOCUMENT_ID, pageNum),
    [pageNum]
  );

  return {
    boxesForPage,
    selectedBox,
    selectedAttachment,
    relationshipGraph,
    relationshipTruthRows,
    relationshipHighlights,
    connectionPointEditorTarget,
    validationIssues,
    overlayLabels,
    imageSrc,
  };
}
