"use client";

import type { BBoxPx } from "./studio-geometry";
import {
  annotationBboxStyle,
  bboxStrokeStyle,
  draftBoxClass,
} from "./annotation-styles";
import { isYoloWorkspace, type AnnotationWorkspaceMode } from "./studio-types";

export function DraftBox({
  bbox,
  annotationWorkspaceMode,
}: {
  bbox: BBoxPx;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
}) {
  const yoloDraftStyle = isYoloWorkspace(annotationWorkspaceMode)
    ? {
        borderColor: "rgb(34, 211, 238)",
        borderWidth: "4px",
        backgroundColor: "rgba(34, 211, 238, 0.10)",
        boxShadow:
          "0 0 0 1px rgba(8, 145, 178, 0.95), 0 0 24px rgba(34, 211, 238, 0.35)",
        outlineColor: "rgb(34, 211, 238)",
        ["--tw-ring-color" as string]: "rgb(34, 211, 238)",
      }
    : {
        ...annotationBboxStyle(annotationWorkspaceMode),
        ...bboxStrokeStyle(
          annotationWorkspaceMode,
          "var(--atlas-root-bbox-width, 2px)"
        ),
      };
  return (
    <div
      className={`absolute ${draftBoxClass(annotationWorkspaceMode)}`}
      style={{
        left: bbox.x,
        top: bbox.y,
        width: bbox.width,
        height: bbox.height,
        ...yoloDraftStyle,
      }}
    />
  );
}

export function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/45 px-2 py-1.5">
      <div className="font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-foreground">{value}</div>
    </div>
  );
}

export function CompactStatus({ label, value }: { label: string; value: string }) {
  const ready = value === "ready" || value === "saved";
  const pending = value === "loading" || value === "saving";
  return (
    <div className="rounded-xl border border-border/70 bg-background/45 px-2 py-1.5">
      <div className="text-[7px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.08em] ${
          ready ? "text-emerald-200" : pending ? "text-amber-200" : "text-rose-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
