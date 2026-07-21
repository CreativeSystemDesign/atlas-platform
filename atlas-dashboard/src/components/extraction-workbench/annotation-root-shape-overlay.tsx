"use client";

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import type { RootObjectKind } from "./annotation-model";
import {
  annotationBboxStyle,
  bboxStrokeStyle,
  componentColorForSeed,
  componentColorStyle,
  rootBoxShadowClass,
  rootObjectClass,
  type ResizeHandle,
} from "./annotation-styles";
import {
  BoxEdgeHitTargets,
  BoxResizeEdgeHitTargets,
  ResizeHandleButton,
  RootTypeOverlay,
} from "./annotation-overlay-primitives";
import { componentPartsTagForBox } from "./component-parts-tag";
import { isDatasetComponentTrainingPairRoot } from "./dataset-class-tracker";
import { RESIZE_HANDLES } from "./studio-selection-helpers";
import {
  isObjectDetectionWorkspace,
  isYoloWorkspace,
  type AnnotationBox,
  type AnnotationWorkspaceMode,
  type LabelCandidate,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
} from "./studio-types";
import {
  yoloComponentDisplayLabel,
  yoloComponentLabelCandidates,
} from "./yolo-label-candidates";

type AnnotationRootShapeOverlayProps = {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  selected: boolean;
  selectedAttachmentId: string | null;
  rootType: RootObjectKind | null | undefined;
  canEdit: boolean;
  overlayPillsVisible: boolean;
  rootHighlightClass: string;
  rootHighlightStyle: CSSProperties;
  datasetClassHighlighted: boolean;
  typeMenuBoxId: string | null;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, box: AnnotationBox) => void;
  onResizePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    box: AnnotationBox,
    handle: ResizeHandle
  ) => void;
  onContextMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    box: AnnotationBox
  ) => void;
  onLabelCandidateSelect: (
    box: AnnotationBox,
    candidate: LabelCandidate
  ) => void;
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
};

