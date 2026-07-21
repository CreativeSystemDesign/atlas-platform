import assert from "node:assert/strict";
import test from "node:test";

import {
  toTrainingDatasetComponentLabelCandidate,
  trainingDatasetComponentLabelBboxForManualLabel,
  trainingDatasetComponentLabelFromResolvedText,
} from "./component-label-prefix.ts";

test("crops a dataset component label candidate to the leading class characters", () => {
  const candidate = toTrainingDatasetComponentLabelCandidate({
    text: "WHM10",
    normalizedText: "WHM10",
    bbox: { x: 100, y: 40, width: 50, height: 10 },
    score: 1,
    distance: 0,
    source: "text_proximity",
    reason: "test",
  });

  assert.equal(candidate.normalizedText, "WHM");
  assert.deepEqual(candidate.bbox, { x: 100, y: 40, width: 30, height: 10 });
});

test("uses OCR fragments when cropping the leading class characters", () => {
  const candidate = toTrainingDatasetComponentLabelCandidate({
    text: "WHM10",
    normalizedText: "WHM10",
    bbox: { x: 100, y: 40, width: 68, height: 10 },
    textFragments: [
      { text: "W", normalizedText: "W", bbox: { x: 100, y: 40, width: 12, height: 10 } },
      { text: "H", normalizedText: "H", bbox: { x: 116, y: 40, width: 10, height: 10 } },
      { text: "M", normalizedText: "M", bbox: { x: 130, y: 40, width: 14, height: 10 } },
      { text: "1", normalizedText: "1", bbox: { x: 148, y: 40, width: 8, height: 10 } },
      { text: "0", normalizedText: "0", bbox: { x: 160, y: 40, width: 8, height: 10 } },
    ],
    score: 1,
    distance: 0,
    source: "text_proximity",
    reason: "test",
  });

  assert.equal(candidate.normalizedText, "WHM");
  assert.deepEqual(candidate.bbox, { x: 100, y: 40, width: 44, height: 10 });
});

test("narrows multiline OCR candidates to one line before cropping dataset labels", () => {
  const candidate = toTrainingDatasetComponentLabelCandidate({
    text: "WHM10\nHIGH TEMP",
    normalizedText: "WHM10HIGHTEMP",
    bbox: { x: 100, y: 40, width: 80, height: 24 },
    score: 1,
    distance: 0,
    source: "text_proximity",
    reason: "test",
  });

  assert.equal(candidate.normalizedText, "WHM");
  assert.deepEqual(candidate.bbox, { x: 100, y: 40, width: 48, height: 12 });
});

test("uses OCR fragment lines before cropping dataset labels", () => {
  const candidate = toTrainingDatasetComponentLabelCandidate({
    text: "WHM10 HIGH TEMP",
    normalizedText: "WHM10HIGHTEMP",
    bbox: { x: 100, y: 40, width: 80, height: 24 },
    textFragments: [
      { text: "WHM10", normalizedText: "WHM10", bbox: { x: 100, y: 40, width: 50, height: 10 } },
      { text: "HIGH TEMP", normalizedText: "HIGHTEMP", bbox: { x: 100, y: 54, width: 80, height: 10 } },
    ],
    score: 1,
    distance: 0,
    source: "text_proximity",
    reason: "test",
  });

  assert.equal(candidate.normalizedText, "WHM");
  assert.deepEqual(candidate.bbox, { x: 100, y: 40, width: 30, height: 10 });
});

test("shrinks an existing full label bbox when the operator changes WHM10 to WHM", () => {
  const labelBbox = trainingDatasetComponentLabelBboxForManualLabel(
    annotationBox({
      label: "WHM10",
      labelBbox: { x: 100, y: 40, width: 50, height: 10 },
    }),
    "WHM"
  );

  assert.deepEqual(labelBbox, { x: 100, y: 40, width: 30, height: 10 });
});

