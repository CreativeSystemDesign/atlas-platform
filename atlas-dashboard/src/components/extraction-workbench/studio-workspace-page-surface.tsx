"use client";

import type { CSSProperties, ReactNode } from "react";

import { type BBoxPx } from "./studio-geometry";
import { DraftBox } from "./studio-readouts";
import {
  type AnnotationWorkspaceMode,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
} from "./studio-types";
import type { BBoxStrokeWidths } from "./bbox-display-controls";
import { StudioWorkspacePageStatusOverlay } from "./studio-workspace-page-status-overlay";

type PanOffset = {
  x: number;
  y: number;
};

export type WorkspacePageSurfaceProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  bboxStrokeWidths: BBoxStrokeWidths;
  pageNum: number;
  pan: PanOffset;
  zoom: number;
  draftBox: BBoxPx | null;
  imageSrc: string;
  imageStatus: "loading" | "ready" | "error";
  onChangeImageReady: () => void;
  onChangeImageError: () => void;
  children: ReactNode;
};

export function StudioWorkspacePageSurface({
  annotationWorkspaceMode,
  bboxStrokeWidths,
  pageNum,
  pan,
  zoom,
  draftBox,
  imageSrc,
  imageStatus,
  onChangeImageReady,
  onChangeImageError,
  children,
}: WorkspacePageSurfaceProps) {
  return (
    <div
      className="absolute left-1/2 top-1/2 rounded-sm bg-white shadow-[0_22px_70px_-34px_rgba(0,0,0,0.95)]"
      style={{
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
        "--atlas-root-bbox-width": `${bboxStrokeWidths.root}px`,
        "--atlas-attachment-bbox-width": `${bboxStrokeWidths.attachments}px`,
        transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
        transformOrigin: "center",
      } as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={imageSrc}
        src={imageSrc}
        alt={`reference schematic page ${pageNum}`}
        className="h-full w-full select-none object-contain"
        draggable={false}
        onLoad={onChangeImageReady}
        onError={onChangeImageError}
      />
      <div className="pointer-events-none absolute inset-0">
        {draftBox ? (
          <DraftBox
            bbox={draftBox}
            annotationWorkspaceMode={annotationWorkspaceMode}
          />
        ) : null}
      </div>
      {children}
      <StudioWorkspacePageStatusOverlay imageStatus={imageStatus} />
    </div>
  );
}
