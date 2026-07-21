import {
  clampBoxToPage,
  enclosingBox,
  type BBoxPx,
  type PageSizePx,
} from "./studio-geometry.ts";
import { componentSnapPadding } from "./snap-strength.ts";
import type { SnapStrength } from "./studio-types.ts";

type ShapeMeta = {
  bbox: [number, number, number, number];
};

type PdfBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
};

export type ComponentSnapResult = {
  bbox: BBoxPx;
  snapped: boolean;
  reason?:
    | "metadata_unavailable"
    | "snap_disabled"
    | "enclosed_component"
    | "cluster_density"
    | "no_component_cluster"
    | "no_shape_hits";
};

export function snapComponentBoxToShapes({
  roughBox,
  scale,
  shapes,
  pageSize,
  snapPaddingPdf,
  snapStrength = "normal",
  requireEnclosedComponent = false,
}: {
  roughBox: BBoxPx;
  scale?: number;
  shapes: ShapeMeta[];
  pageSize: PageSizePx;
  snapPaddingPdf: number;
  snapStrength?: SnapStrength;
  requireEnclosedComponent?: boolean;
}): ComponentSnapResult {
  if (!scale || shapes.length === 0) {
    return { bbox: roughBox, snapped: false, reason: "metadata_unavailable" };
  }
  const adjustedSnapPaddingPdf = componentSnapPadding({
    strength: snapStrength,
    normalPaddingPdf: snapPaddingPdf,
  });
  if (adjustedSnapPaddingPdf <= 0) {
    return { bbox: roughBox, snapped: false, reason: "snap_disabled" };
  }

  const rx0 = roughBox.x / scale;
  const ry0 = roughBox.y / scale;
  const rx1 = (roughBox.x + roughBox.width) / scale;
  const ry1 = (roughBox.y + roughBox.height) / scale;
  const clickPointPdf = {
    x: (rx0 + rx1) / 2,
    y: (ry0 + ry1) / 2,
  };
  const compactSymbol = compactComponentSymbolAtPoint({
    point: clickPointPdf,
    shapes,
    pageSizePdf: {
      width: pageSize.width / scale,
      height: pageSize.height / scale,
    },
  });
  if (compactSymbol) {
    return {
      bbox: clampBoxToPage(
        {
          x: (compactSymbol.x0 - adjustedSnapPaddingPdf) * scale,
          y: (compactSymbol.y0 - adjustedSnapPaddingPdf) * scale,
          width:
            (compactSymbol.x1 - compactSymbol.x0 + adjustedSnapPaddingPdf * 2) *
            scale,
          height:
            (compactSymbol.y1 - compactSymbol.y0 + adjustedSnapPaddingPdf * 2) *
            scale,
        },
        pageSize
      ),
      snapped: true,
      reason: "cluster_density",
    };
  }
  const enclosingComponent = enclosingComponentBoxAtPoint({
    point: clickPointPdf,
    shapes,
    pageSizePdf: {
      width: pageSize.width / scale,
      height: pageSize.height / scale,
    },
  });
  if (enclosingComponent) {
    const expandedComponent = expandPdfBox(enclosingComponent, 10);
    const terminalShapes = shapes
      .map((shape) => normalizePdfBox(shape.bbox))
      .filter((shape) => shouldIncludeComponentEdgeShape(shape, expandedComponent));
    const snappedPdfBox = unionPdfBoxes([
      enclosingComponent,
      ...terminalShapes,
    ]);
    return {
      bbox: clampBoxToPage(
        {
          x: (snappedPdfBox.x0 - adjustedSnapPaddingPdf) * scale,
          y: (snappedPdfBox.y0 - adjustedSnapPaddingPdf) * scale,
          width:
            (snappedPdfBox.x1 - snappedPdfBox.x0 + adjustedSnapPaddingPdf * 2) *
            scale,
          height:
            (snappedPdfBox.y1 - snappedPdfBox.y0 + adjustedSnapPaddingPdf * 2) *
            scale,
        },
        pageSize
      ),
      snapped: true,
      reason: "enclosed_component",
    };
  }
  if (requireEnclosedComponent) {
    const densityCluster = componentDensityClusterAtPoint({
      point: clickPointPdf,
      shapes,
      pageSizePdf: {
        width: pageSize.width / scale,
        height: pageSize.height / scale,
      },
    });
    if (!densityCluster) {
      return { bbox: roughBox, snapped: false, reason: "no_component_cluster" };
    }
    return {
      bbox: clampBoxToPage(
        {
          x: (densityCluster.x0 - adjustedSnapPaddingPdf) * scale,
          y: (densityCluster.y0 - adjustedSnapPaddingPdf) * scale,
          width:
            (densityCluster.x1 - densityCluster.x0 + adjustedSnapPaddingPdf * 2) *
            scale,
          height:
            (densityCluster.y1 - densityCluster.y0 + adjustedSnapPaddingPdf * 2) *
            scale,
        },
        pageSize
      ),
      snapped: true,
      reason: "cluster_density",
    };
  }

  const hits = shapes.filter((shape) => {
    const [sx0, sy0, sx1, sy1] = shape.bbox;
    const width = sx1 - sx0;
    const height = sy1 - sy0;
    if (width > 120 && height > 120) return false;
    if (width > 0.5 && height > 0.5) {
      const aspect =
        Math.max(width, height) / Math.max(Math.min(width, height), 0.1);
      if (aspect > 8) return false;
    }
    const cx = (sx0 + sx1) / 2;
    const cy = (sy0 + sy1) / 2;
    return rx0 <= cx && cx <= rx1 && ry0 <= cy && cy <= ry1;
  });

  if (hits.length === 0) {
    return { bbox: roughBox, snapped: false, reason: "no_shape_hits" };
  }

  const x0 =
    Math.min(...hits.map((shape) => shape.bbox[0])) - adjustedSnapPaddingPdf;
  const y0 =
    Math.min(...hits.map((shape) => shape.bbox[1])) - adjustedSnapPaddingPdf;
  const x1 =
    Math.max(...hits.map((shape) => shape.bbox[2])) + adjustedSnapPaddingPdf;
  const y1 =
    Math.max(...hits.map((shape) => shape.bbox[3])) + adjustedSnapPaddingPdf;

  return {
    bbox: clampBoxToPage(
      {
        x: x0 * scale,
        y: y0 * scale,
        width: (x1 - x0) * scale,
        height: (y1 - y0) * scale,
      },
      pageSize
    ),
    snapped: true,
    reason: "cluster_density",
  };
}

