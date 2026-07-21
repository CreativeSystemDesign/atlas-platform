"use client";

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";

import {
  ATTACHMENT_TYPES,
  attachmentTypeLabel,
  type AttachmentKind,
} from "./annotation-model";
import {
  annotationBboxStyle,
  attachmentBoxShadowClass,
  attachmentClass,
  bboxStrokeStyle,
  componentColorStyle,
  type ResizeHandle,
} from "./annotation-styles";
import {
  BoxEdgeHitTargets,
  ResizeHandleButton,
} from "./annotation-overlay-primitives";
import type { RelationshipHighlight } from "./relationship-highlight";
import {
  relationshipAttachmentHighlightClass,
  relationshipAttachmentHighlightStyle,
} from "./relationship-visuals";
import { RESIZE_HANDLES } from "./studio-selection-helpers";
import type {
  AnnotationAttachment,
  AnnotationBox,
  AnnotationWorkspaceMode,
} from "./studio-types";

type AnnotationAttachmentOverlayProps = {
  box: AnnotationBox;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  attachment: AnnotationAttachment;
  zoom: number;
  selected: boolean;
  canEdit: boolean;
  overlayPillsVisible: boolean;
  typeMenuOpen: boolean;
  attachmentHighlight: RelationshipHighlight | null;
  datasetClassHighlighted: boolean;
  onAttachmentPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment
  ) => void;
  onAttachmentResizePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment,
    handle: ResizeHandle
  ) => void;
  onAttachmentContextMenu: (
    event:
      | ReactMouseEvent<HTMLDivElement>
      | ReactPointerEvent<HTMLDivElement>,
    box: AnnotationBox,
    attachment: AnnotationAttachment
  ) => void;
  onAttachmentTypeMenuToggle: (attachmentId: string) => void;
  onAttachmentTypeChange: (attachmentId: string, type: AttachmentKind) => void;
};

export function AnnotationAttachmentOverlay({
  box,
  annotationWorkspaceMode,
  attachment,
  zoom,
  selected,
  canEdit,
  overlayPillsVisible,
  typeMenuOpen,
  attachmentHighlight,
  datasetClassHighlighted,
  onAttachmentPointerDown,
  onAttachmentResizePointerDown,
  onAttachmentContextMenu,
  onAttachmentTypeMenuToggle,
  onAttachmentTypeChange,
}: AnnotationAttachmentOverlayProps) {
  const componentColor = componentColorStyle(box.id, annotationWorkspaceMode);
  const suppressNextContextMenuRef = useRef(false);
  const handleAttachmentContextMenu = (
    event:
      | ReactMouseEvent<HTMLDivElement>
      | ReactPointerEvent<HTMLDivElement>
  ) => {
    if (suppressNextContextMenuRef.current) {
      suppressNextContextMenuRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onAttachmentContextMenu(event, box, attachment);
  };
  return (
    <div
      data-testid={`attachment-box-${attachment.id}`}
      data-parent-attachment-id={attachment.parentAttachmentId ?? undefined}
      data-relation={attachment.relation ?? "object_has_attachment"}
      className={`group/attachment pointer-events-none absolute z-50 border-2 ${attachmentClass(
        attachment.type,
        selected,
        annotationWorkspaceMode
      )} ${attachmentBoxShadowClass(
        annotationWorkspaceMode
      )} ${relationshipAttachmentHighlightClass(attachmentHighlight)} ${
        datasetClassHighlighted ? "z-[65]" : ""
      }`}
      style={{
        left: attachment.bbox.x,
        top: attachment.bbox.y,
        width: attachment.bbox.width,
        height: attachment.bbox.height,
        ...relationshipAttachmentHighlightStyle(attachmentHighlight),
        ...annotationBboxStyle(annotationWorkspaceMode),
        ...componentColor,
        ...bboxStrokeStyle(
          annotationWorkspaceMode,
          "var(--atlas-attachment-bbox-width, 2px)"
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
      onContextMenu={handleAttachmentContextMenu}
    >
      <BoxEdgeHitTargets
        zoom={zoom}
        label="Move attachment annotation"
        onPointerDown={(event) => {
          if (event.button === 2) {
            suppressNextContextMenuRef.current = true;
            handleAttachmentContextMenu(event);
            return;
          }
          onAttachmentPointerDown(event, box, attachment);
        }}
        onContextMenu={handleAttachmentContextMenu}
      />
      {canEdit && overlayPillsVisible && attachment.type !== "wire_endpoint" ? (
        <button
          type="button"
          data-testid={`attachment-pill-${attachment.id}`}
          className="pointer-events-auto absolute left-0 z-[70] touch-none select-none rounded-full border border-amber-300/45 bg-black/82 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-100 opacity-100 shadow-[0_0_16px_rgba(245,158,11,0.28)] transition hover:border-amber-200 hover:bg-amber-200/15 hover:text-white"
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
            onAttachmentTypeMenuToggle(attachment.id);
          }}
        >
          {attachmentTypeLabel(attachment.type)}
        </button>
      ) : null}
      {canEdit && typeMenuOpen && attachment.type !== "wire_endpoint" ? (
        <div
          data-testid={`attachment-type-menu-${attachment.id}`}
          className="pointer-events-auto absolute left-0 z-[80] grid min-w-[148px] touch-none select-none grid-cols-2 gap-1 rounded-2xl border border-amber-200/35 bg-black/90 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.55),0_0_28px_rgba(245,158,11,0.22)] backdrop-blur-xl"
          style={{
            top: attachment.bbox.height + 8 / zoom,
            transform: `scale(${1 / zoom})`,
            transformOrigin: "left top",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {ATTACHMENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              data-testid={`attachment-overlay-type-${type}`}
              className={`rounded-xl border px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition ${
                attachment.type === type
                  ? "border-amber-200 bg-amber-200/18 text-white"
                  : "border-white/10 bg-white/5 text-white/72 hover:border-amber-200/60 hover:bg-amber-200/12 hover:text-white"
              }`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAttachmentTypeChange(attachment.id, type);
              }}
            >
              {attachmentTypeLabel(type)}
            </button>
          ))}
        </div>
      ) : null}
      {canEdit && selected && attachment.type !== "wire_endpoint"
        ? RESIZE_HANDLES.map((handle) => (
            <ResizeHandleButton
              key={handle}
              handle={handle}
              zoom={zoom}
              label={`Resize attachment ${handle}`}
              annotationWorkspaceMode={annotationWorkspaceMode}
              onPointerDown={(event) =>
                onAttachmentResizePointerDown(event, box, attachment, handle)
              }
            />
          ))
        : null}
    </div>
  );
}