export function AnnotationRootShapeOverlay({
  box,
  annotationWorkspaceMode,
  zoom,
  selected,
  selectedAttachmentId,
  rootType,
  canEdit,
  overlayPillsVisible,
  rootHighlightClass,
  rootHighlightStyle,
  datasetClassHighlighted,
  typeMenuBoxId,
  onPointerDown,
  onResizePointerDown,
  onContextMenu,
  onLabelCandidateSelect,
  onRootTypeMenuToggle,
  onRootTypeChange,
}: AnnotationRootShapeOverlayProps) {
  const componentColor = componentColorStyle(box.id, annotationWorkspaceMode);
  const isDataset = isObjectDetectionWorkspace(annotationWorkspaceMode);
  const isYolo = isYoloWorkspace(annotationWorkspaceMode);
  const datasetComponentMissingLabel =
    isDataset && isDatasetComponentTrainingPairRoot(box) && !box.labelBbox;
  const handleColor = isDataset ? componentColorForSeed(box.id).borderColor : undefined;
  const useDatasetComponentEdgeResize =
    isDataset &&
    (rootType ?? "component") === "component" &&
    canEdit &&
    selected &&
    !selectedAttachmentId;
  const partsTag =
    isDataset && (rootType ?? "component") === "component"
      ? componentPartsTagForBox(box)
      : null;
  const yoloCandidates =
    isYolo && selected && box.metadata.yoloCandidateMenuOpen === true
      ? yoloComponentLabelCandidates(box.labelCandidates, box.bbox)
      : [];
  const yoloMenuHorizontalStyle: CSSProperties =
    box.bbox.x + box.bbox.width > PAGE_WIDTH_PX * 0.72
      ? { right: 0 }
      : { left: 0 };
  const yoloMenuVerticalStyle: CSSProperties =
    box.bbox.y + box.bbox.height > PAGE_HEIGHT_PX * 0.74
      ? { bottom: "100%", marginBottom: 8 / zoom }
      : { top: "100%", marginTop: 8 / zoom };
  const isYoloContinuationBox =
    isYolo &&
    ((rootType ?? "component") === "continuation" ||
      box.label.trim().toLowerCase() === "continuation");
  const yoloBorderTagStyle: CSSProperties = isYoloContinuationBox
    ? {
        left: "100%",
        top: "50%",
        marginLeft: 4 / zoom,
        transform: `translateY(-50%) scale(${1 / zoom})`,
        transformOrigin: "left center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }
    : {
        right: 0,
        top: 0,
        transform: `scale(${1 / zoom})`,
        transformOrigin: "right top",
        lineHeight: 0.82,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      };
  return (
    <div
      className={`group/root pointer-events-none absolute border-2 ${
        selected
          ? "z-40"
          : datasetClassHighlighted
            ? "z-[35]"
            : rootHighlightClass
              ? "z-30"
              : "z-10"
      } ${rootObjectClass(
        rootType ?? "component",
        selected,
        annotationWorkspaceMode
      )} ${rootBoxShadowClass(annotationWorkspaceMode)} ${rootHighlightClass}`}
      style={{
        left: box.bbox.x,
        top: box.bbox.y,
        width: box.bbox.width,
        height: box.bbox.height,
        ...rootHighlightStyle,
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
          : datasetComponentMissingLabel
            ? {
                backgroundColor: "rgba(251, 191, 36, 0.16)",
                borderColor: "rgba(255, 244, 183, 1)",
                borderStyle: "dashed",
                borderWidth: "4px",
                boxShadow:
                  "0 0 0 3px rgba(245, 158, 11, 0.92), 0 0 34px 10px rgba(251, 191, 36, 0.7), inset 0 0 18px rgba(255, 255, 255, 0.24)",
                filter: "brightness(1.25) saturate(1.5)",
              }
            : {}),
      }}
    >
      {useDatasetComponentEdgeResize ? (
        <BoxResizeEdgeHitTargets
          zoom={zoom}
          label="Resize component body"
          thicknessPx={Math.max(2, 4 / zoom)}
          onPointerDown={(event, handle) =>
            onResizePointerDown(event, box, handle)
          }
        />
      ) : (
        <BoxEdgeHitTargets
          zoom={zoom}
          label="Move root annotation"
          onPointerDown={(event) => onPointerDown(event, box)}
          onContextMenu={(event) => onContextMenu(event, box)}
          color={handleColor}
        />
      )}
      {canEdit && rootType && overlayPillsVisible ? (
        <RootTypeOverlay
          boxId={box.id}
          rootType={rootType}
          zoom={zoom}
          typeMenuOpen={typeMenuBoxId === box.id}
          onRootTypeMenuToggle={onRootTypeMenuToggle}
          onRootTypeChange={onRootTypeChange}
        />
      ) : null}
      {isYolo && box.label.trim() ? (
        <>
          <div
            data-testid={`yolo-border-tag-${box.id}`}
            className="pointer-events-none absolute z-[66] max-w-[240px] select-none bg-transparent p-0 text-[10px] font-black uppercase tracking-[0.1em] text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.65)]"
            style={yoloBorderTagStyle}
            title={box.label}
          >
            {box.label}
          </div>
          {!isYoloContinuationBox ? (
            <div
              data-testid={`yolo-leader-tag-${box.id}`}
              className="pointer-events-none absolute left-full top-0 z-[66] flex max-w-[260px] select-none items-center bg-transparent p-0 text-[10px] font-black uppercase tracking-[0.1em] text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.65)]"
              style={{
                transform: `translateY(-100%) scale(${1 / zoom})`,
                transformOrigin: "left bottom",
                lineHeight: 0.82,
                whiteSpace: "nowrap",
              }}
              title={box.label}
            >
              <span
                aria-hidden="true"
                className="block h-px w-5 bg-red-500"
              />
              <span className="block overflow-hidden text-ellipsis">
                {box.label}
              </span>
            </div>
          ) : null}
        </>
      ) : null}
      {isYolo && selected && yoloCandidates.length > 0 ? (
        <div
          data-testid={`yolo-label-candidate-menu-${box.id}`}
          data-atlas-annotation-control="true"
          data-atlas-yolo-label-candidate-menu="true"
          className="pointer-events-auto absolute z-[90] min-w-[170px] max-w-[280px] overscroll-contain overflow-y-auto rounded-lg border border-sky-300/60 bg-black/92 text-[10px] font-bold uppercase tracking-[0.08em] text-sky-50 shadow-[0_0_24px_rgba(14,165,233,0.45)] backdrop-blur-md"
          style={{
            ...yoloMenuHorizontalStyle,
            ...yoloMenuVerticalStyle,
            maxHeight: 112 * zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin:
              "right" in yoloMenuHorizontalStyle
                ? "right top"
                : "left top",
          }}
          onWheelCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.scrollTop += event.deltaY;
          }}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.scrollTop += event.deltaY;
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {yoloCandidates.map((candidate, index) => {
            const displayLabel = yoloComponentDisplayLabel(candidate);
            const detail = candidate.symbol?.symbol ?? candidate.normalizedText;
            return (
              <button
                key={`${candidate.source}-${candidate.normalizedText}-${index}`}
                type="button"
                data-atlas-annotation-control="true"
                className="block w-full border-b border-sky-300/10 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-sky-400/20 focus:bg-sky-400/24 focus:outline-none"
                title={candidate.text}
                onWheel={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const menu = event.currentTarget.closest(
                    '[data-atlas-yolo-label-candidate-menu="true"]'
                  );
                  if (menu instanceof HTMLElement) {
                    menu.scrollTop += event.deltaY;
                  }
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onLabelCandidateSelect(box, candidate);
                }}
              >
                <span className="block text-sky-100">{displayLabel}</span>
                <span className="block max-w-[250px] truncate text-[9px] text-sky-100/62">
                  {detail}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {partsTag ? (
        <div
          data-testid={`parts-list-tag-${box.id}`}
          title={[
            partsTag.description ? `Description: ${partsTag.description}` : "",
            partsTag.partNumber ? `Part number: ${partsTag.partNumber}` : "",
            partsTag.location ? `Location: ${partsTag.location}` : "",
            partsTag.sourcePage ? `Parts list page: ${partsTag.sourcePage}` : "",
          ]
            .filter(Boolean)
            .join("\n")}
          className="pointer-events-none absolute left-0 z-[66] max-w-[260px] select-none rounded-full border border-emerald-200/50 bg-black/86 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.07em] text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.28)] backdrop-blur-md"
          style={{
            top: (canEdit && rootType ? -53 : -27) / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: "left bottom",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {partsTag.label}
        </div>
      ) : null}
      {datasetComponentMissingLabel ? (
        <div
          className="pointer-events-none absolute left-0 z-[67] select-none rounded-full border border-amber-100/75 bg-amber-300 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-black shadow-[0_0_24px_rgba(251,191,36,0.8)]"
          style={{
            top: (partsTag ? -79 : canEdit && rootType ? -53 : -27) / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: "left bottom",
            whiteSpace: "nowrap",
          }}
        >
          Needs label bbox
        </div>
      ) : null}
      {canEdit && selected && !selectedAttachmentId ? (
        RESIZE_HANDLES.map((handle) => (
          <ResizeHandleButton
            key={handle}
            handle={handle}
            zoom={zoom}
            label={`Resize component ${handle}`}
            annotationWorkspaceMode={annotationWorkspaceMode}
            color={handleColor}
            sizePx={useDatasetComponentEdgeResize ? 5 : undefined}
            onPointerDown={(event) =>
              onResizePointerDown(event, box, handle)
            }
          />
        ))
      ) : null}
    </div>
  );
}
