import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentCandidateAtPoint,
  continuationCandidateAtPoint,
  groundReferenceCandidateAtPoint,
  junctionCandidateAtPoint,
  wireSegmentCandidateAtPoint,
} from "./studio-root-candidates.ts";

const pageSize = { width: 1000, height: 800 };

test("finds compact square junction shapes near the pointer", () => {
  assert.deepEqual(
    junctionCandidateAtPoint({
      point: { x: 95, y: 95 },
      pageMetadata: {
        scale: 1,
        shapes: [{ bbox: [90, 90, 100, 100] }],
      },
      pageSize,
    }),
    {
      bbox: { x: 80, y: 80, width: 30, height: 30 },
      text: "junction",
      type: "junction",
    }
  );
});

test("recognizes ground references from nearby horizontal and vertical strokes", () => {
  assert.deepEqual(
    groundReferenceCandidateAtPoint({
      point: { x: 120, y: 105 },
      pageMetadata: {
        scale: 1,
        shapes: [
          { bbox: [100, 100, 140, 104] },
          { bbox: [105, 112, 135, 116] },
          { bbox: [118, 80, 122, 120] },
        ],
      },
      pageSize,
    }),
    {
      bbox: { x: 98, y: 78, width: 44, height: 44 },
      text: "ground",
      type: "ground_reference",
    }
  );
});

test("finds long thin wire segment shapes near the pointer", () => {
  assert.deepEqual(
    wireSegmentCandidateAtPoint({
      point: { x: 50, y: 11 },
      pageMetadata: {
        scale: 1,
        shapes: [{ bbox: [10, 10, 110, 12] }],
      },
      zoom: 1,
      pageSize,
    }),
    {
      bbox: { x: 6, y: 6, width: 108, height: 16 },
      text: "",
      type: "wire_segment",
    }
  );
});

test("resolves continuation symbols from nearby stacked page and row text", () => {
  const candidate = continuationCandidateAtPoint({
    point: { x: 848, y: 1149 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "12", bbox: [829, 1110, 851, 1125] },
        { text: "4", bbox: [835, 1142, 845, 1156] },
      ],
    },
    pageSize: { width: 2000, height: 2000 },
  });

  assert.equal(candidate.text, "12/4");
  assert.equal(candidate.type, "continuation");
  assert.deepEqual(candidate.labelBbox, { x: 827, y: 1108, width: 26, height: 50 });
  assert.deepEqual(candidate.bbox, { x: 827, y: 1108, width: 26, height: 50 });
  assert.equal(candidate.continuationReference.page, 12);
  assert.equal(candidate.continuationReference.row, 4);
});

test("keeps dense stacked continuation symbols isolated to the clicked H marker", () => {
  const candidate = continuationCandidateAtPoint({
    point: { x: 118, y: 150 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "102", bbox: [90, 103, 126, 119] },
        { text: "4", bbox: [103, 124, 114, 140] },
        { text: "102", bbox: [90, 137, 126, 153] },
        { text: "5", bbox: [103, 158, 114, 174] },
        { text: "102", bbox: [90, 171, 126, 187] },
        { text: "6", bbox: [103, 192, 114, 208] },
      ],
      shapes: [
        { bbox: [86, 121, 130, 123] },
        { bbox: [86, 155, 130, 157] },
        { bbox: [86, 189, 130, 191] },
        { bbox: [128, 137, 130, 174] },
      ],
    },
    pageSize: { width: 400, height: 400 },
  });

  assert.equal(candidate.text, "102/5");
  assert.equal(candidate.type, "continuation");
  assert.deepEqual(candidate.bbox, { x: 84, y: 135, width: 54, height: 41 });
  assert.equal(candidate.continuationReference.page, 102);
  assert.equal(candidate.continuationReference.row, 5);
});

test("resolves attachment candidates from text and classifies wire labels", () => {
  assert.deepEqual(
    attachmentCandidateAtPoint({
      point: { x: 25, y: 14 },
      pageMetadata: {
        scale: 1,
        shapes: [],
        text_blocks: [{ text: "102 L", bbox: [10, 10, 40, 18] }],
      },
      zoom: 1,
      pageSize,
      symbolBank: [],
      wireLabelBank: [wireLabel("102L")],
    }),
    {
      bbox: { x: 10, y: 10, width: 30, height: 8 },
      text: "102 L",
      type: "wire_label",
    }
  );
});

