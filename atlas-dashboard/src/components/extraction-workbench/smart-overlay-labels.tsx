"use client";

import {
  ATTACHMENT_TYPES,
  ROOT_OBJECT_TYPES,
  attachmentTypeLabel,
  rootObjectTypeLabel,
  type AttachmentKind,
  type RootObjectKind,
} from "./annotation-model";
import type { OverlayLabelTarget } from "./overlay-label-layout";

export function SmartOverlayLabels({
  labels,
  zoom,
  typeMenuAttachmentId,
  typeMenuBoxId,
  onRootTypeMenuToggle,
  onRootTypeChange,
  onAttachmentTypeMenuToggle,
  onAttachmentTypeChange,
}: {
  labels: OverlayLabelTarget[];
  zoom: number;
  typeMenuAttachmentId: string | null;
  typeMenuBoxId: string | null;
  onRootTypeMenuToggle: (boxId: string) => void;
  onRootTypeChange: (boxId: string, type: RootObjectKind) => void;
  onAttachmentTypeMenuToggle: (boxId: string, attachmentId: string) => void;
  onAttachmentTypeChange: (
    boxId: string,
    attachmentId: string,
    type: AttachmentKind
  ) => void;
}) {
  return (
    <>
      {labels.map((label) => {
        const menuOpen =
          label.kind === "root"
            ? typeMenuBoxId === label.boxId
            : typeMenuAttachmentId === label.attachmentId;
        return (
          <div
            key={label.id}
            className="absolute z-[72]"
            style={{
              left: label.labelBox.x,
              top: label.labelBox.y,
              transform: `scale(${1 / zoom})`,
              transformOrigin: "left top",
            }}
          >
            <button
              type="button"
              className="pointer-events-auto min-h-7 touch-none select-none whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] font-black uppercase tracking-normal text-black outline-none [text-shadow:0_1px_0_rgba(255,255,255,0.95),1px_0_0_rgba(255,255,255,0.82),-1px_0_0_rgba(255,255,255,0.82),0_-1px_0_rgba(255,255,255,0.82)] hover:text-cyan-700 focus-visible:text-cyan-700"
              title={
                label.kind === "root"
                  ? `Change ${label.text} root type`
                  : `Change ${label.text} attachment type`
              }
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (label.kind === "root") {
                  onRootTypeMenuToggle(label.boxId);
                } else if (label.attachmentId) {
                  onAttachmentTypeMenuToggle(label.boxId, label.attachmentId);
                }
              }}
            >
              {label.text}
            </button>
            {menuOpen && label.kind === "root" ? (
              <div
                data-testid={`root-smart-type-menu-${label.boxId}`}
                className="pointer-events-auto mt-1 grid min-w-[150px] touch-none select-none grid-cols-2 gap-1 rounded-2xl border border-zinc-900/20 bg-white/94 p-1.5 text-zinc-950 shadow-[0_16px_40px_rgba(0,0,0,0.26)] backdrop-blur-xl"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                {(label.kind === "root" ? ROOT_OBJECT_TYPES : ATTACHMENT_TYPES).map(
                  (type) => (
                    <button
                      key={type}
                      type="button"
                      className={`min-h-7 rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] transition ${
                        label.targetType === type
                          ? "bg-zinc-950 text-white"
                          : "text-zinc-700 hover:bg-cyan-100 hover:text-zinc-950"
                      }`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (label.kind === "root") {
                          onRootTypeChange(label.boxId, type as RootObjectKind);
                        } else if (label.attachmentId) {
                          onAttachmentTypeChange(
                            label.boxId,
                            label.attachmentId,
                            type as AttachmentKind
                          );
                        }
                      }}
                    >
                      {label.kind === "root"
                        ? rootObjectTypeLabel(type as RootObjectKind)
                        : attachmentTypeLabel(type as AttachmentKind)}
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
