import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import {
  moveAnnotationAttachment,
  moveAnnotationBox,
  moveAnnotationLabel,
  resizeAnnotationAttachment,
  resizeAnnotationBox,
  resizeAnnotationLabel,
} from "./interaction-drag-updates.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  attachmentsOf,
  rootTypeOf,
} from "./annotation-box-helpers.ts";
import {
  type AnnotationAttachment,
  type AnnotationMode,
  type AnnotationWorkspaceMode,
  type CableAuthoringMode,
  type ComponentAuthoringMode,
  type InteractionSession,
  type WireAuthoringMode,
  isObjectDetectionWorkspace,
} from "./studio-types.ts";
import { type BBoxPx } from "./studio-geometry.ts";
import type { AnnotationBox } from "./studio-types.ts";
import type { ClientPoint } from "./studio-viewport.ts";
import { normalizeManualWireSegmentBox } from "./manual-wire-geometry.ts";
import { trainingDatasetComponentLabelFromResolvedText } from "./component-label-prefix.ts";
import type { ResizeHandle } from "./annotation-styles.ts";
import { TIGHT_TEXT_AUTOSNAP_MERGE_SCALE } from "./snap-strength.ts";
import { isAnnotationControlPointerTarget } from "./annotation-control-target.ts";

type ClientPointerEvent = {
  clientX: number;
  clientY: number;
};

type PointerPagePoint = {
  x: number;
  y: number;
};

type GetPagePoint = (
  event: ClientPointerEvent,
  options?: { clampToPage?: boolean }
) => PointerPagePoint | null;

type UpdateBox = (
  boxId: string,
  updater: (box: AnnotationBox) => AnnotationBox,
  options?: { recordHistory?: boolean }
) => void;

type UpdateAttachment = (
  boxId: string,
  attachmentId: string,
  updater: (attachment: AnnotationAttachment) => AnnotationAttachment,
  options?: { recordHistory?: boolean }
) => void;

type ResolveLabelForText = (
  labelBox: BBoxPx,
  options?: {
    mergeLines?: boolean;
    mergeScale?: number;
    includeAdjacentOutsideBox?: boolean;
  }
) =>
  | {
      text: string;
      normalizedText?: string;
      bbox: BBoxPx;
      textFragments?: Array<{
        text: string;
        normalizedText?: string;
        bbox: BBoxPx;
      }>;
      score?: number;
      overlap?: number;
      insideCenter?: boolean;
    }
  | null;

type ReconcileTouchedContacts = (
  scope?: { wireBoxId?: string; endpointId?: string },
  options?: { recordHistory?: boolean }
) => void;

type ReconcileCableReferenceConnectionPoints = (
  options?: { recordHistory?: boolean }
) => void;

type ZoomContext = {
  setZoomAtClientPoint: (nextZoom: number, clientPoint: ClientPoint) => void;
};

type GestureHandlersContext = {
  interactionRef: { current: InteractionSession | null };
  setPan: (pan: { x: number; y: number }) => void;
  setDraftBox: (draft: BBoxPx | null) => void;
  getPagePoint: GetPagePoint;
  normalizeBox: (start: PointerPagePoint, end: PointerPagePoint) => BBoxPx;
  updateCursorPosition: (event: {
    clientX: number;
    clientY: number;
  }) => void;
  clampBox: (box: BBoxPx) => BBoxPx;
  pageNum: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  zoom: number;
  boxesRef: { current: AnnotationBox[] };
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  updateBox: UpdateBox;
  updateAttachment: UpdateAttachment;
  addBox: (roughBox: BBoxPx, options?: { manualLabel?: string }) => void;
  addYoloManualComponentBox: (roughBox: BBoxPx) => void;
  addYoloContinuationFromPoint: (point: { x: number; y: number }) => void;
  addYoloManualContinuationBox: (roughBox: BBoxPx) => void;
  detectYolov26Area: (roi: BBoxPx) => void;
  selectYoloBulkExpandBoxes: (roi: BBoxPx) => void;
  openConnectorTerminalPrompt: (roughBox: BBoxPx) => void;
  addTerminalBlockBox: (roughBox: BBoxPx) => void;
  openComponentLabelPrompt: (roughBox: BBoxPx) => void;
  addCableSegmentBox: (roughBox: BBoxPx) => void;
  addCableReferenceBox: (roughBox: BBoxPx) => void;
  addManualWireSegmentBox: (roughBox: BBoxPx, targetBoxId?: string | null) => void;
  addAttachmentFromPoint: (box: AnnotationBox, point: PointerPagePoint) => void;
  addCircuitDescriptorRegion: (descriptorBox: AnnotationBox, bbox: BBoxPx) => void;
  addManualAttachment: (box: AnnotationBox, bbox: BBoxPx) => void;
  resolveTextForLabelBox: ResolveLabelForText;
  reconcileTouchedWireEndpointContacts: ReconcileTouchedContacts;
  reconcileTouchedCableReferenceConnectionPoints: ReconcileCableReferenceConnectionPoints;
};

