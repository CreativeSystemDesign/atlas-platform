import assert from "node:assert/strict";
import test from "node:test";

import { buildRelationshipGraph } from "./relationship-graph.ts";
import { relationshipTruthRowsForSelection } from "./relationship-truth-rows.ts";

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
  wire("wire-ground-only", "G", [
    wireEndpoint("wire-ground-only-start", "start"),
    wireEndpoint("wire-ground-only-end", "end"),
    {
      id: "wire-ground-only-ground-link",
      type: "ground_reference",
      text: "G",
      relation: "wire_segment_to_ground_reference",
      linkedBoxId: "ground-pe",
      linkedAttachmentId: null,
      parentAttachmentId: "wire-ground-only-end",
    },
  ]),
  {
    id: "ground-pe",
    label: "ground",
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

test("summarizes every connection point when a component root is selected", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(graph, {
    selectedBoxId: "component-whm10",
    selectedAttachmentId: null,
  });

  assert.deepEqual(
    rows.map((row) => ({ label: row.label, status: row.status, tone: row.tone })),
    [
      {
        label: "WHM10:1 -> wire 101K -> CT10:k",
        status: "complete",
        tone: "complete",
      },
      {
        label: "WHM10:2 -> open end",
        status: "open end",
        tone: "open",
      },
      {
        label: "WHM10:25 -> wire PE -> ground",
        status: "grounded",
        tone: "grounded",
      },
    ]
  );
});

test("numbers paths and exposes one addressable item per path line", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(graph, {
    selectedBoxId: "component-whm10",
    selectedAttachmentId: null,
  });

  assert.deepEqual(
    rows.map((row) => ({
      pathNumber: row.pathNumber,
      lineRefs: row.items.map((item) => item.ref),
      lineLabels: row.items.map((item) => item.label),
    })),
    [
      {
        pathNumber: 1,
        lineRefs: ["1.1", "1.2", "1.3"],
        lineLabels: ["WHM10:1", "wire 101K", "CT10:k"],
      },
      {
        pathNumber: 2,
        lineRefs: ["2.1", "2.2"],
        lineLabels: ["WHM10:2", "open end"],
      },
      {
        pathNumber: 3,
        lineRefs: ["3.1", "3.2", "3.3"],
        lineLabels: ["WHM10:25", "wire PE", "ground"],
      },
    ]
  );
});

test("summarizes one path when a connection point attachment is selected", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(graph, {
    selectedBoxId: "component-mcb10",
    selectedAttachmentId: "mcb10-s1",
  });

  assert.deepEqual(
    rows.map((row) => ({ label: row.label, status: row.status, tone: row.tone })),
    [
      {
        label: "MCB10:S1 -> wire S1 -> continues 5/1",
        status: "continues",
        tone: "continues",
      },
    ]
  );
});

test("summarizes linked connection paths when a wire root is selected", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(graph, {
    selectedBoxId: "wire-101k",
    selectedAttachmentId: null,
  });

  assert.deepEqual(
    rows.map((row) => ({ label: row.label, status: row.status, tone: row.tone })),
    [
      {
        label: "WHM10:1 -> wire 101K -> CT10:k",
        status: "complete",
        tone: "complete",
      },
      {
        label: "CT10:k -> wire 101K -> WHM10:1",
        status: "complete",
        tone: "complete",
      },
    ]
  );
});

test("summarizes a grounded wire with no component connection points when selected", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(
    graph,
    {
      selectedBoxId: "wire-ground-only",
      selectedAttachmentId: null,
    },
    { scope: "trace" }
  );

  assert.deepEqual(
    rows.map((row) => ({
      label: row.label,
      status: row.status,
      tone: row.tone,
      lineLabels: row.items.map((item) => item.label),
      rootIds: row.rootIds,
      attachmentIds: row.attachmentIds,
    })),
    [
      {
        label: "wire G -> ground",
        status: "grounded",
        tone: "grounded",
        lineLabels: ["wire G", "ground"],
        rootIds: ["wire-ground-only", "ground-pe"],
        attachmentIds: ["wire-ground-only-end", "wire-ground-only-ground-link"],
      },
    ]
  );
});

