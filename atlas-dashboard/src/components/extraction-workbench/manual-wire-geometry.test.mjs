import assert from "node:assert/strict";
import test from "node:test";

import { normalizeManualWireSegmentBox } from "./manual-wire-geometry.ts";

test("normalizes a manual horizontal wire draw to a thin canonical segment", () => {
  assert.deepEqual(
    normalizeManualWireSegmentBox(
      { x: 100, y: 100, width: 80, height: 28 },
      { clampBox: (box) => box }
    ),
    { x: 100, y: 106, width: 80, height: 16 }
  );
});

test("normalizes a manual vertical wire draw to a thin canonical segment", () => {
  assert.deepEqual(
    normalizeManualWireSegmentBox(
      { x: 100, y: 100, width: 24, height: 80 },
      { clampBox: (box) => box }
    ),
    { x: 104, y: 100, width: 16, height: 80 }
  );
});

test("rejects tiny manual wire gestures", () => {
  assert.equal(
    normalizeManualWireSegmentBox(
      { x: 100, y: 100, width: 8, height: 8 },
      { clampBox: (box) => box }
    ),
    null
  );
});
