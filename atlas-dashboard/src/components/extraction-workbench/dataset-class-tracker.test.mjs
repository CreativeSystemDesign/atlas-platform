import assert from "node:assert/strict";
import test from "node:test";

import {
  datasetClassCountsForBoxes,
  datasetClassHighlightForBoxes,
  isDatasetComponentTrainingPairRoot,
} from "./dataset-class-tracker.ts";

function box(id, rootType, label, attachments = [], labelBbox = null) {
  return {
    id,
    pageNum: 7,
    label,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    labelBbox,
    labelSource: "manual",
    labelCandidateIndex: -1,
    labelCandidates: [],
    source: "human",
    snapped: true,
    metadata: { rootType, attachments },
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
  };
}

function attachment(id, type, text) {
  return {
    id,
    type,
    text,
    bbox: { x: 0, y: 0, width: 4, height: 4 },
    source: "ctrl_click",
    snapped: true,
    createdAt: "2026-06-16T00:00:00.000Z",
  };
}

test("counts all dataset classes from current annotations", () => {
  const boxes = [
    box(
      "component-1",
      "component",
      "WHM10",
      [
        attachment("wire-p24", "wire_label", "P24"),
        attachment("wire-x", "wire_label", "X0001"),
        attachment("part-1", "part_number", "<drawing-no>"),
        attachment("spec-1", "spec", "LPJ-3SP"),
        attachment("terminal-1", "terminal", "1"),
      ],
      { x: 0, y: 0, width: 12, height: 6 }
    ),
    box("component-2", "component", "ELB 3 Phase"),
    box("component-continuation", "component", "CONTINUATION"),
    box("root-continuation", "continuation", "continuation"),
    box("root-wire", "wire_label", "Y1234"),
    box("root-part-number", "part_number", "<drawing-no>"),
  ];
  const counts = datasetClassCountsForBoxes(boxes);

  const byClass = Object.fromEntries(
    counts.map((entry) => [entry.className, entry.count])
  );

  assert.equal(byClass.WHM, 1);
  assert.equal(byClass.ELB, 1);
  assert.equal(byClass.WHM_label, 1);
  assert.equal(byClass["Wire Label (+24v)"], 1);
  assert.equal(byClass["Input Signal Wire"], 1);
  assert.equal(byClass.WHM_part_number, 1);
  assert.equal(byClass.WHM_spec, 1);
  assert.equal(byClass.unknown_component_part_number, 1);
  assert.equal(byClass.component_terminal, 1);
  assert.equal(byClass.continuation, 2);
  assert.equal(byClass["Output Signal Wire"], 1);
  assert.equal(byClass.component_body, undefined);
  assert.equal(byClass.component_label, undefined);
  assert.equal(byClass.component_part_number, undefined);
  assert.equal(byClass.component_spec, undefined);
  assert.equal(byClass.CONTINUATION, undefined);
  assert.equal(byClass.part_number, undefined);

  const whmHighlight = datasetClassHighlightForBoxes(boxes, "WHM");
  assert.deepEqual([...whmHighlight.rootBoxIds], ["component-1"]);
  assert.deepEqual([...whmHighlight.labelBoxIds], []);
  assert.deepEqual([...whmHighlight.attachmentIds], []);

  const wireHighlight = datasetClassHighlightForBoxes(boxes, "Input Signal Wire");
  assert.deepEqual([...wireHighlight.rootBoxIds], []);
  assert.deepEqual([...wireHighlight.attachmentIds], ["wire-x"]);

  const partHighlight = datasetClassHighlightForBoxes(
    boxes,
    "WHM_part_number"
  );
  assert.deepEqual([...partHighlight.rootBoxIds], []);
  assert.deepEqual([...partHighlight.attachmentIds], ["part-1"]);

  const labelHighlight = datasetClassHighlightForBoxes(boxes, "WHM_label");
  assert.deepEqual([...labelHighlight.rootBoxIds], []);
  assert.deepEqual([...labelHighlight.labelBoxIds], ["component-1"]);

  const continuationHighlight = datasetClassHighlightForBoxes(
    boxes,
    "continuation"
  );
  assert.deepEqual([...continuationHighlight.rootBoxIds], [
    "component-continuation",
    "root-continuation",
  ]);
  assert.equal(isDatasetComponentTrainingPairRoot(boxes[0]), true);
  assert.equal(isDatasetComponentTrainingPairRoot(boxes[2]), false);
});

test("normalizes component labels so case and digits do not split classes", () => {
  const boxes = [
    box("elb-1", "component", "ELB40"),
    box("elb-2", "component", "elb51"),
    box("elb-3", "component", "ELB 3 Phase"),
    box("mc-1", "component", "mc12"),
  ];
  const counts = datasetClassCountsForBoxes(boxes);
  const byClass = Object.fromEntries(
    counts.map((entry) => [entry.className, entry.count])
  );

  assert.equal(byClass.ELB, 3);
  assert.equal(byClass.MC, 1);
  assert.equal(byClass.elb, undefined);
  assert.equal(byClass.ELB40, undefined);
  assert.equal(byClass.ELB51, undefined);
});
