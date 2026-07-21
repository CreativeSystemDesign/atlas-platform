import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRelationshipGraph,
  componentForConnectionPoint,
  descriptorMembers,
  traceConnectionPointReachability,
  traceConnectionPointPath,
  wireEndpointForConnectionPoint,
} from "./relationship-graph.ts";

const annotations = [
  component("component-whm10", "WHM10", [
    connectionPoint("whm10-1", "1"),
    connectionPoint("whm10-2", "2"),
    connectionPoint("whm10-25", "25"),
  ]),
  component("component-ct10", "CT10", [connectionPoint("ct10-k", "k")]),
  component("component-mcb10", "MCB10", [connectionPoint("mcb10-s1", "S1")]),
  wire("wire-101k", "101K", [
    wireEndpoint("wire-101k-start", "start"),
    wireEndpoint("wire-101k-end", "end"),
    wireConnection("wire-101k-to-whm10-1", "WHM10:1", {
      componentId: "component-whm10",
      connectionPointId: "whm10-1",
      endpointId: "wire-101k-start",
    }),
    wireConnection("wire-101k-to-ct10-k", "CT10:k", {
      componentId: "component-ct10",
      connectionPointId: "ct10-k",
      endpointId: "wire-101k-end",
    }),
  ]),
  wire("wire-s1", "S1", [
    wireEndpoint("wire-s1-start", "start"),
    wireEndpoint("wire-s1-end", "end"),
    wireConnection("wire-s1-to-mcb10-s1", "MCB10:S1", {
      componentId: "component-mcb10",
      connectionPointId: "mcb10-s1",
      endpointId: "wire-s1-start",
    }),
  ]),
  wire("wire-pe", "PE", [
    wireEndpoint("wire-pe-start", "start"),
    wireEndpoint("wire-pe-end", "end"),
    wireConnection("wire-pe-to-whm10-25", "WHM10:25", {
      componentId: "component-whm10",
      connectionPointId: "whm10-25",
      endpointId: "wire-pe-start",
    }),
    {
      id: "wire-pe-ground-link",
      type: "ground_reference",
      text: "G",
      relation: "wire_segment_to_ground_reference",
      linkedBoxId: "ground-pe",
      linkedAttachmentId: null,
    },
  ]),
  {
    id: "ground-pe",
    label: "G",
    type: "ground_reference",
    metadata: {
      rootType: "ground_reference",
      attachments: [],
    },
  },
  {
    id: "continuation-5-1",
    label: "5/1",
    type: "continuation",
    metadata: {
      rootType: "continuation",
      attachments: [
        {
          id: "continuation-5-1-to-s1-end",
          type: "wire_endpoint",
          text: "S1",
          relation: "continuation_to_object",
          linkedBoxId: "wire-s1",
          linkedAttachmentId: "wire-s1-end",
        },
      ],
    },
  },
  {
    id: "descriptor-power-monitor",
    label: "POWER MONITOR",
    type: "circuit_descriptor",
    metadata: {
      rootType: "circuit_descriptor",
      attachments: [
        {
          id: "descriptor-power-monitor-to-whm10",
          type: "component",
          text: "WHM10",
          relation: "circuit_descriptor_applies_to_component",
          linkedBoxId: "component-whm10",
          linkedAttachmentId: null,
        },
        {
          id: "descriptor-power-monitor-to-ct10",
          type: "component",
          text: "CT10",
          relation: "circuit_descriptor_applies_to_component",
          linkedBoxId: "component-ct10",
          linkedAttachmentId: null,
        },
      ],
    },
  },
];

test("finds the component that owns a connection point", () => {
  const graph = buildRelationshipGraph(annotations);

  assert.deepEqual(componentForConnectionPoint(graph, "whm10-1"), {
    id: "component-whm10",
    label: "WHM10",
    type: "component",
  });
});

