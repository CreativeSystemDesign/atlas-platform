import {
  descriptorMembers,
  traceConnectionPointReachability,
  traceConnectionPointPath,
  type RelationshipBoundary,
  type RelationshipConnectionPointPath,
  type RelationshipGraph,
  type RelationshipGraphAttachment,
  type RelationshipGraphAttachmentRef,
  type RelationshipGraphRoot,
  type RelationshipPathStatus,
  type RelationshipTrace,
} from "./relationship-graph.ts";

export type RelationshipTruthTone =
  | "complete"
  | "open"
  | "continues"
  | "grounded"
  | "ambiguous"
  | "neutral";

export type RelationshipTruthRow = {
  id: string;
  label: string;
  pathNumber: number;
  items: RelationshipTruthRowItem[];
  kind: "connection_path" | "boundary_path" | "descriptor_member";
  tone: RelationshipTruthTone;
  status?: RelationshipPathStatus;
  rootIds: string[];
  attachmentIds: string[];
};

export type RelationshipTruthRowItem = {
  ref: string;
  label: string;
  rootId?: string | null;
  attachmentId?: string | null;
};

export type RelationshipTruthSelection = {
  selectedBoxId: string | null;
  selectedAttachmentId?: string | null;
};

export type RelationshipTruthOptions = {
  scope?: "local" | "trace";
};

export function relationshipTruthRowsForSelection(
  graph: RelationshipGraph,
  selection: RelationshipTruthSelection,
  options: RelationshipTruthOptions = {}
): RelationshipTruthRow[] {
  const scope = options.scope ?? "local";
  const selectedRoot = selection.selectedBoxId
    ? graph.rootsById.get(selection.selectedBoxId) ?? null
    : null;
  const selectedAttachment = selection.selectedAttachmentId
    ? graph.attachmentsById.get(selection.selectedAttachmentId) ?? null
    : null;

  if (selectedAttachment) {
    const connectionPointId = connectionPointIdForSelectedAttachment(selectedAttachment);
    if (connectionPointId) {
      return numberRows([
        scope === "trace"
          ? tracePathRow(graph, connectionPointId)
          : connectionPathRow(graph, connectionPointId),
      ]);
    }

    if (selectedAttachment.type === "wire_endpoint" && selectedRoot) {
      return numberRows(wireRows(graph, selectedRoot.id, scope));
    }
  }

  if (!selectedRoot) return [];

  if (selectedRoot.type === "component") {
    return numberRows(
      connectionPointsOwnedBy(graph, selectedRoot.id).map((attachment) =>
        scope === "trace"
          ? tracePathRow(graph, attachment.id)
          : connectionPathRow(graph, attachment.id)
      )
    );
  }

  if (selectedRoot.type === "wire_segment") {
    return numberRows(wireRows(graph, selectedRoot.id, scope));
  }

  if (
    selectedRoot.type === "ground_reference" ||
    selectedRoot.type === "continuation"
  ) {
    return numberRows(boundaryRootRows(graph, selectedRoot.id, scope));
  }

  const members = descriptorMembers(graph, selectedRoot.id);
  if (members.length > 0) {
    return numberRows(
      members.map((member) => ({
        id: `descriptor-member:${selectedRoot.id}:${member.id}`,
        label: `${selectedRoot.label} -> ${member.label}`,
        pathNumber: 0,
        items: [
          { ref: "", label: selectedRoot.label, rootId: selectedRoot.id },
          { ref: "", label: member.label, rootId: member.id },
        ],
        kind: "descriptor_member",
        tone: "neutral",
        rootIds: [selectedRoot.id, member.id],
        attachmentIds: [],
      }))
    );
  }

  return [];
}

function wireRows(
  graph: RelationshipGraph,
  wireId: string,
  scope: RelationshipTruthOptions["scope"] = "local"
): RelationshipTruthRow[] {
  const rows = connectionRowsForWire(graph, wireId, scope);
  return rows.length > 0 ? rows : boundaryRowsForReachableWires(graph, wireId, scope);
}

