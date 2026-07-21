import type {
  PointerEvent as ReactPointerEvent,
  MutableRefObject,
} from "react";

import { attachmentKindOfRoot, rootTypeOf } from "./annotation-box-helpers.ts";
import { pointAnchorBox } from "./studio-geometry.ts";
import { nearestWireRootAtPoint, smallestRootContainingPoint } from "./studio-hit-targets.ts";
import type { AttachmentKind } from "./annotation-model.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
  AnnotationMode,
  AnnotationWorkspaceMode,
  CableAuthoringMode,
  ComponentAuthoringMode,
  InteractionSession,
  RootSnapCandidate,
  StudioTool,
  WireAuthoringMode,
} from "./studio-types.ts";
import { CONTINUATION_LINK_ANCHOR_SIZE } from "./studio-types.ts";
import type { ContinuationReference } from "./continuation-symbol.ts";
import {
  isAuxiliaryPointerActivation,
  isPrimaryAnnotationPointerActivation,
  isSecondaryPointerActivation,
  isSupportedStagePointerActivation,
} from "./studio-pointer-input.ts";

type ClientPoint = {
  clientX: number;
  clientY: number;
};

type PagePoint = { x: number; y: number };

type GroundReferenceCandidate = {
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text: string;
  type: AttachmentKind;
};