test("finds the wire endpoint linked to a component connection point", () => {
  const graph = buildRelationshipGraph(annotations);

  assert.deepEqual(wireEndpointForConnectionPoint(graph, "whm10-1"), {
    wire: { id: "wire-101k", label: "101K", type: "wire_segment" },
    endpoint: {
      id: "wire-101k-start",
      text: "start",
      type: "wire_endpoint",
      ownerId: "wire-101k",
    },
  });
});

test("traces a complete component connection point path through one wire", () => {
  const graph = buildRelationshipGraph(annotations);

  assert.deepEqual(traceConnectionPointPath(graph, "whm10-1"), {
    status: "complete",
    startComponent: { id: "component-whm10", label: "WHM10", type: "component" },
    startConnectionPoint: {
      id: "whm10-1",
      text: "1",
      type: "connection_point",
      ownerId: "component-whm10",
    },
    wire: { id: "wire-101k", label: "101K", type: "wire_segment" },
    connectionPoints: [
      {
        component: { id: "component-whm10", label: "WHM10", type: "component" },
        connectionPoint: {
          id: "whm10-1",
          text: "1",
          type: "connection_point",
          ownerId: "component-whm10",
        },
      },
      {
        component: { id: "component-ct10", label: "CT10", type: "component" },
        connectionPoint: {
          id: "ct10-k",
          text: "k",
          type: "connection_point",
          ownerId: "component-ct10",
        },
      },
    ],
    boundaries: [],
  });
});

test("marks a path as continued when a continuation targets a wire endpoint", () => {
  const graph = buildRelationshipGraph(annotations);

  const path = traceConnectionPointPath(graph, "mcb10-s1");

  assert.equal(path.status, "continues");
  assert.deepEqual(path.boundaries, [
    {
      root: { id: "continuation-5-1", label: "5/1", type: "continuation" },
      relation: "continuation_to_object",
      targetAttachmentId: "wire-s1-end",
      continuationReference: {
        page: 5,
        row: 1,
        label: "5/1",
      },
    },
  ]);
});

test("full trace keeps structured continuation target for future page-hop resolution", () => {
  const graph = buildRelationshipGraph(annotations);

  const trace = traceConnectionPointReachability(graph, "mcb10-s1");

  assert.equal(trace.status, "continues");
  assert.deepEqual(
    trace.steps.map((step) => step.label),
    ["MCB10:S1", "wire S1", "continues 5/1"]
  );
  assert.deepEqual(trace.rootIds, [
    "component-mcb10",
    "wire-s1",
    "continuation-5-1",
  ]);
  assert.deepEqual(trace.attachmentIds, [
    "mcb10-s1",
    "wire-s1-to-mcb10-s1",
    "wire-s1-start",
    "wire-s1-end",
  ]);
  const boundaryStep = trace.steps.find((step) => step.kind === "boundary");
  assert.deepEqual(boundaryStep?.boundary.continuationReference, {
    page: 5,
    row: 1,
    label: "5/1",
  });
});

test("marks an unlinked connection point as open ended", () => {
  const graph = buildRelationshipGraph(annotations);

  const path = traceConnectionPointPath(graph, "whm10-2");

  assert.equal(path.status, "open end");
  assert.equal(path.wire, null);
  assert.deepEqual(path.boundaries, []);
});

test("marks a path as grounded when its wire links to a ground reference", () => {
  const graph = buildRelationshipGraph(annotations);

  const path = traceConnectionPointPath(graph, "whm10-25");

  assert.equal(path.status, "grounded");
  assert.deepEqual(path.boundaries, [
    {
      root: { id: "ground-pe", label: "G", type: "ground_reference" },
      relation: "wire_segment_to_ground_reference",
      targetAttachmentId: null,
      sourceAttachmentId: "wire-pe-ground-link",
      sourceParentAttachmentId: null,
      wireContactKind: "wire_segment_tap",
    },
  ]);
});

