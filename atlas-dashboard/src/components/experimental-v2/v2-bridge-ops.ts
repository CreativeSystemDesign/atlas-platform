// Apply copilot `annotate` ops to a V2Graph draft. Pure — runs inside the
// screen's updateGraph() so undo/redo and Neon persistence apply as if Shane
// drew it himself. Mirrors the element-minting rules in use-v2-drawing.

import type { V2Graph, V2Port } from "./experimental-v2-types";
import { mateParentsAt } from "./v2-geometry.ts";
import { mintConnectorPair } from "./v2-connector.ts";
import { adoptEndpointAt, clearGraph, clearLayers, deleteElement, inferWireNet, knownNetOf, moveContinuation, moveTerminal, nameEndpointsFromNet, renameElement, reparentPort, resizeBoxWithTerminals } from "./v2-graph-ops.ts";
import { detectBorderCrossings, groundBorderTerminals, cableLabelNear } from "./v2-intent.ts";
import { extractStripRows, rowForY, ensureRowConduction, stripTitleAbove, stripsTouchingBox, STRIP_MIN_ROWS } from "./v2-strip.ts";
import { attachTextToComponent, removeAttachment } from "./v2-attachments.ts";
import { DEFAULT_SNAP_RADIUS_PX, snapPoint, groundClusterAtPoint, nearestText, type PageGeometry } from "./v2-snapping.ts";
import type { SymbolBankEntry, WireLabelBankEntry } from "../extraction-workbench/studio-types";
import type { AnnotateOp, Point } from "./v2-bridge-types";

const PORT_REUSE_PX = 12; // keep in sync with use-v2-drawing
// Slate 4.3: wire endpoints bind to EXISTING graph ports before any artwork
// snap (terminal-first). Starts near the proven 12px reuse radius; calibrate
// upward only with receipts naming the reused terminal.
const BIND_RADIUS_PX = 15;
// Slate 4.3: a snap displacement past this is kept RAW and reported — silent
// mutation becomes visible imprecision (snap once moved a point 16px and the
// turn said nothing; legit snaps on printed runs land 0-1px).
const SNAP_SILENT_MAX_PX = 8;

