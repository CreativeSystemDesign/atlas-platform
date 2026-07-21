import { attachmentTypeLabel } from "./annotation-model.ts";
import { normalizeClassLabel } from "./class-label-normalization.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  attachmentsOf,
  nearestWireEndpoint,
  rootTypeOf,
  wireEndpointAttachmentsOf,
  wireSegmentFromBox,
} from "./annotation-box-helpers.ts";
import {
  buildCableEndpointAttachments,
  buildTouchedCableEndpointConnectionLinks,
  type CableEndpointConnectionPointCandidate,
} from "./cable-connection-point.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
  LabelCandidate,
  RootSnapCandidate,
} from "./studio-types.ts";
import {
  centerOfBox,
  type BBoxPx,
} from "./studio-geometry.ts";
import {
  appendTouchedGroundReferenceLinks,
  connectionPointAttachmentsForWire,
  groundReferenceAttachmentsForWire,
  reconcileTouchedWireEndpointContactsInBoxes,
} from "./wire-link-reconciliation.ts";
import {
  buildWireConnectionPointLink,
  buildWireEndpointAttachments,
} from "./wire-connection-point.ts";

export function addRootSnapAnnotationToBoxes(
  current: AnnotationBox[],
  {
    candidate,
    id,
    pageNum,
    zoom,
    source,
    capturedAt,
    labelCandidates,
  }: {
    candidate: RootSnapCandidate;
    id: string;
    pageNum: number;
    zoom: number;
    source: string;
    capturedAt: string;
    labelCandidates: LabelCandidate[];
  }
) {
  const rootIsWire = candidate.type === "wire_segment";
  const rootIsCable = candidate.type === "cable_segment";
  const rootIsGround = candidate.type === "ground_reference";
  const rootIsContinuation = candidate.type === "continuation";
  const wireGeometry = rootIsWire
    ? { segments: [wireSegmentFromBox(candidate.bbox)] }
    : undefined;
  const wireEndpointAttachments = rootIsWire
    ? (buildWireEndpointAttachments({
        wireBoxId: id,
        wireBox: candidate.bbox,
        zoom,
        pageNum,
        capturedAt,
      }) as AnnotationAttachment[])
    : [];
  const cableEndpointAttachments = rootIsCable
    ? buildCableEndpointAttachments({
        cableBoxId: id,
        cableBox: candidate.bbox,
        zoom,
        pageNum,
        capturedAt,
      })
    : [];
  const activeLabel = labelCandidates[0] ?? null;
  const label =
    normalizeClassLabel(
      activeLabel?.normalizedText ||
        candidate.text ||
        (rootIsWire ? "wire" : attachmentTypeLabel(candidate.type))
    );
  const autoAttachments = rootIsWire
    ? [
        ...connectionPointAttachmentsForWire(
          current,
          wireEndpointAttachments,
          id,
          pageNum,
          capturedAt
        ),
        ...groundReferenceAttachmentsForWire(
          current,
          wireEndpointAttachments,
          id,
          pageNum,
          capturedAt
        ),
      ]
    : [];
  const cableAutoAttachments = rootIsCable
    ? (buildTouchedCableEndpointConnectionLinks({
        cableBoxId: id,
        endpoints: cableEndpointAttachments,
        connectionPoints: cableConnectionPointCandidates(current),
        pageNum,
        capturedAt,
      }) as AnnotationAttachment[])
    : [];
  const createdBox: AnnotationBox = {
    id,
    pageNum,
    label,
    bbox: candidate.bbox,
    labelBbox:
      activeLabel?.bbox ??
      candidate.labelBbox ??
      (candidate.text ? candidate.bbox : null),
    labelSource: activeLabel?.source ?? "manual",
    labelCandidateIndex: activeLabel ? 0 : -1,
    labelCandidates,
    source: "human",
    snapped: true,
    metadata: {
      rootType: candidate.type,
      wireGeometry,
      continuationReference: rootIsContinuation
        ? candidate.continuationReference
        : undefined,
      attachments: [
        ...wireEndpointAttachments,
        ...cableEndpointAttachments,
        ...autoAttachments,
        ...cableAutoAttachments,
      ],
      provenance: buildSpatialProvenance(candidate.bbox, pageNum, source, capturedAt),
      physicalSizePx: physicalSizeOf(candidate.bbox),
    },
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };

  const next = rootIsGround
    ? [
        ...current.map((box) =>
          appendTouchedGroundReferenceLinks(box, createdBox, pageNum, capturedAt)
        ),
        createdBox,
      ]
    : [...current, createdBox];
  const boxes = rootIsWire
    ? reconcileTouchedWireEndpointContactsInBoxes(next, pageNum, capturedAt, {
        wireBoxId: id,
      }).boxes
    : next;

  return {
    boxes,
    createdBox: boxes.find((box) => box.id === id) ?? createdBox,
  };
}

