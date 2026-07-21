import assert from "node:assert/strict";
import test from "node:test";

import {
  nearestWireRootAtPoint,
  smallestRootContainingPoint,
} from "./studio-hit-targets.ts";

test("selects the nearest wire root and uses area as a tie breaker", () => {
  const point = { x: 50, y: 50 };
  const boxes = [
    box("selected", "wire_segment", { x: 48, y: 48, width: 12, height: 12 }),
    box("large-wire", "wire_segment", { x: 42, y: 42, width: 40, height: 40 }),
    box("small-wire", "wire_segment", { x: 44, y: 44, width: 20, height: 20 }),
    box("component", "component", { x: 45, y: 45, width: 10, height: 10 }),
  ];

  assert.equal(
    nearestWireRootAtPoint(boxes, {
      point,
      excludeBoxId: "selected",
      maxDistance: 18,
    })?.id,
    "small-wire"
  );
});

test("returns null when no wire root is close enough", () => {
  assert.equal(
    nearestWireRootAtPoint(
      [box("wire", "wire_segment", { x: 100, y: 100, width: 20, height: 20 })],
      { point: { x: 0, y: 0 }, excludeBoxId: null, maxDistance: 18 }
    ),
    null
  );
});

test("wire hit testing uses segment geometry instead of a multi-segment enclosing bbox", () => {
  const multiSegmentWire = box("wire-6031", "wire_segment", {
    x: 100,
    y: 100,
    width: 260,
    height: 140,
  });
  multiSegmentWire.metadata.wireGeometry = {
    segments: [
      { bbox: { x: 100, y: 224, width: 160, height: 16 } },
      { bbox: { x: 244, y: 120, width: 16, height: 120 } },
      { bbox: { x: 244, y: 120, width: 116, height: 16 } },
    ],
  };

  assert.equal(
    smallestRootContainingPoint([multiSegmentWire], {
      point: { x: 150, y: 128 },
      excludeBoxId: null,
    }),
    null
  );
  assert.equal(
    nearestWireRootAtPoint([multiSegmentWire], {
      point: { x: 150, y: 128 },
      excludeBoxId: null,
      maxDistance: 18,
    }),
    null
  );
  assert.equal(
    nearestWireRootAtPoint([multiSegmentWire], {
      point: { x: 180, y: 232 },
      excludeBoxId: null,
      maxDistance: 18,
    })?.id,
    "wire-6031"
  );
});

test("selects the smallest root containing a point and respects max area", () => {
  const boxes = [
    box("selected", "component", { x: 0, y: 0, width: 100, height: 100 }),
    box("too-large", "component", { x: 0, y: 0, width: 300, height: 300 }),
    box("large", "component", { x: 0, y: 0, width: 80, height: 80 }),
    box("small", "component", { x: 10, y: 10, width: 20, height: 20 }),
  ];

  assert.equal(
    smallestRootContainingPoint(boxes, {
      point: { x: 15, y: 15 },
      excludeBoxId: "selected",
      maxArea: 60000,
    })?.id,
    "small"
  );
  assert.equal(
    smallestRootContainingPoint(boxes, {
      point: { x: 200, y: 200 },
      excludeBoxId: "selected",
      maxArea: 60000,
    }),
    null
  );
});

function box(id, rootType, bbox) {
  return {
    id,
    label: id,
    bbox,
    metadata: { rootType, attachments: [] },
  };
}