function enclosingComponentBoxAtPoint({
  point,
  shapes,
  pageSizePdf,
}: {
  point: { x: number; y: number };
  shapes: ShapeMeta[];
  pageSizePdf: PageSizePx;
}): PdfBox | null {
  const normalizedShapes = shapes.map((shape) => normalizePdfBox(shape.bbox));
  const directShape = normalizedShapes
    .filter((shape) => boxContainsPdfPoint(shape, point))
    .filter((shape) => isValidComponentEnvelope(shape, pageSizePdf))
    .sort((left, right) => left.width * left.height - right.width * right.height)[0];
  if (directShape) return directShape;

  const rayBox = boundaryRayEnclosureAtPoint({
    point,
    shapes: normalizedShapes,
    pageSizePdf,
  });
  if (rayBox) return rayBox;

  const lineTolerance = 2.5;
  const searchRadius = 360;
  const verticals = normalizedShapes
    .filter(
      (shape) =>
        shape.width <= lineTolerance &&
        shape.height >= 3 &&
        Math.abs((shape.x0 + shape.x1) / 2 - point.x) <= searchRadius
    )
    .sort((left, right) => Math.abs((left.x0 + left.x1) / 2 - point.x) - Math.abs((right.x0 + right.x1) / 2 - point.x));
  const horizontals = normalizedShapes
    .filter(
      (shape) =>
        shape.height <= lineTolerance &&
        shape.width >= 18 &&
        Math.abs((shape.y0 + shape.y1) / 2 - point.y) <= searchRadius
    )
    .sort((left, right) => Math.abs((left.y0 + left.y1) / 2 - point.y) - Math.abs((right.y0 + right.y1) / 2 - point.y));

  const top = horizontals
    .filter(
      (shape) =>
        shape.x0 - lineTolerance <= point.x &&
        point.x <= shape.x1 + lineTolerance
    )
    .filter((shape) => (shape.y0 + shape.y1) / 2 <= point.y)
    .sort((a, b) => (b.y0 + b.y1) / 2 - (a.y0 + a.y1) / 2)[0];
  const bottom = horizontals
    .filter(
      (shape) =>
        shape.x0 - lineTolerance <= point.x &&
        point.x <= shape.x1 + lineTolerance
    )
    .filter((shape) => (shape.y0 + shape.y1) / 2 >= point.y)
    .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)[0];

  if (!top || !bottom) return null;
  const sideY0 = Math.min(top.y0, top.y1);
  const sideY1 = Math.max(bottom.y0, bottom.y1);
  const left = bestSegmentedVerticalSide({
    verticals,
    xPredicate: (x) => x <= point.x,
    sortDirection: "descending",
    y0: sideY0,
    y1: sideY1,
    lineTolerance,
  });
  const right = bestSegmentedVerticalSide({
    verticals,
    xPredicate: (x) => x >= point.x,
    sortDirection: "ascending",
    y0: sideY0,
    y1: sideY1,
    lineTolerance,
  });

  if (!left || !right) return null;
  const box = normalizePdfBox([left.x0, top.y0, right.x1, bottom.y1]);
  if (!isValidComponentEnvelope(box, pageSizePdf)) return null;
  const horizontalSpansBox =
    top.x0 <= left.x1 + lineTolerance &&
    top.x1 >= right.x0 - lineTolerance &&
    bottom.x0 <= left.x1 + lineTolerance &&
    bottom.x1 >= right.x0 - lineTolerance;
  return horizontalSpansBox ? box : null;
}

