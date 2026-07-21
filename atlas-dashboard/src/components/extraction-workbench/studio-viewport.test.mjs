import assert from "node:assert/strict";
import test from "node:test";

import {
  clampZoom,
  pagePointFromClient,
  visiblePageBox,
  zoomAtClientPoint,
} from "./studio-viewport.ts";

const stageRect = { left: 10, top: 20, width: 500, height: 400 };
const pageSize = { width: 1000, height: 800 };

test("clamps zoom into the configured viewport bounds", () => {
  assert.equal(clampZoom(0.05, 0.12, 2.4), 0.12);
  assert.equal(clampZoom(3, 0.12, 2.4), 2.4);
  assert.equal(clampZoom(1.25, 0.12, 2.4), 1.25);
});

test("maps client points into page coordinates with optional clamping", () => {
  assert.deepEqual(
    pagePointFromClient({
      stageRect,
      pageSize,
      pan: { x: 0, y: 0 },
      zoom: 0.5,
      clientPoint: { clientX: 260, clientY: 220 },
    }),
    { x: 500, y: 400 }
  );

  assert.equal(
    pagePointFromClient({
      stageRect,
      pageSize,
      pan: { x: 0, y: 0 },
      zoom: 0.5,
      clientPoint: { clientX: -40, clientY: 20 },
    }),
    null
  );

  assert.deepEqual(
    pagePointFromClient({
      stageRect,
      pageSize,
      pan: { x: 0, y: 0 },
      zoom: 0.5,
      clientPoint: { clientX: -40, clientY: 20 },
      clampToPage: true,
    }),
    { x: 0, y: 0 }
  );
});

test("keeps the page point under the cursor stable when zooming", () => {
  const next = zoomAtClientPoint({
    stageRect,
    pageSize,
    pan: { x: 0, y: 0 },
    zoom: 0.5,
    nextZoom: 4,
    minZoom: 0.12,
    maxZoom: 1,
    clientPoint: { clientX: 160, clientY: 160 },
  });

  assert.deepEqual(next, { zoom: 1, pan: { x: 100, y: 60 } });
  assert.deepEqual(
    pagePointFromClient({
      stageRect,
      pageSize,
      pan: next.pan,
      zoom: next.zoom,
      clientPoint: { clientX: 160, clientY: 160 },
    }),
    { x: 300, y: 280 }
  );
});

test("finds the visible page window inside the stage", () => {
  assert.deepEqual(
    visiblePageBox({
      stageRect,
      pageSize,
      pan: { x: 0, y: 0 },
      zoom: 0.5,
    }),
    { x: 0, y: 0, width: 1000, height: 800 }
  );

  assert.deepEqual(
    visiblePageBox({
      stageRect,
      pageSize,
      pan: { x: -250, y: 0 },
      zoom: 0.5,
    }),
    { x: 500, y: 0, width: 500, height: 800 }
  );

  assert.equal(
    visiblePageBox({
      stageRect,
      pageSize,
      pan: { x: -900, y: 0 },
      zoom: 0.5,
    }),
    null
  );
});