const newId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function nextLabel(existing: { label: string }[], prefix: string): string {
  let n = existing.length + 1;
  while (existing.some((e) => e.label === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

const JUNCTION_ON_PATH_PX = 6; // wire end lands ON another wire => tap, not terminal

function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function findWirePathHit(
  draft: V2Graph,
  point: Point,
  excludeEdgeId?: string
): { edge: V2Graph["edges"][number]; segIndex: number } | null {
  for (const e of draft.edges) {
    if (excludeEdgeId && e.id === excludeEdgeId) continue;
    for (let i = 0; i + 1 < e.path.length; i++) {
      if (distToSegment(point, e.path[i], e.path[i + 1]) <= JUNCTION_ON_PATH_PX) {
        return { edge: e, segIndex: i };
      }
    }
  }
  return null;
}

function onExistingWirePath(draft: V2Graph, point: Point): boolean {
  return findWirePathHit(draft, point) !== null;
}

// Page-11 live trap (2026-07-06): a tap aimed ON a trunk within the port
// magnet radius of the trunk's ENDPOINT was magnetized to the endpoint —
// degree-2 joins, diagonal spurs, and a cascade-consumed trunk when the agent
// deleted the magnetized terminal to escape. The written tap law ("a wire end
// landing ON a continuing conductor mints a junction") outranks port reuse
// when the point sits on the candidate port's OWN edge, beyond the junction
// radius from that port — but only outside component boxes, where terminal
// semantics (pin reuse) rightly stand.
function tapWinsOverPort(
  draft: V2Graph,
  point: Point,
  port: V2Graph["ports"][number],
  d: number
): boolean {
  if (d <= JUNCTION_ON_PATH_PX) return false; // genuinely at the port: reuse
  const inBox = draft.nodes.some(
    (n) =>
      point.x >= n.bbox.x &&
      point.x <= n.bbox.x + n.bbox.width &&
      point.y >= n.bbox.y &&
      point.y <= n.bbox.y + n.bbox.height
  );
  if (inBox) return false;
  const hit = findWirePathHit(draft, point);
  return hit !== null && (hit.edge.sourcePortId === port.id || hit.edge.targetPortId === port.id);
}

// The redrawn-tap harness bug (fixed 2026-07-12; was COPILOT_RULES "KNOWN
// HARNESS BUG"): a wire endpoint reusing a parentless terminal where wires
// already meet makes a 3-wire meet outside any box — that is a JUNCTION, not
// a terminal (the tap law). Convert in place, keeping the port id, so already-
// bound wires and continuation chips stay valid. Exemptions where terminal
// semantics rightly stand: a parented port (in-box pins), a ground terminus
// (drain ends at earth by doctrine), and a PRINTED terminal circle (the print
// outranks the topological rule — the FP-class-4 inline-circle family).
function convertMeetToJunction(
  draft: V2Graph,
  port: V2Graph["ports"][number],
  geometry: PageGeometry | null,
  notes?: string[]
): boolean {
  if (port.type !== "terminal" || port.parentId) return false;
  const degree = draft.edges.filter(
    (e) => e.sourcePortId === port.id || e.targetPortId === port.id
  ).length;
  if (degree < 2) return false; // the wire being added is what makes it 3
  const { x, y } = port.point;
  const inBox = draft.nodes.some(
    (n) => x >= n.bbox.x && x <= n.bbox.x + n.bbox.width && y >= n.bbox.y && y <= n.bbox.y + n.bbox.height
  );
  if (inBox) return false;
  const nearGround = (draft.grounds ?? []).some(
    (g) =>
      x >= g.bbox.x - 10 && x <= g.bbox.x + g.bbox.width + 10 &&
      y >= g.bbox.y - 10 && y <= g.bbox.y + g.bbox.height + 10
  );
  if (nearGround) return false;
  if (geometry?.terminals?.some((t) => dist(t.point, port.point) <= 8)) return false;
  const old = port.label ?? port.id;
  port.type = "junction";
  port.label = nextLabel(draft.ports, "J");
  notes?.push(
    `junction ${port.label}: 3-wire meet outside any box — converted parentless terminal ${old} in place (same id; wires and chips keep their target)`
  );
  return true;
}

// Split a trunk edge at a tap point so the junction is a real degree-3 node.
// Without this the tap is electrically stranded: the spur references the
// junction but the trunk never does (the arm-3 graders' dangling-tap defect).
function splitEdgeAtJunction(
  draft: V2Graph,
  hit: { edge: V2Graph["edges"][number]; segIndex: number },
  junctionId: string,
  at: Point
): void {
  const { edge, segIndex } = hit;
  const before = edge.path.slice(0, segIndex + 1);
  const after = edge.path.slice(segIndex + 1);
  const touches = (p: Point) => Math.hypot(p.x - at.x, p.y - at.y) <= 0.5;
  const pathA = touches(before[before.length - 1]) ? before : [...before, { x: at.x, y: at.y }];
  const pathB = after.length && touches(after[0]) ? after : [{ x: at.x, y: at.y }, ...after];
  if (pathA.length < 2 || pathB.length < 2) return; // tap at an endpoint — no split needed
  const second = {
    id: newId("edge"),
    sourcePortId: junctionId,
    targetPortId: edge.targetPortId,
    path: pathB,
    label: edge.label ?? null,
  };
  edge.path = pathA;
  edge.targetPortId = junctionId;
  draft.edges.push(second);
}

// --- duplicate guards -----------------------------------------------------------
// Commands can be redelivered (SSE replay after reconnect, server-side resend
// when an apply-receipt goes missing). Re-applying an `add_*` must be a no-op,
// so the at-least-once bridge never doubles graph elements.

const DUP_EPS_PX = 2;

// Tolerates missing points: commands arrive from the copilot over the wire,
// and one undefined point must degrade to "not the same", never a crash
// (2026-07-12: a point-less continuation op took down the whole canvas here).
const samePoint = (a: Point | undefined, b: Point | undefined) =>
  !!a && !!b && Math.abs(a.x - b.x) <= DUP_EPS_PX && Math.abs(a.y - b.y) <= DUP_EPS_PX;

function duplicateWire(draft: V2Graph, path: Point[], label?: string): boolean {
  return draft.edges.some(
    (e) =>
      e.path.length === path.length &&
      e.path.every((p, i) => samePoint(p, path[i])) &&
      (!label || !e.label || e.label === label)
  );
}

function duplicateComponent(draft: V2Graph, bbox: { x: number; y: number; width: number; height: number }, label?: string): boolean {
  return draft.nodes.some(
    (n) =>
      Math.abs(n.bbox.x - bbox.x) <= DUP_EPS_PX &&
      Math.abs(n.bbox.y - bbox.y) <= DUP_EPS_PX &&
      Math.abs(n.bbox.width - bbox.width) <= DUP_EPS_PX &&
      Math.abs(n.bbox.height - bbox.height) <= DUP_EPS_PX &&
      (!label || n.label === label)
  );
}

function duplicateContinuation(
  draft: V2Graph,
  op: { point?: Point; sheet?: string; zone?: string; target_id?: string }
): boolean {
  // Same place (geometric) OR same binding (target id) with the same ref =
  // a redelivered command. Target matching also covers point-less bind-by-id
  // ops, whose derived point could drift between deliveries.
  return draft.continuations.some(
    (c) =>
      (samePoint(c.point, op.point) ||
        (op.target_id != null && (c.target?.id ?? null) === op.target_id)) &&
      (c.sheet ?? null) === (op.sheet ?? null) &&
      (c.zone ?? null) === (op.zone ?? null)
  );
}

function ensurePort(
  draft: V2Graph,
  point: Point,
  label: string | null,
  parentId?: string,
  notes?: string[]
): string {
  const existing = draft.ports.find((p) => {
    const d = dist(p.point, point);
    return d <= PORT_REUSE_PX && !tapWinsOverPort(draft, point, p, d);
  });
  if (existing) {
    // Reusing a seeded/legacy or unparented port is where silent wiring
    // mistakes hide — surface it so the copilot can verify instead of assume.
    if (existing.id.startsWith("port-legacy-")) {
      notes?.push(
        `warning: reused legacy port ${existing.id} ("${existing.label}") ${Math.round(dist(existing.point, point))}px away — verify it is the right terminal`
      );
    } else if (existing.type === "terminal" && !existing.parentId) {
      notes?.push(
        `warning: reused unparented terminal ${existing.id} ("${existing.label}") ${Math.round(dist(existing.point, point))}px away — it belongs to no component box`
      );
    }
    return existing.id;
  }
  const node =
    (parentId ? draft.nodes.find((n) => n.id === parentId) : undefined) ??
    draft.nodes.find(
      (n) =>
        point.x >= n.bbox.x &&
        point.x <= n.bbox.x + n.bbox.width &&
        point.y >= n.bbox.y &&
        point.y <= n.bbox.y + n.bbox.height
    );
  // A wire end landing on a continuing conductor is a tap: mint a junction,
  // never a terminal — and SPLIT the trunk there so the junction is degree-3
  // (trunk-in, trunk-out, spur). One net, now true in the data, not just pixels.
  const hit = !node ? findWirePathHit(draft, point) : null;
  if (!node && hit) {
    const port: V2Port = {
      id: newId("port"),
      parentId: "",
      type: "junction",
      point,
      label: nextLabel(draft.ports, "J"),
    };
    draft.ports.push(port);
    splitEdgeAtJunction(draft, hit, port.id, point);
    notes?.push(`junction ${port.label}: trunk ${hit.edge.label ?? hit.edge.id} split at (${Math.round(point.x)},${Math.round(point.y)}) — tap is degree-3`);
    return port.id;
  }
  if (!node) {
    // Ground terminus (2026-07-08 doctrine): a parent-less terminal AT a ground
    // element is CORRECT — the ground marks the symbol, the terminal marks the
    // wire's electrical end. Don't nag "box first?" for it.
    const nearGround = (draft.grounds ?? []).find(
      (g) =>
        point.x >= g.bbox.x - 10 && point.x <= g.bbox.x + g.bbox.width + 10 &&
        point.y >= g.bbox.y - 10 && point.y <= g.bbox.y + g.bbox.height + 10
    );
    if (nearGround) {
      notes?.push(
        `ground terminus at ${nearGround.label}: parent-less terminal by doctrine (the ground marks the symbol; this marks the wire's end)`
      );
    } else {
      notes?.push(
        `warning: terminal minted at (${Math.round(point.x)},${Math.round(point.y)}) has no component box here — box first?`
      );
    }
  }
  const port: V2Port = {
    id: newId("port"),
    parentId: node ? node.id : "",
    type: "terminal",
    point,
    label: label ?? nextLabel(draft.ports, "T"),
  };
  draft.ports.push(port);
  return port.id;
}

export type AnnotateApplyResult = {
  notes: string[];
  /** Parallel to ops: the ids each op minted (role -> id), null when nothing was. */
  minted: (Record<string, string> | null)[];
  /** Cable renames this batch — the SCREEN re-keys the document registry
   *  (same-name-same-cable semantics live there, not in the page graph). */
  cableRenames?: { from: string; to: string }[];
};

// Project op coordinates onto the PDF vector artwork (junction > endpoint >
// on-segment). Returns the snapped points plus a note describing what moved —
// the copilot's sloppy 5-10px coords land exactly on the printed lines.
function snapPointsToArtwork(
  points: Point[],
  geometry: PageGeometry,
  radius: number,
  opName: string,
  notes: string[],
  skip?: Set<number>
): Point[] {
  let hits = 0;
  let maxShift = 0;
  const out = points.map((p, i) => {
    if (skip?.has(i)) return p; // slate 4.3: bound endpoints are never snapped
    const s = snapPoint(p, geometry, radius);
    if (!s) return p;
    // Slate 4.3: displacements past the silent cap keep the RAW coordinate
    // and report what snap wanted — visible imprecision beats silent mutation.
    if (s.distance > SNAP_SILENT_MAX_PX) {
      notes.push(
        `warning: ${opName}: snap onto ${s.kind}${s.label ? ` ${s.label}` : ""} wanted ` +
          `Δ${Math.round(s.distance)}px at (${Math.round(p.x)},${Math.round(p.y)}) — ` +
          `REJECTED (> ${SNAP_SILENT_MAX_PX}px); your raw coordinate kept. Look and ` +
          `re-issue if the artwork disagrees`
      );
      return p;
    }
    hits += 1;
    maxShift = Math.max(maxShift, s.distance);
    return { x: Math.round(s.point.x * 10) / 10, y: Math.round(s.point.y * 10) / 10 };
  });
  const eligible = points.length - (skip?.size ?? 0);
  if (eligible > 0 && hits === eligible) {
    notes.push(`${opName}: snapped ${hits}/${eligible} points to artwork (max shift ${Math.round(maxShift)}px)`);
  } else if (eligible > 0 && hits < eligible) {
    notes.push(
      `warning: ${opName}: only ${hits}/${eligible} points snapped within ${radius}px — the rest kept as given`
    );
  }
  return out;
}

/** Apply ops in order; returns per-op notes and the ids that were minted. */
export function applyAnnotateOps(
  draft: V2Graph,
  ops: AnnotateOp[],
  bank: SymbolBankEntry[] = [],
  wireBank: WireLabelBankEntry[] = [],
  geometry: PageGeometry | null = null,
  // Canvas settings the ops must honor (Shane's ruling 2026-07-09: resize
  // semantics are ONE switch for hand grips and copilot alike; 2026-07-11:
  // the continuation snap radius joins it — one reach for hand and copilot).
  opts: { resizeRideTerminals?: boolean; contSnapPx?: number } = {}
): AnnotateApplyResult {
  const notes: string[] = [];
  const minted: (Record<string, string> | null)[] = ops.map(() => null);
  const cableRenames: { from: string; to: string }[] = [];
  // Slate 6.6: per-op reference validation. renameElement/deleteElement no-op
  // on missing ids while the notes claimed success — a one-hex-char corrupted
  // UUID at 319k context was "renamed" having done nothing. Ids live at batch
  // start distinguish a same-batch cascade removal (legitimate: teardown
  // batches delete parents first) from a reference that never existed.
  const preIds = new Set<string>([
    ...draft.nodes.map((n) => n.id),
    ...draft.ports.map((p) => p.id),
    ...draft.edges.map((e) => e.id),
    ...draft.continuations.map((c) => c.id),
    ...(draft.grounds ?? []).map((g) => g.id),
    ...(draft.cables ?? []).map((c) => c.id),
  ]);
  const idLive = (id: string): boolean =>
    draft.nodes.some((n) => n.id === id) ||
    draft.ports.some((p) => p.id === id) ||
    draft.edges.some((e) => e.id === id) ||
    draft.continuations.some((c) => c.id === id) ||
    (draft.grounds ?? []).some((g) => g.id === id) ||
    (draft.cables ?? []).some((c) => c.id === id);
  const missingRefNote = (opName: string, id: string): string =>
    preIds.has(id)
      ? `${opName} ${id}: already-removed-this-batch (cascade of an earlier delete) — no-op`
      : `ERROR ${opName}: id ${id} not found — NOTHING applied for this op ` +
        `(corrupted/truncated id? use the receipt's minted ids or get_state; never guess)`;
  // Slate 4.4: nodes resized this batch — the stranded-terminal preflight
  // evaluates their NET post-batch state (there is no terminal "move" op,
  // only delete/add/reparent, so mid-batch strandings are legal).
  const resizedIds = new Set<string>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    // One malformed op must never take down the canvas (2026-07-12: a
    // point-less add_continuation threw in a dedupe scan and crashed the
    // whole React tree mid-run). The throw becomes a receipt note the
    // copilot reads; the rest of the batch still applies.
    try {
    switch (op.op) {
      case "add_component": {
        if (op.bbox.width < 8 || op.bbox.height < 8) {
          notes.push("skipped add_component: bbox too small");
          break;
        }
        if (duplicateComponent(draft, op.bbox, op.label)) {
          notes.push("skipped add_component: identical box already exists (redelivered command?)");
          break;
        }
        const id = newId("node");
        // Terminal strips (Shane, 2026-07-10): a box containing a printed pin
        // table classifies as a strip; rows dictate terminal pin slots and
        // conduct in paired sets (lazy). The designator prints ABOVE the
        // tight box (TB30 over the header) — read it from there.
        const stripRows = geometry ? extractStripRows(op.bbox, geometry) : [];
        const isStrip = stripRows.length >= STRIP_MIN_ROWS;
        const label =
          op.label ??
          (isStrip ? stripTitleAbove(op.bbox, geometry) : null) ??
          nextLabel(draft.nodes, "COMP");
        const newNode: V2Graph["nodes"][number] = {
          id, type: "component", bbox: op.bbox, label, identity: null,
          ...(isStrip ? { kind: "strip" as const, rows: stripRows } : {}),
        };
        draft.nodes.push(newNode);
        minted[i] = { node: id };
        notes.push(
          isStrip
            ? `added component ${label} — classified as TERMINAL STRIP (${stripRows.length} rows: ${stripRows.slice(0, 4).map((r) => r.pin).join(",")}…); row pins name its terminals`
            : `added component ${label}`
        );
        // auto_terminals (parity with Shane's drag-box ghosts, 2026-07-09):
        // every printed conductor crossing the border mints a terminal there,
        // named T~<owner>~[<pin>~]<net> — net from the printed wire number
        // along the run, pin from the printed designator just inside the
        // border (Shane's catch: FWD on INV70 belongs in the name). Same
        // engine, same doctrine: the print decides.
        if (op.auto_terminals && geometry) {
          const crossings = detectBorderCrossings(op.bbox, geometry, 8, 220, label);
          let mintedN = 0, namedN = 0, pinnedN = 0;
          let adoptedN = 0;
          for (const c of crossings) {
            const row = isStrip ? rowForY(stripRows, c.point.y) : null;
            const pinSlot = row ? `${row.pin}~` : c.pinLabel ? `${c.pinLabel}~` : "";
            // Adopt a pre-existing wire endpoint first (parity with the hand
            // tool): it keeps its wire, gains the owner + border seat + name.
            const adopted = adoptEndpointAt(draft, id, c.point);
            if (adopted) {
              const net = c.netLabel ?? knownNetOf(draft, adopted);
              if (net) adopted.label = `T~${label}~${pinSlot}${net}`;
              if (row) row.portIds.push(adopted.id);
              adoptedN += 1;
              continue;
            }
            if (draft.ports.some((p) => Math.hypot(p.point.x - c.point.x, p.point.y - c.point.y) <= 10)) continue;
            const portId = newId("port");
            draft.ports.push({
              id: portId,
              parentId: id,
              type: "terminal",
              point: { ...c.point },
              label: c.netLabel
                ? `T~${label}~${pinSlot}${c.netLabel}`
                : nextLabel(draft.ports, "T"),
            });
            if (row) row.portIds.push(portId);
            mintedN += 1;
            if (c.netLabel) namedN += 1;
            if (c.netLabel && (row || c.pinLabel)) pinnedN += 1;
          }
          if (adoptedN > 0) notes.push(`adopted ${adoptedN} pre-existing wire endpoint(s) as border terminals (kept their wires; renamed per convention)`);
          if (isStrip) notes.push(...ensureRowConduction(draft, newNode, () => newId("edge")));
          notes.push(`auto-minted ${mintedN} border terminal(s) from printed crossings (${namedN} named from wire numbers, ${pinnedN} with printed pin designators; unnamed ones need your read of the print)`);
        }
        break;
      }
      case "add_wire": {
        if (!op.path || op.path.length < 2) {
          notes.push("skipped add_wire: path needs >=2 points");
          break;
        }
        let path = op.path;
        // Slate 4.3: TERMINAL-FIRST endpoint resolution. Root cause was real
        // code, not prose: snap ran FIRST (28px, top priority = printed
        // terminal circles, which sit INTERIOR under the border convention)
        // and only then ensurePort reused graph ports at 12px — the exact
        // ordering+radius mismatch that minted duplicate T-123/T-125 and
        // stray T-56 instead of reusing R40's C terminal. Endpoints bind to
        // an existing graph port BEFORE any artwork snap; bound endpoints
        // are never snapped. Snap itself stays for the rest of the path —
        // on printed runs it lands 0-1px and kills the diagonal-warn class.
        const endIdx = [0, path.length - 1];
        const boundIds: (string | null)[] = [null, null];
        for (let e = 0; e < 2; e++) {
          const pt = path[endIdx[e]];
          let best: { p: (typeof draft.ports)[number]; d: number } | null = null;
          for (const p of draft.ports) {
            const d = dist(p.point, pt);
            if (d <= BIND_RADIUS_PX && !tapWinsOverPort(draft, pt, p, d) && (!best || d < best.d)) {
              best = { p, d };
            }
          }
          if (!best) continue;
          boundIds[e] = best.p.id;
          path = path.map((q, i) => (i === endIdx[e] ? { ...best!.p.point } : q));
          notes.push(
            `add_wire: ${e === 0 ? "start" : "end"} bound to existing ${best.p.type} ` +
              `${best.p.label ?? best.p.id} (Δ${Math.round(best.d)}px)`
          );
          // Stub-edge check, born WARN with the FP-class-4 inline-circle
          // exemption at birth: joining a dot-less mid-run stub terminal
          // makes a segmented conductor — previously caught only at the
          // NEXT audit, each costing a delete+redo cycle.
          if (
            best.p.type === "terminal" &&
            !best.p.parentId &&
            draft.edges.some((ed) => ed.sourcePortId === best!.p.id || ed.targetPortId === best!.p.id)
          ) {
            const onPrintedCircle = geometry?.terminals?.some(
              (t) => dist(t.point, best!.p.point) <= 8
            );
            if (!onPrintedCircle) {
              notes.push(
                `warning: add_wire ${e === 0 ? "start" : "end"} joins dot-less stub-edge ` +
                  `terminal ${best.p.label ?? best.p.id} mid-run — segmented conductor: ` +
                  `extend or replace the existing edge instead`
              );
            }
          }
        }
        if (op.snap === "artwork") {
          if (geometry) {
            const skip = new Set<number>();
            if (boundIds[0]) skip.add(0);
            if (boundIds[1]) skip.add(path.length - 1);
            path = snapPointsToArtwork(
              path, geometry, op.snap_radius ?? DEFAULT_SNAP_RADIUS_PX, "add_wire", notes, skip
            );
          } else {
            notes.push("warning: add_wire: snap requested but page geometry not loaded — raw coords used");
          }
        }
        if (duplicateWire(draft, path, op.label)) {
          notes.push("skipped add_wire: identical path already exists (redelivered command?)");
          break;
        }
        for (let k = 0; k + 1 < path.length; k++) {
          if (Math.abs(path[k + 1].x - path[k].x) > 6 && Math.abs(path[k + 1].y - path[k].y) > 6) {
            notes.push(
              `warning: add_wire segment ${k} is diagonal (${Math.round(path[k].x)},${Math.round(path[k].y)})->(${Math.round(path[k + 1].x)},${Math.round(path[k + 1].y)}) — conductors are H/V; check the artwork`
            );
          }
        }
        const sId = boundIds[0] ?? ensurePort(draft, path[0], null, undefined, notes);
        const tId = boundIds[1] ?? ensurePort(draft, path[path.length - 1], null, undefined, notes);
        if (sId === tId) {
          notes.push("skipped add_wire: degenerate (same port at both ends)");
          break;
        }
        // This wire may turn a reused parentless terminal into a 3-wire meet
        // outside any box — the tap law says that point is a junction. Runs
        // after the duplicate/degenerate guards so a redelivered command can
        // never convert without also adding its wire.
        for (const pid of [sId, tId]) {
          const p = draft.ports.find((pp) => pp.id === pid);
          if (p) convertMeetToJunction(draft, p, geometry ?? null, notes);
        }
        const id = newId("edge");
        // Net inference (Shane, 2026-07-11): an unlabeled wire inherits its
        // net from endpoint agreement or THROUGH a pass-through device
        // (THR2's motor phases) — same rule as the hand tool.
        const inferredNet = op.label ? null : inferWireNet(draft, sId, tId);
        if (inferredNet) {
          nameEndpointsFromNet(draft, [sId, tId], inferredNet);
          notes.push(`add_wire: net '${inferredNet}' inferred (endpoint/pass-through)`);
        }
        draft.edges.push({
          id,
          sourcePortId: sId,
          targetPortId: tId,
          path,
          label: op.label ?? inferredNet ?? null,
        });
        // Endpoint ports may be minted or reused — either way these are the
        // ids the copilot needs for follow-up ops (rename/attach/reparent).
        minted[i] = { edge: id, source_port: sId, target_port: tId };
        notes.push(`added wire${op.label ? ` ${op.label}` : ""}`);
        break;
      }
      case "add_terminal": {
        if (op.component_id && !draft.nodes.some((n) => n.id === op.component_id)) {
          notes.push(missingRefNote("add_terminal->component", op.component_id));
          break;
        }
        let point = op.point;
        if (op.snap === "artwork") {
          if (geometry) {
            [point] = snapPointsToArtwork(
              [point], geometry, op.snap_radius ?? DEFAULT_SNAP_RADIUS_PX, "add_terminal", notes
            );
          } else {
            notes.push("warning: add_terminal: snap requested but page geometry not loaded — raw coords used");
          }
        }
        // Mate awareness (Shane, 2026-07-09): touching terminals CONDUCT.
        // A point on two flush borders mints ONE mate terminal (dual-parent);
        // a second cross-parent placement onto an existing terminal UPGRADES
        // it — never the old silent reuse swallow.
        const mateBorders = mateParentsAt(point, draft.nodes);
        const existingPort = draft.ports.find((p) => dist(p.point, point) <= PORT_REUSE_PX);
        if (existingPort) {
          const otherParent =
            (op.component_id && op.component_id !== existingPort.parentId && op.component_id !== existingPort.parentId2
              ? op.component_id
              : mateBorders.find((bid) => bid !== existingPort.parentId && bid !== existingPort.parentId2));
          if (existingPort.type === "terminal" && existingPort.parentId && otherParent) {
            existingPort.type = "mate";
            existingPort.parentId2 = otherParent;
            minted[i] = { port: existingPort.id };
            const a = draft.nodes.find((n) => n.id === existingPort.parentId)?.label ?? existingPort.parentId;
            const b = draft.nodes.find((n) => n.id === otherParent)?.label ?? otherParent;
            notes.push(`mate terminal: upgraded ${existingPort.label} — ${a} ⇔ ${b} conduct at this point (touching terminals conduct)`);
            break;
          }
          notes.push("skipped add_terminal: a terminal already exists there");
          break;
        }
        const primary = op.component_id ?? (mateBorders.length === 2 ? mateBorders[0] : undefined);
        const secondary = mateBorders.find((bid) => bid !== primary);
        if (primary && secondary) {
          const id = newId("port");
          draft.ports.push({
            id,
            parentId: primary,
            parentId2: secondary,
            type: "mate",
            point,
            label: op.label ?? nextLabel(draft.ports, "T"),
          });
          minted[i] = { port: id };
          const a = draft.nodes.find((n) => n.id === primary)?.label ?? primary;
          const b = draft.nodes.find((n) => n.id === secondary)?.label ?? secondary;
          notes.push(`added MATE terminal${op.label ? ` ${op.label}` : ""} — ${a} ⇔ ${b} conduct at this shared border`);
          break;
        }
        const id = ensurePort(draft, point, op.label ?? null, op.component_id, notes);
        minted[i] = { port: id };
        notes.push(`added terminal${op.label ? ` ${op.label}` : ""}`);
        break;
      }
      case "attach": {
        const r = attachTextToComponent(
          draft,
          op.component_id,
          { text: op.text, bbox: op.bbox },
          bank,
          op.kind,
          wireBank
        );
        notes.push(r.ok ? `${r.note}${r.identity === "parts_match" ? " (parts-list match)" : ""}` : `skipped attach: ${r.note}`);
        break;
      }
      case "detach": {
        const r = removeAttachment(draft, op.attachment_id, bank);
        notes.push(r.ok ? r.note : `skipped detach: ${r.note}`);
        break;
      }
      case "rename": {
        if (!idLive(op.id)) {
          notes.push(missingRefNote("rename", op.id));
          break;
        }
        // Cable renames re-key the DOCUMENT registry (screen-side) — report
        // the transition so the roster follows the name (merge on collision).
        const renamedCable = draft.cables?.find((c) => c.id === op.id);
        const fromLabel = renamedCable?.label;
        renameElement(draft, op.id, op.label);
        if (renamedCable && fromLabel && fromLabel !== op.label) {
          cableRenames.push({ from: fromLabel, to: op.label });
          notes.push(`renamed cable ${fromLabel} -> ${op.label} (registry roster follows the name; renaming onto an existing cable name MERGES)`);
        } else {
          notes.push(`renamed ${op.id} -> ${op.label}`);
        }
        break;
      }
      case "add_continuation": {
        // THE rawRef TAX FIX (2026-07-13, mined from the first autonomous
        // gold runs — this defect survived TWO prose-patch cycles): unknown
        // ref-param spellings were silently dropped (raw_ref is canonical;
        // Arc passed rawRef; older runs tried ref), landing chips unlabeled
        // with an ok:true receipt. Accept all three spellings, parse the
        // fraction into sheet/zone when they're absent, and NEVER land an
        // unlabeled chip silently again.
        const rawRefIn =
          op.raw_ref ??
          (op as { rawRef?: string }).rawRef ??
          (op as { ref?: string }).ref ??
          null;
        let contSheet = op.sheet ?? null;
        let contZone = op.zone ?? null;
        if ((!contSheet || !contZone) && rawRefIn) {
          const frac = /^\s*([0-9A-Za-z.]+)\s*\/\s*([0-9A-Za-z.]+)\s*$/.exec(rawRefIn);
          if (frac) {
            contSheet = contSheet ?? frac[1];
            contZone = contZone ?? frac[2];
          }
        }
        // Explicit target wins (e.g. an ELB's trip ref printed BELOW its box);
        // else the continuation tool's attach rule: a wire-end port within
        // reach, else the component the mark sits inside, else unattached.
        const byId = op.target_id
          ? draft.ports.find((p) => p.id === op.target_id) ??
            draft.nodes.find((n) => n.id === op.target_id) ??
            (draft.cables ?? []).find((cb) => cb.id === op.target_id)
          : undefined;
        // A bind-by-id op may carry no point — derive one from the target so
        // the graph NEVER stores a point-less continuation (one undefined
        // point crashed every later dedupe scan, and the canvas with it).
        const cpoint: Point | undefined =
          op.point ??
          (byId
            ? "point" in byId
              ? { ...byId.point }
              : { x: byId.bbox.x + byId.bbox.width, y: byId.bbox.y + byId.bbox.height / 2 }
            : undefined);
        if (!cpoint) {
          notes.push(
            `skipped add_continuation: no point given and target_id ` +
              `${op.target_id ?? "(none)"} did not resolve — nothing to anchor the chip to`
          );
          break;
        }
        if (duplicateContinuation(draft, {
          ...op, point: cpoint,
          sheet: contSheet ?? undefined, zone: contZone ?? undefined,
        })) {
          notes.push("skipped add_continuation: same ref already exists there (redelivered command?)");
          break;
        }
        if (op.target_id) {
          const contId = newId("cont");
          draft.continuations.push({
            id: contId,
            type: "continuation",
            point: cpoint,
            sheet: contSheet,
            zone: contZone,
            rawRef: rawRefIn ?? (contSheet && contZone ? `${contSheet}/${contZone}` : null),
            target: byId
              ? { kind: "parentId" in byId ? "port" : "type" in byId && byId.type === "cable" ? "cable" : "component", id: byId.id }
              : null,
          });
          minted[i] = { continuation: contId };
          if (byId) {
            notes.push(`added continuation ${rawRefIn ?? `${contSheet ?? "?"}/${contZone ?? "?"}`} -> ${op.target_id}`);
          } else {
            notes.push(
              `warning: continuation target ${op.target_id} not found — added UNATTACHED ` +
                `(${rawRefIn ?? `${contSheet ?? "?"}/${contZone ?? "?"}`}); verify the target id or delete and re-add`
            );
          }
          if (!contSheet) {
            notes.push(
              `warning: continuation landed UNLABELED — no sheet/zone given and nothing parsed ` +
                `from ${JSON.stringify(rawRefIn)}; the badge reads ?/? and cross-page resolution ` +
                `cannot run. Set sheet + zone (or a parseable "N/Z" raw_ref).`
            );
          }
          break;
        }
        const port = draft.ports.find(
          (p) => dist(p.point, cpoint) <= (opts.contSnapPx ?? PORT_REUSE_PX));
        const node = port
          ? undefined
          : draft.nodes.find(
              (n) =>
                cpoint.x >= n.bbox.x &&
                cpoint.x <= n.bbox.x + n.bbox.width &&
                cpoint.y >= n.bbox.y &&
                cpoint.y <= n.bbox.y + n.bbox.height
            );
        // A ref on a cable box is a CABLE continuation (Shane, 2026-07-11).
        const cabT = port || node
          ? undefined
          : (draft.cables ?? []).find(
              (cb) =>
                cpoint.x >= cb.bbox.x && cpoint.x <= cb.bbox.x + cb.bbox.width &&
                cpoint.y >= cb.bbox.y && cpoint.y <= cb.bbox.y + cb.bbox.height
            );
        const contId = newId("cont");
        draft.continuations.push({
          id: contId,
          type: "continuation",
          point: cpoint,
          sheet: contSheet,
          zone: contZone,
          rawRef: rawRefIn ?? (contSheet && contZone ? `${contSheet}/${contZone}` : null),
          target: port ? { kind: "port", id: port.id } : node ? { kind: "component", id: node.id } : cabT ? { kind: "cable", id: cabT.id } : null,
        });
        minted[i] = { continuation: contId };
        notes.push(`added continuation ${rawRefIn ?? `${contSheet ?? "?"}/${contZone ?? "?"}`}`);
        if (!contSheet) {
          notes.push(
            `warning: continuation landed UNLABELED — no sheet/zone given and nothing parsed ` +
              `from ${JSON.stringify(rawRefIn)}; the badge reads ?/? and cross-page resolution ` +
              `cannot run. Set sheet + zone (or a parseable "N/Z" raw_ref).`
          );
        }
        break;
      }
      case "add_connector_pair": {
        // Connector pairs (Shane 2026-07-09): one op per pin — shares the exact
        // engine the canvas Connector tool uses, so both hands behave identically.
        const cp = mintConnectorPair(draft, op.point, {
          connectorId: op.connector_id,
          label: op.label ?? null,
        });
        notes.push(...cp.notes);
        if (cp.ok) minted[i] = cp.minted;
        break;
      }
      case "add_ground": {
        // First-class ground reference. The server snaps a snug box to the
        // clicked earth glyph's enclosing circle (v2-snapping), mirroring the
        // Ground tool exactly, so agent-placed and hand-placed grounds are
        // identical — leaving the stem/glyph free for a later ground terminal.
        if (!geometry) {
          notes.push("skipped add_ground: page geometry not loaded — cannot snap to the glyph");
          break;
        }
        const gbbox = groundClusterAtPoint(geometry, op.point);
        if (!gbbox) {
          notes.push(
            `skipped add_ground: no ground glyph within reach of ` +
              `(${Math.round(op.point.x)},${Math.round(op.point.y)}) — aim at the earth symbol`
          );
          break;
        }
        const gcenter = { x: gbbox.x + gbbox.width / 2, y: gbbox.y + gbbox.height / 2 };
        if ((draft.grounds ?? []).some((g) => dist({ x: g.bbox.x + g.bbox.width / 2, y: g.bbox.y + g.bbox.height / 2 }, gcenter) <= 20)) {
          notes.push("skipped add_ground: a ground already covers that glyph (redelivered command?)");
          break;
        }
        const gnear = nearestText(gcenter, geometry, 60);
        const gtoken = (gnear?.text ?? "").trim().toUpperCase();
        const glabel = op.label ?? (/^(G|FG|SG|PE|E|EARTH|GND|GROUND)\b/.test(gtoken) ? gtoken : "GND");
        if (!draft.grounds) draft.grounds = [];
        const gid = newId("ground");
        draft.grounds.push({ id: gid, type: "ground", bbox: gbbox, label: glabel });
        minted[i] = { ground: gid };
        // Border terminals (parity with the Ground tool, 2026-07-10): the
        // conductor entering the glyph earns a terminal ON the ground border,
        // named T~<glabel>~<net> — net from the printed run when the walk
        // finds one, else the ground's own label (the earth net IS the net).
        let gMinted = 0;
        for (const spec of groundBorderTerminals(gbbox, glabel, geometry)) {
          if (draft.ports.some((p) => Math.hypot(p.point.x - spec.point.x, p.point.y - spec.point.y) <= 12)) continue;
          draft.ports.push({ id: newId("port"), parentId: gid, type: "terminal", point: { ...spec.point }, label: spec.label });
          gMinted += 1;
        }
        if (gMinted > 0) notes.push(`auto-minted ${gMinted} ground border terminal(s) from the entering conductor`);
        notes.push(`added ground ${glabel}`);
        break;
      }
      case "add_cable": {
        if (!op.bbox || op.bbox.width < 12 || op.bbox.height < 8) {
          notes.push("skipped add_cable: bbox too small");
          break;
        }
        if (!draft.cables) draft.cables = [];
        const printed = op.label ?? cableLabelNear(op.bbox, geometry);
        const clabel = printed ?? nextLabel(draft.cables, "CABLE");
        if (draft.cables.some((c) => c.label === clabel && Math.abs(c.bbox.x - op.bbox.x) <= DUP_EPS_PX && Math.abs(c.bbox.y - op.bbox.y) <= DUP_EPS_PX)) {
          notes.push("skipped add_cable: identical cable already drawn here (redelivered command?)");
          break;
        }
        const cid = newId("cable");
        draft.cables.push({ id: cid, type: "cable", label: clabel, bbox: { ...op.bbox } });
        minted[i] = { cable: cid };
        const touching = stripsTouchingBox(draft.nodes, op.bbox);
        notes.push(
          `added cable ${clabel}${printed ? " (name read from the print)" : " (no printed name found — rename it)"} — ` +
          (touching.length
            ? `touching strip(s) ${touching.map((t) => t.label).join(", ")}: their conductors auto-link into the registry roster on-canvas`
            : "cables NEVER conduct; the conductor roster lives in the document registry")
        );
        break;
      }
      case "set_page_meta": {
        draft.meta = { ...draft.meta, ...(op.meta as object) };
        notes.push("set page metadata");
        break;
      }
      case "move_terminal": {
        // Same engine as Shane's canvas pin-drag (2026-07-09): the point is
        // PROJECTED onto the parent's border (mates chain through BOTH parents
        // — they cannot leave the shared flush face); parentless terminals
        // move freely; attached wire endpoints follow BY PORT ID, kept H/V.
        const port = draft.ports.find((p) => p.id === op.id);
        if (!port) {
          notes.push(missingRefNote("move_terminal", op.id));
          break;
        }
        if (port.type === "junction") {
          notes.push(`refused move_terminal: ${op.id} is a junction — wire topology moves by rewiring (delete + re-tap), not by dragging`);
          break;
        }
        const wired = draft.edges.filter((e) => e.sourcePortId === op.id || e.targetPortId === op.id).length;
        moveTerminal(draft, op.id, op.point);
        const p = port.point;
        const constrained = p.x !== Math.round(op.point.x) || p.y !== Math.round(op.point.y);
        notes.push(
          `moved ${port.type} ${port.label || op.id} to (${p.x}, ${p.y})`
          + (constrained ? " — projected onto its parent's border" : "")
          + (wired ? ` (${wired} wire endpoint${wired > 1 ? "s" : ""} followed, H/V preserved)` : "")
        );
        break;
      }
      case "move_continuation": {
        // Same engine as Shane's canvas drag (2026-07-09): within 25px of a
        // drawn wire ENDPOINT the symbol snaps onto it and target-binds to its
        // port (placement doctrine ls-20260709-210529 enforced by the op);
        // open-space drops move it and clear any stale binding.
        if (!draft.continuations.some((c) => c.id === op.id)) {
          notes.push(missingRefNote("move_continuation", op.id));
          break;
        }
        moveContinuation(draft, op.id, op.point);
        const moved = draft.continuations.find((c) => c.id === op.id);
        notes.push(
          `moved continuation ${moved?.sheet ?? "?"}/${moved?.zone ?? "?"} to (${Math.round(op.point.x)}, ${Math.round(op.point.y)})`
          + (moved?.target ? ` — snapped to a wire endpoint, target-bound to ${moved.target.kind} ${moved.target.id}` : " (no endpoint within 25px — unattached)")
        );
        break;
      }
      case "reparent": {
        if (!draft.ports.some((p) => p.id === op.id)) {
          notes.push(missingRefNote("reparent", op.id));
          break;
        }
        if (!draft.nodes.some((n) => n.id === op.component_id)) {
          notes.push(missingRefNote("reparent->component", op.component_id));
          break;
        }
        // Page-11 lesson (blessed 2026-07-11): the receipt PROVES wire
        // preservation — the delete+re-add recipe this op replaces once
        // cascade-dropped 3 conductors with nothing in the notes.
        const r = reparentPort(draft, op.id, op.component_id);
        if (!r.ok) {
          notes.push(`refused reparent ${op.id}: ${r.reason}`);
          break;
        }
        notes.push(
          `reparented ${op.id} -> ${op.component_id} ` +
            `(${r.wiresPreserved} attached wire(s) preserved — wires follow by port id` +
            `${r.detail ? `; ${r.detail}` : ""})`
        );
        break;
      }
      case "delete": {
        if (!idLive(op.id)) {
          notes.push(missingRefNote("delete", op.id));
          break;
        }
        deleteElement(draft, op.id, notes);
        notes.push(`deleted ${op.id}`);
        break;
      }
      case "resize": {
        // Grounds are resizable too (2026-07-09 — the page-7 session had to
        // delete+re-add a ground because resize only knew components).
        const gnd = op.id ? (draft.grounds ?? []).find((g) => g.id === op.id) : undefined;
        if (gnd) {
          gnd.bbox = { ...op.bbox };
          notes.push(`resized ground ${gnd.label}`);
          break;
        }
        // Cables too (2026-07-10): the box hugs the printed bundle symbol;
        // after the resize, touching strips/terminals auto-link on-canvas.
        const cabT = op.id ? (draft.cables ?? []).find((c) => c.id === op.id) : undefined;
        if (cabT) {
          cabT.bbox = { ...op.bbox };
          notes.push(`resized cable ${cabT.label} — anything it now touches auto-links its roster`);
          break;
        }
        let node = op.id ? draft.nodes.find((n) => n.id === op.id) : undefined;
        if (!node && op.at) {
          const at = op.at;
          node =
            draft.nodes.find(
              (n) =>
                at.x >= n.bbox.x &&
                at.x <= n.bbox.x + n.bbox.width &&
                at.y >= n.bbox.y &&
                at.y <= n.bbox.y + n.bbox.height
            ) ??
            [...draft.nodes].sort(
              (a, b) =>
                dist({ x: a.bbox.x + a.bbox.width / 2, y: a.bbox.y + a.bbox.height / 2 }, at) -
                dist({ x: b.bbox.x + b.bbox.width / 2, y: b.bbox.y + b.bbox.height / 2 }, at)
            )[0];
        }
        if (!node && !op.id && !op.at && draft.nodes.length === 1) node = draft.nodes[0];
        if (!node) {
          notes.push("skipped resize: no matching component");
          break;
        }
        // Riding is the default (Shane's ruling 2026-07-09): border terminals
        // follow a moved edge, wires follow by port id. The canvas setting
        // "Terminals ride resized borders" switches resize back to shell-only.
        const ride = opts.resizeRideTerminals !== false;
        resizeBoxWithTerminals(draft, node.id, op.bbox, 6, ride);
        notes.push(
          ride
            ? `resized ${node.label} (border terminals rode the moved edges; wires followed)`
            : `resized ${node.label} (shell only — terminals kept page coordinates per canvas setting)`
        );
        resizedIds.add(node.id); // slate 4.4: preflight evaluates post-batch
        break;
      }
      case "clear": {
        const all = ["components", "wires", "terminals", "continuations", "grounds"] as const;
        const layers = op.layers?.length
          ? new Set(op.layers)
          : op.keep?.length
            ? new Set(all.filter((l) => !op.keep!.includes(l)))
            : null;
        if (layers) {
          notes.push(...clearLayers(draft, layers));
          break;
        }
        const before = draft.nodes.length + draft.ports.length + draft.edges.length + draft.continuations.length + (draft.grounds ?? []).length;
        clearGraph(draft);
        notes.push(`cleared page (${before} elements removed)`);
        break;
      }
      case "normalize_taps": {
        // Repair legacy dangling junctions: any junction referenced by <2 edges
        // that sits on a trunk's path gets the trunk split through it.
        let repaired = 0;
        for (const port of draft.ports) {
          if (port.type !== "junction") continue;
          const degree = draft.edges.filter(
            (e) => e.sourcePortId === port.id || e.targetPortId === port.id
          ).length;
          if (degree >= 2) continue;
          const hit = findWirePathHit(draft, port.point);
          if (hit) {
            splitEdgeAtJunction(draft, hit, port.id, port.point);
            repaired += 1;
          }
        }
        notes.push(
          repaired
            ? `normalized ${repaired} dangling junction tap(s) — trunks split, taps now degree-3`
            : "normalize_taps: no dangling junctions found"
        );
        break;
      }
      case "delete_prefix": {
        const prefix = op.prefix || "";
        if (prefix.length < 5) {
          notes.push(`skipped delete_prefix: prefix "${prefix}" too short — be specific`);
          break;
        }
        const ids = [
          ...draft.nodes.map((n) => n.id),
          ...draft.ports.map((p) => p.id),
          ...draft.edges.map((e) => e.id),
          ...draft.continuations.map((c) => c.id),
        ].filter((id) => id.startsWith(prefix));
        for (const id of ids) deleteElement(draft, id);
        notes.push(`deleted ${ids.length} elements with id prefix "${prefix}" (cascades included)`);
        break;
      }
      default:
        notes.push(`skipped unknown op ${(op as { op?: string }).op ?? "?"}`);
    }
    } catch (err) {
      notes.push(
        `error: op ${i} (${(op as { op?: string }).op ?? "?"}) threw ` +
          `${err instanceof Error ? err.message : String(err)} — op skipped, ` +
          `rest of batch applied (it may have partially applied; verify its target)`
      );
    }
  }
  // Slate 4.4 resize-terminal-preflight — born WARN, never a reject. A
  // resize that leaves the node's OWN terminals off the new border (and the
  // batch made no net repair) draws ONE aggregated warning that rides the
  // ledger -> undisposed-warning -> done-gate chain, so the defect never
  // waits for the next audit (CNV40's tighten clipped 5 terminals 7px
  // outside; THR349's relocation left 3 terminals 472px outside — resize
  // receipts said nothing each time). Tolerances align with audit rule 10's
  // bands (2px outside / 8px inside), not a flat 12 — else gate-pass/
  // audit-fail incoherence. Replayed over the gold end state: zero fires.
  for (const nid of resizedIds) {
    const node = draft.nodes.find((n) => n.id === nid);
    if (!node) continue; // deleted later in the batch — net effect clean
    const stranded: string[] = [];
    for (const p of draft.ports) {
      if (p.parentId !== nid || p.type !== "terminal") continue;
      const b = node.bbox;
      const dxOut = Math.max(b.x - p.point.x, 0, p.point.x - (b.x + b.width));
      const dyOut = Math.max(b.y - p.point.y, 0, p.point.y - (b.y + b.height));
      const outside = Math.hypot(dxOut, dyOut);
      if (outside > 2) {
        stranded.push(`${p.label ?? p.id} ${Math.round(outside)}px OUTSIDE`);
      } else if (outside === 0) {
        const inside = Math.min(
          p.point.x - b.x,
          b.x + b.width - p.point.x,
          p.point.y - b.y,
          b.y + b.height - p.point.y
        );
        if (inside > 8) stranded.push(`${p.label ?? p.id} ${Math.round(inside)}px interior`);
      }
    }
    if (stranded.length) {
      notes.push(
        `warning: resize of ${node.label ?? nid} leaves ${stranded.length} own terminal(s) ` +
          `off the new border (${stranded.slice(0, 5).join(", ")}` +
          `${stranded.length > 5 ? ", …" : ""}) with no net repair in this batch — ` +
          `fix now (terminals live where wires cross the printed border) or the ledger carries it`
      );
    }
  }
  return { notes, minted, cableRenames };
}
