import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTouchedGroundReferenceLinks,
  connectionPointAttachmentsForWire,
  missingConnectionPointAttachmentsForWire,
  reconcileTouchedWireEndpointContactsInBoxes,
} from "./wire-link-reconciliation.ts";

const capturedAt = "2026-05-10T08:00:00.000Z";

test("builds endpoint-owned connection links from component connection points", () => {
  const endpoint = wireEndpoint("wire-r101-end", { x: 91, y: 96, width: 18, height: 18 });
  const links = connectionPointAttachmentsForWire(
    [
      component("component-f12", "F12", [
        connectionPoint("f12-r101", "R101", { x: 90, y: 95, width: 18, height: 18 }),
      ]),
    ],
    [endpoint],
    "wire-r101",
    7,
    capturedAt
  );

  assert.equal(links.length, 1);
  assert.equal(links[0].text, "F12:R101");
  assert.equal(links[0].relation, "wire_segment_endpoint_to_connection_point");
  assert.equal(links[0].parentAttachmentId, "wire-r101-end");
  assert.equal(links[0].linkedBoxId, "component-f12");
  assert.equal(links[0].linkedAttachmentId, "f12-r101");

  const missingAgain = missingConnectionPointAttachmentsForWire(
    [
      component("component-f12", "F12", [
        connectionPoint("f12-r101", "R101", { x: 90, y: 95, width: 18, height: 18 }),
      ]),
    ],
    [endpoint],
    links,
    "wire-r101",
    7,
    capturedAt
  );
  assert.deepEqual(missingAgain, []);
});

test("builds endpoint-owned connection links from cable-reference connection points", () => {
  const endpoint = wireEndpoint("wire-cab-end", { x: 91, y: 96, width: 18, height: 18 });
  const links = connectionPointAttachmentsForWire(
    [
      cableReference("cable-ref-1", "3-ASP", [
        connectionPoint("cable-ref-plug-a", "A", { x: 90, y: 95, width: 18, height: 18 }, "cable_reference_has_connection_point"),
      ]),
    ],
    [endpoint],
    "wire-cab",
    8,
    capturedAt
  );

  assert.equal(links.length, 1);
  assert.equal(links[0].text, "3-ASP:A");
  assert.equal(links[0].relation, "wire_segment_endpoint_to_connection_point");
  assert.equal(links[0].parentAttachmentId, "wire-cab-end");
  assert.equal(links[0].linkedBoxId, "cable-ref-1");
  assert.equal(links[0].linkedAttachmentId, "cable-ref-plug-a");
});

test("builds endpoint-owned connection links from connector connection points", () => {
  const endpoint = wireEndpoint("wire-cn-end", {
    x: 91,
    y: 96,
    width: 18,
    height: 18,
  });
  const links = connectionPointAttachmentsForWire(
    [
      connector("connector-cn22", "CN22", [
        connectionPoint("cn22-1", "1", {
          x: 90,
          y: 95,
          width: 18,
          height: 18,
        }, "connector_has_connection_point"),
      ]),
    ],
    [endpoint],
    "wire-cn",
    8,
    capturedAt
  );

  assert.equal(links.length, 1);
  assert.equal(links[0].text, "CN22:1");
  assert.equal(links[0].relation, "wire_segment_endpoint_to_connection_point");
  assert.equal(links[0].parentAttachmentId, "wire-cn-end");
  assert.equal(links[0].linkedBoxId, "connector-cn22");
  assert.equal(links[0].linkedAttachmentId, "cn22-1");
});

test("reconciles missing component and ground links for touched wire endpoints", () => {
  const wire = wireBox("wire-s101", "S101", [
    wireEndpoint("wire-s101-start", { x: 10, y: 96, width: 18, height: 18 }),
    wireEndpoint("wire-s101-end", { x: 91, y: 96, width: 18, height: 18 }),
  ]);
  const boxes = [
    wire,
    component("component-f13", "F13", [
      connectionPoint("f13-s101", "S101", { x: 90, y: 95, width: 18, height: 18 }),
    ]),
    ground("ground-g", "G", { x: 9, y: 95, width: 18, height: 18 }),
  ];

  const result = reconcileTouchedWireEndpointContactsInBoxes(boxes, 7, capturedAt);

  assert.equal(result.addedCount, 2);
  assert.notEqual(result.boxes, boxes);
  const updatedWire = result.boxes.find((box) => box.id === "wire-s101");
  assert.deepEqual(
    updatedWire.metadata.attachments
      .filter((attachment) => attachment.type !== "wire_endpoint")
      .map((attachment) => ({
        type: attachment.type,
        linkedBoxId: attachment.linkedBoxId,
        parentAttachmentId: attachment.parentAttachmentId,
      })),
    [
      {
        type: "connection_point",
        linkedBoxId: "component-f13",
        parentAttachmentId: "wire-s101-end",
      },
      {
        type: "ground_reference",
        linkedBoxId: "ground-g",
        parentAttachmentId: "wire-s101-start",
      },
    ]
  );
});

