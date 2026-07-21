import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  attachmentsOf,
  wireSegmentFromBox,
  wireSegmentsOf,
} from "./annotation-box-helpers.ts";
import {
  areaOfBox,
  enclosingBox,
  intersectionArea,
  type BBoxPx,
} from "./studio-geometry.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
} from "./studio-types.ts";
import {
  connectionPointAttachmentsForWire,
  groundReferenceAttachmentsForWire,
  reconcileTouchedWireEndpointContactsInBoxes,
} from "./wire-link-reconciliation.ts";
import { buildWireEndpointAttachments } from "./wire-connection-point.ts";

export function extendWireGeometryInBoxes(
  boxes: AnnotationBox[],
  {
    boxId,
    segmentBox,
    zoom,
    pageNum,
    capturedAt,
    source = "wire_segment_extend",
  }: {
    boxId: string;
    segmentBox: BBoxPx;
    zoom: number;
    pageNum: number;
    capturedAt: string;
    source?: string;
  }
) {
  const segment = wireSegmentFromBox(segmentBox);
  const withSegment = boxes.map((box) => {
    if (box.id !== boxId) return box;
    const currentSegments = wireSegmentsOf(box);
    const duplicate = currentSegments.some(
      (existing) =>
        intersectionArea(existing.bbox, segment.bbox) >
        areaOfBox(segment.bbox) * 0.72
    );
    if (duplicate) return box;

    const segments = [...currentSegments, segment];
    const bbox = enclosingBox(segments.map((item) => item.bbox));
    const endpointAttachments = buildWireEndpointAttachments({
      wireBoxId: box.id,
      wireBox: segment.bbox,
      zoom,
      pageNum,
      capturedAt,
    }) as AnnotationAttachment[];
    const otherBoxes = boxes.filter((candidateBox) => candidateBox.id !== box.id);
    const connectionPointAttachments = connectionPointAttachmentsForWire(
      otherBoxes,
      endpointAttachments,
      box.id,
      pageNum,
      capturedAt
    );
    const groundReferenceAttachments = groundReferenceAttachmentsForWire(
      otherBoxes,
      endpointAttachments,
      box.id,
      pageNum,
      capturedAt
    );
    const existingConnectionIds = new Set(
      attachmentsOf(box)
        .filter((attachment) => attachment.type === "connection_point")
        .map((attachment) => attachment.linkedAttachmentId)
    );
    const existingGroundIds = new Set(
      attachmentsOf(box)
        .filter((attachment) => attachment.type === "ground_reference")
        .map((attachment) => attachment.linkedBoxId)
    );
    const newConnectionPointAttachments = connectionPointAttachments.filter(
      (attachment) => !existingConnectionIds.has(attachment.linkedAttachmentId)
    );
    const newGroundReferenceAttachments = groundReferenceAttachments.filter(
      (attachment) => !existingGroundIds.has(attachment.linkedBoxId)
    );

    return {
      ...box,
      bbox,
      metadata: {
        ...box.metadata,
        wireGeometry: { segments },
        attachments: [
          ...attachmentsOf(box),
          ...endpointAttachments,
          ...newConnectionPointAttachments,
          ...newGroundReferenceAttachments,
        ],
        provenance: buildSpatialProvenance(
          bbox,
          pageNum,
          source,
          capturedAt
        ),
        physicalSizePx: physicalSizeOf(bbox),
      },
      updatedAt: capturedAt,
    };
  });

  return reconcileTouchedWireEndpointContactsInBoxes(
    withSegment,
    pageNum,
    capturedAt,
    { wireBoxId: boxId }
  ).boxes;
}