test("summarizes grounded wires when a ground root is selected", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(
    graph,
    {
      selectedBoxId: "ground-pe",
      selectedAttachmentId: null,
    },
    { scope: "trace" }
  );

  assert.deepEqual(
    rows.map((row) => ({
      label: row.label,
      status: row.status,
      tone: row.tone,
      rootIds: row.rootIds,
    })),
    [
      {
        label: "WHM10:25 -> wire PE -> ground",
        status: "grounded",
        tone: "grounded",
        rootIds: ["component-whm10", "wire-pe", "ground-pe"],
      },
      {
        label: "wire G -> ground",
        status: "grounded",
        tone: "grounded",
        rootIds: ["wire-ground-only", "ground-pe"],
      },
    ]
  );
});

test("can summarize full trace rows for validation highlighting", () => {
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

  const rows = relationshipTruthRowsForSelection(
    graph,
    {
      selectedBoxId: "component-source",
      selectedAttachmentId: "source-p",
    },
    { scope: "trace" }
  );

  assert.deepEqual(
    rows.map((row) => ({
      label: row.label,
      status: row.status,
      tone: row.tone,
      lineRefs: row.items.map((item) => item.ref),
      lineLabels: row.items.map((item) => item.label),
      rootIds: row.rootIds,
    })),
    [
      {
        label: "SRC:P -> wire 100 -> F10:1 -> F10:2 -> wire 101 -> LOAD:A",
        status: "complete",
        tone: "complete",
        lineRefs: ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"],
        lineLabels: ["SRC:P", "wire 100", "F10:1", "F10:2", "wire 101", "LOAD:A"],
        rootIds: [
          "component-source",
          "wire-in",
          "component-fuse",
          "wire-out",
          "component-load",
        ],
      },
    ]
  );
});

test("summarizes trace rows when the selected wire only reaches components through wire continuity", () => {
  const graph = buildRelationshipGraph([
    component("component-con22", "CON22", [
      connectionPoint("con22-1", "1", { x: 300, y: 100, width: 10, height: 10 }),
    ]),
    wire("wire-6032-existing", "6032", [
      wireEndpoint("wire-6032-existing-start", "start"),
      wireEndpoint("wire-6032-existing-end", "end"),
      wireConnection("wire-6032-existing-to-con22-1", "CON22:1", {
        componentId: "component-con22",
        connectionPointId: "con22-1",
        endpointId: "wire-6032-existing-end",
      }),
      {
        id: "wire-6032-existing-to-manual",
        type: "wire_endpoint",
        text: "6032",
        relation: "wire_segment_to_wire_segment",
        linkedBoxId: "wire-6032-manual",
        linkedAttachmentId: "wire-6032-manual-end",
        parentAttachmentId: "wire-6032-existing-start",
      },
    ]),
    wire("wire-6032-manual", "6032", [
      wireEndpoint("wire-6032-manual-start", "start"),
      wireEndpoint("wire-6032-manual-end", "end"),
    ]),
  ]);

  const rows = relationshipTruthRowsForSelection(
    graph,
    {
      selectedBoxId: "wire-6032-manual",
      selectedAttachmentId: "wire-6032-manual-start",
    },
    { scope: "trace" }
  );

  assert.deepEqual(
    rows.map((row) => ({
      label: row.label,
      status: row.status,
      tone: row.tone,
      rootIds: row.rootIds,
      attachmentIds: row.attachmentIds,
    })),
    [
      {
        label: "CON22:1 -> wire 6032 -> wire 6032",
        status: "open end",
        tone: "open",
        rootIds: ["component-con22", "wire-6032-existing", "wire-6032-manual"],
        attachmentIds: [
          "con22-1",
          "wire-6032-existing-to-con22-1",
          "wire-6032-existing-end",
          "wire-6032-existing-to-manual",
          "wire-6032-existing-start",
          "wire-6032-manual-end",
        ],
      },
    ]
  );
});

test("summarizes descriptor members when a descriptor root is selected", () => {
  const graph = buildRelationshipGraph(annotations);

  const rows = relationshipTruthRowsForSelection(graph, {
    selectedBoxId: "descriptor-power-monitor",
    selectedAttachmentId: null,
  });

  assert.deepEqual(
    rows.map((row) => ({ label: row.label, tone: row.tone })),
    [
      { label: "POWER MONITOR -> WHM10", tone: "neutral" },
      { label: "POWER MONITOR -> CT10", tone: "neutral" },
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
