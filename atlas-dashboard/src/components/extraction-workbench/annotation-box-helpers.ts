import type {
  AnnotationRelation,
  AttachmentKind,
  LegacyAnnotationRelation,
  RootObjectKind,
} from "./annotation-model.ts";
import {
  centerOfBox,
  distanceBetween,
  type BBoxPx,
} from "./studio-geometry.ts";

type AnnotationWithRoot = {
  metadata?: {
    rootType?: RootObjectKind | null;
  } | null;
};

type AnnotationWithAttachments<Attachment> = {
  metadata?: {
    attachments?: Attachment[] | null;
  } | null;
};

type AnnotationWithWireSegments<WireSegment> = {
  metadata?: {
    wireGeometry?: {
      segments?: WireSegment[] | null;
    } | null;
  } | null;
};

type AttachmentWithKind = {
  type: AttachmentKind;
};

type AttachmentWithBbox = AttachmentWithKind & {
  bbox: BBoxPx;
};

type AttachmentWithParent = {
  id: string;
  parentAttachmentId?: string | null;
};

type AttachmentWithRelation = {
  relation?: AnnotationRelation | LegacyAnnotationRelation | string | null;
};

export type WireSegmentGeometryLike = {
  id: string;
  bbox: BBoxPx;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export function rootTypeOf(box: AnnotationWithRoot): RootObjectKind {
  return box.metadata?.rootType ?? "component";
}

export function attachmentKindOfRoot(box: AnnotationWithRoot): AttachmentKind | null {
  const rootType = rootTypeOf(box);
  return rootType === "circuit_descriptor" ||
    rootType === "page_descriptor" ||
    rootType === "connector" ||
    rootType === "terminal_block"
    ? null
    : rootType;
}

export function attachmentsOf<Attachment>(
  box: AnnotationWithAttachments<Attachment>
): Attachment[] {
  return Array.isArray(box.metadata?.attachments) ? box.metadata.attachments : [];
}

export function wireEndpointAttachmentsOf<Attachment extends AttachmentWithKind>(
  box: AnnotationWithAttachments<Attachment>
): Attachment[] {
  return attachmentsOf(box).filter(
    (attachment) => attachment.type === "wire_endpoint"
  );
}

export function wireSegmentsOf<WireSegment>(
  box: AnnotationWithWireSegments<WireSegment>
): WireSegment[] {
  return Array.isArray(box.metadata?.wireGeometry?.segments)
    ? box.metadata.wireGeometry.segments
    : [];
}

export function wireSegmentFromBox(bbox: BBoxPx): WireSegmentGeometryLike {
  const horizontal = bbox.width >= bbox.height;
  const center = centerOfBox(bbox);
  return {
    id: `wire-segment-${crypto.randomUUID()}`,
    bbox,
    x1: horizontal ? bbox.x : center.x,
    y1: horizontal ? center.y : bbox.y,
    x2: horizontal ? bbox.x + bbox.width : center.x,
    y2: horizontal ? center.y : bbox.y + bbox.height,
  };
}

export function descendantAttachmentIds<Attachment extends AttachmentWithParent>(
  attachments: Attachment[],
  rootAttachmentId: string
): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const attachment of attachments) {
      const parentId = attachment.parentAttachmentId;
      if (
        parentId &&
        (parentId === rootAttachmentId || descendants.has(parentId)) &&
        !descendants.has(attachment.id)
      ) {
        descendants.add(attachment.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export function nearestWireEndpoint<Attachment extends AttachmentWithBbox>(
  endpoints: Attachment[],
  point: { x: number; y: number }
): Attachment | null {
  return (
    endpoints
      .filter((attachment) => attachment.type === "wire_endpoint")
      .map((attachment) => ({
        attachment,
        distance: distanceBetween(centerOfBox(attachment.bbox), point),
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.attachment ?? null
  );
}

export function isReferenceOnlyAttachment(attachment: AttachmentWithRelation) {
  return (
    attachment.relation === "continuation_to_object" ||
    attachment.relation === "connector_connection_point_pair"
  );
}

export function cloneBoxes<Box>(boxes: Box[]): Box[] {
  return structuredClone(boxes);
}
