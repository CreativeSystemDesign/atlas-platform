import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMissingTouchedWireEndpointConnectionLinks,
  buildMissingTouchedWireEndpointGroundLinks,
  buildTouchedWireEndpointConnectionLinks,
  buildTouchedWireEndpointGroundLinks,
  buildWireEndpointAttachments,
  buildWireConnectionPointDraft,
  buildWireConnectionPointLink,
  findNearbyConnectionPoint,
} from "./wire-connection-point.ts";

const wireBox = {
  x: 100,
  y: 200,
  width: 420,
  height: 24,
};

test("builds an editable wire connection point draft at the cursor", () => {
  const draft = buildWireConnectionPointDraft({
    ownerBoxId: "wire-r102",
    ownerBox: wireBox,
    cursor: { x: 520, y: 212 },
    zoom: 0.2,
    pageNum: 7,
    capturedAt: "2026-05-04T07:00:00.000Z",
  });

  assert.equal(draft.type, "connection_point");
  assert.equal(draft.text, "connection");
  assert.equal(draft.relation, "wire_segment_endpoint_to_connection_point");
  assert.equal(draft.source, "ctrl_click");
  assert.equal(draft.snapped, true);
  assert.equal(draft.provenance.pageNum, 7);
  assert.equal(draft.provenance.source, "manual_wire_connection_point");
  assert.equal(draft.bbox.x, 475);
  assert.equal(draft.bbox.y, 167);
  assert.equal(draft.bbox.width, 90);
  assert.equal(draft.bbox.height, 90);
});

test("finds an existing wire connection point near the cursor", () => {
  const existing = {
    id: "wire-r102-connection-point-a",
    type: "connection_point",
    text: "to 2/4",
    bbox: { x: 475, y: 167, width: 90, height: 90 },
  };

  const match = findNearbyConnectionPoint({
    attachments: [existing],
    point: { x: 520, y: 212 },
    tolerance: 81,
  });

  assert.equal(match, existing);
});

test("builds a wire link to an existing component connection point", () => {
  const link = buildWireConnectionPointLink({
    wireBoxId: "wire-101k",
    ownerBoxId: "component-whm10",
    ownerLabel: "WHM10",
    connectionPointId: "whm10-terminal-1",
    connectionPointText: "1",
    connectionPointBbox: { x: 1388, y: 892, width: 18, height: 18 },
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  assert.equal(link.type, "connection_point");
  assert.equal(link.text, "WHM10:1");
  assert.equal(link.relation, "wire_segment_endpoint_to_connection_point");
  assert.equal(link.linkedBoxId, "component-whm10");
  assert.equal(link.linkedAttachmentId, "whm10-terminal-1");
  assert.equal(link.provenance.source, "wire_endpoint_manual_connection_point");
  assert.deepEqual(link.bbox, { x: 1388, y: 892, width: 18, height: 18 });
});

test("builds two automatic endpoints for a horizontal wire segment", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-r100",
    wireBox,
    zoom: 0.5,
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0].type, "wire_endpoint");
  assert.equal(endpoints[0].text, "start");
  assert.equal(endpoints[0].relation, "wire_segment_has_endpoint");
  assert.deepEqual(endpoints[0].bbox, { x: 86, y: 198, width: 28, height: 28 });
  assert.equal(endpoints[1].text, "end");
  assert.deepEqual(endpoints[1].bbox, { x: 506, y: 198, width: 28, height: 28 });
});

test("builds two automatic endpoints for a vertical wire segment", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-r1",
    wireBox: { x: 300, y: 100, width: 20, height: 300 },
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  assert.deepEqual(endpoints.map((endpoint) => endpoint.text), ["start", "end"]);
  assert.deepEqual(endpoints[0].bbox, { x: 301, y: 91, width: 18, height: 18 });
  assert.deepEqual(endpoints[1].bbox, { x: 301, y: 391, width: 18, height: 18 });
});

