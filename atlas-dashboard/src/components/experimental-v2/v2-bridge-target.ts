// Resolve what a page-space point is "on": the copilot's answer to
// "what is Shane pointing at". Pure; used when reporting pen events.

import { projectOntoSegment } from "./v2-snapping.ts";
import type { PageGeometry } from "./v2-snapping.ts";
import type { NetColoring } from "./v2-nets";
import type { V2Graph } from "./experimental-v2-types";
import type { PenTarget, Point } from "./v2-bridge-types";

const SEGMENT_HIT_PX = 14;
const ELEMENT_HIT_PX = 14;

export function resolvePenTarget(
  point: Point,
  geometry: PageGeometry | null,
  netColoring: NetColoring | null,
  graph: V2Graph
): PenTarget | undefined {
  const target: PenTarget = {};

  if (geometry) {
    let bestIdx = -1;
    let bestDist = SEGMENT_HIT_PX;
    for (let i = 0; i < geometry.segments.length; i++) {
      const proj = projectOntoSegment(point, geometry.segments[i]);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      target.segment_index = bestIdx;
      const s = geometry.segments[bestIdx];
      // Ship the printed line's real endpoints: the copilot grounds geometry
      // judgments on these instead of a second capture-and-eyeball pass.
      target.segment = {
        x1: Math.round(s.x1),
        y1: Math.round(s.y1),
        x2: Math.round(s.x2),
        y2: Math.round(s.y2),
      };
      if (netColoring) {
        const netId = netColoring.segmentNetId[bestIdx];
        if (netId >= 0) target.net_id = netId;
      }
    }
  }

  // Drawn overlay elements (the copilot's own work): ports beat wires because
  // a point target is more specific than the line through it.
  let bestEl: { id: string; kind: "wire" | "terminal" | "junction"; label: string | null; d: number } | null = null;
  for (const p of graph.ports) {
    const d = Math.hypot(p.point.x - point.x, p.point.y - point.y);
    if (d <= ELEMENT_HIT_PX && (!bestEl || d < bestEl.d)) {
      bestEl = { id: p.id, kind: p.type === "junction" ? "junction" : "terminal", label: p.label ?? null, d };
    }
  }
  if (!bestEl) {
    for (const e of graph.edges) {
      for (let i = 0; i + 1 < e.path.length; i++) {
        const proj = projectOntoSegment(point, {
          x1: e.path[i].x,
          y1: e.path[i].y,
          x2: e.path[i + 1].x,
          y2: e.path[i + 1].y,
        });
        if (proj.distance <= ELEMENT_HIT_PX && (!bestEl || proj.distance < bestEl.d)) {
          bestEl = { id: e.id, kind: "wire", label: e.label ?? null, d: proj.distance };
        }
      }
    }
  }
  if (bestEl) {
    target.element_id = bestEl.id;
    target.element_kind = bestEl.kind;
    target.element_label = bestEl.label;
    target.element_distance_px = Math.round(bestEl.d);
  }

  const node = graph.nodes.find(
    (n) =>
      point.x >= n.bbox.x &&
      point.x <= n.bbox.x + n.bbox.width &&
      point.y >= n.bbox.y &&
      point.y <= n.bbox.y + n.bbox.height
  );
  if (node) {
    target.component_id = node.id;
    target.component_label = node.label;
  }

  // Grounds are first-class BOXED elements, not points (Shane, 2026-07-08): a
  // tap inside a ground box resolves to the GROUND itself, so its label lands
  // in the target (a blessed ground is categorized by its family, e.g. PE/GND,
  // not treated as a bare point). Wins over the wire passing through / border
  // terminals because the ground box is the specific subject of the gesture.
  const ground = (graph.grounds ?? []).find(
    (g) =>
      point.x >= g.bbox.x &&
      point.x <= g.bbox.x + g.bbox.width &&
      point.y >= g.bbox.y &&
      point.y <= g.bbox.y + g.bbox.height
  );
  if (ground) {
    target.element_id = ground.id;
    target.element_kind = "ground";
    target.element_label = ground.label;
  }

  return Object.keys(target).length > 0 ? target : undefined;
}