test("manual label box resolution snaps dataset component labels to the class prefix", () => {
  const resolved = trainingDatasetComponentLabelFromResolvedText({
    text: "WHM10",
    normalizedText: "WHM10",
    bbox: { x: 100, y: 40, width: 50, height: 10 },
  });

  assert.equal(resolved.label, "WHM");
  assert.deepEqual(resolved.labelBbox, { x: 100, y: 40, width: 30, height: 10 });
});

test("manual label box resolution extracts current class from OCR text with leading spec", () => {
  const resolved = trainingDatasetComponentLabelFromResolvedText(
    {
      text: "125AF20ATELB51",
      normalizedText: "125AF20ATELB51",
      bbox: { x: 100, y: 40, width: 140, height: 10 },
    },
    "ELB"
  );

  assert.equal(resolved.label, "ELB");
  assert.deepEqual(resolved.labelBbox, { x: 190, y: 40, width: 30, height: 10 });
});

test("manual label box resolution uses OCR fragments when current class follows spec text", () => {
  const resolved = trainingDatasetComponentLabelFromResolvedText(
    {
      text: "125AF20AT ELB51",
      normalizedText: "125AF20ATELB51",
      bbox: { x: 100, y: 40, width: 145, height: 10 },
      textFragments: [
        {
          text: "125AF20AT",
          normalizedText: "125AF20AT",
          bbox: { x: 100, y: 40, width: 90, height: 10 },
        },
        {
          text: "ELB51",
          normalizedText: "ELB51",
          bbox: { x: 200, y: 40, width: 45, height: 10 },
        },
      ],
    },
    "ELB"
  );

  assert.equal(resolved.label, "ELB");
  assert.deepEqual(resolved.labelBbox, { x: 200, y: 40, width: 27, height: 10 });
});

test("right edge label resize snaps to the character right boundary", () => {
  const resolved = trainingDatasetComponentLabelFromResolvedText(
    {
      text: "WHM10",
      normalizedText: "WHM10",
      bbox: { x: 100, y: 40, width: 50, height: 10 },
    },
    "WHM",
    {
      editedLabelBbox: { x: 100, y: 40, width: 24, height: 10 },
      resizeHandle: "e",
    }
  );

  assert.equal(resolved.label, "WHM");
  assert.deepEqual(resolved.labelBbox, { x: 100, y: 40, width: 30, height: 10 });
});

test("left edge label resize snaps to the character left boundary", () => {
  const resolved = trainingDatasetComponentLabelFromResolvedText(
    {
      text: "WHM10",
      normalizedText: "WHM10",
      bbox: { x: 100, y: 40, width: 50, height: 10 },
    },
    "WHM",
    {
      editedLabelBbox: { x: 114, y: 40, width: 36, height: 10 },
      resizeHandle: "w",
    }
  );

  assert.equal(resolved.label, "WHM");
  assert.deepEqual(resolved.labelBbox, { x: 110, y: 40, width: 40, height: 10 });
});

test("single-line dataset label autosnap does not keep a two-line-tall OCR bbox", () => {
  const resolved = trainingDatasetComponentLabelFromResolvedText(
    {
      text: "WHM10 OTHER",
      normalizedText: "WHM10OTHER",
      bbox: { x: 100, y: 40, width: 90, height: 24 },
    },
    "WHM",
    {
      editedLabelBbox: { x: 100, y: 40, width: 50, height: 10 },
    }
  );

  assert.equal(resolved.label, "WHM");
  assert.deepEqual(resolved.labelBbox, { x: 100, y: 40, width: 27, height: 10 });
});

function annotationBox(overrides = {}) {
  return {
    id: "box-1",
    pageNum: 7,
    label: "WHM10",
    bbox: { x: 120, y: 80, width: 80, height: 40 },
    labelBbox: null,
    labelSource: "text_proximity",
    labelCandidateIndex: 0,
    labelCandidates: [],
    source: "human",
    snapped: true,
    metadata: {
      rootType: "component",
      attachments: [],
    },
    createdAt: "2026-05-10T12:00:00.000Z",
    updatedAt: "2026-05-10T12:00:00.000Z",
    ...overrides,
  };
}