test("auto-links a wire endpoint only when it touches a component connection point", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-101k",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  const links = buildTouchedWireEndpointConnectionLinks({
    wireBoxId: "wire-101k",
    endpoints,
    connectionPoints: [
      {
        ownerBoxId: "component-ct10",
        ownerLabel: "CT10",
        connectionPointId: "ct10-k",
        connectionPointText: "k",
        connectionPointBbox: { x: 92, y: 204, width: 18, height: 18 },
      },
      {
        ownerBoxId: "component-whm10",
        ownerLabel: "WHM10",
        connectionPointId: "whm10-1",
        connectionPointText: "1",
        connectionPointBbox: { x: 521, y: 204, width: 18, height: 18 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  assert.equal(links.length, 2);
  assert.equal(links[0].text, "CT10:k");
  assert.equal(links[0].parentAttachmentId, endpoints[0].id);
  assert.equal(links[0].linkedBoxId, "component-ct10");
  assert.equal(links[0].linkedAttachmentId, "ct10-k");
  assert.equal(links[1].text, "WHM10:1");
  assert.equal(links[1].parentAttachmentId, endpoints[1].id);
  assert.equal(links[1].linkedBoxId, "component-whm10");
  assert.equal(links[1].linkedAttachmentId, "whm10-1");
});

test("auto-links a wire endpoint when its bbox overlaps a component connection point", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-r101",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T14:00:00.000Z",
  });

  const links = buildTouchedWireEndpointConnectionLinks({
    wireBoxId: "wire-r101",
    endpoints,
    connectionPoints: [
      {
        ownerBoxId: "component-f12",
        ownerLabel: "F12",
        connectionPointId: "f12-r101",
        connectionPointText: "R101",
        connectionPointBbox: { x: 526, y: 207, width: 18, height: 18 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-10T14:00:00.000Z",
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].text, "F12:R101");
  assert.equal(links[0].parentAttachmentId, endpoints[1].id);
  assert.equal(links[0].linkedBoxId, "component-f12");
  assert.equal(links[0].linkedAttachmentId, "f12-r101");
});

test("reconciles missing links for endpoint contacts created by later moves", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-s101",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T14:00:00.000Z",
  });

  const links = buildMissingTouchedWireEndpointConnectionLinks({
    wireBoxId: "wire-s101",
    endpoints,
    existingLinks: [],
    connectionPoints: [
      {
        ownerBoxId: "component-f13",
        ownerLabel: "F13",
        connectionPointId: "f13-s101",
        connectionPointText: "S101",
        connectionPointBbox: { x: 526, y: 207, width: 18, height: 18 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-10T14:00:00.000Z",
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].text, "F13:S101");
  assert.equal(links[0].parentAttachmentId, endpoints[1].id);
});

test("does not reconcile another component link onto an endpoint that is already linked", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-r101",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T14:00:00.000Z",
  });

  const links = buildMissingTouchedWireEndpointConnectionLinks({
    wireBoxId: "wire-r101",
    endpoints,
    existingLinks: [
      {
        relation: "wire_segment_endpoint_to_connection_point",
        parentAttachmentId: endpoints[1].id,
        linkedAttachmentId: "existing-f12-r101",
      },
    ],
    connectionPoints: [
      {
        ownerBoxId: "component-f12",
        ownerLabel: "F12",
        connectionPointId: "f12-r101",
        connectionPointText: "R101",
        connectionPointBbox: { x: 526, y: 207, width: 18, height: 18 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-10T14:00:00.000Z",
  });

  assert.equal(links.length, 0);
});

test("does not auto-link a nearby component connection point that does not touch", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-101k",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  const links = buildTouchedWireEndpointConnectionLinks({
    wireBoxId: "wire-101k",
    endpoints,
    connectionPoints: [
      {
        ownerBoxId: "component-ct10",
        ownerLabel: "CT10",
        connectionPointId: "ct10-k",
        connectionPointText: "k",
        connectionPointBbox: { x: 60, y: 204, width: 18, height: 18 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-08T10:00:00.000Z",
  });

  assert.equal(links.length, 0);
});

test("auto-links a wire endpoint when it touches a ground reference", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-g",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T10:00:00.000Z",
  });

  const links = buildTouchedWireEndpointGroundLinks({
    wireBoxId: "wire-g",
    endpoints,
    groundReferences: [
      {
        groundBoxId: "ground-g1",
        groundLabel: "G",
        groundBbox: { x: 86, y: 184, width: 42, height: 48 },
      },
      {
        groundBoxId: "ground-far",
        groundLabel: "G",
        groundBbox: { x: 240, y: 184, width: 42, height: 48 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-10T10:00:00.000Z",
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].type, "ground_reference");
  assert.equal(links[0].text, "G");
  assert.equal(links[0].relation, "wire_segment_to_ground_reference");
  assert.equal(links[0].linkedBoxId, "ground-g1");
  assert.equal(links[0].linkedAttachmentId, null);
  assert.equal(links[0].parentAttachmentId, endpoints[0].id);
});

test("reconciles missing ground links for endpoint contacts created by later moves", () => {
  const endpoints = buildWireEndpointAttachments({
    wireBoxId: "wire-g",
    wireBox,
    zoom: 1,
    pageNum: 7,
    capturedAt: "2026-05-10T10:00:00.000Z",
  });

  const links = buildMissingTouchedWireEndpointGroundLinks({
    wireBoxId: "wire-g",
    endpoints,
    existingLinks: [],
    groundReferences: [
      {
        groundBoxId: "ground-g1",
        groundLabel: "G",
        groundBbox: { x: 86, y: 184, width: 42, height: 48 },
      },
    ],
    pageNum: 7,
    capturedAt: "2026-05-10T10:00:00.000Z",
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].text, "G");
  assert.equal(links[0].parentAttachmentId, endpoints[0].id);
});
