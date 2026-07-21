import {
  auditCanonicalWireAnnotations,
  type CanonicalWireIssue,
} from "./wire-canonical-audit.ts";
import {
  buildRelationshipGraph,
  traceConnectionPointReachability,
  type RelationshipGraph,
  type RelationshipGraphAnnotation,
  type RelationshipGraphAnnotationAttachment,
  type RelationshipGraphBbox,
  type RelationshipPathStatus,
} from "./relationship-graph.ts";

type WorkbenchAnnotationForReport = RelationshipGraphAnnotation & {
  updatedAt?: string | null;
  updated_at?: string | null;
  metadata?: RelationshipGraphAnnotation["metadata"] & {
    wireGeometry?: {
      segments?: Array<{ bbox?: RelationshipGraphBbox | null }> | null;
    } | null;
  } | null;
};

export type PageValidationTraceCheck = {
  label: string;
  connectionPoint: string;
};

export type PageValidationReportOptions = {
  traceChecks?: PageValidationTraceCheck[];
};

export type PageValidationTraceResult = PageValidationTraceCheck & {
  found: boolean;
  status: RelationshipPathStatus | "missing";
  steps: string[];
  rootIds: string[];
  attachmentIds: string[];
};

export type PageValidationReport = {
  annotationCount: number;
  rootCounts: Record<string, number>;
  latestUpdatedAt: string | null;
  relationshipCounts: {
    wireEndpoints: number;
    endpointLinks: number;
    groundLinks: number;
    continuationLinks: number;
    wireContinuityLinks: number;
  };
  groundContactCounts: Record<string, number>;
  groundBoundaries: Array<{
    wireId: string;
    wireLabel: string;
    groundId: string;
    groundLabel: string;
    sourceAttachmentId: string | null;
    sourceParentAttachmentId: string | null;
    wireContactKind: string | null;
  }>;
  canonicalWireAudit: {
    issueCount: number;
    byKind: Record<string, number>;
    issues: CanonicalWireIssue[];
  };
  traceChecks: PageValidationTraceResult[];
};

export function buildPageValidationReport(
  annotations: WorkbenchAnnotationForReport[],
  options: PageValidationReportOptions = {}
): PageValidationReport {
  const graph = buildRelationshipGraph(annotations);
  const issues = auditCanonicalWireAnnotations(annotations);

  return {
    annotationCount: annotations.length,
    rootCounts: rootCounts(annotations),
    latestUpdatedAt: latestUpdatedAt(annotations),
    relationshipCounts: relationshipCounts(annotations),
    groundContactCounts: groundContactCounts(graph),
    groundBoundaries: groundBoundaries(graph),
    canonicalWireAudit: {
      issueCount: issues.length,
      byKind: countBy(issues, (issue) => issue.kind),
      issues,
    },
    traceChecks: (options.traceChecks ?? []).map((check) =>
      traceCheck(graph, check)
    ),
  };
}

function rootCounts(annotations: WorkbenchAnnotationForReport[]) {
  const counts: Record<string, number> = {};
  for (const annotation of annotations) {
    const type = rootTypeOf(annotation);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return sortRecord(counts);
}

function relationshipCounts(annotations: WorkbenchAnnotationForReport[]) {
  const attachments = annotations.flatMap(attachmentsOf);
  return {
    wireEndpoints: attachments.filter(
      (attachment) => attachment.type === "wire_endpoint"
    ).length,
    endpointLinks: attachments.filter(
      (attachment) =>
        attachment.relation === "wire_segment_endpoint_to_connection_point"
    ).length,
    groundLinks: attachments.filter(
      (attachment) => attachment.relation === "wire_segment_to_ground_reference"
    ).length,
    continuationLinks: attachments.filter(
      (attachment) =>
        attachment.relation === "continuation_to_object" ||
        attachment.relation === "object_to_continuation"
    ).length,
    wireContinuityLinks: attachments.filter(
      (attachment) => attachment.relation === "wire_segment_to_wire_segment"
    ).length,
  };
}

function groundContactCounts(graph: RelationshipGraph) {
  return sortRecord(
    countBy(groundBoundaries(graph), (boundary) =>
      boundary.wireContactKind ?? "unknown"
    )
  );
}

function groundBoundaries(graph: RelationshipGraph) {
  return [...graph.boundariesByWireId.entries()]
    .flatMap(([wireId, boundaries]) =>
      boundaries
        .filter((boundary) => boundary.relation === "wire_segment_to_ground_reference")
        .map((boundary) => ({
          wireId,
          wireLabel: graph.rootsById.get(wireId)?.label ?? "",
          groundId: boundary.root.id,
          groundLabel: boundary.root.label,
          sourceAttachmentId: boundary.sourceAttachmentId ?? null,
          sourceParentAttachmentId: boundary.sourceParentAttachmentId ?? null,
          wireContactKind: boundary.wireContactKind ?? null,
        }))
    )
    .sort((left, right) =>
      `${left.wireLabel}:${left.groundLabel}:${left.sourceAttachmentId ?? ""}`.localeCompare(
        `${right.wireLabel}:${right.groundLabel}:${right.sourceAttachmentId ?? ""}`,
        undefined,
        { numeric: true }
      )
    );
}

function traceCheck(
  graph: RelationshipGraph,
  check: PageValidationTraceCheck
): PageValidationTraceResult {
  const connectionPointId = connectionPointIdByLabel(
    graph,
    check.label,
    check.connectionPoint
  );
  if (!connectionPointId) {
    return {
      ...check,
      found: false,
      status: "missing",
      steps: [],
      rootIds: [],
      attachmentIds: [],
    };
  }

  const trace = traceConnectionPointReachability(graph, connectionPointId);
  return {
    ...check,
    found: true,
    status: trace.status,
    steps: trace.steps.map((step) => step.label),
    rootIds: trace.rootIds,
    attachmentIds: trace.attachmentIds,
  };
}

function connectionPointIdByLabel(
  graph: RelationshipGraph,
  rootLabel: string,
  connectionPointText: string
) {
  const normalizedRootLabel = normalize(rootLabel);
  const normalizedConnectionPointText = normalize(connectionPointText);
  const root = [...graph.rootsById.values()].find(
    (candidate) => normalize(candidate.label) === normalizedRootLabel
  );
  if (!root) return null;

  const connectionPoint = [...graph.attachmentsById.values()].find(
    (attachment) =>
      attachment.ownerId === root.id &&
      attachment.type === "connection_point" &&
      !attachment.linkedAttachmentId &&
      normalize(attachment.text) === normalizedConnectionPointText
  );
  return connectionPoint?.id ?? null;
}

function latestUpdatedAt(annotations: WorkbenchAnnotationForReport[]) {
  return (
    annotations
      .map((annotation) => annotation.updatedAt ?? annotation.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

function attachmentsOf(
  annotation: WorkbenchAnnotationForReport
): RelationshipGraphAnnotationAttachment[] {
  return Array.isArray(annotation.metadata?.attachments)
    ? annotation.metadata.attachments
    : [];
}

function rootTypeOf(annotation: WorkbenchAnnotationForReport) {
  return annotation.metadata?.rootType ?? annotation.rootType ?? annotation.type ?? "component";
}

function countBy<T>(
  values: T[],
  keyForValue: (value: T) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyForValue(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortRecord(record: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalize(value: string) {
  return value.trim().toUpperCase();
}
