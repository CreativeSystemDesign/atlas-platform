import assert from "node:assert/strict";
import test from "node:test";

import { buildPageValidationReport } from "./page-validation-report.ts";

test("reports canonical wire counts, ground contact kinds, and named trace paths", () => {
  const report = buildPageValidationReport(
    [
      component("component-whm10", "WHM10", [
        connectionPoint("whm10-25", "25"),
        connectionPoint("whm10-g", "G"),
      ]),
      wire("wire-pe-tap", "PE", [
        wireEndpoint("wire-pe-tap-start", "start"),
        wireEndpoint("wire-pe-tap-end", "end"),
        wireConnection("wire-pe-tap-to-whm10-25", "WHM10:25", {
          componentId: "component-whm10",
          connectionPointId: "whm10-25",
          endpointId: "wire-pe-tap-start",
        }),
        groundLink("wire-pe-tap-ground-link", {
          groundId: "ground-pe",
          endpointId: null,
        }),
      ]),
      wire("wire-g-end", "G", [
        wireEndpoint("wire-g-end-start", "start"),
        wireEndpoint("wire-g-end-end", "end"),
        wireConnection("wire-g-end-to-whm10-g", "WHM10:G", {
          componentId: "component-whm10",
          connectionPointId: "whm10-g",
          endpointId: "wire-g-end-start",
        }),
        groundLink("wire-g-end-ground-link", {
          groundId: "ground-pe",
          endpointId: "wire-g-end-end",
        }),
      ]),
      {
        id: "ground-pe",
        label: "G",
        type: "ground_reference",
        metadata: { rootType: "ground_reference", attachments: [] },
      },
    ],
    {
      traceChecks: [
        { label: "WHM10", connectionPoint: "25" },
        { label: "WHM10", connectionPoint: "G" },
      ],
    }
  );

  assert.equal(report.annotationCount, 4);
  assert.deepEqual(report.rootCounts, {
    component: 1,
    ground_reference: 1,
    wire_segment: 2,
  });
  assert.equal(report.canonicalWireAudit.issueCount, 0);
  assert.deepEqual(report.relationshipCounts, {
    continuationLinks: 0,
    endpointLinks: 2,
    groundLinks: 2,
    wireContinuityLinks: 0,
    wireEndpoints: 4,
  });
  assert.deepEqual(report.groundContactCounts, {
    wire_endpoint_termination: 1,
    wire_segment_tap: 1,
  });
  assert.deepEqual(
    report.groundBoundaries.map((boundary) => ({
      wireLabel: boundary.wireLabel,
      wireContactKind: boundary.wireContactKind,
      sourceParentAttachmentId: boundary.sourceParentAttachmentId,
    })),
    [
      {
        wireLabel: "G",
        wireContactKind: "wire_endpoint_termination",
        sourceParentAttachmentId: "wire-g-end-end",
      },
      {
        wireLabel: "PE",
        wireContactKind: "wire_segment_tap",
        sourceParentAttachmentId: null,
      },
    ]
  );
  assert.deepEqual(
    report.traceChecks.map((trace) => ({
      label: trace.label,
      connectionPoint: trace.connectionPoint,
      status: trace.status,
      steps: trace.steps,
    })),
    [
      {
        label: "WHM10",
        connectionPoint: "25",
        status: "grounded",
        steps: ["WHM10:25", "wire PE", "ground G"],
      },
      {
        label: "WHM10",
        connectionPoint: "G",
        status: "grounded",
        steps: ["WHM10:G", "wire G", "ground G"],
      },
    ]
  );
});

function component(id, label, attachments) {
  return {
    id,
    label,
    type: "component",
    metadata: { rootType: "component", attachments },
  };
}

function wire(id, label, attachments) {
  return {
    id,
    label,
    type: "wire_segment",
    metadata: {
      rootType: "wire_segment",
      wireGeometry: {
        segments: [
          {
            id: `${id}-segment`,
            bbox: { x: 10, y: 10, width: 100, height: 16 },
          },
        ],
      },
      attachments,
    },
  };
}

function connectionPoint(id, text) {
  return {
    id,
    type: "connection_point",
    text,
    relation: "component_has_connection_point",
  };
}

function wireEndpoint(id, text) {
  return {
    id,
    type: "wire_endpoint",
    text,
    relation: "wire_segment_has_endpoint",
  };
}

function wireConnection(id, text, { componentId, connectionPointId, endpointId }) {
  return {
    id,
    type: "connection_point",
    text,
    relation: "wire_segment_endpoint_to_connection_point",
    linkedBoxId: componentId,
    linkedAttachmentId: connectionPointId,
    parentAttachmentId: endpointId,
  };
}

function groundLink(id, { groundId, endpointId }) {
  return {
    id,
    type: "ground_reference",
    text: "G",
    relation: "wire_segment_to_ground_reference",
    linkedBoxId: groundId,
    linkedAttachmentId: null,
    parentAttachmentId: endpointId,
  };
}