function cableConnectionPointCandidates(
  boxes: AnnotationBox[]
): CableEndpointConnectionPointCandidate[] {
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

export function addWireRootLinkedToConnectionPointToBoxes(
  current: AnnotationBox[],
  {
    ownerBox,
    connectionPoint,
    candidate,
    id,
    pageNum,
    zoom,
    capturedAt,
    labelCandidates,
  }: {
    ownerBox: AnnotationBox;
    connectionPoint: AnnotationAttachment;
    candidate: Pick<RootSnapCandidate, "bbox" | "text" | "type">;
    id: string;
    pageNum: number;
    zoom: number;
    capturedAt: string;
    labelCandidates: LabelCandidate[];
  }
) {
  const activeLabel = labelCandidates[0] ?? null;
  const wireEndpointAttachments = buildWireEndpointAttachments({
    wireBoxId: id,
    wireBox: candidate.bbox,
    zoom,
    pageNum,
    capturedAt,
  }) as AnnotationAttachment[];
  const connectionEndpoint = nearestWireEndpoint(
    wireEndpointAttachments,
    centerOfBox(connectionPoint.bbox)
  );
  const connectionAttachment = buildWireConnectionPointLink({
    wireBoxId: id,
    ownerBoxId: ownerBox.id,
    ownerLabel: ownerBox.label,
    connectionPointId: connectionPoint.id,
    connectionPointText: connectionPoint.text,
    connectionPointBbox: connectionPoint.bbox,
    parentAttachmentId: connectionEndpoint?.id ?? null,
    pageNum,
    capturedAt,
  }) as AnnotationAttachment;
  const candidateBoxes = current.filter((box) => box.id !== ownerBox.id);
  const autoAttachments = [
    ...connectionPointAttachmentsForWire(
      candidateBoxes,
      wireEndpointAttachments,
      id,
      pageNum,
      capturedAt
    ).filter(
      (attachment) =>
        attachment.linkedAttachmentId !== connectionPoint.id &&
        attachment.linkedBoxId !== ownerBox.id
    ),
    ...groundReferenceAttachmentsForWire(
      candidateBoxes,
      wireEndpointAttachments,
      id,
      pageNum,
      capturedAt
    ),
  ];
  const createdBox: AnnotationBox = {
    id,
    pageNum,
    label: activeLabel?.normalizedText || candidate.text || "wire",
    bbox: candidate.bbox,
    labelBbox: activeLabel?.bbox ?? null,
    labelSource: activeLabel?.source ?? "manual",
    labelCandidateIndex: activeLabel ? 0 : -1,
    labelCandidates,
    source: "human",
    snapped: true,
    metadata: {
      rootType: "wire_segment",
      wireGeometry: { segments: [wireSegmentFromBox(candidate.bbox)] },
      attachments: [
        ...wireEndpointAttachments,
        connectionAttachment,
        ...autoAttachments,
      ],
      provenance: buildSpatialProvenance(
        candidate.bbox,
        pageNum,
        "root_wire_segment_to_connection_point",
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(candidate.bbox),
    },
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };

  return {
    boxes: [...current, createdBox],
    createdBox,
    connectionAttachment,
  };
}

export function addGroundReferenceRootLinkedToWireToBoxes(
  current: AnnotationBox[],
  {
    wireBox,
    candidate,
    bbox,
    id,
    pageNum,
    capturedAt,
  }: {
    wireBox: AnnotationBox;
    candidate: Pick<RootSnapCandidate, "bbox" | "labelBbox" | "text" | "type">;
    bbox: BBoxPx;
    id: string;
    pageNum: number;
    capturedAt: string;
  }
) {
  const label = candidate.text || "ground";
  const parentEndpoint = nearestWireEndpoint(
    wireEndpointAttachmentsOf(wireBox),
    centerOfBox(bbox)
  );
  const attachment: AnnotationAttachment = {
    id: `${wireBox.id}-ground-reference-link-${crypto.randomUUID()}`,
    type: "ground_reference",
    text: label,
    bbox,
    linkedBoxId: id,
    linkedAttachmentId: null,
    parentAttachmentId: parentEndpoint?.id ?? null,
    relation: "wire_segment_to_ground_reference",
    provenance: buildSpatialProvenance(
      bbox,
      pageNum,
      "wire_ground_reference_link",
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(bbox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
  const createdBox: AnnotationBox = {
    id,
    pageNum,
    label,
    bbox,
    labelBbox: candidate.labelBbox ?? bbox,
    labelSource: "manual",
    labelCandidateIndex: -1,
    labelCandidates: [],
    source: "human",
    snapped: true,
    metadata: {
      rootType: "ground_reference",
      attachments: [],
      provenance: buildSpatialProvenance(
        bbox,
        pageNum,
        "ground_reference_snap",
        capturedAt
      ),
      physicalSizePx: physicalSizeOf(bbox),
    },
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
  const boxes = current
    .map((box) => {
      const boxWithExplicitLink =
        box.id === wireBox.id
          ? {
              ...box,
              metadata: {
                ...box.metadata,
                attachments: [...attachmentsOf(box), attachment],
              },
              updatedAt: capturedAt,
            }
          : box;
      return appendTouchedGroundReferenceLinks(
        boxWithExplicitLink,
        createdBox,
        pageNum,
        capturedAt
      );
    })
    .concat(createdBox);

  return {
    boxes,
    createdBox,
    attachment,
  };
}
