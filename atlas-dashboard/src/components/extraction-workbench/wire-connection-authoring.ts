import {
  attachmentsOf,
  nearestWireEndpoint,
  rootTypeOf,
  wireEndpointAttachmentsOf,
  wireSegmentsOf,
} from "./annotation-box-helpers.ts";
import { centerOfBox } from "./studio-geometry.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
} from "./studio-types.ts";
import {
  buildWireConnectionPointLink,
  buildWireEndpointAttachments,
} from "./wire-connection-point.ts";

export type ExistingWireConnectionPointEdit = {
  createdEndpoints: AnnotationAttachment[];
  link: AnnotationAttachment;
  capturedAt: string;
};

export function buildExistingWireConnectionPointEdit({
  wireBox,
  ownerBox,
  connectionPoint,
  zoom,
  pageNum,
  capturedAt,
}: {
  wireBox: AnnotationBox;
  ownerBox: AnnotationBox;
  connectionPoint: AnnotationAttachment;
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): ExistingWireConnectionPointEdit | null {
  if (rootTypeOf(wireBox) !== "wire_segment") return null;
  if (
    !isConnectionPointOwner(ownerBox, connectionPoint)
  ) {
    return null;
  }

  const existingEndpoints = wireEndpointAttachmentsOf(wireBox);
  const createdEndpoints =
    existingEndpoints.length > 0
      ? []
      : (buildWireEndpointAttachments({
          wireBoxId: wireBox.id,
          wireBox: wireSegmentsOf(wireBox)[0]?.bbox ?? wireBox.bbox,
          zoom,
          pageNum,
          capturedAt,
        }) as AnnotationAttachment[]);
  const endpoints =
    existingEndpoints.length > 0 ? existingEndpoints : createdEndpoints;
  const parentEndpoint = nearestWireEndpoint(
    endpoints,
    centerOfBox(connectionPoint.bbox)
  );
  const link = buildWireConnectionPointLink({
    wireBoxId: wireBox.id,
    ownerBoxId: ownerBox.id,
    ownerLabel: ownerBox.label,
    connectionPointId: connectionPoint.id,
    connectionPointText: connectionPoint.text,
    connectionPointBbox: connectionPoint.bbox,
    parentAttachmentId: parentEndpoint?.id ?? null,
    pageNum,
    capturedAt,
  }) as AnnotationAttachment;

  return {
    createdEndpoints,
    link,
    capturedAt,
  };
}

function isConnectionPointOwner(
  ownerBox: AnnotationBox,
  connectionPoint: AnnotationAttachment
) {
  const ownerRootType = rootTypeOf(ownerBox);
  return (
    connectionPoint.type === "connection_point" &&
    ((ownerRootType === "component" &&
      connectionPoint.relation === "component_has_connection_point") ||
      (ownerRootType === "cable_reference" &&
        connectionPoint.relation === "cable_reference_has_connection_point"))
  );
}

export function applyExistingWireConnectionPointEdit(
  wireBox: AnnotationBox,
  edit: ExistingWireConnectionPointEdit | null
): AnnotationBox {
  if (!edit) return wireBox;
  return {
    ...wireBox,
    metadata: {
      ...wireBox.metadata,
      attachments: [
        ...edit.createdEndpoints,
        ...attachmentsOf(wireBox).filter(
          (attachment) =>
            attachment.linkedAttachmentId !== edit.link.linkedAttachmentId
        ),
        edit.link,
      ],
    },
    updatedAt: edit.capturedAt,
  };
}