test("distinguishes segment ground taps from endpoint ground terminations", () => {
  const graph = buildRelationshipGraph([
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
      {
        id: "wire-pe-tap-ground-link",
        type: "ground_reference",
        text: "G",
        relation: "wire_segment_to_ground_reference",
        linkedBoxId: "ground-pe",
        linkedAttachmentId: null,
        parentAttachmentId: null,
      },
    ]),
    wire("wire-g-end", "G", [
      wireEndpoint("wire-g-end-start", "start"),
      wireEndpoint("wire-g-end-end", "end"),
      wireConnection("wire-g-end-to-whm10-g", "WHM10:G", {
        componentId: "component-whm10",
        connectionPointId: "whm10-g",
        endpointId: "wire-g-end-start",
      }),
      {
        id: "wire-g-end-ground-link",
        type: "ground_reference",
        text: "G",
        relation: "wire_segment_to_ground_reference",
        linkedBoxId: "ground-pe",
        linkedAttachmentId: null,
        parentAttachmentId: "wire-g-end-end",
      },
    ]),
    {
      id: "ground-pe",
      label: "G",
      type: "ground_reference",
      metadata: { rootType: "ground_reference", attachments: [] },
    },
  ]);

  const tapBoundary = graph.boundariesByWireId.get("wire-pe-tap")?.[0];
  const terminationBoundary = graph.boundariesByWireId.get("wire-g-end")?.[0];

  assert.deepEqual(tapBoundary, {
    root: { id: "ground-pe", label: "G", type: "ground_reference" },
    relation: "wire_segment_to_ground_reference",
    targetAttachmentId: null,
    sourceAttachmentId: "wire-pe-tap-ground-link",
    sourceParentAttachmentId: null,
    wireContactKind: "wire_segment_tap",
  });
  assert.deepEqual(terminationBoundary, {
    root: { id: "ground-pe", label: "G", type: "ground_reference" },
    relation: "wire_segment_to_ground_reference",
    targetAttachmentId: null,
    sourceAttachmentId: "wire-g-end-ground-link",
    sourceParentAttachmentId: "wire-g-end-end",
    wireContactKind: "wire_endpoint_termination",
  });

  const tapTrace = traceConnectionPointReachability(graph, "whm10-25");
  const terminationTrace = traceConnectionPointReachability(graph, "whm10-g");

  assert.deepEqual(tapTrace.attachmentIds, [
    "whm10-25",
    "wire-pe-tap-to-whm10-25",
    "wire-pe-tap-start",
    "wire-pe-tap-ground-link",
  ]);
  assert.deepEqual(terminationTrace.attachmentIds, [
    "whm10-g",
    "wire-g-end-to-whm10-g",
    "wire-g-end-start",
    "wire-g-end-ground-link",
    "wire-g-end-end",
  ]);
});

test("lists descriptor component members", () => {
  const graph = buildRelationshipGraph(annotations);

  assert.deepEqual(descriptorMembers(graph, "descriptor-power-monitor"), [
    { id: "component-whm10", label: "WHM10", type: "component" },
    { id: "component-ct10", label: "CT10", type: "component" },
  ]);
});

