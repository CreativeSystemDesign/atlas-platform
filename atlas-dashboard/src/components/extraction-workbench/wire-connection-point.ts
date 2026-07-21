export type WireConnectionPointBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WireConnectionPointAttachment = {
  id: string;
  type: "connection_point";
  text: string;
  bbox: WireConnectionPointBox;
  parentAttachmentId: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  relation: "wire_segment_endpoint_to_connection_point";
  provenance: {
    projectId: string;
    documentId: string;
    pageNum: number;
    coordinateSpace: "page_px";
    pageSizePx: {
      width: number;
      height: number;
    };
    bbox: WireConnectionPointBox;
    source: string;
    capturedAt: string;
  };
  physicalSizePx: {
    width: number;
    height: number;
    area: number;
  };
  source: "ctrl_click";
  snapped: boolean;
  createdAt: string;
};

export type WireEndpointAttachment = {
  id: string;
  type: "wire_endpoint";
  text: "start" | "end";
  bbox: WireConnectionPointBox;
  parentAttachmentId: null;
  linkedBoxId?: null;
  linkedAttachmentId?: null;
  relation: "wire_segment_has_endpoint";
  provenance: {
    projectId: string;
    documentId: string;
    pageNum: number;
    coordinateSpace: "page_px";
    pageSizePx: {
      width: number;
      height: number;
    };
    bbox: WireConnectionPointBox;
    source: string;
    capturedAt: string;
  };
  physicalSizePx: {
    width: number;
    height: number;
    area: number;
  };
  source: "ctrl_click";
  snapped: boolean;
  createdAt: string;
};

export type WireEndpointConnectionPointCandidate = {
  ownerBoxId: string;
  ownerLabel: string;
  connectionPointId: string;
  connectionPointText: string;
  connectionPointBbox: WireConnectionPointBox;
};

export type WireEndpointGroundReferenceCandidate = {
  groundBoxId: string;
  groundLabel: string;
  groundBbox: WireConnectionPointBox;
};

export type WireGroundReferenceAttachment = {
  id: string;
  type: "ground_reference";
  text: string;
  bbox: WireConnectionPointBox;
  parentAttachmentId: string | null;
  linkedBoxId: string;
  linkedAttachmentId: null;
  relation: "wire_segment_to_ground_reference";
  provenance: {
    projectId: string;
    documentId: string;
    pageNum: number;
    coordinateSpace: "page_px";
    pageSizePx: {
      width: number;
      height: number;
    };
    bbox: WireConnectionPointBox;
    source: string;
    capturedAt: string;
  };
  physicalSizePx: {
    width: number;
    height: number;
    area: number;
  };
  source: "ctrl_click";
  snapped: boolean;
  createdAt: string;
};

type ExistingEndpointContactLink = {
  type?: string | null;
  relation?: string | null;
  parentAttachmentId?: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
};

const DOCUMENT_ID = "schematic_<drawing-no>";
const PROJECT_ID = "00000000-0000-4000-8000-000000001650";
const PAGE_WIDTH_PX = 2481;
const PAGE_HEIGHT_PX = 3509;

type Point = { x: number; y: number };

