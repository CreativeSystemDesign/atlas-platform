import assert from "node:assert/strict";
import test from "node:test";

import { pageValidationIssues } from "./page-validation-issues.ts";

test("includes canonical wire audit issues in Studio validation issues", () => {
  const boxes = [
    component("component-f13", "F13", [
      connectionPoint("f13-left", "1", { x: 90, y: 95, width: 20, height: 20 }),
    ]),
    wire("wire-left", "102L", { x: 10, y: 100, width: 90, height: 10 }, [
      endpoint("wire-left-start", "start", { x: 3, y: 96, width: 18, height: 18 }),
      endpoint("wire-left-end", "end", { x: 91, y: 96, width: 18, height: 18 }),
    ]),
  ];

  const issues = pageValidationIssues(boxes);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "wire-left:wire-left-end:f13-left:unlinked-touch");
  assert.equal(issues[0].kind, "endpoint_touch_unlinked_connection_point");
  assert.equal(issues[0].severity, "error");
  assert.match(issues[0].label, /endpoint touches an unlinked connection point/);
});

test("flags legacy Studio type and relation hygiene issues", () => {
  const issues = pageValidationIssues([
    {
      id: "legacy-root",
      label: "MYSTERY",
      bbox: { x: 0, y: 0, width: 20, height: 20 },
      metadata: {
        attachments: [
          {
            id: "missing-relation",
            type: "terminal",
            text: "11",
          },
          {
            id: "generic-relation",
            type: "terminal",
            text: "12",
            relation: "object_has_attachment",
          },
          {
            id: "invalid-relation",
            type: "continuation",
            text: "8",
            relation: "continuation_to_object",
          },
        ],
      },
    },
    {
      id: "terminal-looking-component",
      label: "terminal",
      bbox: { x: 40, y: 0, width: 20, height: 20 },
      metadata: { rootType: "component", attachments: [] },
    },
    {
      id: "bad-location",
      label: "MAIN_PANEL",
      bbox: { x: 80, y: 0, width: 20, height: 20 },
      metadata: { rootType: "location", attachments: [] },
    },
  ]);

  assert.deepEqual(
    issues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      detail: issue.detail,
    })),
    [
      {
        id: "legacy-root-missing-root-type",
        severity: "warn",
        detail: "This object predates strict root typing and should be reviewed.",
      },
      {
        id: "legacy-root-missing-relation-missing-relation",
        severity: "error",
        detail: "Attachment is missing an explicit relation.",
      },
      {
        id: "legacy-root-generic-relation-generic-relation",
        severity: "warn",
        detail:
          "Saved with the generic legacy relation; review and relink before using this as gold truth.",
      },
      {
        id: "legacy-root-invalid-relation-invalid-relation",
        severity: "warn",
        detail: "component to continuation is not a strict relation path.",
      },
      {
        id: "terminal-looking-component-terminal-label-root-mismatch",
        severity: "warn",
        detail: "Saved as component but the visible label still reads terminal.",
      },
      {
        id: "bad-location-location-text-mismatch",
        severity: "warn",
        detail:
          "Location roots should usually be compact panel/location marks such as PP or CP.",
      },
    ]
  );
});

function component(id, label, attachments = []) {
  return {
    id,
    label,
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    metadata: { rootType: "component", attachments },
  };
}

function wire(id, label, bbox, attachments = []) {
  return {
    id,
    label,
    bbox,
    metadata: {
      rootType: "wire_segment",
      wireGeometry: {
        segments: [
          {
            id: `${id}-segment`,
            bbox,
            x1: bbox.x,
            y1: bbox.y + bbox.height / 2,
            x2: bbox.x + bbox.width,
            y2: bbox.y + bbox.height / 2,
          },
        ],
      },
      attachments,
    },
  };
}

function connectionPoint(id, text, bbox) {
  return {
    id,
    type: "connection_point",
    text,
    bbox,
    relation: "component_has_connection_point",
  };
}

function endpoint(id, text, bbox) {
  return {
    id,
    type: "wire_endpoint",
    text,
    bbox,
    relation: "wire_segment_has_endpoint",
  };
}