function boundaryRayEnclosureAtPoint({
  point,
  shapes,
  pageSizePdf,
}: {
  point: { x: number; y: number };
  shapes: PdfBox[];
  pageSizePdf: PageSizePx;
}): PdfBox | null {
  const boundaryShapes = shapes.filter(isBoundaryEvidenceShape);
  const verticalTolerance = 7;
  const horizontalTolerance = 7;
  const maxRayDistance = 310;
  const left = nearestRayBoundary({
    shapes: boundaryShapes,
    point,
    direction: "left",
    tolerance: verticalTolerance,
    maxDistance: maxRayDistance,
  });
  const right = nearestRayBoundary({
    shapes: boundaryShapes,
    point,
    direction: "right",
    tolerance: verticalTolerance,
    maxDistance: maxRayDistance,
  });
  const top = nearestRayBoundary({
    shapes: boundaryShapes,
    point,
    direction: "up",
    tolerance: horizontalTolerance,
    maxDistance: maxRayDistance,
  });
  const bottom = nearestRayBoundary({
    shapes: boundaryShapes,
    point,
    direction: "down",
    tolerance: horizontalTolerance,
    maxDistance: maxRayDistance,
  });
  if (!left || !right || !top || !bottom) return null;

  const box = normalizePdfBox([left.coord, top.coord, right.coord, bottom.coord]);
  if (!isValidComponentEnvelope(box, pageSizePdf)) return null;
  if (!hasBoundaryEvidenceOnAllSides(box, boundaryShapes)) return null;
  return box;
}

