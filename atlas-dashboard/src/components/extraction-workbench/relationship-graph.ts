export type RelationshipGraphRoot = {
  id: string;
  label: string;
  type: string;
  bbox?: RelationshipGraphBbox | null;
};

export type RelationshipGraphAttachment = {
  id: string;
  type: string;
  text: string;
  relation?: string | null;
  ownerId: string;
  bbox?: RelationshipGraphBbox | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  parentAttachmentId?: string | null;
};

export type RelationshipGraphAttachmentRef = {
  id: string;
  text: string;
  type: string;
  ownerId: string;
};

export type RelationshipGraphBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RelationshipContinuationReference = {
  page: number;
  row: number;
  label: string;
};

export type RelationshipGraphAnnotation = {
  id: string;
  label: string;
  bbox?: RelationshipGraphBbox | null;
  rootType?: string | null;
  type?: string | null;
  metadata?: {
    rootType?: string | null;
    attachments?: RelationshipGraphAnnotationAttachment[] | null;
    continuationReference?: unknown;
  } | null;
};

export type RelationshipGraphAnnotationAttachment = {
  id: string;
  type: string;
  text?: string | null;
  bbox?: RelationshipGraphBbox | null;
  relation?: string | null;
  linkedBoxId?: string | null;
  linkedAttachmentId?: string | null;
  parentAttachmentId?: string | null;
};

export type RelationshipPathStatus =
  | "complete"
  | "open end"
  | "continues"
  | "grounded"
  | "ambiguous";

export type RelationshipBoundary = {
  root: RelationshipGraphRoot;
  relation: string;
  targetAttachmentId: string | null;
  sourceAttachmentId?: string | null;
  sourceParentAttachmentId?: string | null;
  wireContactKind?: "wire_segment_tap" | "wire_endpoint_termination" | null;
  continuationReference?: RelationshipContinuationReference | null;
};

export type RelationshipConnectionPointPath = {
  status: RelationshipPathStatus;
  startComponent: RelationshipGraphRoot | null;
  startConnectionPoint: RelationshipGraphAttachmentRef | null;
  wire: RelationshipGraphRoot | null;
  connectionPoints: Array<{
    component: RelationshipGraphRoot;
    connectionPoint: RelationshipGraphAttachmentRef;
  }>;
  boundaries: RelationshipBoundary[];
};

export type RelationshipTraceStep =
  | {
      kind: "connection_point";
      label: string;
      root: RelationshipGraphRoot;
      attachment: RelationshipGraphAttachmentRef;
    }
  | {
      kind: "wire";
      label: string;
      root: RelationshipGraphRoot;
    }
  | {
      kind: "boundary";
      label: string;
      boundary: RelationshipBoundary;
    }
  | {
      kind: "open_end";
      label: string;
    };

export type RelationshipTrace = {
  status: RelationshipPathStatus;
  startComponent: RelationshipGraphRoot | null;
  startConnectionPoint: RelationshipGraphAttachmentRef | null;
  steps: RelationshipTraceStep[];
  rootIds: string[];
  attachmentIds: string[];
};

export type RelationshipWireContinuity = {
  sourceWireId: string;
  targetWireId: string;
  sourceAttachmentId: string;
  sourceEndpointId: string | null;
  targetAttachmentId: string | null;
};

export type RelationshipGraph = {
  rootsById: Map<string, RelationshipGraphRoot>;
  attachmentsById: Map<string, RelationshipGraphAttachment>;
  attachmentOwnerById: Map<string, string>;
  wireLinksByConnectionPointId: Map<string, RelationshipGraphAttachment[]>;
  wireLinksByWireId: Map<string, RelationshipGraphAttachment[]>;
  wireContinuitiesByWireId: Map<string, RelationshipWireContinuity[]>;
  passThroughConnectionPointById: Map<string, RelationshipGraphAttachmentRef>;
  boundariesByWireId: Map<string, RelationshipBoundary[]>;
  descriptorMembersById: Map<string, RelationshipGraphRoot[]>;
  continuationReferencesByRootId: Map<string, RelationshipContinuationReference>;
};

