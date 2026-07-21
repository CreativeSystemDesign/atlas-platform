"use client";

import { Trash2, WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ATTACHMENT_TYPES,
  ROOT_OBJECT_TYPES,
  attachmentTypeLabel,
  relationDisplayLabel,
  rootObjectTypeLabel,
  type AttachmentKind,
  type RootObjectKind,
} from "./annotation-model";
import { attachmentsOf } from "./annotation-box-helpers";
import { Metric } from "./studio-readouts";
import { attachmentDisplayText } from "./studio-selection-helpers";
import type { AnnotationAttachment, AnnotationBox } from "./studio-types";

type ActiveAnnotationPanelProps = {
  readOnly: boolean;
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  metadataStatus: "loading" | "ready" | "error";
  onLabelChange: (id: string, label: string) => void;
  onSnapSelected: () => void;
  onCycleLabelCandidate: (direction: 1 | -1) => void;
  onDeleteSelected: () => void;
  onAttachmentSelect: (id: string) => void;
  onAttachmentTypeChange: (type: AttachmentKind) => void;
  onRootTypeChange: (type: RootObjectKind) => void;
  onAttachmentDelete: () => void;
};

export function ActiveAnnotationPanel({
  readOnly,
  selectedBox,
  selectedAttachment,
  metadataStatus,
  onLabelChange,
  onSnapSelected,
  onCycleLabelCandidate,
  onDeleteSelected,
  onAttachmentSelect,
  onAttachmentTypeChange,
  onRootTypeChange,
  onAttachmentDelete,
}: ActiveAnnotationPanelProps) {
  const deleteButtonLabel = selectedAttachment ? "Delete attachment" : "Delete";
  const selectedAttachments = selectedBox ? attachmentsOf(selectedBox) : [];

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">
            Active
          </div>
        </div>
        <WandSparkles className="h-4 w-4 text-primary" />
      </div>
      {selectedBox ? (
        <div className="mt-2 space-y-2">
          {readOnly ? (
            <div className="rounded-xl border border-cyan-200/25 bg-cyan-300/8 px-2.5 py-2 text-[10px] leading-4 text-cyan-50/80">
              Trace mode is read-only. The Truth panel and schematic highlights are
              derived from the current saved annotation graph.
            </div>
          ) : null}
          <label className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Mark
            <input
              value={selectedBox.label}
              readOnly={readOnly}
              onChange={(event) => {
                if (!readOnly) onLabelChange(selectedBox.id, event.target.value);
              }}
              className="mt-1 h-8 w-full rounded-xl border border-border/70 bg-background/70 px-2.5 text-[12px] normal-case tracking-normal text-foreground outline-none transition focus:border-primary/70"
            />
          </label>
          {selectedBox.metadata.rootType && !selectedAttachment ? (
            <div className="rounded-xl border border-cyan-200/20 bg-cyan-300/8 px-2.5 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-100/85">
                Root type
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {ROOT_OBJECT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    data-testid={`root-inspector-type-${type}`}
                    disabled={readOnly}
                    onClick={() => onRootTypeChange(type)}
                    className={`rounded-lg border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] transition ${
                      selectedBox.metadata.rootType === type
                        ? "border-cyan-100/75 bg-cyan-200/18 text-cyan-50"
                        : "border-border/70 bg-background/45 text-muted-foreground hover:border-cyan-200/45 hover:text-foreground"
                    }`}
                  >
                    {rootObjectTypeLabel(type)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-border/70 bg-background/45 px-2.5 py-2">
            <div className="text-[10px] leading-4 text-muted-foreground">
              {selectedBox.labelBbox
                ? `${selectedBox.labelSource.replaceAll("_", " ")} · candidate ${
                    selectedBox.labelCandidateIndex + 1
                  }/${selectedBox.labelCandidates.length || 1}`
                : "No label candidate found"}
            </div>
            {selectedBox.labelCandidates.length > 1 ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-[11px]"
                  disabled={readOnly}
                  onClick={() => onCycleLabelCandidate(-1)}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-[11px]"
                  disabled={readOnly}
                  onClick={() => onCycleLabelCandidate(1)}
                >
                  Next / Tab
                </Button>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-[9px] text-muted-foreground">
            <Metric label="x" value={Math.round(selectedBox.bbox.x)} />
            <Metric label="y" value={Math.round(selectedBox.bbox.y)} />
            <Metric label="w" value={Math.round(selectedBox.bbox.width)} />
            <Metric label="h" value={Math.round(selectedBox.bbox.height)} />
          </div>
          <div className="rounded-xl border border-border/70 bg-background/45 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Attachments</span>
              <span>{selectedAttachments.length}</span>
            </div>
            {selectedAttachments.length > 0 ? (
              <div className="mt-2 space-y-1">
                {selectedAttachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    data-testid={`attachment-row-${attachment.id}`}
                    onClick={() => onAttachmentSelect(attachment.id)}
                    className={`flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/50 px-2 py-1 text-[10px] ${
                      attachment.parentAttachmentId ? "ml-4 border-teal-300/30" : ""
                    }`}
                  >
                    <span className="min-w-0 truncate text-foreground">
                      {attachment.parentAttachmentId ? "child: " : ""}
                      {attachment.text || attachment.type}
                    </span>
                    <span className="shrink-0 text-right uppercase tracking-[0.12em] text-amber-100/85">
                      <span className="block">
                        {attachmentTypeLabel(attachment.type)}
                      </span>
                      <span className="block text-[8px] text-muted-foreground">
                        {relationDisplayLabel(attachment.relation)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Ctrl-click text, part numbers, or terminals inside the selected component.
              </div>
            )}
          </div>
          {selectedAttachment ? (
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/8 px-2.5 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                Selected attachment
              </div>
              <div className="mt-1 truncate text-[10px] text-foreground">
                {selectedAttachment.text || selectedAttachment.type}
              </div>
              {selectedAttachment.parentAttachmentId ? (
                <div className="mt-1 text-[10px] leading-4 text-teal-100/80">
                  linked to{" "}
                  {attachmentDisplayText(
                    selectedAttachments.find(
                      (attachment) =>
                        attachment.id === selectedAttachment.parentAttachmentId
                    )
                  )}
                </div>
              ) : null}
              <div className="mt-1 rounded-lg border border-amber-200/20 bg-background/35 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-amber-100/80">
                {relationDisplayLabel(selectedAttachment.relation)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {ATTACHMENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    data-testid={`attachment-type-${type}`}
                    disabled={readOnly}
                    onClick={() => onAttachmentTypeChange(type)}
                    className={`rounded-lg border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] transition ${
                      selectedAttachment.type === type
                        ? "border-amber-200/70 bg-amber-300/18 text-amber-50"
                        : "border-border/70 bg-background/45 text-muted-foreground hover:border-amber-300/35 hover:text-foreground"
                    }`}
                  >
                    {attachmentTypeLabel(type)}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1 text-[9px] text-muted-foreground">
                <Metric label="x" value={Math.round(selectedAttachment.bbox.x)} />
                <Metric label="y" value={Math.round(selectedAttachment.bbox.y)} />
                <Metric label="w" value={Math.round(selectedAttachment.bbox.width)} />
                <Metric label="h" value={Math.round(selectedAttachment.bbox.height)} />
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-8 w-full text-[11px] text-destructive"
                disabled={readOnly}
                onClick={onAttachmentDelete}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete attachment
              </Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="h-8 flex-1 text-[11px]"
              disabled={readOnly || metadataStatus !== "ready"}
              onClick={onSnapSelected}
            >
              Snap
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 flex-1 text-[11px] text-destructive"
              disabled={readOnly}
              onClick={selectedAttachment ? onAttachmentDelete : onDeleteSelected}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {deleteButtonLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-dashed border-border/80 bg-background/35 px-3 py-4 text-[11px] leading-5 text-muted-foreground">
          No active box.
        </div>
      )}
    </div>
  );
}