function nearestRayBoundary({
  shapes,
  point,
  direction,
  tolerance,
  maxDistance,
}: {
  shapes: PdfBox[];
  point: { x: number; y: number };
  direction: "left" | "right" | "up" | "down";
  tolerance: number;
  maxDistance: number;
}) {
  const hits = shapes
    .filter((shape) => rayBoundaryShapeMatchesDirection(shape, direction))
    .map((shape) => {
      if (direction === "left" || direction === "right") {
        if (shape.y0 - tolerance > point.y || shape.y1 + tolerance < point.y) {
          return null;
        }
        const coord = direction === "left" ? shape.x1 : shape.x0;
        const distance = direction === "left" ? point.x - coord : coord - point.x;
        return distance > 0 && distance <= maxDistance
          ? { coord, distance, shape }
          : null;
      }
      if (shape.x0 - tolerance > point.x || shape.x1 + tolerance < point.x) {
        return null;
      }
      const coord = direction === "up" ? shape.y1 : shape.y0;
      const distance = direction === "up" ? point.y - coord : coord - point.y;
      return distance > 0 && distance <= maxDistance
        ? { coord, distance, shape }
        : null;
    })
    .filter((hit): hit is { coord: number; distance: number; shape: PdfBox } =>
      Boolean(hit)
    )
    .sort((left, right) => left.distance - right.distance);
  return hits[0] ?? null;
}

function isBoundaryEvidenceShape(shape: PdfBox) {
  const maxSide = Math.max(shape.width, shape.height);
  const minSide = Math.min(shape.width, shape.height);
  if (maxSide <= 16) return true;
  if (minSide <= 2.5 && maxSide >= 8) return true;
  return shape.width >= 8 && shape.height >= 8 && maxSide <= 24;
}

function rayBoundaryShapeMatchesDirection(
  shape: PdfBox,
  direction: "left" | "right" | "up" | "down"
) {
  if (isCompactBoundaryShape(shape)) return true;
  if (direction === "left" || direction === "right") {
    return shape.width <= 2.5 && shape.height >= 8;
  }
  return shape.height <= 2.5 && shape.width >= 8;
}

function isCompactBoundaryShape(shape: PdfBox) {
  return Math.max(shape.width, shape.height) <= 18;
}

function hasBoundaryEvidenceOnAllSides(box: PdfBox, shapes: PdfBox[]) {
  const tolerance = 8;
  return (
    sideEvidenceCoverage(box, shapes, "left", tolerance) >= 0.42 &&
    sideEvidenceCoverage(box, shapes, "right", tolerance) >= 0.42 &&
    sideEvidenceCoverage(box, shapes, "top", tolerance) >= 0.22 &&
    sideEvidenceCoverage(box, shapes, "bottom", tolerance) >= 0.22
  );
}

function sideEvidenceCoverage(
  box: PdfBox,
  shapes: PdfBox[],
  side: "left" | "right" | "top" | "bottom",
  tolerance: number
) {
  const sideShapes = shapes.filter((shape) => {
    if (side === "left") {
      return Math.abs(shape.x0 - box.x0) <= tolerance || Math.abs(shape.x1 - box.x0) <= tolerance;
    }
    if (side === "right") {
      return Math.abs(shape.x0 - box.x1) <= tolerance || Math.abs(shape.x1 - box.x1) <= tolerance;
    }
    if (side === "top") {
      return Math.abs(shape.y0 - box.y0) <= tolerance || Math.abs(shape.y1 - box.y0) <= tolerance;
    }
    return Math.abs(shape.y0 - box.y1) <= tolerance || Math.abs(shape.y1 - box.y1) <= tolerance;
  });
  if (side === "left" || side === "right") {
    return verticalCoverage(sideShapes, box.y0, box.y1, tolerance);
  }
  return horizontalCoverage(sideShapes, box.x0, box.x1, tolerance);
}

function horizontalCoverage(
  segments: PdfBox[],
  x0: number,
  x1: number,
  gapTolerance: number
) {
  const clipped = segments
    .map((segment) => ({
      x0: Math.max(x0, segment.x0),
      x1: Math.min(x1, segment.x1),
    }))
    .filter((segment) => segment.x1 > segment.x0)
    .sort((left, right) => left.x0 - right.x0);
  if (clipped.length === 0) return 0;
  let covered = 0;
  let currentStart = clipped[0].x0;
  let currentEnd = clipped[0].x1;
  for (const segment of clipped.slice(1)) {
    if (segment.x0 <= currentEnd + gapTolerance) {
      currentEnd = Math.max(currentEnd, segment.x1);
    } else {
      covered += currentEnd - currentStart;
      currentStart = segment.x0;
      currentEnd = segment.x1;
    }
  }
  covered += currentEnd - currentStart;
  return covered / Math.max(1, x1 - x0);
}