export type StagePointerDownContext = {
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  activeMode: AnnotationMode;
  componentAuthoringMode: ComponentAuthoringMode;
  wireAuthoringMode: WireAuthoringMode;
  cableAuthoringMode: CableAuthoringMode;
  tool: StudioTool;
  pan: {
    x: number;
    y: number;
  };
  selectedBox: AnnotationBox | null;
  selectedAttachment: AnnotationAttachment | null;
  interactionRef: MutableRefObject<InteractionSession | null>;
  getPagePoint: (event: ClientPoint) => PagePoint | null;
  setConnectionPointEditor: (state: null) => void;
  setRelationNotice: (notice: string | null) => void;
  setTypeMenuAttachmentId: (id: string | null) => void;
  setTypeMenuBoxId: (id: string | null) => void;
  setSelectedBoxId: (id: string | null) => void;
  setSelectedAttachmentId: (id: string | null) => void;
  setDraftBox: (draft: { x: number; y: number; width: number; height: number } | null) => void;
  undoLastEdit: () => void;
  addRootSnapBox: (candidate: RootSnapCandidate, source: string) => void;
  addCircuitDescriptorRoot: (candidate: RootSnapCandidate) => void;
  addPageDescriptorRoot: (candidate: RootSnapCandidate) => void;
  addWireRootLinkedToConnectionPoint: (
    selectedBox: AnnotationBox,
    selectedAttachment: AnnotationAttachment,
    candidate: RootSnapCandidate
  ) => void;
  linkExistingWireToConnectionPoint: (
    wireBox: AnnotationBox,
    ownerBox: AnnotationBox,
    connectionPoint: AnnotationAttachment
  ) => boolean;
  addGroundReferenceRootLinkedToWire: (
    wireBox: AnnotationBox,
    candidate: GroundReferenceCandidate
  ) => void;
  addAttachmentFromExisting: (
    targetBox: AnnotationBox,
    candidate: RootSnapCandidate,
    source: string
  ) => void;
  addAttachmentFromPoint: (
    box: AnnotationBox,
    point: { x: number; y: number }
  ) => void;
  extendWireGeometry: (boxId: string, segmentBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  boxesForPage: AnnotationBox[];
  resolveAttachmentCandidate: (point: { x: number; y: number }) => {
    bbox: { x: number; y: number; width: number; height: number };
    text: string;
    type: AttachmentKind;
    linkedBoxId?: string | null;
    linkedAttachmentId?: string | null;
    labelBbox?: { x: number; y: number; width: number; height: number } | null;
    continuationReference?: ContinuationReference;
  } | null;
  resolveContinuationCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveContinuationSymbolCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveGroundReferenceCandidate: (point: { x: number; y: number }) => GroundReferenceCandidate | null;
  resolveWireSegmentCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
  resolveWireLabelObjectCandidate: (point: { x: number; y: number }) => RootSnapCandidate | null;
};

export function handlePointerDown(
  event: ReactPointerEvent<HTMLDivElement>,
  context: StagePointerDownContext
) {
  if (!isSupportedStagePointerActivation(event)) return;
  const hasModifier = (event.ctrlKey || event.metaKey);
  const isPrimaryActivation = isPrimaryAnnotationPointerActivation(event);
  const isAuxiliaryActivation = isAuxiliaryPointerActivation(event);
  const isSecondaryActivation = isSecondaryPointerActivation(event);
  if (!isPrimaryActivation && !isAuxiliaryActivation && !isSecondaryActivation) return;

  event.preventDefault();
  event.currentTarget.focus();
  context.setConnectionPointEditor(null);

  if (isSecondaryActivation && hasModifier) {
    context.undoLastEdit();
    return;
  }

  context.setTypeMenuAttachmentId(null);
  context.setTypeMenuBoxId(null);

  const point = context.getPagePoint(event);
  if (isAuxiliaryActivation) {
    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: context.pan.x,
      originY: context.pan.y,
    };
    return;
  }

  if (isPrimaryActivation && context.activeMode === "trace") {
    context.setSelectedBoxId(null);
    context.setSelectedAttachmentId(null);
    context.setTypeMenuAttachmentId(null);
    context.setTypeMenuBoxId(null);
    context.setRelationNotice(null);
    return;
  }

  if (
    isPrimaryActivation &&
    context.activeMode === "wire-label" &&
    !context.selectedBox &&
    point
  ) {
    const candidate = context.resolveWireLabelObjectCandidate(point);
    if (candidate) {
      context.addRootSnapBox(candidate, "root_wire_label_object_snap");
    } else {
      context.setRelationNotice("No wire label object detected under the pointer.");
    }
    return;
  }

  if (
    isPrimaryActivation &&
    context.activeMode === "continuation-symbol" &&
    !context.selectedBox &&
    point
  ) {
    const continuationCandidate = context.resolveContinuationSymbolCandidate(point);
    if (continuationCandidate) {
      context.addRootSnapBox(continuationCandidate, "root_continuation_h_symbol_snap");
    } else {
      context.setRelationNotice("No H continuation symbol detected under the pointer.");
    }
    return;
  }

  if (
    isPrimaryActivation &&
    context.activeMode === "wire" &&
    context.wireAuthoringMode === "auto" &&
    !context.selectedBox &&
    point
  ) {
    const wireCandidate = context.resolveWireSegmentCandidate(point);
    if (wireCandidate) {
      context.addRootSnapBox(wireCandidate, "root_wire_segment_snap");
      return;
    }
    if (!hasModifier) {
      return;
    }
  }

  if (
    isPrimaryActivation &&
    context.activeMode === "cable" &&
    context.cableAuthoringMode === "geometry" &&
    !context.selectedBox &&
    point
  ) {
    const cableCandidate = cableSegmentCandidateFromWire(
      context.resolveWireSegmentCandidate(point)
    );
    if (cableCandidate) {
      context.addRootSnapBox(cableCandidate, "root_cable_segment_snap");
      return;
    }
  }

  if (isPrimaryActivation && context.activeMode === "continuation" && !context.selectedBox && point) {
    const continuationCandidate = context.resolveContinuationCandidate(point);
    if (continuationCandidate) {
      context.addRootSnapBox(continuationCandidate, "root_continuation_snap");
    } else {
      context.setRelationNotice("No continuation page/row pair detected under the pointer.");
    }
    return;
  }

  if (isPrimaryActivation && context.activeMode === "descriptor" && !context.selectedBox && point) {
    const candidate = context.resolveAttachmentCandidate(point);
    if (candidate?.text) {
      context.addCircuitDescriptorRoot(candidate);
    } else {
      context.setRelationNotice("No descriptor text detected under the pointer.");
    }
    return;
  }

  if (isPrimaryActivation && context.activeMode === "page-descriptor" && !context.selectedBox && point) {
    const candidate = context.resolveAttachmentCandidate(point);
    if (candidate?.text) {
      context.addPageDescriptorRoot(candidate);
    } else {
      context.setRelationNotice("No page descriptor text detected under the pointer.");
    }
    return;
  }

  if (isPrimaryActivation && hasModifier && !context.selectedBox && point) {
    if (
      context.activeMode === "wire" &&
      context.wireAuthoringMode === "auto"
    ) {
      const wireCandidate = context.resolveWireSegmentCandidate(point);
      if (wireCandidate) {
        context.addRootSnapBox(wireCandidate, "root_wire_segment_snap");
      } else {
        context.setRelationNotice("No wire segment detected under the pointer.");
      }
      return;
    }
    if (
      context.activeMode === "cable" &&
      context.cableAuthoringMode === "geometry"
    ) {
      const cableCandidate = cableSegmentCandidateFromWire(
        context.resolveWireSegmentCandidate(point)
      );
      if (cableCandidate) {
        context.addRootSnapBox(cableCandidate, "root_cable_segment_snap");
      } else {
        context.setRelationNotice("No cable segment shape detected under the pointer.");
      }
      return;
    }
    if (context.activeMode === "continuation") {
      const continuationCandidate = context.resolveContinuationCandidate(point);
      if (continuationCandidate) {
        context.addRootSnapBox(continuationCandidate, "root_continuation_snap");
      } else {
        context.setRelationNotice("No continuation page/row pair detected under the pointer.");
      }
      return;
    }
    if (context.activeMode === "descriptor") {
      const candidate = context.resolveAttachmentCandidate(point);
      if (candidate?.text) {
        context.addCircuitDescriptorRoot(candidate);
      } else {
        context.setRelationNotice("No descriptor text detected under the pointer.");
      }
      return;
    }
    if (context.activeMode === "page-descriptor") {
      const candidate = context.resolveAttachmentCandidate(point);
      if (candidate?.text) {
        context.addPageDescriptorRoot(candidate);
      } else {
        context.setRelationNotice("No page descriptor text detected under the pointer.");
      }
      return;
    }
    const candidate = context.resolveAttachmentCandidate(point);
    if (candidate) {
      context.addRootSnapBox(
        candidate,
        candidate.type === "wire_segment" ? "root_wire_segment_snap" : "root_text_snap"
      );
    }
    return;
  }

  if (
    isPrimaryActivation &&
    !hasModifier &&
    context.tool === "select" &&
    context.selectedBox &&
    point
  ) {
    clearStageSelection(context);
    return;
  }

  if (
    isPrimaryActivation &&
    context.activeMode === "descriptor" &&
    context.selectedBox &&
    rootTypeOf(context.selectedBox) === "circuit_descriptor" &&
    point
  ) {
    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "draw-attachment",
      pointerId: event.pointerId,
      boxId: context.selectedBox.id,
      start: point,
      current: point,
    };
    context.setDraftBox({ x: point.x, y: point.y, width: 1, height: 1 });
    return;
  }

  if (
    isPrimaryActivation &&
    !hasModifier &&
    context.activeMode === "wire" &&
    context.wireAuthoringMode === "manual" &&
    context.tool === "box" &&
    point
  ) {
    const targetBoxId =
      context.selectedBox && rootTypeOf(context.selectedBox) === "wire_segment"
        ? context.selectedBox.id
        : null;
    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "draw",
      pointerId: event.pointerId,
      start: point,
      current: point,
      targetBoxId,
    };
    context.setDraftBox({ x: point.x, y: point.y, width: 1, height: 1 });
    return;
  }

  if (isPrimaryActivation && hasModifier && context.selectedBox && point) {
    if (
      context.annotationWorkspaceMode === "training_dataset" &&
      rootTypeOf(context.selectedBox) === "component"
    ) {
      const candidate = context.resolveAttachmentCandidate(point);
      if (candidate?.type === "terminal") {
        context.addAttachmentFromPoint(context.selectedBox, point);
        return;
      }
    }

    if (context.selectedAttachment?.type === "connection_point") {
      const existingWire = existingWireRootAtPoint(context.boxesForPage, {
        point,
        excludeBoxId: context.selectedBox.id,
      });
      if (
        existingWire &&
        context.linkExistingWireToConnectionPoint(
          existingWire,
          context.selectedBox,
          context.selectedAttachment
        )
      ) {
        return;
      }
      const wireCandidate = context.resolveWireSegmentCandidate(point);
      if (wireCandidate) {
        context.addWireRootLinkedToConnectionPoint(context.selectedBox, context.selectedAttachment, wireCandidate);
      } else {
        context.setRelationNotice("No wire segment detected under the pointer.");
      }
      return;
    }
    if (context.activeMode === "wire" && rootTypeOf(context.selectedBox) !== "wire_segment") {
      context.setRelationNotice(
        `Wire mode is active, but the selected root is ${rootTypeOf(context.selectedBox) === "component"
          ? "component"
          : rootTypeOf(context.selectedBox)} ${context.selectedBox.label}. Select the wire segment before linking terminals.`
      );
      return;
    }
    if (rootTypeOf(context.selectedBox) === "continuation") {
      const nearbyWireRoot = nearestWireRootAtPoint(context.boxesForPage, {
        point,
        excludeBoxId: context.selectedBox.id,
        maxDistance: 18,
      });
      if (nearbyWireRoot) {
        const nearbyWireType = attachmentKindOfRoot(nearbyWireRoot);
        if (!nearbyWireType) return;
        context.addAttachmentFromExisting(
          context.selectedBox,
          {
            bbox: pointAnchorBox(point, CONTINUATION_LINK_ANCHOR_SIZE),
            text: nearbyWireRoot.label,
            type: nearbyWireType,
            linkedBoxId: nearbyWireRoot.id,
          },
          "continuation_existing_wire_link"
        );
        return;
      }
      const targetRoot = smallestRootContainingPoint(context.boxesForPage, {
        point,
        excludeBoxId: context.selectedBox.id,
      });
      if (targetRoot) {
        const targetType = attachmentKindOfRoot(targetRoot);
        if (!targetType) return;
        context.addAttachmentFromExisting(
          context.selectedBox,
          {
            bbox: pointAnchorBox(point, CONTINUATION_LINK_ANCHOR_SIZE),
            text: targetRoot.label,
            type: targetType,
            linkedBoxId: targetRoot.id,
          },
          "continuation_existing_root_link"
        );
        return;
      }
      const candidate = context.resolveAttachmentCandidate(point);
      if (candidate) {
        context.addAttachmentFromExisting(
          context.selectedBox,
          {
            ...candidate,
            bbox: pointAnchorBox(point, CONTINUATION_LINK_ANCHOR_SIZE),
          },
          "continuation_object_link"
        );
      } else {
        context.setRelationNotice("No schematic object detected under the pointer.");
      }
      return;
    }

    if (rootTypeOf(context.selectedBox) === "wire_segment") {
      const targetRoot = smallestRootContainingPoint(context.boxesForPage, {
        point,
        excludeBoxId: context.selectedBox.id,
        maxArea: 60000,
      });
      if (targetRoot) {
        const targetType = attachmentKindOfRoot(targetRoot);
        if (!targetType) return;
        context.addAttachmentFromExisting(
          context.selectedBox,
          {
            bbox: targetRoot.bbox,
            text: targetRoot.label,
            type: targetType,
          },
          "wire_existing_root_endpoint"
        );
        return;
      }
      if (
        context.activeMode === "wire" &&
        context.wireAuthoringMode === "auto"
      ) {
        const groundReferenceCandidate = context.resolveGroundReferenceCandidate(point);
        if (groundReferenceCandidate) {
          context.addGroundReferenceRootLinkedToWire(context.selectedBox, groundReferenceCandidate);
          return;
        }
      }
      if (context.wireAuthoringMode === "auto") {
        const wireCandidate = context.resolveWireSegmentCandidate(point);
        if (wireCandidate) {
          context.extendWireGeometry(context.selectedBox.id, wireCandidate.bbox);
          return;
        }
      }
    }

    if (
      context.activeMode === "wire" &&
      context.wireAuthoringMode === "auto"
    ) {
      const wireCandidate = context.resolveWireSegmentCandidate(point);
      if (wireCandidate) {
        context.addRootSnapBox(wireCandidate, "root_wire_segment_snap");
      } else {
        context.setRelationNotice("No wire segment detected under the pointer.");
      }
      return;
    }

    if (rootTypeOf(context.selectedBox) === "location") {
      const targetRoot = smallestRootContainingPoint(context.boxesForPage, {
        point,
        excludeBoxId: context.selectedBox.id,
      });
      if (targetRoot) {
        const targetType = attachmentKindOfRoot(targetRoot);
        if (!targetType) return;
        context.addAttachmentFromExisting(
          context.selectedBox,
          {
            bbox: targetRoot.bbox,
            text: targetRoot.label,
            type: targetType,
          },
          "existing_root_attachment"
        );
        return;
      }
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "draw-attachment",
      pointerId: event.pointerId,
      boxId: context.selectedBox.id,
      start: point,
      current: point,
    };
    return;
  }

  if (isSecondaryActivation) {
    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: context.pan.x,
      originY: context.pan.y,
    };
    return;
  }

  if (
    (context.activeMode === "component" || context.activeMode === "cable" || context.activeMode === "terminal-block") &&
    context.tool === "box"
  ) {
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "draw",
      pointerId: event.pointerId,
      start: point,
      current: point,
    };
    context.setSelectedBoxId(null);
    context.setDraftBox({ x: point.x, y: point.y, width: 1, height: 1 });
    return;
  }

  if (context.tool === "pan" || !point) {
    event.currentTarget.setPointerCapture(event.pointerId);
    context.interactionRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: context.pan.x,
      originY: context.pan.y,
    };
  } else {
    context.setSelectedBoxId(null);
    context.setSelectedAttachmentId(null);
  }
}

function clearStageSelection(context: StagePointerDownContext) {
  context.setSelectedBoxId(null);
  context.setSelectedAttachmentId(null);
  context.setTypeMenuAttachmentId(null);
  context.setTypeMenuBoxId(null);
  context.setRelationNotice(null);
}

function cableSegmentCandidateFromWire(
  candidate: RootSnapCandidate | null
): RootSnapCandidate | null {
  if (!candidate) return null;
  return {
    ...candidate,
    type: "cable_segment",
    text: candidate.text || "cable",
  };
}

function existingWireRootAtPoint(
  boxes: AnnotationBox[],
  {
    point,
    excludeBoxId,
  }: {
    point: { x: number; y: number };
    excludeBoxId: string | null;
  }
) {
  const containingRoot = smallestRootContainingPoint(boxes, {
    point,
    excludeBoxId,
    maxArea: 60000,
  });
  if (containingRoot && rootTypeOf(containingRoot) === "wire_segment") {
    return containingRoot;
  }
  return nearestWireRootAtPoint(boxes, {
    point,
    excludeBoxId,
    maxDistance: 18,
  });
}