function connectionRowsForWire(
  graph: RelationshipGraph,
  wireId: string,
  scope: RelationshipTruthOptions["scope"] = "local"
): RelationshipTruthRow[] {
  const seenConnectionPointIds = new Set<string>();
  const seenTraceKeys = new Set<string>();
  const rows: RelationshipTruthRow[] = [];
  for (const reachableWireId of reachableWireIdsForRows(graph, wireId, scope)) {
    for (const link of graph.wireLinksByWireId.get(reachableWireId) ?? []) {
      const connectionPointId = link.linkedAttachmentId;
      if (!connectionPointId || seenConnectionPointIds.has(connectionPointId)) {
        continue;
      }
      seenConnectionPointIds.add(connectionPointId);
      const row =
        scope === "trace"
          ? tracePathRow(graph, connectionPointId)
          : connectionPathRow(graph, connectionPointId);
      const traceKey = [...row.rootIds].sort().join("|");
      if (scope === "trace" && seenTraceKeys.has(traceKey)) continue;
      seenTraceKeys.add(traceKey);
      rows.push(row);
    }
  }
  return rows;
}

function reachableWireIdsForRows(
  graph: RelationshipGraph,
  wireId: string,
  scope: RelationshipTruthOptions["scope"]
) {
  if (scope !== "trace") return [wireId];

  const ids: string[] = [];
  const visited = new Set<string>();
  const queue = [wireId];

  while (queue.length > 0) {
    const currentWireId = queue.shift() as string;
    if (visited.has(currentWireId)) continue;
    visited.add(currentWireId);
    ids.push(currentWireId);
    for (const continuity of graph.wireContinuitiesByWireId.get(currentWireId) ?? []) {
      if (!visited.has(continuity.targetWireId)) {
        queue.push(continuity.targetWireId);
      }
    }
  }

  return ids;
}

