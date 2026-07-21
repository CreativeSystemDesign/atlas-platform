import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_BOX_SIZE,
  areaOfBox,
  boxContainsPoint,
  boxesIntersect,
  centerOfBox,
  clampBoxToPage,
  clampPointToBox,
  distanceBetween,
  distanceToBox,
  enclosingBox,
  expandBox,
  intersectionArea,
  normalizeBoxFromPoints,
  pdfBboxToPx,
  pointAnchorBox,
  resizeBox,
} from "./studio-geometry.ts";

test("converts PDF boxes and preserves the minimum annotation size", () => {
  assert.equal(MIN_BOX_SIZE, 8);
  assert.deepEqual(pdfBboxToPx([10, 20, 11, 21], 2), {
    x: 20,
    y: 40,
    width: 8,
    height: 8,
  });
  assert.deepEqual(pdfBboxToPx([10, 20, 30, 45], 2), {
    x: 20,
    y: 40,
    width: 40,
    height: 50,
  });
});

test("computes common bbox geometry for Studio hit testing", () => {
  const box = { x: 10, y: 20, width: 30, height: 40 };

  assert.deepEqual(centerOfBox(box), { x: 25, y: 40 });
  assert.equal(areaOfBox(box), 1200);
  assert.equal(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distanceToBox({ x: 4, y: 10 }, box), Math.hypot(6, 10));
  assert.equal(distanceToBox({ x: 20, y: 30 }, box), 0);
  assert.deepEqual(pointAnchorBox({ x: 10, y: 20 }, 6), {
    x: 7,
    y: 17,
    width: 6,
    height: 6,
  });
  assert.deepEqual(clampPointToBox({ x: 100, y: 0 }, box), { x: 40, y: 20 });
  assert.deepEqual(expandBox(box, 2), { x: 8, y: 18, width: 34, height: 44 });
});

test("handles bbox intersection, containment, resize, and enclosure", () => {
  const box = { x: 10, y: 10, width: 30, height: 20 };
  const overlap = { x: 35, y: 20, width: 20, height: 20 };
  const distant = { x: 100, y: 100, width: 10, height: 10 };

  assert.equal(boxesIntersect(box, overlap), true);
  assert.equal(boxesIntersect(box, distant), false);
  assert.equal(boxContainsPoint(box, { x: 40, y: 30 }), true);
  assert.equal(boxContainsPoint(box, { x: 41, y: 30 }), false);
  assert.equal(intersectionArea(box, overlap), 50);
  assert.deepEqual(enclosingBox([box, distant]), { x: 10, y: 10, width: 100, height: 100 });
  assert.deepEqual(enclosingBox([]), { x: 0, y: 0, width: 0, height: 0 });

  const resized = resizeBox(box, "nw", 50, 50, (next) => next);
  assert.deepEqual(resized, { x: 32, y: 22, width: 8, height: 8 });
});

test("clamps and normalizes annotation boxes inside page bounds", () => {
  const pageSize = { width: 100, height: 80 };

  assert.deepEqual(
    clampBoxToPage({ x: 95, y: -10, width: 20, height: 4 }, pageSize),
    { x: 80, y: 0, width: 20, height: 8 }
  );

  assert.deepEqual(
    clampBoxToPage({ x: -50, y: 10, width: 200, height: 200 }, pageSize),
    { x: 0, y: 0, width: 100, height: 80 }
  );

  assert.deepEqual(
    normalizeBoxFromPoints({ x: 90, y: 70 }, { x: 30, y: 20 }, pageSize),
    { x: 30, y: 20, width: 60, height: 50 }
  );
});