test("reconciles touched wire endpoints as explicit wire continuity", () => {
  const leftWire = wireBox("wire-6022-left", "6022", [
    wireEndpoint("wire-6022-left-start", { x: 10, y: 96, width: 18, height: 18 }),
    wireEndpoint("wire-6022-left-end", { x: 91, y: 96, width: 18, height: 18 }),
  ]);
  const rightWire = wireBox("wire-6022-right", "6022", [
    wireEndpoint("wire-6022-right-start", { x: 92, y: 96, width: 18, height: 18 }),
    wireEndpoint("wire-6022-right-end", { x: 190, y: 96, width: 18, height: 18 }),
  ]);

  const result = reconcileTouchedWireEndpointContactsInBoxes(
    [leftWire, rightWire],
    8,
    capturedAt,
    { wireBoxId: leftWire.id }
  );

  assert.equal(result.addedCount, 1);
  const updatedLeftWire = result.boxes.find((box) => box.id === leftWire.id);
  const continuity = updatedLeftWire.metadata.attachments.find(
    (attachment) => attachment.relation === "wire_segment_to_wire_segment"
  );
  assert.equal(continuity.type, "wire_segment");
  assert.equal(continuity.text, "6022");
  assert.equal(continuity.parentAttachmentId, "wire-6022-left-end");
  assert.equal(continuity.linkedBoxId, "wire-6022-right");
  assert.equal(continuity.linkedAttachmentId, "wire-6022-right-start");
  assert.deepEqual(continuity.bbox, { x: 92, y: 96, width: 18, height: 18 });

  const secondPass = reconcileTouchedWireEndpointContactsInBoxes(
    result.boxes,
    8,
    capturedAt
  );
  assert.equal(secondPass.addedCount, 0);
});

test("does not reconcile physical endpoint overlap across loaded pages", () => {
  const page8Wire = {
    ...wireBox("page-8-wire-6022", "6022", [
      wireEndpoint("page-8-wire-6022-end", { x: 91, y: 96, width: 18, height: 18 }),
    ]),
    pageNum: 8,
  };
  const page7Wire = {
    ...wireBox("page-7-wire-1112", "1112", [
      wireEndpoint("page-7-wire-1112-end", { x: 92, y: 96, width: 18, height: 18 }),
    ]),
    pageNum: 7,
  };

  const result = reconcileTouchedWireEndpointContactsInBoxes(
    [page8Wire, page7Wire],
    8,
    capturedAt,
    { wireBoxId: page8Wire.id }
  );

  assert.equal(result.addedCount, 0);
  assert.equal(
    result.boxes
      .find((box) => box.id === page8Wire.id)
      .metadata.attachments.some(
        (attachment) => attachment.relation === "wire_segment_to_wire_segment"
      ),
    false
  );
});

test("appends touched ground references without duplicating existing ground links", () => {
  const wire = wireBox("wire-g", "G", [
    wireEndpoint("wire-g-start", { x: 10, y: 96, width: 18, height: 18 }),
  ]);
  const groundBox = ground("ground-g", "G", { x: 9, y: 95, width: 18, height: 18 });

  const updated = appendTouchedGroundReferenceLinks(wire, groundBox, 7, capturedAt);
  const secondPass = appendTouchedGroundReferenceLinks(updated, groundBox, 7, capturedAt);

  assert.equal(updated.metadata.attachments.length, 2);
  assert.equal(updated.metadata.attachments[1].type, "ground_reference");
  assert.equal(updated.metadata.attachments[1].linkedBoxId, "ground-g");
  assert.equal(secondPass.metadata.attachments.length, 2);
});

function component(id, label, attachments = []) {
  return {
    id,
    label,
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    metadata: { rootType: "component", attachments },
  };
}

function cableReference(id, label, attachments = []) {
  return {
    id,
    label,
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    metadata: { rootType: "cable_reference", attachments },
  };
}

function connector(id, label, attachments = []) {
  return {
    id,
    label,
    bbox: { x: 0, y: 0, width: 40, height: 40 },
    metadata: { rootType: "connector", attachments },
  };
}

function ground(id, label, bbox) {
  return {
    id,
    label,
    bbox,
    metadata: { rootType: "ground_reference", attachments: [] },
  };
}

function wireBox(id, label, attachments = []) {
  return {
    id,
    label,
    bbox: { x: 10, y: 100, width: 100, height: 10 },
    metadata: {
      rootType: "wire_segment",
      attachments,
      wireGeometry: {
        segments: [{ id: `${id}-segment`, bbox: { x: 10, y: 100, width: 100, height: 10 } }],
      },
    },
  };
}

function connectionPoint(id, text, bbox, relation = "component_has_connection_point") {
  return {
    id,
    type: "connection_point",
    text,
    bbox,
    relation,
  };
}

function wireEndpoint(id, bbox) {
  return {
    id,
    type: "wire_endpoint",
    text: id.endsWith("start") ? "start" : "end",
    bbox,
    relation: "wire_segment_has_endpoint",
    parentAttachmentId: null,
  };
}