function bestSegmentedVerticalSide({
  verticals,
  xPredicate,
  sortDirection,
  y0,
  y1,
  lineTolerance,
}: {
  verticals: PdfBox[];
  xPredicate: (x: number) => boolean;
  sortDirection: "ascending" | "descending";
  y0: number;
  y1: number;
  lineTolerance: number;
}): PdfBox | null {
  const grouped = verticals
    .filter((shape) => {
      const x = (shape.x0 + shape.x1) / 2;
      return xPredicate(x) && shape.y1 >= y0 - lineTolerance && shape.y0 <= y1 + lineTolerance;
    })
    .reduce<Array<{ x: number; segments: PdfBox[] }>>((groups, shape) => {
      const x = (shape.x0 + shape.x1) / 2;
      const group = groups.find((candidate) => Math.abs(candidate.x - x) <= lineTolerance);
      if (group) {
        group.segments.push(shape);
      } else {
        groups.push({ x, segments: [shape] });
      }
      return groups;
    }, [])
    .map((group) => ({
      ...group,
      coverage: verticalCoverage(group.segments, y0, y1, lineTolerance),
      box: unionPdfBoxes(group.segments),
    }))
    .filter((group) => group.coverage >= 0.62)
    .sort((left, right) =>
      sortDirection === "ascending" ? left.x - right.x : right.x - left.x
    );
  return grouped[0]?.box ?? null;
}

function verticalCoverage(
  segments: PdfBox[],
  y0: number,
  y1: number,
  gapTolerance: number
) {
  const clipped = segments
    .map((segment) => ({
      y0: Math.max(y0, segment.y0),
      y1: Math.min(y1, segment.y1),
    }))
    .filter((segment) => segment.y1 > segment.y0)
    .sort((left, right) => left.y0 - right.y0);
  if (clipped.length === 0) return 0;
  let covered = 0;
  let currentStart = clipped[0].y0;
  let currentEnd = clipped[0].y1;
  for (const segment of clipped.slice(1)) {
    if (segment.y0 <= currentEnd + gapTolerance) {
      currentEnd = Math.max(currentEnd, segment.y1);
    } else {
      covered += currentEnd - currentStart;
      currentStart = segment.y0;
      currentEnd = segment.y1;
    }
  }
  covered += currentEnd - currentStart;
  return covered / Math.max(1, y1 - y0);
}

function componentDensityClusterAtPoint({
  point,
  shapes,
  pageSizePdf,
}: {
  point: { x: number; y: number };
  shapes: ShapeMeta[];
  pageSizePdf: PageSizePx;
}): PdfBox | null {
  const candidates = shapes
    .map((shape) => normalizePdfBox(shape.bbox))
    .filter((shape) => isLocalClusterShapeCandidate(shape, point));
  if (candidates.length < 2) return null;

  const components = connectedShapeComponents(candidates, 14);
  const ranked = components
    .map((component) => {
      const box = unionPdfBoxes(component);
      const area = Math.max(1, box.width * box.height);
      const pointDistance = distanceToPdfBox(point, box);
      const density = component.length / area;
      return { box, count: component.length, density, pointDistance };
    })
    .filter(({ box, count, density, pointDistance }) => {
      if (pointDistance > 12) return false;
      if (count < 2) return false;
      if (!isValidClusterEnvelope(box, pageSizePdf)) return false;
      if (box.width > 110 || box.height > 110) return false;
      return density >= 0.001;
    })
    .sort((left, right) => {
      const distanceDelta = left.pointDistance - right.pointDistance;
      if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return right.density - left.density;
    });

  return ranked[0]?.box ?? null;
}

