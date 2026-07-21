import type { ResizeHandle } from "./annotation-styles.ts";

export const MIN_BOX_SIZE = 8;

export type BBoxPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageSizePx = {
  width: number;
  height: number;
};

export function clampBoxToPage(box: BBoxPx, pageSize: PageSizePx): BBoxPx {
  const width = Math.max(MIN_BOX_SIZE, Math.min(pageSize.width, box.width));
  const height = Math.max(MIN_BOX_SIZE, Math.min(pageSize.height, box.height));
  return {
    x: Math.max(0, Math.min(pageSize.width - width, box.x)),
    y: Math.max(0, Math.min(pageSize.height - height, box.y)),
    width,
    height,
  };
}

export function normalizeBoxFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  pageSize: PageSizePx
): BBoxPx {
  return clampBoxToPage(
    {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    },
    pageSize
  );
}

export function resizeBox(
  original: BBoxPx,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  clampBox: (box: BBoxPx) => BBoxPx
): BBoxPx {
  let { x, y, width, height } = original;
  if (handle.includes("w")) {
    x = original.x + dx;
    width = original.width - dx;
  }
  if (handle.includes("e")) {
    width = original.width + dx;
  }
  if (handle.includes("n")) {
    y = original.y + dy;
    height = original.height - dy;
  }
  if (handle.includes("s")) {
    height = original.height + dy;
  }
  if (width < MIN_BOX_SIZE) {
    x = original.x + original.width - MIN_BOX_SIZE;
    width = MIN_BOX_SIZE;
  }
  if (height < MIN_BOX_SIZE) {
    y = original.y + original.height - MIN_BOX_SIZE;
    height = MIN_BOX_SIZE;
  }
  return clampBox({ x, y, width, height });
}

export function pdfBboxToPx(
  bbox: [number, number, number, number],
  scale: number
): BBoxPx {
  const [x0, y0, x1, y1] = bbox;
  return {
    x: x0 * scale,
    y: y0 * scale,
    width: Math.max(MIN_BOX_SIZE, (x1 - x0) * scale),
    height: Math.max(MIN_BOX_SIZE, (y1 - y0) * scale),
  };
}

export function centerOfBox(box: BBoxPx) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

export function distanceBetween(
  left: { x: number; y: number },
  right: { x: number; y: number }
) {
  return Math.sqrt(Math.pow(left.x - right.x, 2) + Math.pow(left.y - right.y, 2));
}

export function distanceToBox(point: { x: number; y: number }, box: BBoxPx) {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
}

export function pointAnchorBox(
  point: { x: number; y: number },
  size: number
): BBoxPx {
  return {
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size,
  };
}

export function clampPointToBox(point: { x: number; y: number }, box: BBoxPx) {
  return {
    x: Math.max(box.x, Math.min(box.x + box.width, point.x)),
    y: Math.max(box.y, Math.min(box.y + box.height, point.y)),
  };
}

export function expandBox(box: BBoxPx, amount: number): BBoxPx {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

export function boxesIntersect(left: BBoxPx, right: BBoxPx) {
  return !(
    right.x > left.x + left.width ||
    right.x + right.width < left.x ||
    right.y > left.y + left.height ||
    right.y + right.height < left.y
  );
}

export function boxContainsPoint(box: BBoxPx, point: { x: number; y: number }) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

export function areaOfBox(box: BBoxPx) {
  return box.width * box.height;
}

export function intersectionArea(left: BBoxPx, right: BBoxPx) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

export function enclosingBox(boxes: BBoxPx[]): BBoxPx {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
