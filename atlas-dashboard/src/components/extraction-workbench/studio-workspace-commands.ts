import { useCallback } from "react";
import { type AnnotationMode, type StudioTool } from "./studio-types";
import { type AttachmentKind, type RootObjectKind } from "./annotation-model";

type StudioWorkspaceCommandInputs = {
  zoom: number;
  changePage: (delta: number) => void;
  setBoundedZoom: (zoom: number) => void;
  resetView: () => void;
  handleModeChange: (mode: AnnotationMode) => void;
  setTool: (tool: StudioTool) => void;
  snapSelectedBox: () => void;
  savePageAnnotations: () => void;
  cycleSelectedLabelCandidate: (direction: 1 | -1) => void;
  setImageStatus: (status: "loading" | "ready" | "error") => void;
  undoLastEdit: () => void;
  redoLastEdit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  changeRootType: (boxId: string, type: RootObjectKind) => void;
  changeAttachmentType: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  onCommitConnectionPointEditor: () => void;
  onCancelConnectionPointEditor: () => void;
};

export type StudioWorkspaceCommandHandlers = {
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onModeChange: (mode: AnnotationMode) => void;
  onToolChange: (tool: StudioTool) => void;
  onSnapSelected: () => void;
  onSavePage: () => void;
  onCycleLabelCandidate: (direction: 1 | -1) => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeRootType: (boxId: string, type: RootObjectKind) => void;
  onChangeAttachmentType: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
  onCommitConnectionPointEditor: () => void;
  onCancelConnectionPointEditor: () => void;
  onChangeImageReady: () => void;
  onChangeImageError: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useStudioWorkspaceCommands({
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
  canUndo,
  canRedo,
  changeRootType,
  changeAttachmentType,
  onCommitConnectionPointEditor,
  onCancelConnectionPointEditor,
}: StudioWorkspaceCommandInputs): StudioWorkspaceCommandHandlers {
  const onPreviousPage = useCallback(() => changePage(-1), [changePage]);
  const onNextPage = useCallback(() => changePage(1), [changePage]);
  const onZoomIn = useCallback(
    () => setBoundedZoom(zoom + 0.06),
    [zoom, setBoundedZoom]
  );
  const onZoomOut = useCallback(
    () => setBoundedZoom(zoom - 0.06),
    [zoom, setBoundedZoom]
  );
  const onResetView = useCallback(() => resetView(), [resetView]);
  const onSnapSelected = useCallback(() => snapSelectedBox(), [snapSelectedBox]);
  const onChangeImageReady = useCallback(
    () => setImageStatus("ready"),
    [setImageStatus]
  );
  const onChangeImageError = useCallback(
    () => setImageStatus("error"),
    [setImageStatus]
  );
  const onUndo = useCallback(() => undoLastEdit(), [undoLastEdit]);
  const onRedo = useCallback(() => redoLastEdit(), [redoLastEdit]);
  const onCycleLabelCandidate = useCallback(
    (direction: 1 | -1) => cycleSelectedLabelCandidate(direction),
    [cycleSelectedLabelCandidate]
  );

  return {
    onPreviousPage,
    onNextPage,
    onZoomIn,
    onZoomOut,
    onResetView,
    onModeChange: handleModeChange,
    onToolChange: setTool,
    onSnapSelected,
    onSavePage: savePageAnnotations,
    onCycleLabelCandidate,
    onUndo,
    onRedo,
    onChangeRootType: changeRootType,
    onChangeAttachmentType: changeAttachmentType,
    onCommitConnectionPointEditor,
    onCancelConnectionPointEditor,
    onChangeImageReady,
    onChangeImageError,
    canUndo,
    canRedo,
  };
}
