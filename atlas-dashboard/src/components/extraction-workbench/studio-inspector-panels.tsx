"use client";

import { FileText, Link2, Redo2, Save, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ValidationIssue } from "./page-validation-issues";
import { CompactStatus } from "./studio-readouts";
import type { AnnotationStatus, AnnotationWorkspaceMode } from "./studio-types";

type InspectorStatusPanelProps = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  readOnly: boolean;
  boxesCount: number;
  selectedBoxLabel: string | null;
  metadataStatus: "loading" | "ready" | "error";
  symbolBankStatus: "loading" | "ready" | "error";
  symbolBankSource: string;
  wireLabelBankStatus: "loading" | "ready" | "error";
  wireLabelBankSource: string;
  wireLabelBankCount: number;
  annotationStatus: AnnotationStatus;
  lastSavedAt: string | null;
  exportTruthUrl: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSavePage: () => void;
};

export function InspectorStatusPanel({
  annotationWorkspaceMode,
  readOnly,
  boxesCount,
  selectedBoxLabel,
  metadataStatus,
  symbolBankStatus,
  symbolBankSource,
  wireLabelBankStatus,
  wireLabelBankSource,
  wireLabelBankCount,
  annotationStatus,
  lastSavedAt,
  exportTruthUrl,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSavePage,
}: InspectorStatusPanelProps) {
  const isDatasetWorkspace = annotationWorkspaceMode === "training_dataset";
  const inspectorTitle = isDatasetWorkspace ? "Dataset Inspector" : "Inspector";
  const boxSummary = isDatasetWorkspace ? "training boxes" : "boxes";
  const symbolSourceLabel = isDatasetWorkspace ? "dataset class source" : "reference source";
  const wireSourceLabel = isDatasetWorkspace ? "dataset wire labels" : "wire labels";

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">
            {inspectorTitle}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {boxesCount} {boxSummary} · {selectedBoxLabel ?? "none"}
          </div>
        </div>
        <FileText className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <CompactStatus label="parts" value={symbolBankStatus} />
        <CompactStatus label="wires" value={wireLabelBankStatus} />
        <CompactStatus label="snap" value={metadataStatus} />
        <CompactStatus label="save" value={annotationStatus} />
      </div>
      {symbolBankSource ? (
        <div
          className="mt-2 truncate rounded-xl border border-border/70 bg-background/40 px-2 py-1.5 text-[9px] text-muted-foreground"
          title={`${symbolSourceLabel}: ${symbolBankSource}`}
        >
          {symbolSourceLabel}: {symbolBankSource}
        </div>
      ) : null}
      {wireLabelBankSource ? (
        <div
          className="mt-1 truncate rounded-xl border border-blue-300/20 bg-blue-300/8 px-2 py-1.5 text-[9px] text-blue-100/80"
          title={`${wireSourceLabel}: ${wireLabelBankSource}`}
        >
          {wireLabelBankCount} {wireSourceLabel} · {wireLabelBankSource}
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <Button
          type="button"
          variant="outline"
          className="h-8 px-2 text-[11px]"
          disabled={readOnly || !canUndo}
          onClick={onUndo}
          aria-label="Undo annotation edit"
          title="Undo last annotation edit"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-8 px-2 text-[11px]"
          disabled={readOnly || !canRedo}
          onClick={onRedo}
          aria-label="Redo annotation edit"
          title="Redo annotation edit"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-8 text-[11px]"
          disabled={
            readOnly || annotationStatus === "saving" || annotationStatus === "loading"
          }
          onClick={onSavePage}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {annotationStatus === "saving" ? "Saving" : "Save"}
        </Button>
        <a
          href={exportTruthUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition hover:bg-muted"
        >
          JSON
        </a>
      </div>
      {lastSavedAt ? (
        <div className="mt-2 text-right text-[9px] text-muted-foreground">
          saved {new Date(lastSavedAt).toLocaleTimeString()}
        </div>
      ) : null}
    </div>
  );
}

type RelationReviewPanelProps = {
  readOnly: boolean;
  validationIssues: ValidationIssue[];
  onReconcileEndpointContacts: () => void;
};

export function RelationReviewPanel({
  readOnly,
  validationIssues,
  onReconcileEndpointContacts,
}: RelationReviewPanelProps) {
  const hasUnlinkedEndpointContacts = validationIssues.some(
    (issue) => issue.kind === "endpoint_touch_unlinked_connection_point"
  );

  if (validationIssues.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-300/8 p-3 shadow-[0_0_24px_rgba(251,191,36,0.08)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-amber-100">
          Relation review
        </div>
        <div className="flex items-center gap-1.5">
          {hasUnlinkedEndpointContacts && !readOnly ? (
            <button
              type="button"
              onClick={onReconcileEndpointContacts}
              className="inline-flex h-6 items-center gap-1 rounded-lg border border-cyan-200/35 bg-cyan-300/10 px-2 text-[8px] font-semibold uppercase tracking-[0.12em] text-cyan-50 transition hover:border-cyan-100/70 hover:bg-cyan-300/18"
              title="Link wire endpoints that are already touching component connection points or ground references"
            >
              <Link2 className="h-3 w-3" />
              Link
            </button>
          ) : null}
          <span className="rounded-full border border-amber-200/30 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-amber-100/80">
            {validationIssues.length}
          </span>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {validationIssues.slice(0, 5).map((issue) => (
          <div
            key={issue.id}
            className={`rounded-xl border px-2.5 py-2 ${
              issue.severity === "error"
                ? "border-rose-300/30 bg-rose-400/10"
                : "border-amber-200/20 bg-background/35"
            }`}
          >
            <div className="text-[10px] font-semibold text-foreground">
              {issue.label}
            </div>
            <div className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
              {issue.detail}
            </div>
          </div>
        ))}
        {validationIssues.length > 5 ? (
          <div className="text-[9px] text-amber-100/70">
            {validationIssues.length - 5} more issues hidden.
          </div>
        ) : null}
      </div>
    </div>
  );
}
