"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import {
  BoxEdgeHitTargets,
  BoxMoveHitTarget,
  BoxResizeEdgeHitTargets,
  ResizeHandleButton,
} from "./annotation-overlay-primitives";
import {
  annotationBboxStyle,
  bboxStrokeStyle,
  componentColorStyle,
  labelBoxClass,
  labelBoxShadowClass,
} from "./annotation-styles";
import { RESIZE_HANDLES } from "./studio-selection-helpers";
import {
  isObjectDetectionWorkspace,
  isYoloWorkspace,
  type AnnotationBox,
  type AnnotationWorkspaceMode,
} from "./studio-types";

type AnnotationLabelOverlayProps = {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  selected: boolean;
  selectedAttachmentId: string | null;
  canEdit: boolean;
  overlayPillsVisible: boolean;
  labelIsRootText: boolean;
  datasetClassHighlighted: boolean;
  onLabelPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onLabelResizePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    box: AnnotationBox,
    handle: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se"
  ) => void;
};

export function AnnotationLabelOverlay({
  box,
  annotationWorkspaceMode,
  zoom,
  selected,
  selectedAttachmentId,
  canEdit,
  overlayPillsVisible,
  labelIsRootText,
  datasetClassHighlighted,
  onLabelPointerDown,
  onLabelResizePointerDown,
}: AnnotationLabelOverlayProps) {
  if (isYoloWorkspace(annotationWorkspaceMode) || !box.labelBbox) {
    return null;
  }

  const componentColor = componentColorStyle(box.id, annotationWorkspaceMode);
  const isDatasetWorkspace = isObjectDetectionWorkspace(annotationWorkspaceMode);

  return (
    <div
      className={`pointer-events-none absolute z-20 border-2 ${labelBoxClass(
        selected,
        annotationWorkspaceMode
      )} ${labelBoxShadowClass(annotationWorkspaceMode)} ${
        datasetClassHighlighted ? "z-[35]" : ""
      }`}
      style={{
        left: box.labelBbox.x,
        top: box.labelBbox.y,
        width: box.labelBbox.width,
        height: box.labelBbox.height,
        ...annotationBboxStyle(annotationWorkspaceMode),
        ...componentColor,
        ...bboxStrokeStyle(
          annotationWorkspaceMode,
          "var(--atlas-root-bbox-width, 2px)"
        ),
        ...(datasetClassHighlighted
          ? {
              backgroundColor: "rgba(103, 232, 249, 0.16)",
              borderColor: "rgba(255, 255, 255, 1)",
              borderWidth: "4px",
              boxShadow:
                "0 0 0 4px rgba(34, 211, 238, 0.9), 0 0 0 8px rgba(6, 182, 212, 0.42), 0 0 46px 12px rgba(34, 211, 238, 0.82), inset 0 0 22px rgba(255, 255, 255, 0.34)",
              filter: "brightness(1.35) saturate(1.55)",
            }
          : {}),
      }}
    >
      {isDatasetWorkspace ? (
        <BoxMoveHitTarget
          label="Move label annotation"
          onPointerDown={(event) => onLabelPointerDown(event, box)}
        />
      ) : (
        <BoxEdgeHitTargets
          zoom={zoom}
          label="Move label annotation"
          onPointerDown={(event) => onLabelPointerDown(event, box)}
        />
      )}
      {isDatasetWorkspace && canEdit && selected && !selectedAttachmentId ? (
        <BoxResizeEdgeHitTargets
          zoom={zoom}
          label="Resize label annotation"
          thicknessPx={Math.max(2, 4 / zoom)}
          onPointerDown={(event, handle) =>
            onLabelResizePointerDown(event, box, handle)
          }
        />
      ) : null}
      {canEdit && !labelIsRootText && overlayPillsVisible ? (
        <div
          className="pointer-events-none absolute left-0 rounded-full border border-sky-300/40 bg-black/75 px-2 py-1 text-[10px] font-semibold text-sky-100 opacity-100 transition"
          style={{
            top: -30 / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: "left bottom",
          }}
        >
          {box.label}
        </div>
      ) : null}
      {canEdit && selected && !selectedAttachmentId
        ? RESIZE_HANDLES.map((handle) => (
            <ResizeHandleButton
              key={handle}
              handle={handle}
              zoom={zoom}
              label={`Resize label ${handle}`}
              annotationWorkspaceMode={annotationWorkspaceMode}
              sizePx={isDatasetWorkspace ? 5 : undefined}
              onPointerDown={(event) =>
                onLabelResizePointerDown(event, box, handle)
              }
            />
          ))
        : null}
    </div>
  );
}