test("traces through explicit wire-to-wire continuity links", () => {
  const graph = buildRelationshipGraph([
    component("component-source", "SRC", [connectionPoint("source-p", "P")]),
    component("component-load", "LOAD", [connectionPoint("load-a", "A")]),
    wire("wire-left", "100", [
      wireEndpoint("wire-left-start", "start"),
      wireEndpoint("wire-left-end", "end"),
      wireConnection("wire-left-to-source-p", "SRC:P", {
        componentId: "component-source",
        connectionPointId: "source-p",
        endpointId: "wire-left-start",
      }),
      wireContinuity("wire-left-to-wire-right", "101", {
        wireId: "wire-right",
        endpointId: "wire-left-end",
      }),
    ]),
    wire("wire-right", "101", [
      wireEndpoint("wire-right-start", "start"),
      wireEndpoint("wire-right-end", "end"),
      wireConnection("wire-right-to-load-a", "LOAD:A", {
        componentId: "component-load",
        connectionPointId: "load-a",
        endpointId: "wire-right-end",
      }),
    ]),
  ]);

  const trace = traceConnectionPointReachability(graph, "source-p");

  assert.equal(trace.status, "complete");
  assert.deepEqual(
    trace.steps.map((step) => step.label),
    ["SRC:P", "wire 100", "wire 101", "LOAD:A"]
  );
  assert.deepEqual(trace.rootIds, [
    "component-source",
    "wire-left",
    "wire-right",
    "component-load",
  ]);
  assert.deepEqual(trace.attachmentIds, [
    "source-p",
    "wire-left-to-source-p",
    "wire-left-start",
    "wire-left-to-wire-right",
    "wire-left-end",
    "wire-right-to-load-a",
    "wire-right-end",
    "load-a",
  ]);
});

test("traces through paired ports on inline protective components only", () => {
  const graph = buildRelationshipGraph([
    component("component-source", "SRC", [
      connectionPoint("source-p", "P", { x: 0, y: 100, width: 10, height: 10 }),
    ]),
    component("component-fuse", "F10", [
      connectionPoint("fuse-1", "1", { x: 100, y: 100, width: 10, height: 10 }),
      connectionPoint("fuse-2", "2", { x: 220, y: 100, width: 10, height: 10 }),
    ]),
    component("component-load", "LOAD", [
      connectionPoint("load-a", "A", { x: 340, y: 100, width: 10, height: 10 }),
    ]),
    wire("wire-in", "100", [
      wireEndpoint("wire-in-start", "start"),
      wireEndpoint("wire-in-end", "end"),
      wireConnection("wire-in-to-source-p", "SRC:P", {
        componentId: "component-source",
        connectionPointId: "source-p",
        endpointId: "wire-in-start",
      }),
      wireConnection("wire-in-to-fuse-1", "F10:1", {
        componentId: "component-fuse",
        connectionPointId: "fuse-1",
        endpointId: "wire-in-end",
      }),
    ]),
    wire("wire-out", "101", [
      wireEndpoint("wire-out-start", "start"),
      wireEndpoint("wire-out-end", "end"),
      wireConnection("wire-out-to-fuse-2", "F10:2", {
        componentId: "component-fuse",
        connectionPointId: "fuse-2",
        endpointId: "wire-out-start",
      }),
      wireConnection("wire-out-to-load-a", "LOAD:A", {
        componentId: "component-load",
        connectionPointId: "load-a",
        endpointId: "wire-out-end",
      }),
    ]),
  ]);

  const trace = traceConnectionPointReachability(graph, "source-p");

  assert.equal(trace.status, "complete");
  assert.deepEqual(
    trace.steps.map((step) => step.label),
    ["SRC:P", "wire 100", "F10:1", "F10:2", "wire 101", "LOAD:A"]
  );
});

test("marks pass-through traces open when the opposite side has no outgoing wire", () => {
  const graph = buildRelationshipGraph([
    component("component-source", "SRC", [
      connectionPoint("source-p", "P", { x: 0, y: 100, width: 10, height: 10 }),
    ]),
    component("component-fuse", "F10", [
      connectionPoint("fuse-1", "1", { x: 100, y: 100, width: 10, height: 10 }),
      connectionPoint("fuse-2", "2", { x: 220, y: 100, width: 10, height: 10 }),
    ]),
    wire("wire-in", "100", [
      wireEndpoint("wire-in-start", "start"),
      wireEndpoint("wire-in-end", "end"),
      wireConnection("wire-in-to-source-p", "SRC:P", {
        componentId: "component-source",
        connectionPointId: "source-p",
        endpointId: "wire-in-start",
      }),
      wireConnection("wire-in-to-fuse-1", "F10:1", {
        componentId: "component-fuse",
        connectionPointId: "fuse-1",
        endpointId: "wire-in-end",
      }),
    ]),
  ]);

  const trace = traceConnectionPointReachability(graph, "source-p");

  assert.equal(trace.status, "open end");
  assert.deepEqual(
    trace.steps.map((step) => step.label),
    ["SRC:P", "wire 100", "F10:1", "F10:2", "open end"]
  );
});

