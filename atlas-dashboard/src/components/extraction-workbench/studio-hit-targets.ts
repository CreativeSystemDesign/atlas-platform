import { rootTypeOf, wireSegmentsOf } from "./annotation-box-helpers.ts";
import type { RootObjectKind } from "./annotation-model.ts";
import {
  areaOfBox,
  boxContainsPoint,
  distanceToBox,
  type BBoxPx,
} from "./studio-geometry.ts";

type RootHitBox = {
  id: string;
  bbox: BBoxPx;
  metadata?: {
    rootType?: RootObjectKind | null;
    wireGeometry?: {
      segments?: { bbox: BBoxPx }[] | null;
    } | null;
  } | null;
};

export function nearestWireRootAtPoint<Box extends RootHitBox>(
  boxes: Box[],
  {
    point,
    excludeBoxId,
    maxDistance,
  }: {
    point: { x: number; y: number };
    excludeBoxId: string | null;
    maxDistance: number;
  }
) {
  return (
    boxes
      .filter((box) => box.id !== excludeBoxId && rootTypeOf(box) === "wire_segment")
      .map((box) => {
        const hits = wireHitBoxes(box).map((hitBox) => ({
          hitBox,
          distance: distanceToBox(point, hitBox),
        }));
        const bestHit = hits.sort((left, right) => {
          const distanceDelta = left.distance - right.distance;
          if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
          return areaOfBox(left.hitBox) - areaOfBox(right.hitBox);
        })[0];
        return bestHit ? { box, ...bestHit } : null;
      })
      .filter((hit): hit is { box: Box; hitBox: BBoxPx; distance: number } =>
        Boolean(hit && hit.distance <= maxDistance)
      )
      .sort((left, right) => {
        const distanceDelta = left.distance - right.distance;
        if (Math.abs(distanceDelta) > 0.001) {
          return distanceDelta;
        }
        const hitAreaDelta = areaOfBox(left.hitBox) - areaOfBox(right.hitBox);
        if (Math.abs(hitAreaDelta) > 0.001) return hitAreaDelta;
        return areaOfBox(left.box.bbox) - areaOfBox(right.box.bbox);
      })[0]?.box ?? null
  );
}

export function smallestRootContainingPoint<Box extends RootHitBox>(
  boxes: Box[],
  {
    point,
    excludeBoxId,
    maxArea = Number.POSITIVE_INFINITY,
  }: {
    point: { x: number; y: number };
    excludeBoxId: string | null;
    maxArea?: number;
  }
) {
  return (
    boxes
      .filter((box) => box.id !== excludeBoxId)
      .map((box) => {
        const hitBox = rootHitBoxes(box)
          .filter((candidate) => boxContainsPoint(candidate, point))
          .sort((left, right) => areaOfBox(left) - areaOfBox(right))[0];
        return hitBox ? { box, hitBox } : null;
      })
      .filter((hit): hit is { box: Box; hitBox: BBoxPx } =>
        Boolean(hit && areaOfBox(hit.hitBox) < maxArea)
      )
      .sort((left, right) => {
        const hitAreaDelta = areaOfBox(left.hitBox) - areaOfBox(right.hitBox);
        if (Math.abs(hitAreaDelta) > 0.001) return hitAreaDelta;
        return areaOfBox(left.box.bbox) - areaOfBox(right.box.bbox);
      })[0]?.box ??
    null
  );
}

function rootHitBoxes(box: RootHitBox): BBoxPx[] {
  return rootTypeOf(box) === "wire_segment" ? wireHitBoxes(box) : [box.bbox];
}

function wireHitBoxes(box: RootHitBox): BBoxPx[] {
  const segmentBoxes = wireSegmentsOf<{ bbox: BBoxPx }>(box)
    .map((segment) => segment.bbox)
    .filter(Boolean);
  return segmentBoxes.length > 0 ? segmentBoxes : [box.bbox];
}
