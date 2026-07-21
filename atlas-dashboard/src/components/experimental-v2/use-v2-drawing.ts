"use client";

import { useState } from "react";
import type {
  V2Node,
  V2Port,
  V2Graph,
  V2Tool,
  V2ComponentIdentity,
} from "./experimental-v2-types";
import { type Point, distance, pointInRect, mateParentsAt } from "./v2-geometry.ts";
import { type PageGeometry, type SnapResult, snapPoint } from "./v2-snapping.ts";
import { interpretWireStroke, interpretComponentStroke, detectBorderCrossings, cableLabelNear } from "./v2-intent.ts";
import { extractStripRows, rowForY, ensureRowConduction, stripTitleAbove, STRIP_MIN_ROWS } from "./v2-strip.ts";
import { adoptEndpointAt, inferWireNet, knownNetOf, nameEndpointsFromNet } from "./v2-graph-ops.ts";
import { type V2Settings, enabledSnapKinds } from "./v2-settings.ts";
import { printedRefAt } from "./v2-continuation-links.ts";

// Re-exported for backwards compatibility with existing imports/tests.
export { getNearestPointOnRect } from "./v2-geometry.ts";

const newId = (kind: string) => `${kind}-${crypto.randomUUID()}`;
const PORT_REUSE_PX = 10; // wire endpoints this close share one terminal