test("traces through explicit paired terminals on connector roots", () => {
  const graph = buildRelationshipGraph([
    component("component-source", "SRC", [
      connectionPoint("source-p", "P", { x: 0, y: 100, width: 10, height: 10 }),
    ]),
    connector("connector-cn22", "CN22", [
      connectorConnectionPoint("cn22-left-1", "1", {
        x: 100,
        y: 100,
        width: 10,
        height: 10,
      }),
      connectorConnectionPoint("cn22-right-1", "A", {
        x: 220,
        y: 100,
        width: 10,
        height: 10,
      }),
      connectorPair("cn22-pair-1", "cn22-left-1", "cn22-right-1"),
    ]),
    component("component-load", "LOAD", [
      connectionPoint("load-x", "X", { x: 340, y: 100, width: 10, height: 10 }),
    ]),
    wire("wire-in", "6022", [
      wireEndpoint("wire-in-start", "start"),
      wireEndpoint("wire-in-end", "end"),
      wireConnection("wire-in-to-source-p", "SRC:P", {
        componentId: "component-source",
        connectionPointId: "source-p",
        endpointId: "wire-in-start",
      }),
      wireConnection("wire-in-to-cn22-1", "CN22:1", {
        componentId: "connector-cn22",
        connectionPointId: "cn22-left-1",
        endpointId: "wire-in-end",
      }),
    ]),
    wire("wire-out", "6032", [
      wireEndpoint("wire-out-start", "start"),
      wireEndpoint("wire-out-end", "end"),
      wireConnection("wire-out-to-cn22-a", "CN22:A", {
        componentId: "connector-cn22",
        connectionPointId: "cn22-right-1",
        endpointId: "wire-out-start",
      }),
      wireConnection("wire-out-to-load-x", "LOAD:X", {
        componentId: "component-load",
        connectionPointId: "load-x",
        endpointId: "wire-out-end",
      }),
    ]),
  ]);

  const trace = traceConnectionPointReachability(graph, "source-p");

  assert.equal(trace.status, "complete");
  assert.deepEqual(
    trace.steps.map((step) => step.label),
    ["SRC:P", "wire 6022", "CN22:1", "CN22:A", "wire 6032", "LOAD:X"]
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

function connector(id, label, attachments) {
  return {
    id,
    label,
    type: "connector",
    metadata: { rootType: "connector", attachments },
  };
}

function wire(id, label, attachments) {
  return {
    id,
    label,
    type: "wire_segment",
    metadata: { rootType: "wire_segment", attachments },
  };
}

function connectionPoint(id, text, bbox) {
  return {
    id,
    type: "connection_point",
    text,
    relation: "component_has_connection_point",
    bbox,
  };
}

function connectorConnectionPoint(id, text, bbox) {
  return {
    id,
    type: "connection_point",
    text,
    relation: "connector_has_connection_point",
    bbox,
  };
}

function connectorPair(id, leftConnectionPointId, rightConnectionPointId) {
  return {
    id,
    type: "connection_point",
    text: "terminal pair",
    relation: "connector_connection_point_pair",
    linkedBoxId: "connector-cn22",
    linkedAttachmentId: rightConnectionPointId,
    parentAttachmentId: leftConnectionPointId,
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

function wireContinuity(id, text, { wireId, endpointId }) {
  return {
    id,
    type: "wire_segment",
    text,
    relation: "wire_segment_to_wire_segment",
    linkedBoxId: wireId,
    linkedAttachmentId: null,
    parentAttachmentId: endpointId,
  };
}
