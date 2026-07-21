"use client";

import { ANNOTATION_WORKSPACE_MODES, type AnnotationWorkspaceMode } from "./studio-types";

type StudioWorkspaceHeaderProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  onAnnotationWorkspaceModeChange: (mode: AnnotationWorkspaceMode) => void;
};

export function StudioWorkspaceHeader({
  annotationWorkspaceMode,
  onAnnotationWorkspaceModeChange,
}: StudioWorkspaceHeaderProps) {
  const isDatasetWorkspace = annotationWorkspaceMode === "training_dataset";
  const isYoloWorkspace = annotationWorkspaceMode === "yolo";
  const eyebrow = isDatasetWorkspace
    ? "Dataset Studio"
    : isYoloWorkspace
      ? "YOLO Studio"
      : "Extraction Studio";
  const heading = isDatasetWorkspace
    ? "Object-detection dataset annotation workbench"
    : isYoloWorkspace
      ? "YOLO component annotation workbench"
      : "Digital twin reference annotation workbench";
  const workspaceNote = isDatasetWorkspace
    ? "Training labels isolated from digital twin"
    : isYoloWorkspace
      ? "Center-snap object labels"
      : "Development aid, not production extractor";

  return (
    <div className="border-b border-border/70 bg-background/40 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-primary">
            {eyebrow}
          </div>
          <h2 className="mt-1 text-[17px] font-semibold text-foreground">
            {heading}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-border/70 bg-black/35 p-1">
            {ANNOTATION_WORKSPACE_MODES.map((mode) => {
              const active = mode.id === annotationWorkspaceMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onAnnotationWorkspaceModeChange(mode.id)}
                  className={[
                    "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition",
                    active
                      ? "border border-cyan-300/40 bg-cyan-400/18 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
                      : "border border-transparent text-muted-foreground hover:bg-white/8 hover:text-foreground",
                  ].join(" ")}
                  aria-pressed={active}
                >
                  {mode.shortLabel}
                </button>
              );
            })}
          </div>
          <div
            className={`rounded-full border px-3 py-1 text-[10px] font-medium ${
              isDatasetWorkspace
                ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                : isYoloWorkspace
                  ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                : "border-amber-400/25 bg-amber-400/10 text-amber-100"
            }`}
          >
            {workspaceNote}
          </div>
        </div>
      </div>
    </div>
  );
}
