import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { snapComponentBoxToShapes } from "./component-snap.ts";

const pageSize = { width: 1000, height: 800 };

test("returns the rough box when snap metadata is unavailable", () => {
  const roughBox = { x: 10, y: 20, width: 40, height: 30 };

  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox,
      scale: undefined,
      shapes: [],
      pageSize,
      snapPaddingPdf: 1,
    }),
    { bbox: roughBox, snapped: false, reason: "metadata_unavailable" }
  );
});

test("snaps to compact shape centers inside the rough component box", () => {
  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox: { x: 18, y: 18, width: 50, height: 50 },
      scale: 2,
      shapes: [
        { bbox: [10, 11, 20, 21] },
        { bbox: [13, 15, 25, 27] },
        { bbox: [100, 100, 230, 230] },
      ],
      pageSize,
      snapPaddingPdf: 1,
    }),
    {
      bbox: { x: 18, y: 20, width: 34, height: 36 },
      snapped: true,
      reason: "cluster_density",
    }
  );
});

test("ignores long thin non-component shapes while snapping", () => {
  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox: { x: 0, y: 0, width: 300, height: 80 },
      scale: 1,
      shapes: [{ bbox: [10, 10, 210, 20] }],
      pageSize,
      snapPaddingPdf: 1,
    }),
    {
      bbox: { x: 0, y: 0, width: 300, height: 80 },
      snapped: false,
      reason: "no_shape_hits",
    }
  );
});

test("strict component mode fails instead of using generic shape union", () => {
  const roughBox = { x: 0, y: 0, width: 300, height: 80 };

  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox,
      scale: 1,
      shapes: [{ bbox: [10, 10, 40, 40] }],
      pageSize,
      snapPaddingPdf: 1,
      requireEnclosedComponent: true,
    }),
    {
      bbox: roughBox,
      snapped: false,
      reason: "no_component_cluster",
    }
  );
});

test("shift-click style rough box snaps to large enclosed component frame and terminal shapes", () => {
  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox: { x: 160, y: 120, width: 520, height: 520 },
      scale: 2,
      shapes: [
        { bbox: [160, 120, 260, 120] },
        { bbox: [160, 260, 260, 260] },
        { bbox: [160, 120, 160, 260] },
        { bbox: [260, 120, 260, 260] },
        { bbox: [154, 145, 166, 157] },
        { bbox: [254, 220, 266, 232] },
        { bbox: [260, 225, 330, 225] },
      ],
      pageSize,
      snapPaddingPdf: 1,
    }),
    {
      bbox: { x: 306, y: 238, width: 228, height: 284 },
      snapped: true,
      reason: "enclosed_component",
    }
  );
});

test("strict component mode snaps to a dense local cluster when no enclosure exists", () => {
  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox: { x: 90, y: 90, width: 60, height: 60 },
      scale: 1,
      shapes: [
        { bbox: [100, 100, 112, 112] },
        { bbox: [115, 102, 127, 114] },
        { bbox: [104, 117, 116, 129] },
        { bbox: [130, 110, 142, 122] },
        { bbox: [10, 10, 250, 10] },
      ],
      pageSize,
      snapPaddingPdf: 1,
      requireEnclosedComponent: true,
    }),
    {
      bbox: { x: 99, y: 99, width: 44, height: 31 },
      snapped: true,
      reason: "cluster_density",
    }
  );
});

test("leaves the rough component box unchanged when snap strength is off", () => {
  const roughBox = { x: 18, y: 18, width: 50, height: 50 };

  assert.deepEqual(
    snapComponentBoxToShapes({
      roughBox,
      scale: 2,
      shapes: [{ bbox: [10, 11, 20, 21] }],
      pageSize,
      snapPaddingPdf: 1,
      snapStrength: "off",
    }),
    {
      bbox: roughBox,
      snapped: false,
      reason: "snap_disabled",
    }
  );
});

test("strict component mode keeps page 7 MCB autosnap on the local component cluster", () => {
  const page = referencePage(7);
  const result = snapComponentBoxToShapes({
    roughBox: centerSearchBox({ x: 459, y: 659 }),
    scale: referenceMetadata.scale,
    shapes: page.shapes,
    pageSize: referencePageSize(page),
    snapPaddingPdf: 1,
    requireEnclosedComponent: true,
  });

  assert.equal(result.snapped, true);
  assert.equal(result.reason, "cluster_density");
  assert.ok(
    bboxIou(result.bbox, { x: 341.3, y: 604.4, width: 235.4, height: 108.2 }) >
      0.55
  );
});

