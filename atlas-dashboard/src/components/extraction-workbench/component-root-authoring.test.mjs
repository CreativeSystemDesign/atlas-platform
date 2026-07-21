import assert from "node:assert/strict";
import test from "node:test";

import { buildComponentRootAnnotation } from "./component-root-authoring.ts";

test("blocks component root creation when the drawn box is too small", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 10, y: 20, width: 4, height: 20 },
    snappedBox: {
      bbox: { x: 10, y: 20, width: 4, height: 20 },
      snapped: false,
    },
    labelCandidates: [],
    id: "component-small",
    pageNum: 7,
    capturedAt: "2026-05-10T12:30:00.000Z",
  });

  assert.deepEqual(result, { status: "blocked" });
});

test("builds a component root annotation from the best label candidate", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 102, y: 198, width: 76, height: 62 },
      snapped: true,
    },
    labelCandidates: [
      {
        text: " F12 ",
        normalizedText: "F12",
        bbox: { x: 110, y: 180, width: 40, height: 18 },
        score: 0.95,
        distance: 4,
        source: "text_proximity",
        reason: "nearby_component_label",
      },
    ],
    id: "component-f12",
    pageNum: 7,
    capturedAt: "2026-05-10T12:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.label, "F12");
  assert.deepEqual(result.box.labelBbox, { x: 110, y: 180, width: 40, height: 18 });
  assert.equal(result.box.metadata.rootType, "component");
  assert.equal(result.box.metadata.provenance.source, "component_snap");
});

test("keeps the full component label bbox for digital twin annotations", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 102, y: 198, width: 76, height: 62 },
      snapped: true,
    },
    labelCandidates: [
      {
        text: " WHM10 ",
        normalizedText: "WHM10",
        bbox: { x: 110, y: 180, width: 50, height: 18 },
        score: 0.95,
        distance: 4,
        source: "text_proximity",
        reason: "nearby_component_label",
      },
    ],
    annotationWorkspaceMode: "digital_twin",
    id: "component-whm10",
    pageNum: 7,
    capturedAt: "2026-05-10T12:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.label, "WHM10");
  assert.deepEqual(result.box.labelBbox, { x: 110, y: 180, width: 50, height: 18 });
});

test("trims dataset component label bboxes to the class prefix only", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 102, y: 198, width: 76, height: 62 },
      snapped: true,
    },
    labelCandidates: [
      {
        text: " WHM10 ",
        normalizedText: "WHM10",
        bbox: { x: 110, y: 180, width: 50, height: 18 },
        score: 0.95,
        distance: 4,
        source: "text_proximity",
        reason: "nearby_component_label",
      },
    ],
    annotationWorkspaceMode: "training_dataset",
    id: "component-whm-dataset",
    pageNum: 7,
    capturedAt: "2026-05-10T12:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.label, "WHM");
  assert.deepEqual(result.box.labelBbox, { x: 110, y: 180, width: 30, height: 18 });
  assert.equal(result.box.labelCandidates[0].normalizedText, "WHM");
});

test("labels yolo component boxes with the detected component class", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 102, y: 198, width: 76, height: 62 },
      snapped: true,
    },
    labelCandidates: [
      {
        text: " ELB51 ",
        normalizedText: "ELB51",
        bbox: { x: 110, y: 180, width: 50, height: 18 },
        score: 0.95,
        distance: 4,
        source: "parts_symbol_match",
        reason: "known_parts_list_symbol_nearby",
        symbol: {
          symbol: "ELB51",
          family: "ELB",
          suffix: "51",
          suffix_semantics: "opaque_identifier",
          description: "EARTH LEAKAGE BREAKER",
          part_number: "NV63-CV",
          location: "",
          source_page: "11",
        },
      },
    ],
    annotationWorkspaceMode: "yolo",
    id: "component-elb-yolo",
    pageNum: 11,
    capturedAt: "2026-06-18T12:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.label, "ELB");
  assert.deepEqual(result.box.labelBbox, { x: 110, y: 180, width: 50, height: 18 });
  assert.equal(result.box.labelCandidates[0].normalizedText, "ELB51");
});

test("blocks yolo component boxes when OCR metadata cannot provide a label", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 100, y: 200, width: 80, height: 60 },
      snapped: false,
    },
    labelCandidates: [],
    annotationWorkspaceMode: "yolo",
    id: "component-yolo-no-label",
    pageNum: 7,
    capturedAt: "2026-06-18T12:30:00.000Z",
  });

  assert.deepEqual(result, { status: "blocked" });
});

test("keeps dataset autosnapped component labels to a single OCR line", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 102, y: 198, width: 76, height: 62 },
      snapped: true,
    },
    labelCandidates: [
      {
        text: "WHM10\nHIGH TEMP",
        normalizedText: "WHM10HIGHTEMP",
        bbox: { x: 110, y: 180, width: 80, height: 24 },
        score: 0.95,
        distance: 4,
        source: "text_proximity",
        reason: "nearby_component_label",
      },
    ],
    annotationWorkspaceMode: "training_dataset",
    id: "component-whm-dataset-single-line",
    pageNum: 7,
    capturedAt: "2026-05-10T12:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.label, "WHM");
  assert.deepEqual(result.box.labelBbox, { x: 110, y: 180, width: 48, height: 12 });
  assert.equal(result.box.labelCandidates[0].normalizedText, "WHM");
});

test("builds a manual component root when no label candidate is available", () => {
  const result = buildComponentRootAnnotation({
    roughBox: { x: 100, y: 200, width: 80, height: 60 },
    snappedBox: {
      bbox: { x: 100, y: 200, width: 80, height: 60 },
      snapped: false,
    },
    labelCandidates: [],
    id: "component-manual",
    pageNum: 7,
    capturedAt: "2026-05-10T12:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.label, "component");
  assert.equal(result.box.labelBbox, null);
  assert.equal(result.box.labelSource, "manual");
  assert.equal(result.box.metadata.provenance.source, "component_manual");
});
