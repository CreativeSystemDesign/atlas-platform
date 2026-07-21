import assert from "node:assert/strict";
import test from "node:test";

import { attachmentsOf, wireSegmentsOf } from "./annotation-box-helpers.ts";
import { extendWireGeometryInBoxes } from "./wire-geometry-extension.ts";

const capturedAt = "2026-05-10T09:00:00.000Z";

test("extends a wire segment with endpoints and touched connection links", () => {
  const wire = box("wire-1", "wire_segment", { x: 0, y: 10, width: 20, height: 8 }, {
    wireGeometry: {
      segments: [segment("segment-1", { x: 0, y: 10, width: 20, height: 8 })],
    },
    attachments: [],
  });
  const component = box("component-1", "component", { x: 96, y: 0, width: 48, height: 48 }, {
    attachments: [
      {
        id: "component-1-cp-a1",
        type: "connection_point",
        text: "A1",
        bbox: { x: 98, y: 5, width: 18, height: 18 },
        relation: "component_has_connection_point",
      },
    ],
  });

  const next = extendWireGeometryInBoxes([wire, component], {
    boxId: "wire-1",
    segmentBox: { x: 20, y: 10, width: 90, height: 8 },
    zoom: 1,
    pageNum: 7,
    capturedAt,
  });

  const nextWire = next.find((item) => item.id === "wire-1");
  assert.deepEqual(nextWire.bbox, { x: 0, y: 10, width: 110, height: 8 });
  assert.equal(wireSegmentsOf(nextWire).length, 2);
  assert.equal(nextWire.metadata.provenance.source, "wire_segment_extend");
  assert.deepEqual(nextWire.metadata.physicalSizePx, {
    width: 110,
    height: 8,
    area: 880,
  });

  const attachments = attachmentsOf(nextWire);
  const endpoints = attachments.filter((attachment) => attachment.type === "wire_endpoint");
  const connectionLinks = attachments.filter(
    (attachment) => attachment.relation === "wire_segment_endpoint_to_connection_point"
  );
  assert.equal(endpoints.length, 2);
  assert.equal(connectionLinks.length, 1);
  assert.equal(connectionLinks[0].linkedBoxId, "component-1");
  assert.equal(connectionLinks[0].linkedAttachmentId, "component-1-cp-a1");
  assert.ok(endpoints.some((endpoint) => endpoint.id === connectionLinks[0].parentAttachmentId));
});

test("does not duplicate an overlapping wire segment", () => {
  const wire = box("wire-1", "wire_segment", { x: 0, y: 10, width: 90, height: 8 }, {
    wireGeometry: {
      segments: [segment("segment-1", { x: 0, y: 10, width: 90, height: 8 })],
    },
    attachments: [{ id: "existing", type: "text", text: "", bbox: { x: 0, y: 0, width: 8, height: 8 } }],
  });

  const next = extendWireGeometryInBoxes([wire], {
    boxId: "wire-1",
    segmentBox: { x: 4, y: 10, width: 80, height: 8 },
    zoom: 1,
    pageNum: 7,
    capturedAt,
  });

  const nextWire = next[0];
  assert.equal(wireSegmentsOf(nextWire).length, 1);
  assert.deepEqual(attachmentsOf(nextWire), attachmentsOf(wire));
});

function box(id, rootType, bbox, metadata = {}) {
  return {
    id,
    pageNum: 7,
    label: id,
    bbox,
    labelBbox: null,
    labelSource: "manual",
    labelCandidateIndex: -1,
    labelCandidates: [],
    source: "human",
    snapped: true,
    metadata: {
      rootType,
      attachments: [],
      ...metadata,
    },
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

function segment(id, bbox) {
  const horizontal = bbox.width >= bbox.height;
  const center = {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
  return {
    id,
    bbox,
    x1: horizontal ? bbox.x : center.x,
    y1: horizontal ? center.y : bbox.y,
    x2: horizontal ? bbox.x + bbox.width : center.x,
    y2: horizontal ? center.y : bbox.y + bbox.height,
  };
}