function boundaryRowsForReachableWires(
  graph: RelationshipGraph,
  wireId: string,
  scope: RelationshipTruthOptions["scope"]
) {
  const seenRowIds = new Set<string>();
  const rows: RelationshipTruthRow[] = [];
  for (const reachableWireId of reachableWireIdsForRows(graph, wireId, scope)) {
    for (const row of boundaryRowsForWire(graph, reachableWireId)) {
      if (seenRowIds.has(row.id)) continue;
      seenRowIds.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

function boundaryRootRows(
  graph: RelationshipGraph,
  boundaryRootId: string,
  scope: RelationshipTruthOptions["scope"] = "local"
): RelationshipTruthRow[] {
  const rows: RelationshipTruthRow[] = [];
  const seenRowIds = new Set<string>();
  for (const [wireId, boundaries] of graph.boundariesByWireId.entries()) {
    if (!boundaries.some((boundary) => boundary.root.id === boundaryRootId)) {
      continue;
    }
    const connectionRows = connectionRowsForWire(graph, wireId, scope).filter(
      (row) => row.rootIds.includes(boundaryRootId)
    );
    const candidateRows =
      connectionRows.length > 0
        ? connectionRows
        : boundaryRowsForWire(
            graph,
            wireId,
            (boundary) => boundary.root.id === boundaryRootId
          );
    for (const row of candidateRows) {
      if (seenRowIds.has(row.id)) continue;
      seenRowIds.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

function boundaryRowsForWire(
  graph: RelationshipGraph,
  wireId: string,
  filter: (boundary: RelationshipBoundary) => boolean = () => true
): RelationshipTruthRow[] {
  const wire = graph.rootsById.get(wireId);
  if (!wire) return [];
  return (graph.boundariesByWireId.get(wireId) ?? [])
    .filter(filter)
    .map((boundary) => {
      const attachmentIds = boundarySourceAttachmentIds(graph, wireId, boundary);
      const status = boundaryStatus(boundary);
      const items: RelationshipTruthRowItem[] = [
        {
          ref: "",
          label: `wire ${wire.label}`,
          rootId: wire.id,
        },
        {
          ref: "",
          label: boundaryLabel(boundary),
          rootId: boundary.root.id,
          attachmentId: boundary.targetAttachmentId,
        },
      ];
      return {
        id: `boundary-path:${wire.id}:${boundary.root.id}:${
          boundary.targetAttachmentId ?? (attachmentIds.join("|") || "root")
        }`,
        label: items.map((item) => item.label).join(" -> "),
        pathNumber: 0,
        items,
        kind: "boundary_path",
        tone: toneForStatus(status),
        status,
        rootIds: [wire.id, boundary.root.id],
        attachmentIds,
      };
    });
}

function connectionPathRow(
  graph: RelationshipGraph,
  connectionPointId: string
): RelationshipTruthRow {
  const path = traceConnectionPointPath(graph, connectionPointId);
  return {
    id: `connection-path:${connectionPointId}`,
    label: connectionPathItems(path).map((item) => item.label).join(" -> "),
    pathNumber: 0,
    items: connectionPathItems(path),
    kind: "connection_path",
    tone: toneForStatus(path.status),
    status: path.status,
    rootIds: connectionPathRootIds(path),
    attachmentIds: connectionPathAttachmentIds(path),
  };
}

function tracePathRow(
  graph: RelationshipGraph,
  connectionPointId: string
): RelationshipTruthRow {
  const trace = traceConnectionPointReachability(graph, connectionPointId);
  return {
    id: `trace-path:${connectionPointId}`,
    label: trace.steps.map((step) => step.label).join(" -> "),
    pathNumber: 0,
    items: tracePathItems(trace),
    kind: "connection_path",
    tone: toneForStatus(trace.status),
    status: trace.status,
    rootIds: trace.rootIds,
    attachmentIds: trace.attachmentIds,
  };
}

function tracePathItems(trace: RelationshipTrace): RelationshipTruthRowItem[] {
  return trace.steps.map((step) => {
    if (step.kind === "connection_point") {
      return {
        ref: "",
        label: step.label,
        rootId: step.root.id,
        attachmentId: step.attachment.id,
      };
    }
    if (step.kind === "wire") {
      return {
        ref: "",
        label: step.label,
        rootId: step.root.id,
      };
    }
    if (step.kind === "boundary") {
      return {
        ref: "",
        label: step.label,
        rootId: step.boundary.root.id,
        attachmentId: step.boundary.targetAttachmentId,
      };
    }
    return { ref: "", label: step.label };
  });
}

function connectionPathItems(
  path: RelationshipConnectionPointPath
): RelationshipTruthRowItem[] {
  const startLabel = componentConnectionLabel(
    path.startComponent,
    path.startConnectionPoint
  );
  if (!path.wire) {
    return [
      {
        ref: "",
        label: startLabel,
        rootId: path.startComponent?.id,
        attachmentId: path.startConnectionPoint?.id,
      },
      { ref: "", label: "open end" },
    ];
  }

  const items: RelationshipTruthRowItem[] = [
    {
      ref: "",
      label: startLabel,
      rootId: path.startComponent?.id,
      attachmentId: path.startConnectionPoint?.id,
    },
    { ref: "", label: `wire ${path.wire.label}`, rootId: path.wire.id },
  ];
  for (const item of path.connectionPoints) {
    if (item.connectionPoint.id === path.startConnectionPoint?.id) continue;
    items.push({
      ref: "",
      label: componentConnectionLabel(item.component, item.connectionPoint),
      rootId: item.component.id,
      attachmentId: item.connectionPoint.id,
    });
  }
  for (const boundary of path.boundaries) {
    if (
      boundary.root.type === "continuation" ||
      boundary.relation === "continuation_to_object"
    ) {
      items.push({
        ref: "",
        label: `continues ${boundary.root.label}`,
        rootId: boundary.root.id,
        attachmentId: boundary.targetAttachmentId,
      });
    } else if (
      boundary.root.type === "ground_reference" ||
      boundary.relation === "wire_segment_to_ground_reference"
    ) {
      items.push({
        ref: "",
        label: groundBoundaryLabel(boundary.root),
        rootId: boundary.root.id,
        attachmentId: boundary.targetAttachmentId,
      });
    } else {
      items.push({
        ref: "",
        label: boundary.root.label,
        rootId: boundary.root.id,
        attachmentId: boundary.targetAttachmentId,
      });
    }
  }

  if (items.length === 1) {
    items.push({ ref: "", label: path.status });
  }
  return items;
}

function groundBoundaryLabel(root: RelationshipGraphRoot): string {
  const label = root.label.trim();
  return label && label.toLowerCase() !== "ground" ? `ground ${label}` : "ground";
}

function boundaryLabel(boundary: RelationshipBoundary): string {
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

function boundaryStatus(boundary: RelationshipBoundary): RelationshipPathStatus {
  if (
    boundary.root.type === "continuation" ||
    boundary.relation === "continuation_to_object"
  ) {
    return "continues";
  }
  if (
    boundary.root.type === "ground_reference" ||
    boundary.relation === "wire_segment_to_ground_reference"
  ) {
    return "grounded";
  }
  return "ambiguous";
}

function boundarySourceAttachmentIds(
  graph: RelationshipGraph,
  wireId: string,
  boundary: RelationshipBoundary
): string[] {
  const ids: Array<string | null | undefined> = [
    boundary.sourceParentAttachmentId,
    boundary.sourceAttachmentId,
  ];
  for (const attachment of graph.attachmentsById.values()) {
    if (
      !boundary.sourceAttachmentId &&
      attachment.relation === "wire_segment_to_ground_reference" &&
      attachment.ownerId === wireId &&
      attachment.linkedBoxId === boundary.root.id
    ) {
      ids.push(attachment.parentAttachmentId, attachment.id);
    }
    if (
      !boundary.sourceAttachmentId &&
      attachment.relation === "continuation_to_object" &&
      attachment.ownerId === boundary.root.id &&
      attachment.linkedBoxId === wireId
    ) {
      ids.push(attachment.linkedAttachmentId, attachment.id);
    }
  }
  if (boundary.targetAttachmentId) ids.push(boundary.targetAttachmentId);
  return uniqueCompact(ids);
}

function connectionPointIdForSelectedAttachment(
  attachment: RelationshipGraphAttachment
): string | null {
  if (attachment.type !== "connection_point") return null;
  return attachment.linkedAttachmentId || attachment.id;
}

function connectionPointsOwnedBy(
  graph: RelationshipGraph,
  ownerId: string
): RelationshipGraphAttachment[] {
  return [...graph.attachmentsById.values()]
    .filter(
      (attachment) =>
        attachment.ownerId === ownerId &&
        attachment.type === "connection_point" &&
        !attachment.linkedAttachmentId
    )
    .sort((left, right) =>
      left.text.localeCompare(right.text, undefined, { numeric: true })
    );
}

function componentConnectionLabel(
  component: RelationshipGraphRoot | null,
  connectionPoint: RelationshipGraphAttachmentRef | null
): string {
  const componentLabel = component?.label || "Unknown";
  const pointLabel = connectionPoint?.text || "connection";
  return `${componentLabel}:${pointLabel}`;
}

function toneForStatus(status: RelationshipPathStatus): RelationshipTruthTone {
  if (status === "open end") return "open";
  return status;
}

function connectionPathRootIds(path: RelationshipConnectionPointPath): string[] {
  return uniqueCompact([
    path.startComponent?.id,
    path.wire?.id,
    ...path.connectionPoints.map((item) => item.component.id),
    ...path.boundaries.map((boundary) => boundary.root.id),
  ]);
}

function connectionPathAttachmentIds(
  path: RelationshipConnectionPointPath
): string[] {
  return uniqueCompact([
    path.startConnectionPoint?.id,
    ...path.connectionPoints.map((item) => item.connectionPoint.id),
    ...path.boundaries.flatMap((boundary) => [
      boundary.sourceParentAttachmentId,
      boundary.sourceAttachmentId,
    ]),
    ...path.boundaries.map((boundary) => boundary.targetAttachmentId),
  ]);
}

function uniqueCompact(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function numberRows(rows: RelationshipTruthRow[]): RelationshipTruthRow[] {
  return rows.map((row, rowIndex) => {
    const pathNumber = rowIndex + 1;
    return {
      ...row,
      pathNumber,
      items: row.items.map((item, itemIndex) => ({
        ...item,
        ref: `${pathNumber}.${itemIndex + 1}`,
      })),
    };
  });
}
