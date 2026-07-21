import assert from "node:assert/strict";
import test from "node:test";
import { getNearestPointOnRect } from "./use-v2-drawing.ts";

test("getNearestPointOnRect snaps correctly to rectangle boundaries", () => {
  const rect = { x: 100, y: 100, width: 200, height: 150 };

  // 1. Point outside to the left should snap to left edge
  const p1 = { x: 50, y: 150 };
  assert.deepEqual(getNearestPointOnRect(p1, rect), { x: 100, y: 150 });

  // 2. Point outside to the top-right corner should snap to top-right corner
  const p2 = { x: 350, y: 50 };
  assert.deepEqual(getNearestPointOnRect(p2, rect), { x: 300, y: 100 });

  // 3. Point inside near the left border should snap to left border
  const p3 = { x: 110, y: 150 };
  assert.deepEqual(getNearestPointOnRect(p3, rect), { x: 100, y: 150 });

  // 4. Point inside near the bottom border should snap to bottom border
  const p4 = { x: 200, y: 245 };
  assert.deepEqual(getNearestPointOnRect(p4, rect), { x: 200, y: 250 });
});
