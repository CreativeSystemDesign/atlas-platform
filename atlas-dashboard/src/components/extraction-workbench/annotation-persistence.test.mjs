import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpatialProvenance,
  normalizeStudioAnnotations,
  physicalSizeOf,
} from "./annotation-persistence.ts";

test("normalizes loaded annotations without changing explicit canonical relationships", () => {
  const annotations = normalizeStudioAnnotations(
    [
      {
        id: "wire-102l",
        pageNum: 99,
        label: "",
        bbox: { x: 10, y: 20, width: 120, height: 16 },
        metadata: {
          rootType: "wire_segment",
          attachments: [
            {
              id: "wire-102l-ground-tap",
              type: "ground_reference",
              text: "G",
              bbox: { x: 64, y: 4, width: 40, height: 48 },
              relation: "wire_segment_to_ground_reference",
              linkedBoxId: "ground-g",
              linkedAttachmentId: null,
              parentAttachmentId: null,
              source: "ctrl_click",
              snapped: true,
              createdAt: "2026-05-10T06:00:00.000Z",
            },
          ],
        },
        createdAt: "2026-05-10T06:00:00.000Z",
      },
    ],
    7,
    { now: "2026-05-10T07:00:00.000Z" }
  );

  assert.equal(annotations[0].pageNum, 7);
  assert.equal(annotations[0].label, "component");
  assert.equal(annotations[0].labelBbox, null);
  assert.equal(annotations[0].labelSource, "manual");
  assert.equal(annotations[0].labelCandidateIndex, -1);
  assert.deepEqual(annotations[0].labelCandidates, []);
  assert.equal(annotations[0].source, "human");
  assert.equal(annotations[0].snapped, false);
  assert.equal(annotations[0].metadata.rootType, "wire_segment");
  assert.deepEqual(annotations[0].metadata.physicalSizePx, {
    width: 120,
    height: 16,
    area: 1920,
  });
  assert.deepEqual(annotations[0].metadata.provenance, {
    projectId: "00000000-0000-4000-8000-000000001650",
    documentId: "schematic_<drawing-no>",
    pageNum: 7,
    coordinateSpace: "page_px",
    pageSizePx: { width: 2481, height: 3509 },
    bbox: { x: 10, y: 20, width: 120, height: 16 },
    source: "loaded_component",
    capturedAt: "2026-05-10T06:00:00.000Z",
  });

  const [groundTap] = annotations[0].metadata.attachments;
  assert.equal(groundTap.relation, "wire_segment_to_ground_reference");
  assert.equal(groundTap.parentAttachmentId, null);
  assert.deepEqual(groundTap.physicalSizePx, {
    width: 40,
    height: 48,
    area: 1920,
  });
  assert.equal(groundTap.provenance.source, "loaded_snap");
  assert.equal(groundTap.provenance.capturedAt, "2026-05-10T06:00:00.000Z");
});

test("dedupes repeated linked attachments and normalizes legacy attachment relations", () => {
  const duplicateLink = {
    id: "wire-r1-to-f12-1",
    type: "connection_point",
    text: "F12:R1",
    bbox: { x: 90, y: 95, width: 18, height: 18 },
    relation: "component_attachment",
    linkedBoxId: "f12",
    linkedAttachmentId: "f12-r1",
    parentAttachmentId: "wire-r1-end",
    source: "ctrl_click",
    snapped: false,
    createdAt: "2026-05-10T06:00:00.000Z",
  };

  const [annotation] = normalizeStudioAnnotations(
    [
      {
        id: "wire-r1",
        pageNum: 7,
        label: "R1",
        bbox: { x: 10, y: 100, width: 90, height: 16 },
        metadata: {
          rootType: "wire_segment",
          attachments: [
            duplicateLink,
            { ...duplicateLink, id: "wire-r1-to-f12-1-duplicate" },
          ],
        },
      },
    ],
    7,
    { now: "2026-05-10T07:00:00.000Z" }
  );

  assert.equal(annotation.metadata.attachments.length, 1);
  assert.equal(
    annotation.metadata.attachments[0].relation,
    "wire_segment_endpoint_to_connection_point"
  );
});

test("builds reusable spatial provenance and physical-size evidence", () => {
  const bbox = { x: 1, y: 2, width: 3, height: 4 };

  assert.deepEqual(physicalSizeOf(bbox), {
    width: 3,
    height: 4,
    area: 12,
  });
  assert.deepEqual(
    buildSpatialProvenance(bbox, 7, "test_source", "2026-05-10T07:00:00.000Z"),
    {
      projectId: "00000000-0000-4000-8000-000000001650",
      documentId: "schematic_<drawing-no>",
      pageNum: 7,
      coordinateSpace: "page_px",
      pageSizePx: { width: 2481, height: 3509 },
      bbox,
      source: "test_source",
      capturedAt: "2026-05-10T07:00:00.000Z",
    }
  );
});
