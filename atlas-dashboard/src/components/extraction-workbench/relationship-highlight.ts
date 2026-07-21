import type { RelationshipTruthRow } from "./relationship-truth-rows.ts";

export type RelationshipPathColor = {
  pathNumber: number;
  stroke: string;
  border: string;
  fill: string;
  glow: string;
  panelBackground: string;
  text: string;
};

export type RelationshipHighlight = {
  rowIds: string[];
  pathNumbers: number[];
  primaryPathNumber: number;
  color: RelationshipPathColor;
};

export type RelationshipHighlightMap = {
  rootById: Map<string, RelationshipHighlight>;
  attachmentById: Map<string, RelationshipHighlight>;
};

const PATH_COLORS: Omit<RelationshipPathColor, "pathNumber">[] = [
  {
    stroke: "rgba(34, 211, 238, 0.98)",
    border: "rgba(165, 243, 252, 0.95)",
    fill: "rgba(34, 211, 238, 0.14)",
    glow: "rgba(34, 211, 238, 0.55)",
    panelBackground: "rgba(34, 211, 238, 0.1)",
    text: "rgba(207, 250, 254, 0.98)",
  },
  {
    stroke: "rgba(251, 191, 36, 0.98)",
    border: "rgba(253, 230, 138, 0.95)",
    fill: "rgba(251, 191, 36, 0.14)",
    glow: "rgba(251, 191, 36, 0.52)",
    panelBackground: "rgba(251, 191, 36, 0.1)",
    text: "rgba(254, 243, 199, 0.98)",
  },
  {
    stroke: "rgba(167, 139, 250, 0.98)",
    border: "rgba(221, 214, 254, 0.95)",
    fill: "rgba(167, 139, 250, 0.14)",
    glow: "rgba(167, 139, 250, 0.54)",
    panelBackground: "rgba(167, 139, 250, 0.1)",
    text: "rgba(237, 233, 254, 0.98)",
  },
  {
    stroke: "rgba(52, 211, 153, 0.98)",
    border: "rgba(167, 243, 208, 0.95)",
    fill: "rgba(52, 211, 153, 0.14)",
    glow: "rgba(52, 211, 153, 0.52)",
    panelBackground: "rgba(52, 211, 153, 0.1)",
    text: "rgba(209, 250, 229, 0.98)",
  },
  {
    stroke: "rgba(244, 114, 182, 0.98)",
    border: "rgba(251, 207, 232, 0.95)",
    fill: "rgba(244, 114, 182, 0.14)",
    glow: "rgba(244, 114, 182, 0.52)",
    panelBackground: "rgba(244, 114, 182, 0.1)",
    text: "rgba(252, 231, 243, 0.98)",
  },
  {
    stroke: "rgba(96, 165, 250, 0.98)",
    border: "rgba(191, 219, 254, 0.95)",
    fill: "rgba(96, 165, 250, 0.14)",
    glow: "rgba(96, 165, 250, 0.52)",
    panelBackground: "rgba(96, 165, 250, 0.1)",
    text: "rgba(219, 234, 254, 0.98)",
  },
];

export function relationshipPathColor(pathNumber: number): RelationshipPathColor {
  const index = Math.max(0, pathNumber - 1) % PATH_COLORS.length;
  return { pathNumber, ...PATH_COLORS[index] };
}

export function buildRelationshipHighlightMap(
  rows: RelationshipTruthRow[]
): RelationshipHighlightMap {
  const rootById = new Map<string, RelationshipHighlight>();
  const attachmentById = new Map<string, RelationshipHighlight>();

  for (const row of rows) {
    for (const rootId of row.rootIds) {
      addHighlight(rootById, rootId, row);
    }
    for (const attachmentId of row.attachmentIds) {
      addHighlight(attachmentById, attachmentId, row);
    }
  }

  return { rootById, attachmentById };
}

function addHighlight(
  map: Map<string, RelationshipHighlight>,
  id: string,
  row: RelationshipTruthRow
) {
  const existing = map.get(id);
  if (!existing) {
    map.set(id, {
      rowIds: [row.id],
      pathNumbers: [row.pathNumber],
      primaryPathNumber: row.pathNumber,
      color: relationshipPathColor(row.pathNumber),
    });
    return;
  }

  if (!existing.rowIds.includes(row.id)) {
    existing.rowIds.push(row.id);
  }
  if (!existing.pathNumbers.includes(row.pathNumber)) {
    existing.pathNumbers.push(row.pathNumber);
    existing.pathNumbers.sort((left, right) => left - right);
  }
}
