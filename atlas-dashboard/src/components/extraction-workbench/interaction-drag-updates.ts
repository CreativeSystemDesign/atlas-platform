import type { ResizeHandle } from "./annotation-styles.ts";
import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  resizeBox,
  type BBoxPx,
} from "./studio-geometry.ts";
import type {
  AnnotationAttachment,
  AnnotationBox,
} from "./studio-types.ts";

type ClampBox = (box: BBoxPx) => BBoxPx;

type MoveParams = {
  original: BBoxPx;
  dx: number;
  dy: number;
  clampBox: ClampBox;
  capturedAt: string;
};

type PageMoveParams = MoveParams & {
  pageNum: number;
};

type ResizeParams = MoveParams & {
  handle: ResizeHandle;
};

type PageResizeParams = ResizeParams & {
  pageNum: number;
};

export function moveAnnotationBox(
  box: AnnotationBox,
  params: PageMoveParams
): AnnotationBox {
  const nextBbox = params.clampBox({
    ...params.original,
    x: params.original.x + params.dx,
    y: params.original.y + params.dy,
  });
  return {
    ...box,
    source: "human",
    bbox: nextBbox,
    metadata: {
      ...box.metadata,
      reviewStatus: "human-edited",
      provenance: buildSpatialProvenance(
        nextBbox,
        params.pageNum,
        "component_manual_move",
        params.capturedAt
      ),
      physicalSizePx: physicalSizeOf(nextBbox),
      ...(box.metadata?.yolo && typeof box.metadata.yolo === "object"
        ? {
            yolo: {
              ...box.metadata.yolo,
              lastManualAdjustment: "move",
              adjustedBbox: nextBbox,
            },
          }
        : {}),
    },
    snapped: false,
    updatedAt: params.capturedAt,
  };
}

export function resizeAnnotationBox(
  box: AnnotationBox,
  params: PageResizeParams
): AnnotationBox {
  const nextBbox = resizeBox(
    params.original,
    params.handle,
    params.dx,
    params.dy,
    params.clampBox
  );
  return {
    ...box,
    source: "human",
    bbox: nextBbox,
    metadata: {
      ...box.metadata,
      reviewStatus: "human-edited",
      provenance: buildSpatialProvenance(
        nextBbox,
        params.pageNum,
        "component_manual_resize",
        params.capturedAt
      ),
      physicalSizePx: physicalSizeOf(nextBbox),
      ...(box.metadata?.yolo && typeof box.metadata.yolo === "object"
        ? {
            yolo: {
              ...box.metadata.yolo,
              lastManualAdjustment: "resize",
              adjustedBbox: nextBbox,
            },
          }
        : {}),
    },
    snapped: false,
    updatedAt: params.capturedAt,
  };
}

export function moveAnnotationLabel(
  box: AnnotationBox,
  params: MoveParams
): AnnotationBox {
  return {
    ...box,
    labelBbox: params.clampBox({
      ...params.original,
      x: params.original.x + params.dx,
      y: params.original.y + params.dy,
    }),
    labelSource: "manual",
    updatedAt: params.capturedAt,
  };
}

export function resizeAnnotationLabel(
  box: AnnotationBox,
  params: ResizeParams
): AnnotationBox {
  return {
    ...box,
    labelBbox: resizeBox(
      params.original,
      params.handle,
      params.dx,
      params.dy,
      params.clampBox
    ),
    labelSource: "manual",
    updatedAt: params.capturedAt,
  };
}

export function moveAnnotationAttachment(
  attachment: AnnotationAttachment,
  params: PageMoveParams
): AnnotationAttachment {
  const nextBbox = params.clampBox({
    ...params.original,
    x: params.original.x + params.dx,
    y: params.original.y + params.dy,
  });
  return {
    ...attachment,
    bbox: nextBbox,
    provenance: buildSpatialProvenance(
      nextBbox,
      params.pageNum,
      "attachment_manual_move",
      params.capturedAt
    ),
    physicalSizePx: physicalSizeOf(nextBbox),
    snapped: false,
  };
}

export function resizeAnnotationAttachment(
  attachment: AnnotationAttachment,
  params: PageResizeParams
): AnnotationAttachment {
  const nextBbox = resizeBox(
    params.original,
    params.handle,
    params.dx,
    params.dy,
    params.clampBox
  );
  return {
    ...attachment,
    bbox: nextBbox,
    provenance: buildSpatialProvenance(
      nextBbox,
      params.pageNum,
      "attachment_manual_resize",
      params.capturedAt
    ),
    physicalSizePx: physicalSizeOf(nextBbox),
    snapped: false,
  };
}
