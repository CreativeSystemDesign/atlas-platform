import assert from "node:assert/strict";
import test from "node:test";

import {
  componentLabelCandidates,
  textForLabelBox,
  wireLabelCandidatesForSegment,
} from "./studio-label-candidates.ts";

test("builds component label candidates from nearby visible text blocks", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 20, y: 20, width: 40, height: 40 },
    pageMetadata: {
      scale: 2,
      text_blocks: [
        { text: "F12", bbox: [12, 12, 20, 16] },
        { text: "K 99", bbox: [200, 200, 210, 210] },
      ],
    },
    symbolBank: [symbol("F12")],
    visiblePageBox: { x: 0, y: 0, width: 100, height: 100 },
  });

  assert.deepEqual(candidates.map((candidate) => candidate.normalizedText), ["F12"]);
  assert.equal(candidates[0].source, "parts_symbol_match");
  assert.equal(candidates[0].reason, "known_parts_list_symbol_nearby");
  assert.equal(candidates[0].symbol.symbol, "F12");
});

test("uses digit-only text directly right of a component label for parts lookup only", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 20, y: 20, width: 40, height: 40 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "WHM", bbox: [12, 10, 42, 24] },
        { text: "10", bbox: [45, 10, 60, 24] },
        { text: "99", bbox: [120, 10, 138, 24] },
      ],
    },
    symbolBank: [symbol("WHM10")],
    datasetClassLabels: true,
    visiblePageBox: { x: 0, y: 0, width: 100, height: 100 },
  });

  assert.equal(candidates[0].normalizedText, "WHM");
  assert.equal(candidates[0].source, "parts_symbol_match");
  assert.equal(
    candidates[0].reason,
    "known_parts_list_symbol_from_adjacent_digits"
  );
  assert.equal(candidates[0].symbol.symbol, "WHM10");
  assert.deepEqual(candidates[0].bbox, { x: 12, y: 10, width: 30, height: 14 });
});

test("uses multiple spaced digit fragments to the right for parts lookup only", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 20, y: 20, width: 40, height: 40 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "W H M", bbox: [12, 10, 42, 24] },
        { text: "1", bbox: [45, 10, 52, 24] },
        { text: "0", bbox: [55, 10, 62, 24] },
      ],
    },
    symbolBank: [symbol("WHM10")],
    datasetClassLabels: true,
    visiblePageBox: { x: 0, y: 0, width: 100, height: 100 },
  });

  assert.equal(candidates[0].normalizedText, "WHM");
  assert.equal(candidates[0].source, "parts_symbol_match");
  assert.equal(candidates[0].symbol.symbol, "WHM10");
});

test("uses spaced characters and numbers in one label block for parts lookup while keeping class label", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 20, y: 20, width: 40, height: 40 },
    pageMetadata: {
      scale: 1,
      text_blocks: [{ text: "W H M 1 0", bbox: [12, 10, 80, 24] }],
    },
    symbolBank: [symbol("WHM10")],
    datasetClassLabels: true,
    visiblePageBox: { x: 0, y: 0, width: 100, height: 100 },
  });

  assert.equal(candidates[0].normalizedText, "WHM");
  assert.equal(candidates[0].source, "parts_symbol_match");
  assert.equal(candidates[0].reason, "known_parts_list_symbol_prefix_nearby");
  assert.equal(candidates[0].symbol.symbol, "WHM10");
  assert.deepEqual(candidates[0].bbox, { x: 12, y: 10, width: 40.8, height: 14 });
});

test("does not expand component label lookup with distant digit-only text", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 20, y: 20, width: 40, height: 40 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "WHM", bbox: [12, 10, 42, 24] },
        { text: "10", bbox: [90, 10, 105, 24] },
      ],
    },
    symbolBank: [symbol("WHM10")],
    visiblePageBox: { x: 0, y: 0, width: 140, height: 100 },
  });

  assert.equal(candidates[0].normalizedText, "WHM");
  assert.equal(candidates[0].source, "text_proximity");
  assert.equal(candidates[0].symbol, undefined);
});

test("includes text inside a manual YOLO bbox as an explicit label candidate", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 100, y: 100, width: 120, height: 80 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "CR74E", bbox: [128, 122, 174, 140] },
        { text: "CR110", bbox: [120, 68, 166, 86] },
      ],
    },
    symbolBank: [symbol("CR74E"), symbol("CR110")],
    visiblePageBox: { x: 0, y: 0, width: 300, height: 300 },
    includeInsideTextCandidates: true,
  });

  assert.equal(candidates[0].normalizedText, "CR74E");
  assert.equal(candidates[0].source, "bbox_text");
  assert.equal(candidates[0].reason, "text_inside_component_bbox");
  assert.equal(candidates[0].symbol.symbol, "CR74E");
});

