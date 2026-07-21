import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCircuitDescriptorRegionAttachments,
  buildCircuitDescriptorRootAnnotation,
  buildPageDescriptorRootAnnotation,
  buildPageDescriptorComponentAttachments,
} from "./circuit-descriptor.ts";

test("links only components whose centers are inside a descriptor region", () => {
  const attachments = buildCircuitDescriptorRegionAttachments({
    descriptorBoxId: "descriptor-power-monitor",
    regionBbox: { x: 100, y: 100, width: 400, height: 260 },
    pageNum: 7,
    capturedAt: "2026-05-08T11:00:00.000Z",
    boxes: [
      {
        id: "component-whm10",
        label: "WHM10",
        rootType: "component",
        bbox: { x: 200, y: 180, width: 90, height: 80 },
      },
      {
        id: "component-f12",
        label: "F12",
        rootType: "component",
        bbox: { x: 520, y: 330, width: 80, height: 60 },
      },
      {
        id: "wire-r101",
        label: "R101",
        rootType: "wire_segment",
        bbox: { x: 120, y: 210, width: 360, height: 16 },
      },
    ],
  });

  assert.equal(attachments[0].relation, "circuit_descriptor_applies_to_region");
  assert.equal(attachments[0].type, "text");
  assert.equal(attachments[0].text, "applies to region");

  assert.equal(attachments.length, 2);
  assert.equal(attachments[1].type, "component");
  assert.equal(attachments[1].text, "WHM10");
  assert.equal(attachments[1].linkedBoxId, "component-whm10");
  assert.equal(
    attachments[1].relation,
    "circuit_descriptor_applies_to_component"
  );
});

test("page descriptor links every component on the page", () => {
  const attachments = buildPageDescriptorComponentAttachments({
    descriptorBoxId: "page-descriptor-main-power",
    pageNum: 7,
    capturedAt: "2026-05-08T11:20:00.000Z",
    boxes: [
      {
        id: "component-mcb10",
        label: "MCB10",
        rootType: "component",
        bbox: { x: 100, y: 100, width: 120, height: 80 },
      },
      {
        id: "component-whm10",
        label: "WHM10",
        rootType: "component",
        bbox: { x: 400, y: 300, width: 220, height: 300 },
      },
      {
        id: "wire-r1",
        label: "R1",
        rootType: "wire_segment",
        bbox: { x: 120, y: 200, width: 500, height: 16 },
      },
    ],
  });

  assert.equal(attachments.length, 2);
  assert.deepEqual(
    attachments.map((attachment) => attachment.text),
    ["MCB10", "WHM10"]
  );
  assert.ok(
    attachments.every(
      (attachment) => attachment.relation === "page_descriptor_applies_to_component"
    )
  );
});

test("builds a circuit descriptor root annotation from detected descriptor text", () => {
  const result = buildCircuitDescriptorRootAnnotation({
    candidate: {
      text: "  MAIN POWER  ",
      type: "text",
      bbox: { x: -10, y: 40, width: 140, height: 24 },
    },
    id: "descriptor-main-power",
    pageNum: 7,
    capturedAt: "2026-05-08T11:30:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.id, "descriptor-main-power");
  assert.equal(result.box.label, "MAIN POWER");
  assert.equal(result.box.metadata.rootType, "circuit_descriptor");
  assert.deepEqual(result.box.bbox, { x: 0, y: 40, width: 140, height: 24 });
  assert.equal(
    result.box.metadata.provenance.source,
    "circuit_descriptor_text_snap"
  );
});

test("blocks descriptor root creation when detected text is empty", () => {
  const result = buildCircuitDescriptorRootAnnotation({
    candidate: {
      text: "   ",
      type: "text",
      bbox: { x: 100, y: 40, width: 140, height: 24 },
    },
    id: "descriptor-empty",
    pageNum: 7,
    capturedAt: "2026-05-08T11:30:00.000Z",
  });

  assert.deepEqual(result, {
    status: "blocked",
    notice: "No descriptor text detected under the pointer.",
  });
});

test("builds a page descriptor root and links every component currently on the page", () => {
  const result = buildPageDescriptorRootAnnotation({
    candidate: {
      text: "PAGE 1 MAIN",
      type: "text",
      bbox: { x: 200, y: 40, width: 160, height: 28 },
    },
    id: "page-descriptor-main",
    pageNum: 7,
    capturedAt: "2026-05-08T11:40:00.000Z",
    boxes: [
      {
        id: "component-mcb10",
        label: "MCB10",
        rootType: "component",
        bbox: { x: 100, y: 100, width: 120, height: 80 },
      },
      {
        id: "wire-r1",
        label: "R1",
        rootType: "wire_segment",
        bbox: { x: 100, y: 220, width: 400, height: 16 },
      },
    ],
  });

  assert.equal(result.status, "created");
  assert.equal(result.box.metadata.rootType, "page_descriptor");
  assert.deepEqual(
    result.box.metadata.attachments.map((attachment) => attachment.text),
    ["MCB10"]
  );
  assert.equal(result.notice, "Page descriptor linked all page components");
});
