type BBoxLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AttachmentLike = {
  id: string;
  type?: string | null;
  text?: string | null;
  bbox?: BBoxLike | null;
  relation?: string | null;
  parentAttachmentId?: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
};

type AnnotationLike = {
  id: string;
  label?: string | null;
  bbox?: BBoxLike | null;
  metadata?: {
    rootType?: string | null;
    attachments?: AttachmentLike[] | null;
    wireGeometry?: {
      segments?: Array<{ bbox?: BBoxLike | null }> | null;
    } | null;
  } | null;
};

export type CanonicalWireIssueKind =
  | "missing_wire_geometry"
  | "missing_wire_endpoint"
  | "legacy_direct_wire_relation"
  | "wire_connection_link_missing_parent_endpoint"
  | "wire_connection_link_orphan_parent_endpoint"
  | "endpoint_touch_unlinked_connection_point";

export type CanonicalWireIssue = {
  id: string;
  kind: CanonicalWireIssueKind;
  severity: "warn" | "error";
  label: string;
  detail: string;
  wireId: string;
  rootIds: string[];
  attachmentIds: string[];
};

const LEGACY_DIRECT_WIRE_RELATIONS = new Set([
  "wire_segment_to_component",
  "wire_segment_to_terminal",
]);

export function auditCanonicalWireAnnotations(
  boxes: AnnotationLike[]
): CanonicalWireIssue[] {
  const issues: CanonicalWireIssue[] = [];
  const componentConnectionPoints = componentConnectionPointCandidates(boxes);

  for (const wire of boxes.filter((box) => rootTypeOf(box) === "wire_segment")) {
    const wireAttachments = attachmentsOf(wire);
    const wireEndpoints = wireAttachments.filter(
      (attachment) => attachment.type === "wire_endpoint"
    );
    const wireConnectionLinks = wireAttachments.filter(
      (attachment) =>
        attachment.type === "connection_point" &&
        attachment.relation === "wire_segment_endpoint_to_connection_point"
    );
    const wireLabel = wire.label?.trim() || "wire segment";
    const wireSegments = wire.metadata?.wireGeometry?.segments ?? [];
    const validSegmentCount = wireSegments.filter((segment) => segment.bbox).length;

    if (validSegmentCount === 0) {
      issues.push({
        id: `${wire.id}:missing-wire-geometry`,
        kind: "missing_wire_geometry",
        severity: "error",
        label: `${wireLabel}: missing wire geometry`,
        detail:
          "Canonical wire roots need saved wire geometry so trace validation can reason from the annotation data.",
        wireId: wire.id,
        rootIds: [wire.id],
        attachmentIds: [],
      });
    }

    const expectedEndpointCount = Math.max(2, validSegmentCount * 2);
    if (wireEndpoints.length < expectedEndpointCount) {
      issues.push({
        id: `${wire.id}:missing-wire-endpoints`,
        kind: "missing_wire_endpoint",
        severity: "error",
        label: `${wireLabel}: missing wire endpoints`,
        detail: `Canonical wire geometry expects ${expectedEndpointCount} endpoint markers for ${validSegmentCount || 1} segment(s); this wire has ${wireEndpoints.length}.`,
        wireId: wire.id,
        rootIds: [wire.id],
        attachmentIds: wireEndpoints.map((endpoint) => endpoint.id),
      });
    }

    for (const attachment of wireAttachments) {
      if (isLegacyDirectWireRelation(attachment)) {
        issues.push({
          id: `${wire.id}:${attachment.id}:legacy-direct-wire-relation`,
          kind: "legacy_direct_wire_relation",
          severity: "warn",
          label: `${wireLabel}: legacy direct wire link`,
          detail:
            "This wire uses an older direct relation. Recreate or relink it through a wire endpoint and component connection point before treating it as canonical truth.",
          wireId: wire.id,
          rootIds: [wire.id, attachment.linkedBoxId].filter(Boolean) as string[],
          attachmentIds: [attachment.id, attachment.linkedAttachmentId].filter(
            Boolean
          ) as string[],
        });
      }
    }

    const endpointIds = new Set(wireEndpoints.map((endpoint) => endpoint.id));
    for (const link of wireConnectionLinks) {
      if (!link.parentAttachmentId) {
        issues.push({
          id: `${wire.id}:${link.id}:missing-parent-endpoint`,
          kind: "wire_connection_link_missing_parent_endpoint",
          severity: "error",
          label: `${wireLabel}: connection link missing endpoint`,
          detail:
            "This endpoint-to-connection-point link does not identify which wire endpoint owns the connection.",
          wireId: wire.id,
          rootIds: [wire.id, link.linkedBoxId].filter(Boolean) as string[],
          attachmentIds: [link.id, link.linkedAttachmentId].filter(
            Boolean
          ) as string[],
        });
      } else if (!endpointIds.has(link.parentAttachmentId)) {
        issues.push({
          id: `${wire.id}:${link.id}:orphan-parent-endpoint`,
          kind: "wire_connection_link_orphan_parent_endpoint",
          severity: "error",
          label: `${wireLabel}: connection link points at missing endpoint`,
          detail:
            "This connection link references a wire endpoint that is not saved on the wire segment.",
          wireId: wire.id,
          rootIds: [wire.id, link.linkedBoxId].filter(Boolean) as string[],
          attachmentIds: [
            link.id,
            link.parentAttachmentId,
            link.linkedAttachmentId,
          ].filter(Boolean) as string[],
        });
      }
    }

    const linkedConnectionPointIds = new Set(
      wireConnectionLinks
        .map((link) => link.linkedAttachmentId)
        .filter(Boolean) as string[]
    );
    for (const endpoint of wireEndpoints) {
      if (!endpoint.bbox) continue;
      const endpointBbox = endpoint.bbox;
      const touchedConnection = componentConnectionPoints
        .filter((connectionPoint) => {
          const connectionBbox = connectionPoint.attachment.bbox;
          if (!connectionBbox) return false;
          return boxesOverlap(endpointBbox, connectionBbox);
        })
        .sort(
          (left, right) =>
            boxArea(left.attachment.bbox) - boxArea(right.attachment.bbox)
        )[0];
      if (!touchedConnection) continue;
      if (linkedConnectionPointIds.has(touchedConnection.attachment.id)) continue;
      issues.push({
        id: `${wire.id}:${endpoint.id}:${touchedConnection.attachment.id}:unlinked-touch`,
        kind: "endpoint_touch_unlinked_connection_point",
        severity: "error",
        label: `${wireLabel}: endpoint touches an unlinked connection point`,
        detail: `${endpoint.text || "endpoint"} touches ${touchedConnection.ownerLabel}:${touchedConnection.attachment.text || "connection"} but the saved data has no endpoint link.`,
        wireId: wire.id,
        rootIds: [wire.id, touchedConnection.ownerId],
        attachmentIds: [endpoint.id, touchedConnection.attachment.id],
      });
    }
  }

  return issues;
}