function compactComponentSymbolAtPoint({
  point,
  shapes,
  pageSizePdf,
}: {
  point: { x: number; y: number };
  shapes: ShapeMeta[];
  pageSizePdf: PageSizePx;
}): PdfBox | null {
  const candidates = shapes
    .map((shape) => normalizePdfBox(shape.bbox))
    .filter((shape) => isCompactSymbolShapeCandidate(shape, point));
  if (candidates.length < 2) return null;

  const components = connectedShapeComponents(candidates, 7);
  const ranked = components
    .map((component) => {
      const box = unionPdfBoxes(component);
      const pointDistance = distanceToPdfBox(point, box);
      const dx = point.x - (box.x0 + box.x1) / 2;
      const dy = point.y - (box.y0 + box.y1) / 2;
      const centerDistance = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
      return { box, count: component.length, pointDistance, centerDistance };
    })
    .filter(({ box, count, pointDistance }) => {
      if (count < 2) return false;
      if (pointDistance > 10) return false;
      if (!isValidCompactSymbolEnvelope(box, pageSizePdf)) return false;
      return true;
    })
    .sort((left, right) => {
      const distanceDelta = left.pointDistance - right.pointDistance;
      if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
      const centerDelta = left.centerDistance - right.centerDistance;
      if (Math.abs(centerDelta) > 0.001) return centerDelta;
      return left.box.width * left.box.height - right.box.width * right.box.height;
    });

  return ranked[0]?.box ?? null;
}

function isCompactSymbolShapeCandidate(shape: PdfBox, point: { x: number; y: number }) {
  const maxSide = Math.max(shape.width, shape.height);
  const minSide = Math.min(shape.width, shape.height);
  const center = {
    x: (shape.x0 + shape.x1) / 2,
    y: (shape.y0 + shape.y1) / 2,
  };
  if (Math.abs(center.x - point.x) > 42) return false;
  if (Math.abs(center.y - point.y) > 26) return false;
  if (distanceToPdfBox(point, shape) > 26) return false;
  if (maxSide > 58) return false;
  if (minSide <= 2.5 && maxSide > 48) return false;
  return maxSide >= 1 && minSide >= 0;
}

function isLocalClusterShapeCandidate(shape: PdfBox, point: { x: number; y: number }) {
  const maxSide = Math.max(shape.width, shape.height);
  const minSide = Math.min(shape.width, shape.height);
  const center = {
    x: (shape.x0 + shape.x1) / 2,
    y: (shape.y0 + shape.y1) / 2,
  };
  if (Math.abs(center.x - point.x) > 34) return false;
  if (Math.abs(center.y - point.y) > 34) return false;
  if (distanceToPdfBox(point, shape) > 24) return false;
  if (minSide <= 2.5 && maxSide > 52) return false;
  if (maxSide > 70) return false;
  return maxSide >= 1 && minSide >= 0;
}

