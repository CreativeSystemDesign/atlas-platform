"use client";

import { rootObjectTypeLabel } from "./annotation-model";
import { attachmentsOf } from "./annotation-box-helpers";
import type { AnnotationBox, AnnotationWorkspaceMode } from "./studio-types";

type AnnotationListPanelProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  boxesForPage: AnnotationBox[];
  selectedBoxId: string | null;
  onSelectBox: (id: string) => void;
};

export function AnnotationListPanel({
  annotationWorkspaceMode,
  boxesForPage,
  selectedBoxId,
  onSelectBox,
}: AnnotationListPanelProps) {
  const isDatasetWorkspace = annotationWorkspaceMode === "training_dataset";
  const panelTitle = isDatasetWorkspace ? "Dataset Boxes" : "Annotations";
  const emptyLabel = isDatasetWorkspace
    ? "No training boxes in this dataset workspace."
    : "No boxes.";

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">
        {panelTitle}
      </div>
      <div className="mt-2 max-h-full space-y-1.5 overflow-auto pr-1">
        {boxesForPage.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-background/45 p-3 text-[11px] leading-5 text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          boxesForPage.map((box, index) => {
            const attachmentCount = attachmentsOf(box).length;

            return (
              <button
                key={box.id}
                type="button"
                onClick={() => onSelectBox(box.id)}
                className={`w-full rounded-xl border p-2.5 text-left transition ${
                  selectedBoxId === box.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/70 bg-background/45 hover:border-primary/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold text-foreground">
                    {index + 1}. {box.label || "component"}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${
                      box.snapped
                        ? "bg-emerald-400/12 text-emerald-200"
                        : "bg-amber-400/12 text-amber-200"
                    }`}
                  >
                    {box.metadata.rootType
                      ? rootObjectTypeLabel(box.metadata.rootType)
                      : box.snapped
                        ? "snapped"
                        : "manual"}
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-muted-foreground">
                  {Math.round(box.bbox.x)}, {Math.round(box.bbox.y)} ·{" "}
                  {Math.round(box.bbox.width)} × {Math.round(box.bbox.height)}
                </div>
                {box.labelBbox ? (
                  <div className="mt-1 text-[10px] text-cyan-100/80">
                    label: {Math.round(box.labelBbox.x)},{" "}
                    {Math.round(box.labelBbox.y)}
                  </div>
                ) : null}
                {attachmentCount > 0 ? (
                  <div className="mt-1 text-[10px] text-amber-100/80">
                    attachments: {attachmentCount}
                  </div>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