function nextLabel(existing: { label: string }[], prefix: string): string {
  const re = new RegExp(`^${prefix}-?(\\d+)$`, "i");
  let max = 0;
  for (const e of existing) {
    const m = e.label.match(re);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return `${prefix}${prefix.length > 1 ? "-" : ""}${max + 1}`;
}

// Parse a boxed cross-reference like "12/9" or "11-24" into sheet/zone.
function parseRef(ref: string | null): { sheet: string | null; zone: string | null } {
  if (!ref) return { sheet: null, zone: null };
  const m = ref.match(/^\s*(\w+)\s*[/\-]\s*(\w+)\s*$/);
  return m ? { sheet: m[1], zone: m[2] } : { sheet: null, zone: null };
}

export type V2DrawingOptions = {
  geometry?: PageGeometry | null;
  settings: V2Settings;
  // Resolve a component's mark + full identity from the symbol bank (YOLO
  // zone-ranker). Label is null when no confident mark is found (-> auto-name).
  resolveComponent?: (box: { x: number; y: number; width: number; height: number }) => {
    label: string | null;
    identity: V2ComponentIdentity | null;
  };
};

export function useV2Drawing(
  graph: V2Graph,
  setGraph: (updater: (draft: V2Graph) => void) => void,
  tool: V2Tool,
  options: V2DrawingOptions
) {
  const { settings } = options;
  const geom = settings.snapEnabled ? options.geometry ?? null : null;
  const radius = settings.snapRadiusPx;
  const kinds = enabledSnapKinds(settings);

  const [stroke, setStroke] = useState<Point[] | null>(null);
  const [geometrySnap, setGeometrySnap] = useState<SnapResult | null>(null);

  const snapAt = (p: Point): SnapResult | null => (geom ? snapPoint(p, geom, radius, kinds) : null);
  const placed = (p: Point): Point => snapAt(p)?.point ?? p;

  // Reuse an existing terminal at this point, else create one (parented to the
  // component it lands in). Returns the port id.
  const ensurePort = (draft: V2Graph, point: Point, label: string | null): string => {
    const existing = draft.ports.find((p) => distance(p.point, point) <= PORT_REUSE_PX);
    if (existing) return existing.id;
    const node = draft.nodes.find((n) => pointInRect(point, n.bbox));
    const port: V2Port = {
      id: newId("port"),
      parentId: node ? node.id : "",
      type: "terminal",
      point,
      label: label ?? nextLabel(draft.ports, "T"),
    };
    draft.ports.push(port);
    return port.id;
  };

  const handlePointerDown = (coords: Point) => {
    if (tool === "component" || tool === "freehand" || tool === "wire" || tool === "connector" || tool === "cable") {
      setStroke([coords]);
    }
  };

  const handlePointerMove = (coords: Point) => {
    if (stroke) setStroke((prev) => (prev ? [...prev, coords] : prev));
    setGeometrySnap(tool !== "select" ? snapAt(coords) : null);
  };

  const handlePointerUp = (coords: Point) => {
    if (stroke && (tool === "component" || tool === "freehand" || tool === "wire" || tool === "connector" || tool === "cable")) {
      const pts = stroke.length >= 2 ? stroke : [stroke[0] ?? coords, coords];
      if (tool === "component") commitComponentBox(pts[0], coords);
      else if (tool === "freehand") commitComponent(pts);
      else if (tool === "connector") commitConnectorBox(pts[0], coords);
      else if (tool === "cable") commitCable(pts[0], coords);
      else commitWire(pts);
      setStroke(null);
      setGeometrySnap(null);
      return;
    }
    if (tool === "terminal") commitTerminal(coords);
    else if (tool === "continuation") commitContinuation(coords);
    setGeometrySnap(null);
  };

  // --- Commits ---------------------------------------------------------------
  // Component box (Shane 2026-07-09: "the component tool is supposed to click
  // to drag a box... there's supposed to be a freehand tool too — they got
  // combined"): a rubber-band rectangle, same interaction as the connector —
  // the rect he drags is exactly the box he gets. The symbol bank still
  // resolves the printed designator; the encircle-and-snap gesture lives on
  // as the separate `freehand` tool (commitComponent below).
  const commitComponentBox = (anchor: Point, corner: Point) => {
    const bbox = {
      x: Math.min(anchor.x, corner.x),
      y: Math.min(anchor.y, corner.y),
      width: Math.abs(corner.x - anchor.x),
      height: Math.abs(corner.y - anchor.y),
    };
    if (bbox.width < 8 || bbox.height < 8) return; // degenerate click, not a drag
    const resolved = settings.autoLabelComponents ? options.resolveComponent?.(bbox) : undefined;
    // Ghost terminals become real on commit (Shane, 2026-07-09): every printed
    // conductor crossing the box border mints a terminal there, named per the
    // convention T~<owner>~[<pin>~]<net> — net from the printed wire number
    // along the run, pin from the printed designator just inside the border.
    // The same crossings the drag previewed — print evidence, no guesswork.
    const crossings = detectBorderCrossings(bbox, geom, 8, settings.netLabelWalkPx, resolved?.label ?? null);
    // Terminal strips (Shane, 2026-07-10): a box containing a printed pin
    // table classifies as a strip — its ROWS dictate the terminal pin slots
    // (T~TB30~20~N24), beating the nearest-text pin heuristic (which would
    // grab the signal NAME). Rows conduct in paired sets, minted lazily.
    const stripRows = extractStripRows(bbox, geom);
    const isStrip = stripRows.length >= STRIP_MIN_ROWS;
    // Strip designators print ABOVE the tight box — they beat the resolver,
    // whose inside zone would pick the table's own header ("NAME").
    const stripTitle = isStrip ? stripTitleAbove(bbox, geom) : null;
    setGraph((draft) => {
      const nodeId = newId("node");
      const compLabel = stripTitle ?? resolved?.label ?? nextLabel(draft.nodes, "COMP");
      // Clone rows PER INVOCATION: StrictMode double-invokes this updater,
      // and mutating the captured extraction would accumulate portIds from
      // the discarded first run (stale ids on real rows).
      const rows = isStrip ? stripRows.map((r) => ({ ...r, portIds: [] as string[] })) : null;
      const node: typeof draft.nodes[number] = {
        id: nodeId,
        type: "component",
        bbox,
        label: compLabel,
        identity: resolved?.identity ?? null,
        ...(rows ? { kind: "strip" as const, rows } : {}),
      };
      draft.nodes.push(node);
      for (const c of crossings) {
        const row = rows ? rowForY(rows, c.point.y) : null;
        const pinSlot = row ? `${row.pin}~` : c.pinLabel ? `${c.pinLabel}~` : "";
        // ADOPT a pre-existing wire endpoint first (Shane's catch, 2026-07-10:
        // boxing over already-wired endpoints minted duplicates beside them).
        // The endpoint keeps its wire; it gains the owner, the border seat,
        // and its row name.
        const adopted = adoptEndpointAt(draft, nodeId, c.point);
        if (adopted) {
          const net = c.netLabel ?? knownNetOf(draft, adopted);
          if (net) adopted.label = `T~${compLabel}~${pinSlot}${net}`;
          if (row) row.portIds.push(adopted.id);
          continue;
        }
        // A port owned by someone else at this spot: never steal, never double.
        const existing = draft.ports.find((p) => distance(p.point, c.point) <= PORT_REUSE_PX);
        if (existing) {
          if (row && existing.parentId === nodeId) row.portIds.push(existing.id);
          continue;
        }
        const portId = newId("port");
        draft.ports.push({
          id: portId,
          parentId: nodeId,
          type: "terminal",
          point: { ...c.point },
          label: c.netLabel
            ? `T~${compLabel}~${pinSlot}${c.netLabel}`
            : nextLabel(draft.ports, "T"),
        });
        if (row) row.portIds.push(portId);
      }
      if (isStrip) ensureRowConduction(draft, node, () => newId("edge"));
    });
  };

  const commitComponent = (pts: Point[]) => {
    const intent = interpretComponentStroke(pts, geom, {
      autoLabel: settings.autoLabelComponents,
      snapRadiusPx: radius,
      kinds,
    });
    if (intent.bbox.width < 8 || intent.bbox.height < 8) return;
    // Prefer the symbol mark + identity (bank-backed) over the inside-box guess.
    const resolved = settings.autoLabelComponents ? options.resolveComponent?.(intent.bbox) : undefined;
    const markLabel = resolved?.label ?? (settings.autoLabelComponents ? intent.label : null);
    const identity: V2ComponentIdentity | null = resolved?.identity ?? null;
    setGraph((draft) => {
      draft.nodes.push({
        id: newId("node"),
        type: "component",
        bbox: intent.bbox,
        label: markLabel ?? nextLabel(draft.nodes, "COMP"),
        identity,
      });
    });
  };

  // Connector box (Shane's interaction, 2026-07-09): a RUBBER-BAND rectangle —
  // anchor at pointer-down, opposite corner at pointer-up. No encircle
  // interpretation, no artwork-union snap: connector tables are empty boxes on
  // the print, and the rect he drags is exactly the rect he gets. Pins come
  // afterwards via Ctrl+click (screen's onConnectorPin).
  const commitConnectorBox = (anchor: Point, corner: Point) => {
    const bbox = {
      x: Math.min(anchor.x, corner.x),
      y: Math.min(anchor.y, corner.y),
      width: Math.abs(corner.x - anchor.x),
      height: Math.abs(corner.y - anchor.y),
    };
    if (bbox.width < 8 || bbox.height < 8) return; // degenerate click, not a drag
    // Still ask the symbol bank for the printed designator (e.g. "CON23").
    const resolved = settings.autoLabelComponents ? options.resolveComponent?.(bbox) : undefined;
    setGraph((draft) => {
      draft.nodes.push({
        id: newId("node"),
        type: "component",
        bbox,
        label: resolved?.label ?? nextLabel(draft.nodes, "CON"),
        identity: resolved?.identity ?? null,
      });
    });
  };

  // Cable (Shane's design, 2026-07-10 v2): a BBOX around the printed cable
  // symbol — annotations are YOLO training data, so the cable is a detection
  // target like every other element, never a polyline. It NEVER conducts.
  // Touch-to-link happens screen-side (the auto-adopt effect watches cables);
  // the same rect the drag previews — with its chain-link ghosts — is the
  // rect that commits.
  const commitCable = (anchor: Point, corner: Point) => {
    const bbox = {
      x: Math.round(Math.min(anchor.x, corner.x)),
      y: Math.round(Math.min(anchor.y, corner.y)),
      width: Math.round(Math.abs(corner.x - anchor.x)),
      height: Math.round(Math.abs(corner.y - anchor.y)),
    };
    if (bbox.width < 12 || bbox.height < 8) return; // degenerate click, not a drag
    const printed = cableLabelNear(bbox, geom);
    setGraph((draft) => {
      if (!draft.cables) draft.cables = [];
      const label = printed ?? nextLabel(draft.cables, "CABLE");
      draft.cables.push({ id: newId("cable"), type: "cable", label, bbox });
    });
  };

  const commitWire = (pts: Point[]) => {
    const intent = interpretWireStroke(pts, geom, {
      snapRadiusPx: radius,
      corridorPx: settings.corridorPx,
      autoLabel: settings.autoLabelWires,
      kinds,
    });
    // Ignore a degenerate tap.
    if (distance(intent.path[0], intent.path[intent.path.length - 1]) < PORT_REUSE_PX) return;

    setGraph((draft) => {
      const srcLabel =
        settings.autoLabelTerminals && intent.source.kind === "terminal"
          ? (intent.source as SnapResult).label ?? null
          : null;
      const tgtLabel =
        settings.autoLabelTerminals && intent.target.kind === "terminal"
          ? (intent.target as SnapResult).label ?? null
          : null;
      const sId = ensurePort(draft, intent.path[0], srcLabel);
      const tId = ensurePort(draft, intent.path[intent.path.length - 1], tgtLabel);
      if (sId === tId) return;
      // Net inference (Shane, 2026-07-11): a run with no printed number of
      // its own inherits its net — endpoint agreement, or THROUGH a
      // pass-through device (THR2's motor phases: "the names should be
      // inferred from the THR2 connection. U2, V2 and W2"). Generic endpoint
      // names (T-39 style) get repaired to the convention with it.
      const inferred =
        settings.autoLabelWires && !intent.label ? inferWireNet(draft, sId, tId) : null;
      if (inferred) nameEndpointsFromNet(draft, [sId, tId], inferred);
      draft.edges.push({
        id: newId("edge"),
        sourcePortId: sId,
        targetPortId: tId,
        path: intent.path,
        label: settings.autoLabelWires ? intent.label ?? inferred : null,
      });
    });
  };

  const commitTerminal = (coords: Point) => {
    const snap = snapAt(coords);
    const point = snap?.point ?? coords;
    setGraph((draft) => {
      // Mate awareness (Shane, 2026-07-09): touching terminals CONDUCT.
      const borders = mateParentsAt(point, draft.nodes);
      const existing = draft.ports.find((p) => distance(p.point, point) <= PORT_REUSE_PX);
      if (existing) {
        // Tapping a second component's border onto an existing single-parent
        // terminal UPGRADES it to a mate — instead of the silent reuse swallow.
        const other = borders.find((id) => id !== existing.parentId && id !== existing.parentId2);
        if (existing.type === "terminal" && existing.parentId && other) {
          existing.type = "mate";
          existing.parentId2 = other;
        }
        return; // never mint a duplicate on top
      }
      const label =
        settings.autoLabelTerminals && snap?.kind === "terminal" && snap.label ? snap.label : null;
      if (borders.length === 2) {
        // One tap at a shared flush border = ONE mate terminal, both parents.
        draft.ports.push({
          id: newId("port"),
          parentId: borders[0],
          parentId2: borders[1],
          type: "mate",
          point,
          label: label ?? nextLabel(draft.ports, "T"),
        });
        return;
      }
      ensurePort(draft, point, label);
    });
  };

  const commitContinuation = (coords: Point) => {
    const snap = snapAt(coords);
    const point = snap?.point ?? coords;
    // Fraction-aware ref read (Shane, 2026-07-11): printed refs are often
    // stacked digit tokens ('3','2' over '9' = 32/9) — the old nearest-token
    // read grabbed ONE DIGIT. printedRefAt clusters runs and pairs them.
    const printed = geom ? printedRefAt(geom.texts, point) : null;
    const ref = printed?.rawRef ?? (geom ? nearestRefToken(geom, point) : null);
    const { sheet, zone } = printed ?? parseRef(ref);
    setGraph((draft) => {
      let target: { kind: "port" | "component" | "cable"; id: string } | null = null;
      // Attach reach = the continuation-snap setting (not the wire snap):
      // refs print far from the endpoint they serve; the operator tunes this.
      const port = draft.ports.find((p) => distance(p.point, point) <= settings.contSnapPx);
      if (port) target = { kind: "port", id: port.id };
      else {
        const node = draft.nodes.find((n) => pointInRect(point, n.bbox));
        if (node) target = { kind: "component", id: node.id };
        else {
          // A ref placed on a cable box is a CABLE continuation (Shane,
          // 2026-07-11) — the cable continues at that sheet; no endpoint.
          const cab = (draft.cables ?? []).find((cb) => pointInRect(point, cb.bbox));
          if (cab) target = { kind: "cable", id: cab.id };
        }
      }
      draft.continuations.push({
        id: newId("cont"),
        type: "continuation",
        point,
        sheet,
        zone,
        rawRef: ref,
        target,
      });
    });
  };

  return {
    stroke,
    geometrySnap,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}

// Nearest text token to a point (for continuation cross-ref capture).
function nearestRefToken(geom: PageGeometry, point: Point): string | null {
  let best: string | null = null;
  let bestD = 60;
  for (const t of geom.texts) {
    const token = t.text.trim();
    if (!token) continue;
    const d = distance(point, t.center);
    if (d < bestD) {
      bestD = d;
      best = token;
    }
  }
  return best;
}
