"use client";

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  ROOT_OBJECT_TYPES,
  rootObjectTypeLabel,
  type RootObjectKind,
} from "./annotation-model";
import {
  handleClass,
  type ResizeHandle,
} from "./annotation-styles";
import { isObjectDetectionWorkspace, type AnnotationWorkspaceMode } from "./studio-types";

export function RootTypeOverlay({
  boxId,
  rootType,
  zoom,
  typeMenuOpen,
  onRootTypeMenuToggle,
  onRootTypeChange,
}: {
  boxId: string;
  rootType: RootObjectKind;
  zoom: number;
  typeMenuOpen: boolean;
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
}) {
  return (
    <>
      <button
        type="button"
        data-atlas-annotation-control="true"
        data-testid={`root-type-pill-${boxId}`}
        className="pointer-events-auto absolute left-0 z-[70] touch-none select-none rounded-full border border-cyan-200/45 bg-black/82 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-100 opacity-100 shadow-[0_0_16px_rgba(34,211,238,0.28)] transition hover:border-cyan-100 hover:bg-cyan-200/15 hover:text-white"
        style={{
          top: -27 / zoom,
          transform: `scale(${1 / zoom})`,
          transformOrigin: "left bottom",
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRootTypeMenuToggle(boxId);
        }}
      >
        {rootObjectTypeLabel(rootType)}
      </button>
      {typeMenuOpen ? (
        <div
          data-atlas-annotation-control="true"
          data-testid={`root-type-menu-${boxId}`}
          className="pointer-events-auto absolute left-0 z-[80] grid min-w-[170px] touch-none select-none grid-cols-2 gap-1 rounded-2xl border border-cyan-200/35 bg-black/90 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.55),0_0_28px_rgba(34,211,238,0.22)] backdrop-blur-xl"
          style={{
            top: -130 / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: "left bottom",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {ROOT_OBJECT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              data-testid={`root-overlay-type-${type}`}
              className={`rounded-xl border px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition ${
                rootType === type
                  ? "border-cyan-100 bg-cyan-200/18 text-white"
                  : "border-white/10 bg-white/5 text-white/72 hover:border-cyan-200/60 hover:bg-cyan-200/12 hover:text-white"
              }`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRootTypeChange(boxId, type);
              }}
            >
              {rootObjectTypeLabel(type)}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

const HANDLE_SIZE_PX = 9;
const HANDLE_HIT_SIZE_PX = 28;

export function ResizeHandleButton({
  handle,
  zoom,
  label,
  onPointerDown,
  annotationWorkspaceMode = "digital_twin",
  color,
  sizePx = HANDLE_SIZE_PX,
}: {
  handle: ResizeHandle;
  zoom: number;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  annotationWorkspaceMode?: AnnotationWorkspaceMode;
  color?: string;
  sizePx?: number;
}) {
  const isDataset = isObjectDetectionWorkspace(annotationWorkspaceMode);
  const overrideStyle: CSSProperties = isDataset && color
    ? { backgroundColor: color, borderColor: color }
    : {};
  const screenStableSize = sizePx / Math.max(zoom, 0.01);
  const screenStableHitSize = Math.max(
    HANDLE_HIT_SIZE_PX / Math.max(zoom, 0.01),
    screenStableSize
  );
  return (
    <button
      type="button"
      data-atlas-annotation-control="true"
      aria-label={label}
      className={`${handleClass(handle, annotationWorkspaceMode)} overflow-visible`}
      style={{
        width: screenStableSize,
        height: screenStableSize,
        borderWidth: 1,
        ...overrideStyle,
      }}
      onPointerDown={onPointerDown}
    >
      <span
        aria-hidden="true"
        className="pointer-events-auto absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent"
        style={{
          width: screenStableHitSize,
          height: screenStableHitSize,
        }}
      />
    </button>
  );
}

export function BoxEdgeHitTargets({
  zoom,
  label,
  onPointerDown,
  onContextMenu,
  color,
}: {
  zoom: number;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  color?: string;
}) {
  const thickness = Math.max(8, 18 / zoom);
  const shared =
    "pointer-events-auto absolute z-[45] touch-none select-none rounded-sm bg-transparent";
  const edgeStyle: CSSProperties = color ? { outlineColor: color } : {};

  return (
    <>
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} top edge`}
        className={`${shared} left-0 top-0 w-full cursor-move`}
        role="button"
        style={{ height: thickness, transform: "translateY(-50%)", ...edgeStyle }}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      />
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} right edge`}
        className={`${shared} right-0 top-0 h-full cursor-move`}
        role="button"
        style={{ width: thickness, transform: "translateX(50%)", ...edgeStyle }}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      />
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} bottom edge`}
        className={`${shared} bottom-0 left-0 w-full cursor-move`}
        role="button"
        style={{ height: thickness, transform: "translateY(50%)", ...edgeStyle }}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      />
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} left edge`}
        className={`${shared} left-0 top-0 h-full cursor-move`}
        role="button"
        style={{ width: thickness, transform: "translateX(-50%)", ...edgeStyle }}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      />
    </>
  );
}

export function BoxMoveHitTarget({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-atlas-annotation-control="true"
      aria-label={label}
      className="pointer-events-auto absolute inset-0 z-[40] touch-none select-none bg-transparent cursor-move"
      role="button"
      tabIndex={-1}
      onPointerDown={onPointerDown}
    />
  );
}

export function BoxResizeEdgeHitTargets({
  zoom,
  label,
  onPointerDown,
  thicknessPx,
}: {
  zoom: number;
  label: string;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: ResizeHandle
  ) => void;
  thicknessPx?: number;
}) {
  const thickness = thicknessPx ?? Math.max(3, 5 / zoom);
  const shared =
    "pointer-events-auto absolute z-[60] touch-none select-none rounded-sm bg-transparent";

  return (
    <>
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} top edge`}
        className={`${shared} left-0 top-0 w-full cursor-n-resize`}
        role="button"
        style={{ height: thickness, transform: "translateY(-50%)" }}
        tabIndex={-1}
        onPointerDown={(event) => onPointerDown(event, "n")}
      />
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} right edge`}
        className={`${shared} right-0 top-0 h-full cursor-e-resize`}
        role="button"
        style={{ width: thickness, transform: "translateX(50%)" }}
        tabIndex={-1}
        onPointerDown={(event) => onPointerDown(event, "e")}
      />
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} bottom edge`}
        className={`${shared} bottom-0 left-0 w-full cursor-s-resize`}
        role="button"
        style={{ height: thickness, transform: "translateY(50%)" }}
        tabIndex={-1}
        onPointerDown={(event) => onPointerDown(event, "s")}
      />
      <div
        data-atlas-annotation-control="true"
        aria-label={`${label} left edge`}
        className={`${shared} left-0 top-0 h-full cursor-w-resize`}
        role="button"
        style={{ width: thickness, transform: "translateX(-50%)" }}
        tabIndex={-1}
        onPointerDown={(event) => onPointerDown(event, "w")}
      />
    </>
  );
}