test("resolves fragmented attachment text as one visible label", () => {
  assert.deepEqual(
    attachmentCandidateAtPoint({
      point: { x: 21, y: 14 },
      pageMetadata: {
        scale: 1,
        shapes: [],
        text_blocks: [
          { text: "P", bbox: [10, 10, 18, 18] },
          { text: "L", bbox: [18.5, 10, 26.5, 18] },
          { text: "12", bbox: [27, 10, 43, 18] },
        ],
      },
      zoom: 1,
      pageSize,
      symbolBank: [symbol({ part_number: "PL12" })],
      wireLabelBank: [],
    }),
    {
      bbox: { x: 10, y: 10, width: 33, height: 8 },
      text: "PL12",
      type: "part_number",
    }
  );
});

test("reduces text snap strength in dense neighboring text", () => {
  const pageMetadata = {
    scale: 1,
    shapes: [],
    text_blocks: [
      { text: "AUTO", bbox: [10, 10, 40, 18] },
      { text: "MAN", bbox: [50, 10, 80, 18] },
    ],
  };

  assert.deepEqual(
    attachmentCandidateAtPoint({
      point: { x: 49, y: 14 },
      pageMetadata,
      zoom: 1,
      pageSize,
      symbolBank: [],
      wireLabelBank: [],
    }),
    {
      bbox: { x: 10, y: 10, width: 70, height: 8 },
      text: "AUTO MAN",
      type: "text",
    }
  );

  assert.deepEqual(
    attachmentCandidateAtPoint({
      point: { x: 49, y: 14 },
      pageMetadata,
      zoom: 1,
      pageSize,
      symbolBank: [],
      wireLabelBank: [],
      snapStrength: "low",
    }),
    {
      bbox: { x: 50, y: 10, width: 30, height: 8 },
      text: "MAN",
      type: "text",
    }
  );
});

test("off text snap strength requires an exact text hit", () => {
  const pageMetadata = {
    scale: 1,
    shapes: [],
    text_blocks: [{ text: "MAN", bbox: [50, 10, 80, 18] }],
  };

  assert.equal(
    attachmentCandidateAtPoint({
      point: { x: 49, y: 14 },
      pageMetadata,
      zoom: 1,
      pageSize,
      symbolBank: [],
      wireLabelBank: [],
      snapStrength: "off",
    }),
    null
  );

  assert.deepEqual(
    attachmentCandidateAtPoint({
      point: { x: 51, y: 14 },
      pageMetadata,
      zoom: 1,
      pageSize,
      symbolBank: [],
      wireLabelBank: [],
      snapStrength: "off",
    }),
    {
      bbox: { x: 50, y: 10, width: 30, height: 8 },
      text: "MAN",
      type: "text",
    }
  );
});

test("resolves direct compact shape attachment hits as terminals", () => {
  assert.deepEqual(
    attachmentCandidateAtPoint({
      point: { x: 25, y: 25 },
      pageMetadata: {
        scale: 1,
        shapes: [{ bbox: [20, 20, 50, 28] }],
        text_blocks: [],
      },
      zoom: 1,
      pageSize,
      symbolBank: [],
      wireLabelBank: [],
    }),
    {
      bbox: { x: 12, y: 12, width: 46, height: 24 },
      text: "",
      type: "terminal",
    }
  );
});

test("returns null when metadata is missing or no candidate passes the shape rules", () => {
  assert.equal(
    junctionCandidateAtPoint({
      point: { x: 0, y: 0 },
      pageMetadata: null,
      pageSize,
    }),
    null
  );
  assert.equal(
    groundReferenceCandidateAtPoint({
      point: { x: 0, y: 0 },
      pageMetadata: { scale: 1, shapes: [{ bbox: [0, 0, 100, 2] }] },
      pageSize,
    }),
    null
  );
  assert.equal(
    wireSegmentCandidateAtPoint({
      point: { x: 0, y: 0 },
      pageMetadata: { scale: 1, shapes: [{ bbox: [0, 0, 10, 10] }] },
      zoom: 1,
      pageSize,
    }),
    null
  );
});

function wireLabel(wire_label) {
  return {
    wire_label,
    raw_label: wire_label,
    cable_number: "",
    originating_point: "",
    termination_point: "",
    source_page: "1",
    extraction_id: "test",
  };
}

function symbol(overrides = {}) {
  return {
    symbol: "PL12",
    family: "pilot_lamp",
    suffix: "12",
    suffix_semantics: "opaque_identifier",
    description: "",
    part_number: "",
    location: "",
    source_page: "1",
    ...overrides,
  };
}
