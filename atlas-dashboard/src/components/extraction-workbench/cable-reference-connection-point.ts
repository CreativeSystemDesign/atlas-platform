import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
} from "./studio-types.ts";
import type { BBoxPx } from "./studio-geometry.ts";

type ConnectionPointCandidate = {
  ownerBoxId: string;
  ownerLabel: string;
  connectionPointId: string;
  connectionPointText: string;
  connectionPointBbox: BBoxPx;
};

export function reconcileTouchedCableReferenceConnectionPointsInBoxes<
  Box extends AnnotationBox,
>(
  boxes: Box[],
  pageNum: number,
  capturedAt: string
): { boxes: Box[]; addedCount: number } {
  const componentConnectionPoints = componentConnectionPointCandidates(boxes);
  let addedCount = 0;
  const next = boxes.map((box) => {
    if (rootTypeOf(box) !== "cable_reference") return box;
    const attachments = attachmentsOf(box);
    const ownedConnectionPoints = attachments.filter(
      (attachment) =>
        attachment.type === "connection_point" &&
        attachment.relation === "cable_reference_has_connection_point"
    );
    if (ownedConnectionPoints.length === 0) return box;

    const newLinks = ownedConnectionPoints.flatMap((connectionPoint) =>
      missingTouchedConnectionPointLinks({
        cableReferenceBoxId: box.id,
        ownerConnectionPoint: connectionPoint,
        existingAttachments: attachments,
        candidates: componentConnectionPoints,
        pageNum,
        capturedAt,
      })
    );
    if (newLinks.length === 0) return box;
    addedCount += newLinks.length;
    return {
      ...box,
      metadata: {
        ...box.metadata,
        attachments: [...attachments, ...newLinks],
      },
      updatedAt: capturedAt,
    } as Box;
  });

  return {
    boxes: addedCount > 0 ? next : boxes,
    addedCount,
  };
}

function missingTouchedConnectionPointLinks({
  cableReferenceBoxId,
  ownerConnectionPoint,
  existingAttachments,
  candidates,
  pageNum,
  capturedAt,
}: {
  cableReferenceBoxId: string;
  ownerConnectionPoint: AnnotationAttachment;
  existingAttachments: AnnotationAttachment[];
  candidates: ConnectionPointCandidate[];
  pageNum: number;
  capturedAt: string;
}): AnnotationAttachment[] {
  const existingLinkedIds = new Set(
    existingAttachments
      .filter(
        (attachment) =>
          attachment.relation ===
            "cable_reference_connection_point_to_connection_point" &&
          attachment.parentAttachmentId === ownerConnectionPoint.id
      )
      .map((attachment) => attachment.linkedAttachmentId)
      .filter(Boolean)
  );
  return candidates
    .filter((candidate) =>
      boxesOverlap(ownerConnectionPoint.bbox, candidate.connectionPointBbox)
    )
    .filter(
      (candidate) => !existingLinkedIds.has(candidate.connectionPointId)
    )
    .map((candidate) =>
      buildCableReferenceConnectionPointLink({
        cableReferenceBoxId,
        ownerConnectionPointId: ownerConnectionPoint.id,
        candidate,
        pageNum,
        capturedAt,
      })
    );
}

function buildCableReferenceConnectionPointLink({
  cableReferenceBoxId,
  ownerConnectionPointId,
  candidate,
  pageNum,
  capturedAt,
}: {
  cableReferenceBoxId: string;
  ownerConnectionPointId: string;
  candidate: ConnectionPointCandidate;
  pageNum: number;
  capturedAt: string;
}): AnnotationAttachment {
  return {
    id: `${cableReferenceBoxId}-connection-point-link-${crypto.randomUUID()}`,
    type: "connection_point",
    text: `${candidate.ownerLabel}:${candidate.connectionPointText || "connection"}`,
    bbox: candidate.connectionPointBbox,
    parentAttachmentId: ownerConnectionPointId,
    linkedBoxId: candidate.ownerBoxId,
    linkedAttachmentId: candidate.connectionPointId,
    relation: "cable_reference_connection_point_to_connection_point",
    provenance: buildSpatialProvenance(
      candidate.connectionPointBbox,
      pageNum,
      "cable_reference_auto_connection_point",
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(candidate.connectionPointBbox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function componentConnectionPointCandidates(
  boxes: AnnotationBox[]
): ConnectionPointCandidate[] {
  return boxes
    .filter((box) => rootTypeOf(box) === "component" || rootTypeOf(box) === "connector")
    .flatMap((box) =>
      attachmentsOf(box)
        .filter(
          (attachment) =>
            attachment.type === "connection_point" &&
            (attachment.relation === "component_has_connection_point" ||
              attachment.relation === "connector_has_connection_point")
        )
        .map((attachment) => ({
          ownerBoxId: box.id,
          ownerLabel: box.label,
          connectionPointId: attachment.id,
          connectionPointText: attachment.text,
          connectionPointBbox: attachment.bbox,
        }))
    );
}

function boxesOverlap(left: BBoxPx, right: BBoxPx): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}
