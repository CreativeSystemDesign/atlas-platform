import type { BBoxPx } from "./studio-geometry.ts";

export type ViewportPoint = {
  x: number;
  y: number;
};

export type StageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PageSize = {
  width: number;
  height: number;
};

export type ClientPoint = {
  clientX: number;
  clientY: number;
};

export function clampZoom(zoom: number, minZoom: number, maxZoom: number) {
  return Math.max(minZoom, Math.min(maxZoom, zoom));
}

function pageOrigin({
  stageRect,
  pageSize,
  pan,
  zoom,
}: {
  stageRect: StageRect;
  pageSize: PageSize;
  pan: ViewportPoint;
  zoom: number;
}) {
  return {
    left: stageRect.width / 2 + pan.x - (pageSize.width * zoom) / 2,
    top: stageRect.height / 2 + pan.y - (pageSize.height * zoom) / 2,
  };
}

export function pagePointFromClient({
  stageRect,
  pageSize,
  pan,
  zoom,
  clientPoint,
  clampToPage = false,
}: {
  stageRect: StageRect;
  pageSize: PageSize;
  pan: ViewportPoint;
  zoom: number;
  clientPoint: ClientPoint;
  clampToPage?: boolean;
}) {
  const stageX = clientPoint.clientX - stageRect.left;
  const stageY = clientPoint.clientY - stageRect.top;
  const { left, top } = pageOrigin({ stageRect, pageSize, pan, zoom });
  let x = (stageX - left) / zoom;
  let y = (stageY - top) / zoom;

  if (clampToPage) {
    x = Math.max(0, Math.min(pageSize.width, x));
    y = Math.max(0, Math.min(pageSize.height, y));
  }

  if (x < 0 || y < 0 || x > pageSize.width || y > pageSize.height) {
    return null;
  }

  return { x, y };
}

export function zoomAtClientPoint({
  stageRect,
  pageSize,
  pan,
  zoom,
  nextZoom,
  minZoom,
  maxZoom,
  clientPoint,
}: {
  stageRect: StageRect;
  pageSize: PageSize;
  pan: ViewportPoint;
  zoom: number;
  nextZoom: number;
  minZoom: number;
  maxZoom: number;
  clientPoint: ClientPoint;
}) {
  const boundedZoom = clampZoom(nextZoom, minZoom, maxZoom);
  const stageX = clientPoint.clientX - stageRect.left;
  const stageY = clientPoint.clientY - stageRect.top;
  const { left, top } = pageOrigin({ stageRect, pageSize, pan, zoom });
  const pageX = (stageX - left) / zoom;
  const pageY = (stageY - top) / zoom;
  const nextPageLeft = stageX - pageX * boundedZoom;
  const nextPageTop = stageY - pageY * boundedZoom;

  return {
    zoom: boundedZoom,
    pan: {
      x:
        nextPageLeft -
        stageRect.width / 2 +
        (pageSize.width * boundedZoom) / 2,
      y:
        nextPageTop -
        stageRect.height / 2 +
        (pageSize.height * boundedZoom) / 2,
    },
  };
}

export function visiblePageBox({
  stageRect,
  pageSize,
  pan,
  zoom,
}: {
  stageRect: StageRect;
  pageSize: PageSize;
  pan: ViewportPoint;
  zoom: number;
}): BBoxPx | null {
  const { left, top } = pageOrigin({ stageRect, pageSize, pan, zoom });
  const x0 = Math.max(0, (0 - left) / zoom);
  const y0 = Math.max(0, (0 - top) / zoom);
  const x1 = Math.min(pageSize.width, (stageRect.width - left) / zoom);
  const y1 = Math.min(pageSize.height, (stageRect.height - top) / zoom);

  if (x1 <= x0 || y1 <= y0) return null;

  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
  };
}
