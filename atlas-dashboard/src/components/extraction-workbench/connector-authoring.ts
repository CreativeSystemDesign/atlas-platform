import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  clampBoxToPage,
  MIN_BOX_SIZE,
  type BBoxPx,
} from "./studio-geometry.ts";
import {
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  type AnnotationAttachment,
  type AnnotationBox,
} from "./studio-types.ts";

type ConnectorRootAuthoringResult =
  | {
      status: "created";
      box: AnnotationBox;
      connectionPointIds: string[];
    }
  | {
      status: "blocked";
    };

type ConnectorSide = "left" | "right" | "top" | "bottom";

export function buildConnectorRootAnnotation({
  id,
  bbox,
  pairCount,
  pageNum,
  zoom,
  capturedAt,
  createId = (suffix) => `${id}-${suffix}-${crypto.randomUUID()}`,
}: {
  id: string;
  bbox: BBoxPx;
  pairCount: number;
  pageNum: number;
  zoom: number;
  capturedAt: string;
  createId?: (suffix: string) => string;
}): ConnectorRootAuthoringResult {
  const normalizedPairCount = Math.floor(pairCount);
  if (
    bbox.width < MIN_BOX_SIZE ||
    bbox.height < MIN_BOX_SIZE ||
    normalizedPairCount < 1
  ) {
    return { status: "blocked" };
  }

  const terminalPairs = buildConnectorTerminalPairs({
    connectorBoxId: id,
    bbox,
    pairCount: normalizedPairCount,
    zoom,
    pageNum,
    capturedAt,
    createId,
  });
  const attachments = terminalPairs.flatMap((pair) => [
    pair.first,
    pair.second,
    pair.pairLink,
  ]);

  return {
    status: "created",
    box: {
      id,
      pageNum,
      label: "connector",
      bbox,
      labelBbox: null,
      labelSource: "manual",
      labelCandidateIndex: -1,
      labelCandidates: [],
      source: "human",
      snapped: true,
      metadata: {
        rootType: "connector",
        attachments,
        provenance: buildSpatialProvenance(
          bbox,
          pageNum,
          "manual_connector",
          capturedAt
        ),
        physicalSizePx: physicalSizeOf(bbox),
      },
      createdAt: capturedAt,
      updatedAt: capturedAt,
    },
    connectionPointIds: terminalPairs.flatMap((pair) => [
      pair.first.id,
      pair.second.id,
    ]),
  };
}

function buildConnectorTerminalPairs({
  connectorBoxId,
  bbox,
  pairCount,
  zoom,
  pageNum,
  capturedAt,
  createId,
}: {
  connectorBoxId: string;
  bbox: BBoxPx;
  pairCount: number;
  zoom: number;
  pageNum: number;
  capturedAt: string;
  createId: (suffix: string) => string;
}) {
  const vertical = bbox.height >= bbox.width;
  const firstSide: ConnectorSide = vertical ? "left" : "top";
  const secondSide: ConnectorSide = vertical ? "right" : "bottom";

  return Array.from({ length: pairCount }, (_, index) => {
    const pairNumber = index + 1;
    const first = buildConnectorConnectionPoint({
      side: firstSide,
      index: pairNumber,
      bbox,
      pairCount,
      zoom,
      pageNum,
      capturedAt,
      id: createId(`${firstSide}-${pairNumber}`),
    });
    const second = buildConnectorConnectionPoint({
      side: secondSide,
      index: pairNumber,
      bbox,
      pairCount,
      zoom,
      pageNum,
      capturedAt,
      id: createId(`${secondSide}-${pairNumber}`),
    });
    return {
      first,
      second,
      pairLink: buildConnectorPairLink({
        connectorBoxId,
        first,
        second,
        pageNum,
        capturedAt,
        id: createId(`pair-${pairNumber}`),
      }),
    };
  });
}

function buildConnectorConnectionPoint({
  side,
  index,
  bbox,
  pairCount,
  zoom,
  pageNum,
  capturedAt,
  id,
}: {
  side: ConnectorSide;
  index: number;
  bbox: BBoxPx;
  pairCount: number;
  zoom: number;
  pageNum: number;
  capturedAt: string;
  id: string;
}): AnnotationAttachment {
  const size = Math.max(18, 18 / zoom);
  const center = connectorTerminalCenter(side, index, pairCount, bbox);
  const pointBox = clampBoxToPage(
    {
      x: center.x - size / 2,
      y: center.y - size / 2,
      width: size,
      height: size,
    },
    {
      width: PAGE_WIDTH_PX,
      height: PAGE_HEIGHT_PX,
    }
  );

  return {
    id,
    type: "connection_point",
    text: "connection",
    bbox: pointBox,
    parentAttachmentId: null,
    relation: "connector_has_connection_point",
    provenance: buildSpatialProvenance(
      pointBox,
      pageNum,
      `manual_connector_${side}_connection_point`,
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(pointBox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function buildConnectorPairLink({
  connectorBoxId,
  first,
  second,
  pageNum,
  capturedAt,
  id,
}: {
  connectorBoxId: string;
  first: AnnotationAttachment;
  second: AnnotationAttachment;
  pageNum: number;
  capturedAt: string;
  id: string;
}): AnnotationAttachment {
  return {
    id,
    type: "connection_point",
    text: "terminal pair",
    bbox: second.bbox,
    parentAttachmentId: first.id,
    linkedBoxId: connectorBoxId,
    linkedAttachmentId: second.id,
    relation: "connector_connection_point_pair",
    provenance: buildSpatialProvenance(
      second.bbox,
      pageNum,
      "manual_connector_terminal_pair",
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(second.bbox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function connectorTerminalCenter(
  side: ConnectorSide,
  index: number,
  pairCount: number,
  bbox: BBoxPx
) {
  const horizontalOffset = (bbox.width / (pairCount + 1)) * index;
  const verticalOffset = (bbox.height / (pairCount + 1)) * index;
  if (side === "left") return { x: bbox.x, y: bbox.y + verticalOffset };
  if (side === "right") return { x: bbox.x + bbox.width, y: bbox.y + verticalOffset };
  if (side === "top") return { x: bbox.x + horizontalOffset, y: bbox.y };
  return { x: bbox.x + horizontalOffset, y: bbox.y + bbox.height };
}
