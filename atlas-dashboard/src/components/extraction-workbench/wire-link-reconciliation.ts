import type {
  AnnotationRelation,
  AttachmentKind,
  LegacyAnnotationRelation,
  RootObjectKind,
} from "./annotation-model.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  attachmentsOf,
  rootTypeOf,
  wireEndpointAttachmentsOf,
} from "./annotation-box-helpers.ts";
import type { BBoxPx } from "./studio-geometry.ts";
import {
  buildMissingTouchedWireEndpointConnectionLinks,
  buildMissingTouchedWireEndpointGroundLinks,
  buildTouchedWireEndpointConnectionLinks,
  buildTouchedWireEndpointGroundLinks,
  type WireEndpointAttachment,
} from "./wire-connection-point.ts";

export type WireLinkAnnotationAttachment = {
  id: string;
  type: AttachmentKind;
  text: string;
  bbox: BBoxPx;
  parentAttachmentId?: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  relation?: AnnotationRelation | LegacyAnnotationRelation;
  [key: string]: unknown;
};

export type WireLinkAnnotationBox = {
  id: string;
  label: string;
  pageNum?: number;
  bbox: BBoxPx;
  updatedAt?: string;
  metadata: {
    rootType?: RootObjectKind;
    attachments?: WireLinkAnnotationAttachment[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function connectionPointAttachmentsForWire<
  Attachment extends WireLinkAnnotationAttachment = WireLinkAnnotationAttachment,
>(
  boxes: WireLinkAnnotationBox[],
  endpoints: Attachment[],
  wireBoxId: string,
  pageNum: number,
  capturedAt: string
): Attachment[] {
  const candidates = boxes
    .filter((box) => isConnectionPointOwnerRoot(box))
    .flatMap((box) =>
      attachmentsOf(box)
        .filter(isOwnedConnectionPoint)
        .map((attachment) => ({
          ownerBoxId: box.id,
          ownerLabel: box.label,
          connectionPointId: attachment.id,
          connectionPointText: attachment.text,
          connectionPointBbox: attachment.bbox,
        }))
    );
  return buildTouchedWireEndpointConnectionLinks({
    wireBoxId,
    endpoints: wireEndpointOnly(endpoints),
    connectionPoints: candidates,
    pageNum,
    capturedAt,
  }) as unknown as Attachment[];
}

export function missingConnectionPointAttachmentsForWire<
  Attachment extends WireLinkAnnotationAttachment = WireLinkAnnotationAttachment,
>(
  boxes: WireLinkAnnotationBox[],
  endpoints: Attachment[],
  existingLinks: Attachment[],
  wireBoxId: string,
  pageNum: number,
  capturedAt: string
): Attachment[] {
  const candidates = boxes
    .filter((box) => isConnectionPointOwnerRoot(box))
    .flatMap((box) =>
      attachmentsOf(box)
        .filter(isOwnedConnectionPoint)
        .map((attachment) => ({
          ownerBoxId: box.id,
          ownerLabel: box.label,
          connectionPointId: attachment.id,
          connectionPointText: attachment.text,
          connectionPointBbox: attachment.bbox,
        }))
    );
  return buildMissingTouchedWireEndpointConnectionLinks({
    wireBoxId,
    endpoints: wireEndpointOnly(endpoints),
    connectionPoints: candidates,
    existingLinks,
    pageNum,
    capturedAt,
  }) as unknown as Attachment[];
}

export function reconcileTouchedWireEndpointContactsInBoxes<
  Box extends WireLinkAnnotationBox,
>(
  boxes: Box[],
  pageNum: number,
  capturedAt: string,
  scope: { wireBoxId?: string; endpointId?: string } = {}
): { boxes: Box[]; addedCount: number } {
  let addedCount = 0;
  const samePageBoxes = boxes.filter((box) => boxIsOnPage(box, pageNum));
  const next = boxes.map((box) => {
    if (rootTypeOf(box) !== "wire_segment") return box;
    if (!boxIsOnPage(box, pageNum)) return box;
    if (scope.wireBoxId && box.id !== scope.wireBoxId) return box;
    const attachments = attachmentsOf(box);
    const endpoints = wireEndpointAttachmentsOf(box).filter(
      (endpoint) => !scope.endpointId || endpoint.id === scope.endpointId
    );
    if (endpoints.length === 0) return box;
    const candidateBoxes = samePageBoxes.filter(
      (candidateBox) => candidateBox.id !== box.id
    );
    const connectionLinks = missingConnectionPointAttachmentsForWire(
      candidateBoxes,
      endpoints,
      attachments,
      box.id,
      pageNum,
      capturedAt
    );
    const groundLinks = missingGroundReferenceAttachmentsForWire(
      candidateBoxes,
      endpoints,
      [...attachments, ...connectionLinks],
      box.id,
      pageNum,
      capturedAt
    );
    const continuityLinks = missingWireContinuityAttachmentsForWire(
      samePageBoxes,
      candidateBoxes,
      endpoints,
      [...attachments, ...connectionLinks, ...groundLinks],
      box.id,
      pageNum,
      capturedAt,
      { scoped: Boolean(scope.wireBoxId || scope.endpointId) }
    );
    const newLinks = [...connectionLinks, ...groundLinks, ...continuityLinks];
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
  return { boxes: addedCount > 0 ? next : boxes, addedCount };
}

export function groundReferenceAttachmentsForWire<
  Attachment extends WireLinkAnnotationAttachment = WireLinkAnnotationAttachment,
>(
  boxes: WireLinkAnnotationBox[],
  endpoints: Attachment[],
  wireBoxId: string,
  pageNum: number,
  capturedAt: string
): Attachment[] {
  const candidates = boxes
    .filter((box) => rootTypeOf(box) === "ground_reference")
    .map((box) => ({
      groundBoxId: box.id,
      groundLabel: box.label,
      groundBbox: box.bbox,
    }));
  return buildTouchedWireEndpointGroundLinks({
    wireBoxId,
    endpoints: wireEndpointOnly(endpoints),
    groundReferences: candidates,
    pageNum,
    capturedAt,
  }) as unknown as Attachment[];
}

export function missingGroundReferenceAttachmentsForWire<
  Attachment extends WireLinkAnnotationAttachment = WireLinkAnnotationAttachment,
>(
  boxes: WireLinkAnnotationBox[],
  endpoints: Attachment[],
  existingLinks: Attachment[],
  wireBoxId: string,
  pageNum: number,
  capturedAt: string
): Attachment[] {
  const candidates = boxes
    .filter((box) => rootTypeOf(box) === "ground_reference")
    .map((box) => ({
      groundBoxId: box.id,
      groundLabel: box.label,
      groundBbox: box.bbox,
    }));
  return buildMissingTouchedWireEndpointGroundLinks({
    wireBoxId,
    endpoints: wireEndpointOnly(endpoints),
    groundReferences: candidates,
    existingLinks,
    pageNum,
    capturedAt,
  }) as unknown as Attachment[];
}

export function appendTouchedGroundReferenceLinks<Box extends WireLinkAnnotationBox>(
  wireBox: Box,
  groundBox: WireLinkAnnotationBox,
  pageNum: number,
  capturedAt: string
): Box {
  if (rootTypeOf(wireBox) !== "wire_segment") return wireBox;
  if (rootTypeOf(groundBox) !== "ground_reference") return wireBox;
  const existingGroundIds = new Set(
    attachmentsOf(wireBox)
      .filter((attachment) => attachment.type === "ground_reference")
      .map((attachment) => attachment.linkedBoxId)
  );
  if (existingGroundIds.has(groundBox.id)) return wireBox;
  const newLinks = groundReferenceAttachmentsForWire(
    [groundBox],
    wireEndpointAttachmentsOf(wireBox),
    wireBox.id,
    pageNum,
    capturedAt
  ).filter((attachment) => !existingGroundIds.has(attachment.linkedBoxId));
  if (newLinks.length === 0) return wireBox;
  return {
    ...wireBox,
    metadata: {
      ...wireBox.metadata,
      attachments: [...attachmentsOf(wireBox), ...newLinks],
    },
    updatedAt: capturedAt,
  } as Box;
}

function wireEndpointOnly(
  endpoints: WireLinkAnnotationAttachment[]
): WireEndpointAttachment[] {
  return endpoints.filter(
    (attachment) => attachment.type === "wire_endpoint"
  ) as unknown as WireEndpointAttachment[];
}

function isConnectionPointOwnerRoot(box: WireLinkAnnotationBox) {
  const rootType = rootTypeOf(box);
  return (
    rootType === "component" ||
    rootType === "cable_reference" ||
    rootType === "connector"
  );
}

function boxIsOnPage(box: WireLinkAnnotationBox, pageNum: number) {
  return typeof box.pageNum !== "number" || box.pageNum === pageNum;
}

function isOwnedConnectionPoint(attachment: WireLinkAnnotationAttachment) {
  return (
    attachment.type === "connection_point" &&
    (attachment.relation === "component_has_connection_point" ||
      attachment.relation === "cable_reference_has_connection_point" ||
      attachment.relation === "connector_has_connection_point")
  );
}

function missingWireContinuityAttachmentsForWire<
  Attachment extends WireLinkAnnotationAttachment = WireLinkAnnotationAttachment,
>(
  allBoxes: WireLinkAnnotationBox[],
  candidateBoxes: WireLinkAnnotationBox[],
  endpoints: Attachment[],
  existingLinks: Attachment[],
  wireBoxId: string,
  pageNum: number,
  capturedAt: string,
  options: { scoped: boolean }
): Attachment[] {
  const existingContinuityKeys = wireContinuityKeys(allBoxes);
  const currentContinuityKeys = new Set<string>();
  const links: Attachment[] = [];
  const availableEndpoints = wireEndpointOnly(endpoints);
  const candidateEndpoints = candidateBoxes
    .filter((box) => rootTypeOf(box) === "wire_segment")
    .flatMap((box) =>
      wireEndpointAttachmentsOf(box).map((endpoint) => ({
        wireBox: box,
        endpoint,
      }))
    );

  for (const endpoint of availableEndpoints) {
    const match = candidateEndpoints
      .filter((candidate) => boxesOverlap(endpoint.bbox, candidate.endpoint.bbox))
      .filter((candidate) =>
        options.scoped
          ? true
          : shouldOwnUnscopedContinuityLink(
              wireBoxId,
              endpoint.id,
              candidate.wireBox.id,
              candidate.endpoint.id
            )
      )
      .filter((candidate) => {
        const key = wireContinuityKey({
          sourceWireId: wireBoxId,
          sourceEndpointId: endpoint.id,
          targetWireId: candidate.wireBox.id,
          targetEndpointId: candidate.endpoint.id,
        });
        return (
          !existingContinuityKeys.has(key) &&
          !currentContinuityKeys.has(key) &&
          !hasExistingContinuityForEndpoint(existingLinks, endpoint.id)
        );
      })
      .sort((left, right) => boxArea(left.endpoint.bbox) - boxArea(right.endpoint.bbox))[0];
    if (!match) continue;
    const key = wireContinuityKey({
      sourceWireId: wireBoxId,
      sourceEndpointId: endpoint.id,
      targetWireId: match.wireBox.id,
      targetEndpointId: match.endpoint.id,
    });
    currentContinuityKeys.add(key);
    links.push(
      buildWireContinuityLink({
        wireBoxId,
        targetWireBoxId: match.wireBox.id,
        targetWireLabel: match.wireBox.label,
        sourceEndpointId: endpoint.id,
        targetEndpointId: match.endpoint.id,
        targetEndpointBbox: match.endpoint.bbox,
        pageNum,
        capturedAt,
      }) as Attachment
    );
  }

  return links;
}

function buildWireContinuityLink({
  wireBoxId,
  targetWireBoxId,
  targetWireLabel,
  sourceEndpointId,
  targetEndpointId,
  targetEndpointBbox,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  targetWireBoxId: string;
  targetWireLabel: string;
  sourceEndpointId: string;
  targetEndpointId: string;
  targetEndpointBbox: BBoxPx;
  pageNum: number;
  capturedAt: string;
}): WireLinkAnnotationAttachment {
  return {
    id: `${wireBoxId}-wire-continuity-link-${crypto.randomUUID()}`,
    type: "wire_segment",
    text: targetWireLabel || "wire",
    bbox: targetEndpointBbox,
    linkedBoxId: targetWireBoxId,
    linkedAttachmentId: targetEndpointId,
    parentAttachmentId: sourceEndpointId,
    relation: "wire_segment_to_wire_segment",
    provenance: buildSpatialProvenance(
      targetEndpointBbox,
      pageNum,
      "wire_endpoint_auto_wire_segment",
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(targetEndpointBbox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function wireContinuityKeys(boxes: WireLinkAnnotationBox[]) {
  const keys = new Set<string>();
  for (const box of boxes) {
    for (const attachment of attachmentsOf(box)) {
      if (
        attachment.relation !== "wire_segment_to_wire_segment" ||
        !attachment.linkedBoxId ||
        !attachment.parentAttachmentId
      ) {
        continue;
      }
      keys.add(
        wireContinuityKey({
          sourceWireId: box.id,
          sourceEndpointId: attachment.parentAttachmentId,
          targetWireId: attachment.linkedBoxId,
          targetEndpointId: attachment.linkedAttachmentId,
        })
      );
    }
  }
  return keys;
}

function wireContinuityKey({
  sourceWireId,
  sourceEndpointId,
  targetWireId,
  targetEndpointId,
}: {
  sourceWireId: string;
  sourceEndpointId: string | null;
  targetWireId: string;
  targetEndpointId?: string | null;
}) {
  return [
    `${sourceWireId}:${sourceEndpointId ?? ""}`,
    `${targetWireId}:${targetEndpointId ?? ""}`,
  ].sort().join("|");
}

function shouldOwnUnscopedContinuityLink(
  sourceWireId: string,
  sourceEndpointId: string,
  targetWireId: string,
  targetEndpointId: string
) {
  return `${sourceWireId}:${sourceEndpointId}` < `${targetWireId}:${targetEndpointId}`;
}

function hasExistingContinuityForEndpoint(
  existingLinks: WireLinkAnnotationAttachment[],
  endpointId: string
) {
  return existingLinks.some(
    (attachment) =>
      attachment.relation === "wire_segment_to_wire_segment" &&
      attachment.parentAttachmentId === endpointId
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

function boxArea(box: BBoxPx) {
  return box.width * box.height;
}
