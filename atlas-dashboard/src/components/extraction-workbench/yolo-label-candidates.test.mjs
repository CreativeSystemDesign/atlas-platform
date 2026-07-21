import assert from "node:assert/strict";
import test from "node:test";

import { yoloComponentLabelCandidates } from "./yolo-label-candidates.ts";

function candidate(normalizedText, bbox, distance, symbol = normalizedText) {
  return {
    text: normalizedText,
    normalizedText,
    bbox,
    score: distance,
    distance,
    source: symbol ? "parts_symbol_match" : "text_proximity",
    reason: "test",
    symbol: symbol
      ? {
          symbol,
          description: `${symbol} part`,
        }
      : undefined,
  };
}

test("YOLO manual bbox label candidates prefer the symbol directly above the bbox", () => {
  const componentBox = { x: 100, y: 200, width: 120, height: 80 };
  const sideCandidate = candidate(
    "MC",
    { x: 235, y: 220, width: 35, height: 20 },
    8
  );
  const aboveCandidate = candidate(
    "ELB",
    { x: 135, y: 168, width: 45, height: 22 },
    60
  );
  const belowCandidate = candidate(
    "WHM",
    { x: 130, y: 292, width: 60, height: 22 },
    12
  );

  const ordered = yoloComponentLabelCandidates(
    [sideCandidate, belowCandidate, aboveCandidate],
    componentBox
  );

  assert.equal(ordered[0].normalizedText, "ELB");
  assert.equal(ordered[1].normalizedText, "MC");
  assert.equal(ordered[2].normalizedText, "WHM");
});

test("YOLO manual bbox label candidates start above before center-near labels", () => {
  const componentBox = { x: 740, y: 1440, width: 70, height: 42 };
  const centerCandidate = candidate(
    "P1",
    { x: 790, y: 1452, width: 20, height: 14 },
    4
  );
  const topCandidate = candidate(
    "F14",
    { x: 748, y: 1402, width: 44, height: 28 },
    54,
    "F14"
  );
  const sideCandidate = candidate(
    "LPJ",
    { x: 825, y: 1420, width: 60, height: 24 },
    18
  );

  const ordered = yoloComponentLabelCandidates(
    [centerCandidate, sideCandidate, topCandidate],
    componentBox
  );

  assert.equal(ordered[0].normalizedText, "F14");
});

test("YOLO manual bbox label candidates prefer text inside the bbox", () => {
  const componentBox = { x: 120, y: 200, width: 150, height: 90 };
  const insideCandidate = candidate(
    "CR74E",
    { x: 160, y: 224, width: 58, height: 18 },
    8,
    "CR74E"
  );
  const aboveCandidate = candidate(
    "CR110",
    { x: 142, y: 166, width: 64, height: 22 },
    32,
    "CR110"
  );
  const sideCandidate = candidate(
    "PL110",
    { x: 286, y: 210, width: 62, height: 20 },
    40,
    "PL110"
  );

  const ordered = yoloComponentLabelCandidates(
    [aboveCandidate, sideCandidate, insideCandidate],
    componentBox
  );

  assert.equal(ordered[0].normalizedText, "CR74E");
  assert.equal(ordered[1].normalizedText, "CR110");
});

test("YOLO manual bbox keeps short text captured inside the bbox", () => {
  const componentBox = { x: 120, y: 200, width: 150, height: 90 };
  const insideCandidate = {
    ...candidate(
      "CR",
      { x: 160, y: 224, width: 24, height: 18 },
      8,
      ""
    ),
    source: "bbox_text",
    reason: "text_inside_component_bbox",
  };
  const aboveCandidate = candidate(
    "CR110",
    { x: 142, y: 166, width: 64, height: 22 },
    32,
    "CR110"
  );

  const ordered = yoloComponentLabelCandidates(
    [aboveCandidate, insideCandidate],
    componentBox
  );

  assert.equal(ordered[0].normalizedText, "CR");
});

test("YOLO label cycling uses visible viewport top for long components", () => {
  const componentBox = { x: 100, y: 120, width: 380, height: 3100 };
  const visiblePageBox = { x: 0, y: 900, width: 900, height: 850 };
  const centerCandidate = candidate(
    "P1",
    { x: 270, y: 1420, width: 28, height: 18 },
    4
  );
  const visibleTopCandidate = candidate(
    "WHM10",
    { x: 160, y: 930, width: 70, height: 22 },
    520,
    "WHM10"
  );
  const hiddenTopCandidate = candidate(
    "MCB10",
    { x: 160, y: 650, width: 70, height: 22 },
    300,
    "MCB10"
  );

  const ordered = yoloComponentLabelCandidates(
    [centerCandidate, hiddenTopCandidate, visibleTopCandidate],
    componentBox,
    { visiblePageBox }
  );

  assert.equal(ordered.length, 2);
  assert.equal(ordered[0].normalizedText, "WHM10");
  assert.equal(ordered[1].normalizedText, "P1");
});