export function buildRelationshipGraph(
  annotations: RelationshipGraphAnnotation[]
): RelationshipGraph {
  const graph: RelationshipGraph = {
    rootsById: new Map(),
    attachmentsById: new Map(),
    attachmentOwnerById: new Map(),
    wireLinksByConnectionPointId: new Map(),
    wireLinksByWireId: new Map(),
    wireContinuitiesByWireId: new Map(),
    passThroughConnectionPointById: new Map(),
    boundariesByWireId: new Map(),
    descriptorMembersById: new Map(),
    continuationReferencesByRootId: new Map(),
  };

  for (const annotation of annotations) {
    const rootType = rootTypeOf(annotation);
    const root: RelationshipGraphRoot = {
      id: annotation.id,
      label: annotation.label,
      type: rootType,
    };
    if (annotation.bbox) root.bbox = annotation.bbox;
    graph.rootsById.set(annotation.id, root);
    if (rootType === "continuation") {
      const reference =
        normalizeContinuationReference(annotation.metadata?.continuationReference) ??
        parseContinuationReferenceLabel(annotation.label);
      if (reference) {
        graph.continuationReferencesByRootId.set(annotation.id, reference);
      }
    }
  }

  for (const annotation of annotations) {
    const attachments = annotation.metadata?.attachments ?? [];
    for (const attachment of attachments) {
      const normalized: RelationshipGraphAttachment = {
        id: attachment.id,
        type: attachment.type,
        text: attachment.text ?? "",
        relation: attachment.relation ?? null,
        ownerId: annotation.id,
        linkedBoxId: attachment.linkedBoxId ?? null,
        linkedAttachmentId: attachment.linkedAttachmentId ?? null,
        parentAttachmentId: attachment.parentAttachmentId ?? null,
      };
      if (attachment.bbox) normalized.bbox = attachment.bbox;
      graph.attachmentsById.set(normalized.id, normalized);
      graph.attachmentOwnerById.set(normalized.id, annotation.id);
    }
  }

  for (const attachment of graph.attachmentsById.values()) {
    if (attachment.relation === "wire_segment_endpoint_to_connection_point") {
      addMapArray(
        graph.wireLinksByConnectionPointId,
        attachment.linkedAttachmentId ?? "",
        attachment
      );
      addMapArray(graph.wireLinksByWireId, attachment.ownerId, attachment);
    }

    if (
      attachment.relation === "connector_connection_point_pair" &&
      attachment.parentAttachmentId &&
      attachment.linkedAttachmentId
    ) {
      addExplicitConnectionPointPair(
        graph,
        attachment.parentAttachmentId,
        attachment.linkedAttachmentId
      );
    }

    if (
      attachment.relation === "wire_segment_to_wire_segment" &&
      attachment.linkedBoxId
    ) {
      addWireContinuity(graph, {
        sourceWireId: attachment.ownerId,
        targetWireId: attachment.linkedBoxId,
        sourceAttachmentId: attachment.id,
        sourceEndpointId: attachment.parentAttachmentId ?? null,
        targetAttachmentId: attachment.linkedAttachmentId ?? null,
      });
    }

    if (
      attachment.relation === "continuation_to_object" &&
      attachment.linkedBoxId
    ) {
      const boundaryRoot = graph.rootsById.get(attachment.ownerId);
      if (!boundaryRoot) continue;
      const boundary: RelationshipBoundary = {
        root: boundaryRoot,
        relation: attachment.relation,
        targetAttachmentId: attachment.linkedAttachmentId ?? null,
      };
      const continuationReference = graph.continuationReferencesByRootId.get(
        boundaryRoot.id
      );
      if (continuationReference) {
        boundary.continuationReference = continuationReference;
      }
      addMapArray(graph.boundariesByWireId, attachment.linkedBoxId, boundary);
    }

    if (
      attachment.relation === "wire_segment_to_ground_reference" &&
      attachment.linkedBoxId
    ) {
      const groundRoot = graph.rootsById.get(attachment.linkedBoxId);
      if (!groundRoot) continue;
      addMapArray(graph.boundariesByWireId, attachment.ownerId, {
        root: groundRoot,
        relation: attachment.relation,
        targetAttachmentId: attachment.linkedAttachmentId ?? null,
        sourceAttachmentId: attachment.id,
        sourceParentAttachmentId: attachment.parentAttachmentId ?? null,
        wireContactKind: attachment.parentAttachmentId
          ? "wire_endpoint_termination"
          : "wire_segment_tap",
      });
    }

    if (
      (attachment.relation === "circuit_descriptor_applies_to_component" ||
        attachment.relation === "page_descriptor_applies_to_component") &&
      attachment.linkedBoxId
    ) {
      const component = graph.rootsById.get(attachment.linkedBoxId);
      if (component) {
        addMapArray(graph.descriptorMembersById, attachment.ownerId, component);
      }
    }
  }

  addPassThroughConnectionPointPairs(graph);

  return graph;
}

