import { centerOfBox, type BBoxPx } from "./studio-geometry.ts";

const DOCUMENT_ID = "schematic_<drawing-no>";
const PROJECT_ID = "00000000-0000-4000-8000-000000001650";
const PAGE_WIDTH_PX = 2481;
const PAGE_HEIGHT_PX = 3509;

type Point = { x: number; y: number };

export type CableConnectionPointBox = BBoxPx;

export type CableEndpointAttachment = {
  id: string;
  type: "cable_endpoint";
  text: "start" | "end";
  bbox: CableConnectionPointBox;
  parentAttachmentId: null;
  linkedBoxId?: null;
  linkedAttachmentId?: null;
  relation: "cable_segment_has_endpoint";
  provenance: {
    projectId: string;
    documentId: string;
    pageNum: number;
    coordinateSpace: "page_px";
    pageSizePx: {
      width: number;
      height: number;
    };
    bbox: CableConnectionPointBox;
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

export type CableConnectionPointAttachment = {
  id: string;
  type: "connection_point";
  text: string;
  bbox: CableConnectionPointBox;
  parentAttachmentId: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  relation: "cable_segment_endpoint_to_connection_point";
  provenance: {
    projectId: string;
    documentId: string;
    pageNum: number;
    coordinateSpace: "page_px";
    pageSizePx: {
      width: number;
      height: number;
    };
    bbox: CableConnectionPointBox;
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

export type CableEndpointConnectionPointCandidate = {
  ownerBoxId: string;
  ownerLabel: string;
  connectionPointId: string;
  connectionPointText: string;
  connectionPointBbox: CableConnectionPointBox;
};

export function buildCableEndpointAttachments({
  cableBoxId,
  cableBox,
  zoom,
  pageNum,
  capturedAt,
}: {
  cableBoxId: string;
  cableBox: CableConnectionPointBox;
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): CableEndpointAttachment[] {
  const { start, end } = cableEndpointPoints(cableBox);
  return [
    buildCableEndpointAttachment({
      cableBoxId,
      point: start,
      text: "start",
      zoom,
      pageNum,
      capturedAt,
    }),
    buildCableEndpointAttachment({
      cableBoxId,
      point: end,
      text: "end",
      zoom,
      pageNum,
      capturedAt,
    }),
  ];
}

export function buildTouchedCableEndpointConnectionLinks({
  cableBoxId,
  endpoints,
  connectionPoints,
  pageNum,
  capturedAt,
}: {
  cableBoxId: string;
  endpoints: CableEndpointAttachment[];
  connectionPoints: CableEndpointConnectionPointCandidate[];
  pageNum: number;
  capturedAt: string;
}): CableConnectionPointAttachment[] {
  const linkedConnectionPoints = new Set<string>();
  const links: CableConnectionPointAttachment[] = [];
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
      buildCableConnectionPointLink({
        cableBoxId,
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

function buildCableConnectionPointLink({
  cableBoxId,
  ownerBoxId,
  ownerLabel,
  connectionPointId,
  connectionPointText,
  connectionPointBbox,
  parentAttachmentId,
  pageNum,
  capturedAt,
}: {
  cableBoxId: string;
  ownerBoxId: string;
  ownerLabel: string;
  connectionPointId: string;
  connectionPointText: string;
  connectionPointBbox: CableConnectionPointBox;
  parentAttachmentId: string | null;
  pageNum: number;
  capturedAt: string;
}): CableConnectionPointAttachment {
  return {
    id: `${cableBoxId}-connection-point-link-${crypto.randomUUID()}`,
    type: "connection_point",
    text: `${ownerLabel}:${connectionPointText || "connection"}`,
    bbox: connectionPointBbox,
    linkedBoxId: ownerBoxId,
    linkedAttachmentId: connectionPointId,
    parentAttachmentId,
    relation: "cable_segment_endpoint_to_connection_point",
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
      source: "cable_endpoint_auto_connection_point",
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

function buildCableEndpointAttachment({
  cableBoxId,
  point,
  text,
  zoom,
  pageNum,
  capturedAt,
}: {
  cableBoxId: string;
  point: Point;
  text: "start" | "end";
  zoom: number;
  pageNum: number;
  capturedAt: string;
}): CableEndpointAttachment {
  const size = Math.max(18, 14 / zoom);
  const bbox = clampBox({
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size,
  });
  return {
    id: `${cableBoxId}-cable-endpoint-${text}-${crypto.randomUUID()}`,
    type: "cable_endpoint",
    text,
    bbox,
    parentAttachmentId: null,
    linkedBoxId: null,
    linkedAttachmentId: null,
    relation: "cable_segment_has_endpoint",
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
      source: "cable_endpoint_auto",
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

function cableEndpointPoints(box: CableConnectionPointBox): {
  start: Point;
  end: Point;
} {
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

function clampBox(box: CableConnectionPointBox): CableConnectionPointBox {
  return {
    x: Math.max(0, Math.min(PAGE_WIDTH_PX - box.width, box.x)),
    y: Math.max(0, Math.min(PAGE_HEIGHT_PX - box.height, box.y)),
    width: box.width,
    height: box.height,
  };
}

function boxesOverlap(
  left: CableConnectionPointBox,
  right: CableConnectionPointBox
): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function boxArea(box: CableConnectionPointBox) {
  return box.width * box.height;
}