export function buildWireConnectionPointDraft({
  ownerBoxId,
  ownerBox,
  cursor,
  zoom,
  pageNum,
  capturedAt,
}: {
  ownerBoxId: string;
  ownerBox: WireConnectionPointBox;
  cursor: Point;
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): WireConnectionPointAttachment {
  const point = nearestPointOnWireBox(cursor, ownerBox);
  const size = Math.max(18, 18 / zoom);
  const bbox = clampBox({
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size,
  });
  return {
    id: `${ownerBoxId}-connection-point-${crypto.randomUUID()}`,
    type: "connection_point",
    text: "connection",
    bbox,
    parentAttachmentId: null,
    relation: "wire_segment_endpoint_to_connection_point",
    provenance: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      pageNum,
      coordinateSpace: "page_px",
      pageSizePx: {
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
      },
      bbox,
      source: "manual_wire_connection_point",
      capturedAt,
    },
    physicalSizePx: {
      width: bbox.width,
      height: bbox.height,
      area: bbox.width * bbox.height,
    },
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

export function buildWireConnectionPointLink({
  wireBoxId,
  ownerBoxId,
  ownerLabel,
  connectionPointId,
  connectionPointText,
  connectionPointBbox,
  parentAttachmentId = null,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  ownerBoxId: string;
  ownerLabel: string;
  connectionPointId: string;
  connectionPointText: string;
  connectionPointBbox: WireConnectionPointBox;
  parentAttachmentId?: string | null;
  pageNum: number;
  capturedAt: string;
}): WireConnectionPointAttachment {
  return {
    id: `${wireBoxId}-connection-point-link-${crypto.randomUUID()}`,
    type: "connection_point",
    text: `${ownerLabel}:${connectionPointText || "connection"}`,
    bbox: connectionPointBbox,
    linkedBoxId: ownerBoxId,
    linkedAttachmentId: connectionPointId,
    parentAttachmentId,
    relation: "wire_segment_endpoint_to_connection_point",
    provenance: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      pageNum,
      coordinateSpace: "page_px",
      pageSizePx: {
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
      },
      bbox: connectionPointBbox,
      source: "wire_endpoint_manual_connection_point",
      capturedAt,
    },
    physicalSizePx: {
      width: connectionPointBbox.width,
      height: connectionPointBbox.height,
      area: connectionPointBbox.width * connectionPointBbox.height,
    },
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

export function buildWireEndpointAttachments({
  wireBoxId,
  wireBox,
  zoom,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  wireBox: WireConnectionPointBox;
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): WireEndpointAttachment[] {
  const { start, end } = wireEndpointPoints(wireBox);
  return [
    buildWireEndpointAttachment({
      wireBoxId,
      point: start,
      text: "start",
      zoom,
      pageNum,
      capturedAt,
    }),
    buildWireEndpointAttachment({
      wireBoxId,
      point: end,
      text: "end",
      zoom,
      pageNum,
      capturedAt,
    }),
  ];
}

export function buildTouchedWireEndpointConnectionLinks({
  wireBoxId,
  endpoints,
  connectionPoints,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  endpoints: WireEndpointAttachment[];
  connectionPoints: WireEndpointConnectionPointCandidate[];
  pageNum: number;
  capturedAt: string;
}): WireConnectionPointAttachment[] {
  const linkedConnectionPoints = new Set<string>();
  const links: WireConnectionPointAttachment[] = [];
  for (const endpoint of endpoints) {
    const match = connectionPoints
      .filter((connectionPoint) =>
        boxesOverlap(endpoint.bbox, connectionPoint.connectionPointBbox)
      )
      .filter(
        (connectionPoint) =>
          !linkedConnectionPoints.has(connectionPoint.connectionPointId)
      )
      .sort(
        (left, right) =>
          boxArea(left.connectionPointBbox) - boxArea(right.connectionPointBbox)
      )[0];
    if (!match) continue;
    linkedConnectionPoints.add(match.connectionPointId);
    links.push(
      buildWireConnectionPointLink({
        wireBoxId,
        ownerBoxId: match.ownerBoxId,
        ownerLabel: match.ownerLabel,
        connectionPointId: match.connectionPointId,
        connectionPointText: match.connectionPointText,
        connectionPointBbox: match.connectionPointBbox,
        parentAttachmentId: endpoint.id,
        pageNum,
        capturedAt,
      })
    );
  }
  return links;
}

export function buildMissingTouchedWireEndpointConnectionLinks({
  wireBoxId,
  endpoints,
  connectionPoints,
  existingLinks,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  endpoints: WireEndpointAttachment[];
  connectionPoints: WireEndpointConnectionPointCandidate[];
  existingLinks: ExistingEndpointContactLink[];
  pageNum: number;
  capturedAt: string;
}): WireConnectionPointAttachment[] {
  const linkedEndpointIds = new Set(
    existingLinks
      .filter(
        (link) =>
          link.relation === "wire_segment_endpoint_to_connection_point" ||
          link.relation === "wire_segment_to_ground_reference"
      )
      .map((link) => link.parentAttachmentId)
      .filter(Boolean) as string[]
  );
  const linkedConnectionPointIds = new Set(
    existingLinks
      .filter(
        (link) => link.relation === "wire_segment_endpoint_to_connection_point"
      )
      .map((link) => link.linkedAttachmentId)
      .filter(Boolean) as string[]
  );
  const availableEndpoints = endpoints.filter(
    (endpoint) => !linkedEndpointIds.has(endpoint.id)
  );
  const availableConnectionPoints = connectionPoints.filter(
    (connectionPoint) =>
      !linkedConnectionPointIds.has(connectionPoint.connectionPointId)
  );
  return buildTouchedWireEndpointConnectionLinks({
    wireBoxId,
    endpoints: availableEndpoints,
    connectionPoints: availableConnectionPoints,
    pageNum,
    capturedAt,
  });
}

export function buildTouchedWireEndpointGroundLinks({
  wireBoxId,
  endpoints,
  groundReferences,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  endpoints: WireEndpointAttachment[];
  groundReferences: WireEndpointGroundReferenceCandidate[];
  pageNum: number;
  capturedAt: string;
}): WireGroundReferenceAttachment[] {
  const linkedGrounds = new Set<string>();
  const links: WireGroundReferenceAttachment[] = [];
  for (const endpoint of endpoints) {
    const match = groundReferences
      .filter((ground) => boxesOverlap(endpoint.bbox, ground.groundBbox))
      .filter((ground) => !linkedGrounds.has(ground.groundBoxId))
      .sort((left, right) => boxArea(left.groundBbox) - boxArea(right.groundBbox))[0];
    if (!match) continue;
    linkedGrounds.add(match.groundBoxId);
    links.push(
      buildWireGroundReferenceLink({
        wireBoxId,
        groundBoxId: match.groundBoxId,
        groundLabel: match.groundLabel,
        groundBbox: match.groundBbox,
        parentAttachmentId: endpoint.id,
        pageNum,
        capturedAt,
      })
    );
  }
  return links;
}

export function buildMissingTouchedWireEndpointGroundLinks({
  wireBoxId,
  endpoints,
  groundReferences,
  existingLinks,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  endpoints: WireEndpointAttachment[];
  groundReferences: WireEndpointGroundReferenceCandidate[];
  existingLinks: ExistingEndpointContactLink[];
  pageNum: number;
  capturedAt: string;
}): WireGroundReferenceAttachment[] {
  const linkedEndpointIds = new Set(
    existingLinks
      .filter(
        (link) =>
          link.relation === "wire_segment_endpoint_to_connection_point" ||
          link.relation === "wire_segment_to_ground_reference"
      )
      .map((link) => link.parentAttachmentId)
      .filter(Boolean) as string[]
  );
  const linkedGroundIds = new Set(
    existingLinks
      .filter((link) => link.relation === "wire_segment_to_ground_reference")
      .map((link) => link.linkedBoxId)
      .filter(Boolean) as string[]
  );
  const availableEndpoints = endpoints.filter(
    (endpoint) => !linkedEndpointIds.has(endpoint.id)
  );
  const availableGroundReferences = groundReferences.filter(
    (ground) => !linkedGroundIds.has(ground.groundBoxId)
  );
  return buildTouchedWireEndpointGroundLinks({
    wireBoxId,
    endpoints: availableEndpoints,
    groundReferences: availableGroundReferences,
    pageNum,
    capturedAt,
  });
}

export function buildWireGroundReferenceLink({
  wireBoxId,
  groundBoxId,
  groundLabel,
  groundBbox,
  parentAttachmentId = null,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  groundBoxId: string;
  groundLabel: string;
  groundBbox: WireConnectionPointBox;
  parentAttachmentId?: string | null;
  pageNum: number;
  capturedAt: string;
}): WireGroundReferenceAttachment {
  return {
    id: `${wireBoxId}-ground-reference-link-${crypto.randomUUID()}`,
    type: "ground_reference",
    text: groundLabel || "ground",
    bbox: groundBbox,
    linkedBoxId: groundBoxId,
    linkedAttachmentId: null,
    parentAttachmentId,
    relation: "wire_segment_to_ground_reference",
    provenance: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      pageNum,
      coordinateSpace: "page_px",
      pageSizePx: {
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
      },
      bbox: groundBbox,
      source: "wire_endpoint_auto_ground_reference",
      capturedAt,
    },
    physicalSizePx: {
      width: groundBbox.width,
      height: groundBbox.height,
      area: groundBbox.width * groundBbox.height,
    },
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

export function findNearbyConnectionPoint<T extends { type?: string; bbox: WireConnectionPointBox }>({
  attachments,
  point,
  tolerance,
}: {
  attachments: T[];
  point: Point;
  tolerance: number;
}): T | null {
  return (
    attachments
      .filter((attachment) => attachment.type === "connection_point")
      .map((attachment) => ({
        attachment,
        distance: distanceBetween(centerOfBox(attachment.bbox), point),
      }))
      .filter((candidate) => candidate.distance <= tolerance)
      .sort((left, right) => left.distance - right.distance)[0]?.attachment ?? null
  );
}

function buildWireEndpointAttachment({
  wireBoxId,
  point,
  text,
  zoom,
  pageNum,
  capturedAt,
}: {
  wireBoxId: string;
  point: Point;
  text: "start" | "end";
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): WireEndpointAttachment {
  const size = Math.max(18, 14 / zoom);
  const bbox = clampBox({
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size,
  });
  return {
    id: `${wireBoxId}-wire-endpoint-${text}-${crypto.randomUUID()}`,
    type: "wire_endpoint",
    text,
    bbox,
    parentAttachmentId: null,
    linkedBoxId: null,
    linkedAttachmentId: null,
    relation: "wire_segment_has_endpoint",
    provenance: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      pageNum,
      coordinateSpace: "page_px",
      pageSizePx: {
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
      },
      bbox,
      source: "wire_endpoint_auto",
      capturedAt,
    },
    physicalSizePx: {
      width: bbox.width,
      height: bbox.height,
      area: bbox.width * bbox.height,
    },
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function nearestPointOnWireBox(point: Point, box: WireConnectionPointBox): Point {
  const horizontal = box.width >= box.height;
  return {
    x: horizontal ? Math.max(box.x, Math.min(box.x + box.width, point.x)) : box.x + box.width / 2,
    y: horizontal ? box.y + box.height / 2 : Math.max(box.y, Math.min(box.y + box.height, point.y)),
  };
}

function wireEndpointPoints(box: WireConnectionPointBox): { start: Point; end: Point } {
  const horizontal = box.width >= box.height;
  const center = centerOfBox(box);
  return {
    start: {
      x: horizontal ? box.x : center.x,
      y: horizontal ? center.y : box.y,
    },
    end: {
      x: horizontal ? box.x + box.width : center.x,
      y: horizontal ? center.y : box.y + box.height,
    },
  };
}

function clampBox(box: WireConnectionPointBox): WireConnectionPointBox {
  return {
    x: Math.max(0, Math.min(PAGE_WIDTH_PX - box.width, box.x)),
    y: Math.max(0, Math.min(PAGE_HEIGHT_PX - box.height, box.y)),
    width: box.width,
    height: box.height,
  };
}

function boxesOverlap(left: WireConnectionPointBox, right: WireConnectionPointBox): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function boxArea(box: WireConnectionPointBox): number {
  return box.width * box.height;
}

function centerOfBox(box: WireConnectionPointBox): Point {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function distanceBetween(left: Point, right: Point): number {
  return Math.sqrt(Math.pow(left.x - right.x, 2) + Math.pow(left.y - right.y, 2));
}