function connectedShapeComponents(shapes: PdfBox[], gap: number) {
  const remaining = new Set(shapes.map((_, index) => index));
  const components: PdfBox[][] = [];
  while (remaining.size > 0) {
    const [first] = remaining;
    const queue = [first];
    const component: PdfBox[] = [];
    remaining.delete(first);
    while (queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) continue;
      const shape = shapes[index];
      component.push(shape);
      for (const candidateIndex of [...remaining]) {
        if (pdfBoxesIntersect(expandPdfBox(shape, gap), shapes[candidateIndex])) {
          remaining.delete(candidateIndex);
          queue.push(candidateIndex);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function normalizePdfBox(bbox: [number, number, number, number]): PdfBox {
  const x0 = Math.min(bbox[0], bbox[2]);
  const y0 = Math.min(bbox[1], bbox[3]);
  const x1 = Math.max(bbox[0], bbox[2]);
  const y1 = Math.max(bbox[1], bbox[3]);
  return {
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0,
    height: y1 - y0,
  };
}

function isValidComponentEnvelope(box: PdfBox, pageSizePdf: PageSizePx) {
  if (box.width < 18 || box.height < 18) return false;
  if (box.width > pageSizePdf.width * 0.82) return false;
  if (box.height > pageSizePdf.height * 0.82) return false;
  const aspect = Math.max(box.width, box.height) / Math.max(1, Math.min(box.width, box.height));
  return aspect <= 16;
}

function isValidCompactSymbolEnvelope(box: PdfBox, pageSizePdf: PageSizePx) {
  if (box.width < 8 || box.height < 4) return false;
  if (box.width > 96 || box.height > 52) return false;
  if (box.width > pageSizePdf.width * 0.08) return false;
  if (box.height > pageSizePdf.height * 0.08) return false;
  const aspect = Math.max(box.width, box.height) / Math.max(1, Math.min(box.width, box.height));
  return aspect <= 14;
}

function isValidClusterEnvelope(box: PdfBox, pageSizePdf: PageSizePx) {
  if (box.width < 6 || box.height < 4) return false;
  if (box.width > pageSizePdf.width * 0.18) return false;
  if (box.height > pageSizePdf.height * 0.18) return false;
  const aspect = Math.max(box.width, box.height) / Math.max(1, Math.min(box.width, box.height));
  return aspect <= 16;
}

function shouldIncludeComponentEdgeShape(shape: PdfBox, componentBox: PdfBox) {
  if (!pdfBoxesIntersect(shape, componentBox)) return false;
  if (
    shape.x0 < componentBox.x0 - 2 ||
    shape.x1 > componentBox.x1 + 2 ||
    shape.y0 < componentBox.y0 - 2 ||
    shape.y1 > componentBox.y1 + 2
  ) {
    const shapeCenter = {
      x: (shape.x0 + shape.x1) / 2,
      y: (shape.y0 + shape.y1) / 2,
    };
    const insideCenter = boxContainsPdfPoint(componentBox, shapeCenter);
    const touchesBoundary =
      Math.abs(shape.x0 - componentBox.x0) <= 4 ||
      Math.abs(shape.x1 - componentBox.x1) <= 4 ||
      Math.abs(shape.y0 - componentBox.y0) <= 4 ||
      Math.abs(shape.y1 - componentBox.y1) <= 4;
    if (!insideCenter || !touchesBoundary) return false;
  }
  const maxSide = Math.max(shape.width, shape.height);
  const minSide = Math.min(shape.width, shape.height);
  if (maxSide <= 18) return true;
  if (shape.width > 1 && shape.height > 1) return true;
  const aspect = maxSide / Math.max(0.1, minSide);
  return aspect <= 8;
}

function expandPdfBox(box: PdfBox, amount: number): PdfBox {
  return normalizePdfBox([
    box.x0 - amount,
    box.y0 - amount,
    box.x1 + amount,
    box.y1 + amount,
  ]);
}

function unionPdfBoxes(boxes: PdfBox[]) {
  const pxBoxes = boxes.map((box) => ({
    x: box.x0,
    y: box.y0,
    width: box.width,
    height: box.height,
  }));
  const union = enclosingBox(pxBoxes);
  return normalizePdfBox([
    union.x,
    union.y,
    union.x + union.width,
    union.y + union.height,
  ]);
}

function boxContainsPdfPoint(box: PdfBox, point: { x: number; y: number }) {
  return (
    point.x >= box.x0 &&
    point.x <= box.x1 &&
    point.y >= box.y0 &&
    point.y <= box.y1
  );
}

function pdfBoxesIntersect(left: PdfBox, right: PdfBox) {
  return !(
    right.x0 > left.x1 ||
    right.x1 < left.x0 ||
    right.y0 > left.y1 ||
    right.y1 < left.y0
  );
}

function distanceToPdfBox(point: { x: number; y: number }, box: PdfBox) {
  const dx = Math.max(box.x0 - point.x, 0, point.x - box.x1);
  const dy = Math.max(box.y0 - point.y, 0, point.y - box.y1);
  return Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
}