export function handlePointerMove(
  event: ReactPointerEvent<HTMLElement>,
  context: GestureHandlersContext
) {
  context.updateCursorPosition(event);
  const session = context.interactionRef.current;
  if (!session || session.pointerId !== event.pointerId) return;
  event.preventDefault?.();

  if (session.type === "pan") {
    context.setPan({
      x: session.originX + event.clientX - session.startX,
      y: session.originY + event.clientY - session.startY,
    });
    return;
  }

  if (session.type === "draw") {
    const point = context.getPagePoint(event, { clampToPage: true });
    if (!point) return;
    const next = context.normalizeBox(session.start, point);
    context.interactionRef.current = { ...session, current: point };
    context.setDraftBox(
      context.activeMode === "wire" && context.wireAuthoringMode === "manual"
        ? normalizeManualWireSegmentBox(next, { clampBox: context.clampBox }) ?? next
        : next
    );
    return;
  }

  if (session.type === "draw-attachment") {
    const point = context.getPagePoint(event, { clampToPage: true });
    if (!point) return;
    const next = context.normalizeBox(session.start, point);
    context.interactionRef.current = { ...session, current: point };
    context.setDraftBox(next);
    return;
  }

  const dx = (event.clientX - session.startX) / context.zoom;
  const dy = (event.clientY - session.startY) / context.zoom;

  if (session.type === "move") {
    const capturedAt = new Date().toISOString();
    context.updateBox(session.boxId, (box) =>
      moveAnnotationBox(box, {
        original: session.original,
        dx,
        dy,
        clampBox: context.clampBox,
        pageNum: context.pageNum,
        capturedAt,
      })
    );
    return;
  }

  if (session.type === "move-label") {
    const capturedAt = new Date().toISOString();
    context.updateBox(session.boxId, (box) =>
      moveAnnotationLabel(box, {
        original: session.original,
        dx,
        dy,
        clampBox: context.clampBox,
        capturedAt,
      })
    );
    return;
  }

  if (session.type === "resize") {
    const capturedAt = new Date().toISOString();
    context.updateBox(session.boxId, (box) =>
      resizeAnnotationBox(box, {
        original: session.original,
        handle: session.handle,
        dx,
        dy,
        clampBox: context.clampBox,
        pageNum: context.pageNum,
        capturedAt,
      })
    );
    return;
  }

  if (session.type === "resize-label") {
    const capturedAt = new Date().toISOString();
    context.updateBox(session.boxId, (box) =>
      resizeAnnotationLabel(box, {
        original: box.labelBbox ?? box.bbox,
        handle: session.handle,
        dx,
        dy,
        clampBox: context.clampBox,
        capturedAt,
      })
    );
    return;
  }

  if (session.type === "move-attachment") {
    const capturedAt = new Date().toISOString();
    context.updateAttachment(session.boxId, session.attachmentId, (attachment) =>
      moveAnnotationAttachment(attachment, {
        original: session.original,
        dx,
        dy,
        clampBox: context.clampBox,
        pageNum: context.pageNum,
        capturedAt,
      })
    );
    return;
  }

  if (session.type === "resize-attachment") {
    const capturedAt = new Date().toISOString();
    context.updateAttachment(session.boxId, session.attachmentId, (attachment) =>
      resizeAnnotationAttachment(attachment, {
        original: session.original,
        handle: session.handle,
        dx,
        dy,
        clampBox: context.clampBox,
        pageNum: context.pageNum,
        capturedAt,
      })
    );
  }
}

