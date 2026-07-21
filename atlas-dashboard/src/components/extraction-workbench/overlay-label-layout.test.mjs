import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationStackAtPoint,
  hoverStackSignature,
  layoutOverlayLabels,
} from "./overlay-label-layout.ts";

test("builds a sorted hover stack from roots and attachments under the cursor", () => {
  const stack = annotationStackAtPoint(
    [
      annotation("component-f12", "F12", { x: 10, y: 10, width: 80, height: 60 }, [
        attachment("f12-r1", "connection_point", "R1", {
          x: 20,
          y: 20,
          width: 10,
          height: 10,
        }),
      ]),
    ],
    { x: 25, y: 25 }
  );

  assert.deepEqual(stack, [
    {
      kind: "attachment",
      boxId: "component-f12",
      attachmentId: "f12-r1",
      label: "R1",
      bbox: { x: 20, y: 20, width: 10, height: 10 },
    },
    {
      kind: "root",
      boxId: "component-f12",
      label: "F12",
      bbox: { x: 10, y: 10, width: 80, height: 60 },
    },
  ]);
  assert.equal(
    hoverStackSignature(stack),
    "attachment:component-f12:f12-r1|root:component-f12"
  );
});

test("lays out root and attachment labels while skipping reference-only links", () => {
  const labels = layoutOverlayLabels(
    [
      annotation("component-f12", "F12", { x: 10, y: 10, width: 80, height: 60 }, [
        attachment("f12-r1", "connection_point", "R1", {
          x: 20,
          y: 20,
          width: 10,
          height: 10,
        }),
        attachment("f12-empty-connection", "connection_point", "connection", {
          x: 40,
          y: 20,
          width: 10,
          height: 10,
        }),
        {
          ...attachment("continuation-ref", "continuation", "4/4", {
            x: 50,
            y: 20,
            width: 10,
            height: 10,
          }),
          relation: "continuation_to_object",
        },
      ]),
    ],
    1
  );

  assert.deepEqual(
    labels.map((label) => ({
      id: label.id,
      kind: label.kind,
      text: label.text,
      targetType: label.targetType,
      boxId: label.boxId,
      attachmentId: label.attachmentId,
    })),
    [
      {
        id: "attachment-label-component-f12-f12-r1",
        kind: "attachment",
        text: "R1",
        targetType: "connection_point",
        boxId: "component-f12",
        attachmentId: "f12-r1",
      },
      {
        id: "root-label-component-f12",
        kind: "root",
        text: "F12",
        targetType: "component",
        boxId: "component-f12",
        attachmentId: undefined,
      },
    ]
  );
  assert.equal(labels.every((label) => label.labelBox.x >= 2), true);
  assert.equal(labels.every((label) => label.labelBox.y >= 2), true);
});

function annotation(id, label, bbox, attachments = []) {
  return {
    id,
    label,
    bbox,
    metadata: { rootType: "component", attachments },
  };
}

function attachment(id, type, text, bbox) {
  return {
    id,
    type,
    text,
    bbox,
    relation: type === "connection_point" ? "component_has_connection_point" : "object_has_attachment",
  };
}