test("YOLO label lookup can crop a symbol-bank component label to its class prefix", () => {
  const candidates = componentLabelCandidates({
    componentBox: { x: 100, y: 100, width: 120, height: 80 },
    pageMetadata: {
      scale: 1,
      text_blocks: [{ text: "CR74E", bbox: [128, 122, 174, 140] }],
    },
    symbolBank: [symbol("CR74E")],
    datasetClassLabels: true,
    visiblePageBox: { x: 0, y: 0, width: 300, height: 300 },
    includeInsideTextCandidates: true,
  });

  assert.equal(candidates[0].normalizedText, "CR74E");
  assert.equal(candidates[0].source, "bbox_text");
  assert.equal(candidates[1].normalizedText, "CR");
  assert.equal(candidates[1].source, "parts_symbol_match");
});

test("builds wire label candidates and marks bank matches", () => {
  const candidates = wireLabelCandidatesForSegment({
    wireBox: { x: 20, y: 20, width: 180, height: 10 },
    pageMetadata: {
      scale: 2,
      text_blocks: [
        { text: "102 L", bbox: [30, 12, 45, 18] },
        { text: "note", bbox: [300, 300, 320, 320] },
      ],
    },
    wireLabelBank: [wireLabel("102L")],
    visiblePageBox: null,
  });

  assert.deepEqual(candidates.map((candidate) => candidate.normalizedText), ["102L"]);
  assert.equal(candidates[0].source, "wire_label_bank_match");
});

test("finds the best text block for a drawn label box", () => {
  const match = textForLabelBox({
    labelBox: { x: 20, y: 20, width: 50, height: 30 },
    pageMetadata: {
      scale: 2,
      text_blocks: [
        { text: "outside", bbox: [100, 100, 120, 120] },
        { text: " F-12 ", bbox: [12, 12, 24, 18] },
      ],
    },
  });

  assert.equal(match.text, "F-12");
  assert.equal(match.normalizedText, "F-12");
  assert.equal(match.insideCenter, true);
  assert.equal(
    textForLabelBox({
      labelBox: { x: 0, y: 0, width: 5, height: 5 },
      pageMetadata: null,
    }),
    null
  );
});

test("merges adjacent fragmented text blocks inside a drawn label box", () => {
  const match = textForLabelBox({
    labelBox: { x: 8, y: 8, width: 38, height: 14 },
    pageMetadata: {
      scale: 1,
      text_blocks: [
        { text: "P", bbox: [10, 10, 18, 18] },
        { text: "L", bbox: [18.5, 10, 26.5, 18] },
        { text: "12", bbox: [27, 10, 43, 18] },
        { text: "away", bbox: [200, 200, 230, 210] },
      ],
    },
  });

  assert.equal(match.text, "PL12");
  assert.equal(match.normalizedText, "PL12");
  assert.deepEqual(match.bbox, { x: 10, y: 10, width: 33, height: 8 });
});

test("keeps multi-line text conservative unless line merging is explicit", () => {
  const pageMetadata = {
    scale: 1,
    text_blocks: [
      { text: "PR300-", bbox: [10, 10, 58, 18] },
      { text: "32333-6R-0", bbox: [10, 24, 90, 32] },
      { text: "unrelated", bbox: [140, 24, 190, 32] },
    ],
  };

  const conservativeMatch = textForLabelBox({
    labelBox: { x: 8, y: 8, width: 86, height: 28 },
    pageMetadata,
  });
  const mergedMatch = textForLabelBox({
    labelBox: { x: 8, y: 8, width: 86, height: 28 },
    pageMetadata,
    mergeLines: true,
  });

  assert.ok(["PR300-", "32333-6R-0"].includes(conservativeMatch.text));
  assert.notEqual(conservativeMatch.text, "PR300- 32333-6R-0");
  assert.equal(mergedMatch.text, "PR300- 32333-6R-0");
  assert.equal(mergedMatch.normalizedText, "PR300-32333-6R-0");
  assert.deepEqual(mergedMatch.bbox, { x: 10, y: 10, width: 80, height: 22 });
});

test("returns no candidates when page text metadata is unavailable", () => {
  assert.deepEqual(
    componentLabelCandidates({
      componentBox: { x: 0, y: 0, width: 10, height: 10 },
      pageMetadata: null,
      symbolBank: [],
      visiblePageBox: null,
    }),
    []
  );
  assert.deepEqual(
    wireLabelCandidatesForSegment({
      wireBox: { x: 0, y: 0, width: 10, height: 10 },
      pageMetadata: { scale: 1, text_blocks: [] },
      wireLabelBank: [],
      visiblePageBox: null,
    }),
    []
  );
});

function symbol(symbolText) {
  return {
    symbol: symbolText,
    family: "fuse",
    suffix: "12",
    suffix_semantics: "opaque_identifier",
    description: "",
    part_number: "",
    location: "",
    source_page: "1",
  };
}

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