test("strict component mode keeps page 7 ELB autosnap on the local component cluster", () => {
  const page = referencePage(7);
  const result = snapComponentBoxToShapes({
    roughBox: centerSearchBox({ x: 842.4, y: 2321.4 }),
    scale: referenceMetadata.scale,
    shapes: page.shapes,
    pageSize: referencePageSize(page),
    snapPaddingPdf: 1,
    requireEnclosedComponent: true,
  });

  assert.equal(result.snapped, true);
  assert.equal(result.reason, "cluster_density");
  assert.ok(
    bboxIou(result.bbox, { x: 743.4, y: 2204.8, width: 198, height: 233.2 }) >
      0.7
  );
});

test("strict component mode snaps page 7 WHM by enclosure without pulling in ground", () => {
  const page = referencePage(7);
  const center = {
    x: 383 * referenceMetadata.scale,
    y: 303 * referenceMetadata.scale,
  };
  const result = snapComponentBoxToShapes({
    roughBox: centerSearchBox(center),
    scale: referenceMetadata.scale,
    shapes: page.shapes,
    pageSize: referencePageSize(page),
    snapPaddingPdf: 1,
    requireEnclosedComponent: true,
  });

  assert.equal(result.snapped, true);
  assert.equal(result.reason, "enclosed_component");
  assert.ok(result.bbox.x + result.bbox.width < 438 * referenceMetadata.scale);
});

test("strict component mode snaps a small page 7 fuse symbol", () => {
  const page = referencePage(7);
  const center = {
    x: 187 * referenceMetadata.scale,
    y: 286 * referenceMetadata.scale,
  };
  const result = snapComponentBoxToShapes({
    roughBox: centerSearchBox(center),
    scale: referenceMetadata.scale,
    shapes: page.shapes,
    pageSize: referencePageSize(page),
    snapPaddingPdf: 1,
    requireEnclosedComponent: true,
  });

  assert.equal(result.snapped, true);
  assert.equal(result.reason, "cluster_density");
  assert.ok(result.bbox.width >= 40);
  assert.ok(result.bbox.height >= 60);
});

test("strict component mode prefers a compact relay contact over surrounding wire rows", () => {
  const result = snapComponentBoxToShapes({
    roughBox: centerSearchBox({ x: 122, y: 101 }),
    scale: 1,
    shapes: [
      { bbox: [0, 84, 250, 84] },
      { bbox: [0, 150, 250, 150] },
      { bbox: [0, 80, 0, 160] },
      { bbox: [250, 80, 250, 160] },
      { bbox: [100, 100, 130, 100] },
      { bbox: [112, 95, 145, 112] },
      { bbox: [145, 90, 145, 108] },
    ],
    pageSize,
    snapPaddingPdf: 1,
    requireEnclosedComponent: true,
  });

  assert.equal(result.snapped, true);
  assert.equal(result.reason, "cluster_density");
  assert.deepEqual(result.bbox, { x: 99, y: 89, width: 47, height: 24 });
});

const referenceMetadata = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../.atlas/extraction-workbench/reference-assets/annotator/metadata.json",
      import.meta.url
    ),
    "utf8"
  )
);

function referencePage(pageNum) {
  return referenceMetadata.pages[pageNum - 1];
}

function referencePageSize(page) {
  return {
    width: page.display_size[0],
    height: page.display_size[1],
  };
}

function centerSearchBox(center) {
  return {
    x: center.x - 260,
    y: center.y - 260,
    width: 520,
    height: 520,
  };
}

function bboxIou(left, right) {
  const leftX1 = left.x + left.width;
  const leftY1 = left.y + left.height;
  const rightX1 = right.x + right.width;
  const rightY1 = right.y + right.height;
  const intersectionWidth = Math.max(
    0,
    Math.min(leftX1, rightX1) - Math.max(left.x, right.x)
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(leftY1, rightY1) - Math.max(left.y, right.y)
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const unionArea =
    left.width * left.height + right.width * right.height - intersectionArea;
  return intersectionArea / unionArea;
}