export function finishInteraction(
  event: ReactPointerEvent<HTMLElement>,
  context: GestureHandlersContext
) {
  const session = context.interactionRef.current;
  if (!session || session.pointerId !== event.pointerId) return;
  event.preventDefault?.();
  if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (session.type === "draw") {
    const roughBox = context.normalizeBox(session.start, session.current);
    if (session.source === "yolo_detect_area") {
      if (roughBox.width >= 8 && roughBox.height >= 8) {
        context.detectYolov26Area(roughBox);
      }
    } else if (session.source === "yolo_bulk_expand") {
      if (roughBox.width >= 8 && roughBox.height >= 8) {
        context.selectYoloBulkExpandBoxes(roughBox);
      }
    } else if (session.source === "yolo_manual_bbox") {
      context.addYoloManualComponentBox(roughBox);
    } else if (session.source === "yolo_continuation_symbol") {
      const dragDistance = Math.sqrt(Math.pow(session.current.x - session.start.x, 2) + Math.pow(session.current.y - session.start.y, 2));
      if (dragDistance <= 3) {
        context.addYoloContinuationFromPoint(session.start);
      } else {
        context.addYoloManualContinuationBox(roughBox);
      }
    } else if (context.activeMode === "wire" && context.wireAuthoringMode === "manual") {
      context.addManualWireSegmentBox(roughBox, session.targetBoxId ?? null);
    } else if (context.activeMode === "terminal-block") {
      context.addTerminalBlockBox(roughBox);
    } else if (
      context.activeMode === "component" &&
      context.componentAuthoringMode === "connector"
    ) {
      context.openConnectorTerminalPrompt(roughBox);
    } else if (
      context.activeMode === "component" &&
      context.componentAuthoringMode === "component_manual_label"
    ) {
      context.openComponentLabelPrompt(roughBox);
    } else if (context.activeMode === "cable") {
      if (context.cableAuthoringMode === "reference") {
        context.addCableReferenceBox(roughBox);
      } else {
        context.addCableSegmentBox(roughBox);
      }
    } else {
      context.addBox(roughBox);
    }
    if (session.source !== "yolo_detect_area") {
      context.setDraftBox(null);
    }
  }
  if (session.type === "draw-attachment") {
    const parent = context.boxesRef.current.find((box) => box.id === session.boxId);
    if (parent) {
      const roughBox = context.normalizeBox(session.start, session.current);
      if (rootTypeOf(parent) === "circuit_descriptor") {
        context.addCircuitDescriptorRegion(parent, roughBox);
      } else if (roughBox.width <= 12 && roughBox.height <= 12) {
        context.addAttachmentFromPoint(parent, session.start);
      } else {
        context.addManualAttachment(parent, roughBox);
      }
    }
    context.setDraftBox(null);
  }
  if (session.type === "move-label" || session.type === "resize-label") {
    const box = context.boxesRef.current.find((current) => current.id === session.boxId);
    if (box?.labelBbox) {
      if (rootTypeOf(box) === "continuation") {
        const reference = box.metadata?.continuationReference;
        if (reference) {
          context.updateBox(session.boxId, () => ({
            ...box,
            label: reference.label,
            labelBbox: box.labelBbox,
            labelSource: "manual",
            labelCandidateIndex: -1,
            labelCandidates: [],
            updatedAt: new Date().toISOString(),
          }));
        }
        context.interactionRef.current = null;
        return;
      }
      const ownerRootType = rootTypeOf(box);
      const isDatasetComponentLabel =
        isObjectDetectionWorkspace(context.annotationWorkspaceMode) &&
        ownerRootType === "component";
      const allowComponentLabelMultiline =
        ownerRootType === "component" &&
        (isDatasetComponentLabel
          ? labelResizeAllowsMultilineAutosnap(session, box.labelBbox)
          : session.type === "resize-label");
      const resolvedLabel = context.resolveTextForLabelBox(box.labelBbox, {
        mergeLines: allowComponentLabelMultiline,
        includeAdjacentOutsideBox: false,
      });
      if (resolvedLabel) {
        const trainingDatasetComponentLabel =
          isDatasetComponentLabel
            ? trainingDatasetComponentLabelFromResolvedText(
                resolvedLabel,
                box.label,
                {
                  allowMultiline: allowComponentLabelMultiline,
                  editedLabelBbox: box.labelBbox,
                  resizeHandle: labelResizeHandle(session),
                }
              )
            : null;
        const normalizedText =
          trainingDatasetComponentLabel?.label ||
          resolvedLabel.normalizedText ||
          resolvedLabel.text;
        const candidateIndex = box.labelCandidates.findIndex(
          (candidate) => candidate.normalizedText === normalizedText
        );
        context.updateBox(session.boxId, () => ({
          ...box,
          label: normalizedText,
          labelBbox: trainingDatasetComponentLabel?.labelBbox ?? resolvedLabel.bbox,
          labelSource: "manual",
          labelCandidateIndex: candidateIndex,
          updatedAt: new Date().toISOString(),
        }));
      }
    }
  }
  if (session.type === "move-attachment" || session.type === "resize-attachment") {
    const box = context.boxesRef.current.find((current) => current.id === session.boxId);
    const attachment =
      box
        ? attachmentsOf(box).find((item) => item.id === session.attachmentId)
        : null;
    if (box && attachment?.type === "wire_endpoint") {
      context.reconcileTouchedWireEndpointContacts(
        { wireBoxId: box.id, endpointId: attachment.id },
        { recordHistory: false }
      );
    } else if (box && attachment?.type === "connection_point") {
      const ownerRootType = rootTypeOf(box);
      context.reconcileTouchedWireEndpointContacts({}, { recordHistory: false });
      if (ownerRootType === "component" || ownerRootType === "cable_reference") {
        context.reconcileTouchedCableReferenceConnectionPoints({
          recordHistory: false,
        });
      }
    } else if (box && attachment && shouldRefreshAttachmentText(attachment)) {
      const shouldTightenTextBbox =
        shouldSnapAttachmentBboxToResolvedText(
          context.annotationWorkspaceMode,
          box,
          attachment
        );
      const resolvedText = context.resolveTextForLabelBox(attachment.bbox, {
        mergeScale: shouldTightenTextBbox
          ? TIGHT_TEXT_AUTOSNAP_MERGE_SCALE
          : undefined,
        mergeLines:
          session.type === "resize-attachment" &&
          shouldMergeResizedAttachmentLines(box, attachment),
      });
      if (resolvedText) {
        const text = resolvedText.normalizedText || resolvedText.text;
        const capturedAt = new Date().toISOString();
        context.updateAttachment(
          box.id,
          attachment.id,
          (currentAttachment) => ({
            ...currentAttachment,
            text,
            bbox: shouldTightenTextBbox
              ? resolvedText.bbox
              : currentAttachment.bbox,
            provenance: shouldTightenTextBbox
              ? buildSpatialProvenance(
                  resolvedText.bbox,
                  context.pageNum,
                  "dataset_text_attachment_bbox_snap",
                  capturedAt
                )
              : currentAttachment.provenance,
            physicalSizePx: shouldTightenTextBbox
              ? physicalSizeOf(resolvedText.bbox)
              : currentAttachment.physicalSizePx,
            snapped: shouldTightenTextBbox ? true : currentAttachment.snapped,
          }),
          { recordHistory: false }
        );
      }
    }
  }
  context.interactionRef.current = null;
}