export function componentForConnectionPoint(
  graph: RelationshipGraph,
  connectionPointId: string
): RelationshipGraphRoot | null {
  const connectionPoint = graph.attachmentsById.get(connectionPointId);
  if (!connectionPoint || connectionPoint.type !== "connection_point") return null;
  return graph.rootsById.get(connectionPoint.ownerId) ?? null;
}

export function wireEndpointForConnectionPoint(
  graph: RelationshipGraph,
  connectionPointId: string
) {
  const link = graph.wireLinksByConnectionPointId.get(connectionPointId)?.[0];
  if (!link) return null;
  const endpointId = link.parentAttachmentId;
  if (!endpointId) return null;
  const endpoint = graph.attachmentsById.get(endpointId);
  const wire = graph.rootsById.get(link.ownerId);
  if (!endpoint || !wire) return null;
  return { wire, endpoint: attachmentRef(endpoint) };
}

export function traceConnectionPointPath(
  graph: RelationshipGraph,
  connectionPointId: string
): RelationshipConnectionPointPath {
  const startConnectionPoint = attachmentRef(
    graph.attachmentsById.get(connectionPointId) ?? null
  );
  const startComponent = componentForConnectionPoint(graph, connectionPointId);
  const link = graph.wireLinksByConnectionPointId.get(connectionPointId)?.[0] ?? null;
  if (!link) {
    return {
      status: "open end",
      startComponent,
      startConnectionPoint,
      wire: null,
      connectionPoints: [],
      boundaries: [],
    };
  }

  const wire = graph.rootsById.get(link.ownerId) ?? null;
  const wireLinks = graph.wireLinksByWireId.get(link.ownerId) ?? [];
  const connectionPoints = wireLinks
    .map((wireLink) => {
      if (!wireLink.linkedAttachmentId || !wireLink.linkedBoxId) return null;
      const component = graph.rootsById.get(wireLink.linkedBoxId);
      const connectionPoint = graph.attachmentsById.get(wireLink.linkedAttachmentId);
      if (!component || !connectionPoint) return null;
      const connectionPointRef = attachmentRef(connectionPoint);
      if (!connectionPointRef) return null;
      return { component, connectionPoint: connectionPointRef };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const boundaries = graph.boundariesByWireId.get(link.ownerId) ?? [];

  return {
    status: pathStatus(connectionPoints.length, boundaries),
    startComponent,
    startConnectionPoint,
    wire,
    connectionPoints,
    boundaries,
  };
}

export function traceConnectionPointReachability(
  graph: RelationshipGraph,
  connectionPointId: string
): RelationshipTrace {
  const steps: RelationshipTraceStep[] = [];
  const rootIds = new Set<string>();
  const attachmentIds = new Set<string>();
  const boundaryKeys = new Set<string>();
  const openEndConnectionPointIds = new Set<string>();
  const visitedConnectionPointIds = new Set<string>();
  const visitedWireIds = new Set<string>();

  const startConnectionPoint = attachmentRef(
    graph.attachmentsById.get(connectionPointId) ?? null
  );
  const startComponent = componentForConnectionPoint(graph, connectionPointId);

  const addConnectionPointStep = (
    connectionPoint: RelationshipGraphAttachment,
    component: RelationshipGraphRoot
  ) => {
    rootIds.add(component.id);
    attachmentIds.add(connectionPoint.id);
    steps.push({
      kind: "connection_point",
      label: componentConnectionLabel(component, attachmentRef(connectionPoint)),
      root: component,
      attachment: attachmentRef(connectionPoint) as RelationshipGraphAttachmentRef,
    });
  };

  const addOpenEndStep = (currentConnectionPointId: string) => {
    if (openEndConnectionPointIds.has(currentConnectionPointId)) return;
    openEndConnectionPointIds.add(currentConnectionPointId);
    steps.push({ kind: "open_end", label: "open end" });
  };

  const visitConnectionPoint = (
    currentConnectionPointId: string,
    fromPassThrough = false
  ) => {
    if (visitedConnectionPointIds.has(currentConnectionPointId)) return;
    const connectionPoint = graph.attachmentsById.get(currentConnectionPointId);
    if (!connectionPoint || connectionPoint.type !== "connection_point") return;
    const component = graph.rootsById.get(connectionPoint.ownerId);
    if (!component) return;
    visitedConnectionPointIds.add(currentConnectionPointId);
    addConnectionPointStep(connectionPoint, component);

    const wireLinks =
      graph.wireLinksByConnectionPointId.get(currentConnectionPointId) ?? [];
    for (const link of wireLinks) {
      attachmentIds.add(link.id);
      if (link.parentAttachmentId) attachmentIds.add(link.parentAttachmentId);
      visitWire(link.ownerId);
    }

    const pairedConnectionPoint = graph.passThroughConnectionPointById.get(
      currentConnectionPointId
    );
    if (
      pairedConnectionPoint &&
      !visitedConnectionPointIds.has(pairedConnectionPoint.id) &&
      (wireLinks.length > 0 || fromPassThrough)
    ) {
      visitConnectionPoint(pairedConnectionPoint.id, true);
    } else if (wireLinks.length === 0) {
      addOpenEndStep(currentConnectionPointId);
    }
  };

  const visitWire = (wireId: string) => {
    if (visitedWireIds.has(wireId)) return;
    const wire = graph.rootsById.get(wireId);
    if (!wire) return;
    visitedWireIds.add(wireId);
    rootIds.add(wire.id);
    steps.push({
      kind: "wire",
      label: `wire ${wire.label}`,
      root: wire,
    });

    for (const continuity of graph.wireContinuitiesByWireId.get(wireId) ?? []) {
      attachmentIds.add(continuity.sourceAttachmentId);
      if (continuity.sourceEndpointId) attachmentIds.add(continuity.sourceEndpointId);
      if (continuity.targetAttachmentId) {
        attachmentIds.add(continuity.targetAttachmentId);
      }
      visitWire(continuity.targetWireId);
    }

    for (const link of graph.wireLinksByWireId.get(wireId) ?? []) {
      attachmentIds.add(link.id);
      if (link.parentAttachmentId) attachmentIds.add(link.parentAttachmentId);
      if (link.linkedAttachmentId) visitConnectionPoint(link.linkedAttachmentId);
    }

    for (const boundary of graph.boundariesByWireId.get(wireId) ?? []) {
      const key = `${boundary.root.id}:${boundary.relation}:${
        boundary.targetAttachmentId ?? ""
      }:${boundary.sourceAttachmentId ?? ""}:${
        boundary.sourceParentAttachmentId ?? ""
      }`;
      if (boundaryKeys.has(key)) continue;
      boundaryKeys.add(key);
      rootIds.add(boundary.root.id);
      if (boundary.sourceAttachmentId) {
        attachmentIds.add(boundary.sourceAttachmentId);
      }
      if (boundary.sourceParentAttachmentId) {
        attachmentIds.add(boundary.sourceParentAttachmentId);
      }
      if (boundary.targetAttachmentId) attachmentIds.add(boundary.targetAttachmentId);
      steps.push({
        kind: "boundary",
        label: boundaryLabel(boundary),
        boundary,
      });
    }
  };

  visitConnectionPoint(connectionPointId);

  return {
    status: traceStatus(visitedConnectionPointIds.size, boundaryKeys, steps),
    startComponent,
    startConnectionPoint,
    steps,
    rootIds: [...rootIds],
    attachmentIds: [...attachmentIds],
  };
}

export function descriptorMembers(
  graph: RelationshipGraph,
  descriptorId: string
): RelationshipGraphRoot[] {
  return graph.descriptorMembersById.get(descriptorId) ?? [];
}

function addWireContinuity(
  graph: RelationshipGraph,
  continuity: RelationshipWireContinuity
) {
  addMapArray(graph.wireContinuitiesByWireId, continuity.sourceWireId, continuity);
  addMapArray(graph.wireContinuitiesByWireId, continuity.targetWireId, {
    sourceWireId: continuity.targetWireId,
    targetWireId: continuity.sourceWireId,
    sourceAttachmentId: continuity.targetAttachmentId ?? continuity.sourceAttachmentId,
    sourceEndpointId: continuity.targetAttachmentId,
    targetAttachmentId: continuity.sourceAttachmentId,
  });
}

function addPassThroughConnectionPointPairs(graph: RelationshipGraph) {
  for (const root of graph.rootsById.values()) {
    if (!isTraceThroughRoot(root)) continue;
    const connectionPoints = [...graph.attachmentsById.values()]
      .filter(
        (attachment) =>
          attachment.ownerId === root.id &&
          attachment.type === "connection_point" &&
          !attachment.linkedAttachmentId
      )
      .sort((left, right) =>
        left.text.localeCompare(right.text, undefined, { numeric: true })
      );
    for (const [left, right] of traceThroughPairs(connectionPoints)) {
      const leftRef = attachmentRef(left);
      const rightRef = attachmentRef(right);
      if (!leftRef || !rightRef) continue;
      if (!graph.passThroughConnectionPointById.has(left.id)) {
        graph.passThroughConnectionPointById.set(left.id, rightRef);
      }
      if (!graph.passThroughConnectionPointById.has(right.id)) {
        graph.passThroughConnectionPointById.set(right.id, leftRef);
      }
    }
  }
}

function addExplicitConnectionPointPair(
  graph: RelationshipGraph,
  firstConnectionPointId: string,
  secondConnectionPointId: string
) {
  const firstRef = attachmentRef(
    graph.attachmentsById.get(firstConnectionPointId) ?? null
  );
  const secondRef = attachmentRef(
    graph.attachmentsById.get(secondConnectionPointId) ?? null
  );
  if (!firstRef || !secondRef) return;
  graph.passThroughConnectionPointById.set(firstConnectionPointId, secondRef);
  graph.passThroughConnectionPointById.set(secondConnectionPointId, firstRef);
}

function isTraceThroughRoot(root: RelationshipGraphRoot) {
  if (root.type !== "component") return false;
  const label = root.label.trim().toUpperCase();
  return (
    /^(MCB|MCCB|ELB|FU)\d*/.test(label) ||
    /^F\d+/.test(label) ||
    label.includes("FUSE")
  );
}

function traceThroughPairs(
  connectionPoints: RelationshipGraphAttachment[]
): Array<[RelationshipGraphAttachment, RelationshipGraphAttachment]> {
  if (connectionPoints.length < 2) return [];
  if (connectionPoints.length === 2) {
    return [[connectionPoints[0], connectionPoints[1]]];
  }

  const geometryPairs = traceThroughGeometryPairs(connectionPoints);
  if (geometryPairs.length > 0) return geometryPairs;
  return traceThroughNumericPairs(connectionPoints);
}

function traceThroughGeometryPairs(
  connectionPoints: RelationshipGraphAttachment[]
): Array<[RelationshipGraphAttachment, RelationshipGraphAttachment]> {
  const points = connectionPoints
    .map((attachment) => {
      if (!attachment.bbox) return null;
      return { attachment, center: centerOfBox(attachment.bbox) };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (points.length !== connectionPoints.length) return [];

  const xs = points.map((point) => point.center.x);
  const ys = points.map((point) => point.center.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const horizontal = spreadX >= spreadY;
  const midpoint = horizontal
    ? (Math.max(...xs) + Math.min(...xs)) / 2
    : (Math.max(...ys) + Math.min(...ys)) / 2;
  const lowSide = points.filter((point) =>
    horizontal ? point.center.x <= midpoint : point.center.y <= midpoint
  );
  const highSide = points.filter((point) =>
    horizontal ? point.center.x > midpoint : point.center.y > midpoint
  );
  if (lowSide.length !== highSide.length || lowSide.length === 0) return [];
  const sortByInlineAxis = (left: (typeof points)[number], right: (typeof points)[number]) =>
    horizontal ? left.center.y - right.center.y : left.center.x - right.center.x;
  lowSide.sort(sortByInlineAxis);
  highSide.sort(sortByInlineAxis);
  return lowSide.map((point, index) => [point.attachment, highSide[index].attachment]);
}

function traceThroughNumericPairs(
  connectionPoints: RelationshipGraphAttachment[]
): Array<[RelationshipGraphAttachment, RelationshipGraphAttachment]> {
  const byNumber = new Map<number, RelationshipGraphAttachment>();
  for (const point of connectionPoints) {
    const number = Number.parseInt(point.text, 10);
    if (Number.isFinite(number)) byNumber.set(number, point);
  }
  const pairs: Array<[RelationshipGraphAttachment, RelationshipGraphAttachment]> = [];
  for (const [number, point] of byNumber.entries()) {
    if (number % 2 !== 1) continue;
    const paired = byNumber.get(number + 1);
    if (paired) pairs.push([point, paired]);
  }
  return pairs;
}

function rootTypeOf(annotation: RelationshipGraphAnnotation) {
  return (
    annotation.rootType ||
    annotation.metadata?.rootType ||
    annotation.type ||
    "component"
  );
}

function normalizeContinuationReference(
  value: unknown
): RelationshipContinuationReference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    page?: unknown;
    row?: unknown;
    label?: unknown;
  };
  const page = Number(candidate.page);
  const row = Number(candidate.row);
  if (!Number.isFinite(page) || !Number.isFinite(row)) return null;
  return {
    page,
    row,
    label: continuationReferenceLabel(page, row, candidate.label),
  };
}

function parseContinuationReferenceLabel(
  label: string
): RelationshipContinuationReference | null {
  const match = label.trim().match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (!match) return null;
  const page = Number(match[1]);
  const row = Number(match[2]);
  return {
    page,
    row,
    label: `${page}/${row}`,
  };
}

function continuationReferenceLabel(
  page: number,
  row: number,
  label: unknown
) {
  const normalizedLabel = typeof label === "string" ? label.trim() : "";
  return normalizedLabel || `${page}/${row}`;
}

function componentConnectionLabel(
  component: RelationshipGraphRoot | null,
  connectionPoint: RelationshipGraphAttachmentRef | null
): string {
  const componentLabel = component?.label || "Unknown";
  const pointLabel = connectionPoint?.text || "connection";
  return `${componentLabel}:${pointLabel}`;
}

function attachmentRef(
  attachment: RelationshipGraphAttachment | null
): RelationshipGraphAttachmentRef | null {
  if (!attachment) return null;
  return {
    id: attachment.id,
    text: attachment.text,
    type: attachment.type,
    ownerId: attachment.ownerId,
  };
}

function centerOfBox(bbox: RelationshipGraphBbox) {
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2,
  };
}

function boundaryLabel(boundary: RelationshipBoundary) {
  if (
    boundary.root.type === "continuation" ||
    boundary.relation === "continuation_to_object"
  ) {
    return `continues ${boundary.root.label}`;
  }
  if (
    boundary.root.type === "ground_reference" ||
    boundary.relation === "wire_segment_to_ground_reference"
  ) {
    return groundBoundaryLabel(boundary.root);
  }
  return boundary.root.label;
}

function groundBoundaryLabel(root: RelationshipGraphRoot): string {
  const label = root.label.trim();
  return label && label.toLowerCase() !== "ground" ? `ground ${label}` : "ground";
}

function pathStatus(
  connectionPointCount: number,
  boundaries: RelationshipBoundary[]
): RelationshipPathStatus {
  if (
    boundaries.some(
      (boundary) =>
        boundary.root.type === "continuation" ||
        boundary.relation === "continuation_to_object"
    )
  ) {
    return "continues";
  }
  if (
    boundaries.some(
      (boundary) =>
        boundary.root.type === "ground_reference" ||
        boundary.relation === "wire_segment_to_ground_reference"
    )
  ) {
    return "grounded";
  }
  return connectionPointCount > 1 ? "complete" : "open end";
}

function traceStatus(
  connectionPointCount: number,
  boundaryKeys: Set<string>,
  steps: RelationshipTraceStep[]
): RelationshipPathStatus {
  if (steps.some((step) => step.kind === "open_end")) {
    return "open end";
  }
  const boundaries = steps
    .filter((step): step is Extract<RelationshipTraceStep, { kind: "boundary" }> =>
      step.kind === "boundary"
    )
    .map((step) => step.boundary);
  if (
    [...boundaryKeys].length > 0 &&
    boundaries.some(
      (boundary) =>
        boundary.root.type === "continuation" ||
        boundary.relation === "continuation_to_object"
    )
  ) {
    return "continues";
  }
  if (
    [...boundaryKeys].length > 0 &&
    boundaries.some(
      (boundary) =>
        boundary.root.type === "ground_reference" ||
        boundary.relation === "wire_segment_to_ground_reference"
    )
  ) {
    return "grounded";
  }
  return connectionPointCount > 1 ? "complete" : "open end";
}

function addMapArray<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue
) {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}