function rootTypeOf(box: AnnotationLike) {
  return box.metadata?.rootType ?? "component";
}

function attachmentsOf(box: AnnotationLike): AttachmentLike[] {
  return Array.isArray(box.metadata?.attachments) ? box.metadata.attachments : [];
}

function isLegacyDirectWireRelation(attachment: AttachmentLike) {
  if (attachment.relation && LEGACY_DIRECT_WIRE_RELATIONS.has(attachment.relation)) {
    return true;
  }
  return (
    attachment.relation === "object_has_attachment" &&
    attachment.type !== "text" &&
    attachment.type !== "wire_label" &&
    attachment.type !== "wire_color"
  );
}

function componentConnectionPointCandidates(boxes: AnnotationLike[]) {
  return boxes
    .filter((box) => rootTypeOf(box) === "component")
    .flatMap((box) =>
      attachmentsOf(box)
        .filter(
          (
            attachment
          ): attachment is AttachmentLike & { bbox: BBoxLike; id: string } =>
            attachment.type === "connection_point" &&
            attachment.relation === "component_has_connection_point" &&
            Boolean(attachment.bbox)
        )
        .map((attachment) => ({
          ownerId: box.id,
          ownerLabel: box.label?.trim() || "component",
          attachment,
        }))
    );
}

function boxesOverlap(left: BBoxLike, right: BBoxLike): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function boxArea(box: BBoxLike) {
  return box.width * box.height;
}