function shouldSnapAttachmentBboxToResolvedText(
  annotationWorkspaceMode: AnnotationWorkspaceMode,
  box: AnnotationBox,
  attachment: AnnotationAttachment
) {
  return (
    isObjectDetectionWorkspace(annotationWorkspaceMode) &&
    rootTypeOf(box) === "component" &&
    isTightComponentTextAttachment(attachment)
  );
}

function isTightComponentTextAttachment(attachment: AnnotationAttachment) {
  return (
    attachment.type === "part_number" ||
    attachment.type === "spec" ||
    attachment.type === "terminal_label" ||
    attachment.type === "wire_label" ||
    attachment.type === "ground_label" ||
    attachment.type === "location" ||
    attachment.type === "text"
  );
}

function shouldRefreshAttachmentText(attachment: AnnotationAttachment) {
  return (
    attachment.type === "part_number" ||
    attachment.type === "spec" ||
    attachment.type === "terminal" ||
    attachment.type === "terminal_label" ||
    attachment.type === "wire_label" ||
    attachment.type === "cable_label" ||
    attachment.type === "wire_color" ||
    attachment.type === "ground_label" ||
    attachment.type === "location" ||
    attachment.type === "text"
  );
}

function shouldMergeResizedAttachmentLines(
  box: AnnotationBox,
  attachment: AnnotationAttachment
) {
  const ownerRootType = rootTypeOf(box);
  if (ownerRootType === "component") {
    return attachment.type === "part_number" || attachment.type === "text";
  }
  return (
    attachment.type === "part_number" &&
    (ownerRootType === "cable_reference" || ownerRootType === "cable_segment")
  );
}

export function handleStageWheel(
  event: ReactWheelEvent<HTMLElement>,
  context: {
    zoom: number;
    setZoomAtClientPoint: ZoomContext["setZoomAtClientPoint"];
  }
) {
  if (isAnnotationControlPointerTarget(event.target)) {
    return;
  }
  event.preventDefault();
  const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  const zoomDelta = Math.max(-0.18, Math.min(0.18, -normalizedDelta * 0.0015));
  context.setZoomAtClientPoint(context.zoom + zoomDelta, {
    clientX: event.clientX,
    clientY: event.clientY,
  });
}

export function handleStageContextMenu(
  event: ReactMouseEvent<HTMLElement>,
  context: { undoLastEdit: () => void }
) {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    context.undoLastEdit();
  }
}

export function labelResizeAllowsMultilineAutosnap(
  session: InteractionSession,
  labelBbox: BBoxPx | null | undefined
) {
  if (session.type !== "resize-label" || !labelBbox) return false;
  const heightGrowth = labelBbox.height - session.original.height;
  const intentionalSecondLineGrowth = Math.max(8, session.original.height * 0.55);
  return heightGrowth >= intentionalSecondLineGrowth;
}

function labelResizeHandle(session: InteractionSession): ResizeHandle | undefined {
  return session.type === "resize-label" ? session.handle : undefined;
}
