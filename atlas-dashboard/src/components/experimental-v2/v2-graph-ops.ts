// Pure draft-mutating graph operations for the Experimental v2 overlay.
// These mutate a draft graph in place (the screen wraps them with undo/redo).

import type { V2Graph } from "./experimental-v2-types";
import { getNearestPointOnRect } from "./v2-geometry.ts";

type Point = { x: number; y: number };

// --- Terminal drag (Shane 2026-07-09: draggable pins from ANY tool mode) ----

// Where a dragged terminal may actually go. Parented terminals are physical
// connection points ON a component face — the cursor projects onto that
// border; a mate chains through BOTH parents' borders so it stays on the
// shared flush face. Parentless terminals move freely. Junctions are wire
// topology (trunk splits), never draggable. Returns null when not draggable.
export function constrainTerminalPoint(graph: V2Graph, portId: string, cursor: Point): Point | null {
  const port = graph.ports.find((p) => p.id === portId);
  if (!port || port.type === "junction") return null;
  // Parents can be components OR grounds (grounds grew border terminals,
  // 2026-07-10) — either way the pin slides along the parent's border.
  const parentBbox = (pid: string) =>
    graph.nodes.find((n) => n.id === pid)?.bbox ?? graph.grounds?.find((g) => g.id === pid)?.bbox;
  let pt: Point = { x: cursor.x, y: cursor.y };
  const b1 = parentBbox(port.parentId);
  if (b1) pt = getNearestPointOnRect(pt, b1);
  const b2 = port.parentId2 ? parentBbox(port.parentId2) : undefined;
  if (b2) pt = getNearestPointOnRect(pt, b2);
  return { x: Math.round(pt.x), y: Math.round(pt.y) };
}

// A wire path with one endpoint moved, keeping conductors H/V: the point
// adjacent to the moved end follows on the segment's original axis; a
// 2-point axis-aligned wire gets a corner inserted instead (its far end
// belongs to another terminal and must not move).
export function movedEdgePath(path: Point[], end: "source" | "target", pt: Point): Point[] {
  if (path.length < 2) return path.map(() => ({ ...pt }));
  const next = [...path.map((p) => ({ ...p }))];
  const [i, j] = end === "source" ? [0, 1] : [next.length - 1, next.length - 2];
  const old = next[i];
  const adj = next[j];
  const wasVertical = Math.abs(adj.x - old.x) < 0.5;
  const wasHorizontal = Math.abs(adj.y - old.y) < 0.5;
  next[i] = { ...pt };
  if (next.length === 2) {
    if ((wasVertical && Math.abs(adj.x - pt.x) >= 0.5) || (wasHorizontal && Math.abs(adj.y - pt.y) >= 0.5)) {
      // Insert the corner AT THE MOVED PIN's side: the long span stays on the
      // printed conductor's row/column; the short jog absorbs the move.
      const corner = wasHorizontal ? { x: pt.x, y: adj.y } : { x: adj.x, y: pt.y };
      return [next[0], corner, next[1]];
    }
    return next;
  }
  if (wasVertical) next[j] = { ...adj, x: pt.x };
  else if (wasHorizontal) next[j] = { ...adj, y: pt.y };
  return next;
}

// Move a terminal/mate to the constrained point nearest `cursor`; attached
// wire endpoints follow BY PORT ID (never by coordinate match), staying H/V.
export function moveTerminal(draft: V2Graph, portId: string, cursor: Point): boolean {
  const constrained = constrainTerminalPoint(draft, portId, cursor);
  if (!constrained) return false;
  const port = draft.ports.find((p) => p.id === portId)!;
  port.point = constrained;
  for (const e of draft.edges) {
    if (e.sourcePortId === portId) e.path = movedEdgePath(e.path, "source", constrained);
    if (e.targetPortId === portId) e.path = movedEdgePath(e.path, "target", constrained);
  }
  return true;
}

// Drag-a-continuation (Shane, 2026-07-09: "dropping them on an endpoint would
// automatically attach that endpoint"): within the snap radius of a drawn wire
// ENDPOINT the symbol lands exactly on it and target-binds to its port — the
// placement doctrine (lesson ls-20260709-210529: continuations sit ON wire
// endpoints, not beside printed brackets) enforced by the gesture itself.
// Dropped in open space it just moves, and any stale binding is cleared (a
// target the symbol no longer sits on would be a lie).
export function moveContinuation(
  draft: V2Graph,
  contId: string,
  cursor: Point,
  snapRadiusPx = 25
): boolean {
  const cont = draft.continuations.find((c) => c.id === contId);
  if (!cont) return false;
  let best: { point: Point; portId: string | null; d: number } | null = null;
  for (const e of draft.edges) {
    const path = e.path ?? [];
    if (path.length < 2) continue;
    const ends: Array<[Point, string | null]> = [
      [path[0], e.sourcePortId ?? null],
      [path[path.length - 1], e.targetPortId ?? null],
    ];
    for (const [pt, portId] of ends) {
      const d = Math.hypot(cursor.x - pt.x, cursor.y - pt.y);
      if (d <= snapRadiusPx && (!best || d < best.d)) {
        best = { point: { x: pt.x, y: pt.y }, portId, d };
      }
    }
  }
  if (best) {
    cont.point = { ...best.point };
    cont.target = best.portId ? { kind: "port", id: best.portId } : null;
    return true;
  }
  // No wire end in reach: a drop ON a cable box binds the chip to the CABLE
  // (Shane, 2026-07-11) — a cable ref says "this cable continues at that
  // sheet"; cables never conduct, so there is no endpoint to demand. A drop
  // touching a COMPONENT box binds the component (device cross-ref: "this
  // component also appears / is detailed at that sheet" — ELB50, THR2).
  cont.point = { x: cursor.x, y: cursor.y };
  const cab = (draft.cables ?? []).find(
    (cb) =>
      cursor.x >= cb.bbox.x - 4 && cursor.x <= cb.bbox.x + cb.bbox.width + 4 &&
      cursor.y >= cb.bbox.y - 4 && cursor.y <= cb.bbox.y + cb.bbox.height + 4
  );
  if (cab) {
    cont.target = { kind: "cable", id: cab.id };
    return true;
  }
  const node = draft.nodes.find(
    (n) =>
      cursor.x >= n.bbox.x - 4 && cursor.x <= n.bbox.x + n.bbox.width + 4 &&
      cursor.y >= n.bbox.y - 4 && cursor.y <= n.bbox.y + n.bbox.height + 4
  );
  cont.target = node ? { kind: "component", id: node.id } : null;
  return true;
}

// Copy-and-bind (Shane, 2026-07-11: "create a copy of a symbol from its
// annotation mark and drag the copy so that it touches the component its
// continuing" / Ctrl+click everything it continues): mint a copy of an
// existing chip at `point`, bound by the same reach rules as a drag drop
// (wire end > cable box > component box > unanchored). The symbol chip
// stays on the print; copies are the link chips.
export function copyContinuationTo(
  draft: V2Graph,
  sourceId: string,
  point: Point,
  id: string,
  snapRadiusPx = 25
): boolean {
  const src = draft.continuations.find((c) => c.id === sourceId);
  if (!src) return false;
  draft.continuations.push({
    id,
    type: "continuation",
    point: { x: point.x, y: point.y },
    sheet: src.sheet,
    zone: src.zone,
    rawRef: src.rawRef,
    target: null,
  });
  moveContinuation(draft, id, point, snapRadiusPx);
  return true;
}

// Ctrl+C/Ctrl+V (Shane, 2026-07-11 — page 11's floating 6/1 refs): mint a
// copy of a copied continuation at the cursor, anchoring exactly like a drag
// drop — a wire end within snapRadius grabs it (point snaps on, target
// binds); empty space leaves it unanchored for a follow-up drag. The caller
// supplies the id so selection can adopt it post-commit (StrictMode runs
// updaters twice on separate drafts; an outside-minted id stays stable).
export function pasteContinuationAt(
  draft: V2Graph,
  ref: { sheet: string | null; zone: string | null; rawRef: string | null },
  cursor: Point,
  id: string,
  snapRadiusPx = 25
): void {
  draft.continuations.push({
    id,
    type: "continuation",
    point: { x: cursor.x, y: cursor.y },
    sheet: ref.sheet,
    zone: ref.zone,
    rawRef: ref.rawRef,
    target: null,
  });
  moveContinuation(draft, id, cursor, snapRadiusPx);
}

function removeContinuationsTargeting(draft: V2Graph, ids: Set<string>): void {
  draft.continuations = draft.continuations.filter(
    (c) => !c.target || !ids.has(c.target.id)
  );
}

// Remove a node/port/edge/continuation and everything that depends on it.
// - Deleting a component removes its terminals and any wires touching them.
// - Deleting a terminal removes any wires touching it.
// - Continuations attached to removed elements are dropped.
export function deleteElement(draft: V2Graph, id: string, notes?: string[]): void {
  const nodeIndex = draft.nodes.findIndex((n) => n.id === id);
  if (nodeIndex !== -1) {
    // Collect child terminals BEFORE mutating, so dependent wires are found.
    // Mates DEGRADE, never cascade (Shane, 2026-07-09): deleting one parent
    // of a mating interface leaves the survivor's pin as an ordinary terminal
    // — the surviving component keeps its connection point (and its wires).
    const childPortIds = new Set(
      draft.ports.filter((p) => p.type !== "mate" && p.parentId === id).map((p) => p.id)
    );
    for (const p of draft.ports) {
      if (p.type !== "mate" || (p.parentId !== id && p.parentId2 !== id)) continue;
      const survivor = p.parentId === id ? p.parentId2 : p.parentId;
      p.type = "terminal";
      p.parentId = survivor ?? "";
      delete p.parentId2;
      notes?.push(`mate ${p.label} degraded to a terminal of its surviving parent (${id} deleted)`);
    }
    draft.nodes.splice(nodeIndex, 1);
    draft.ports = draft.ports.filter((p) => !childPortIds.has(p.id));
    draft.edges = draft.edges.filter(
      (e) => !childPortIds.has(e.sourcePortId) && !childPortIds.has(e.targetPortId)
    );
    removeContinuationsTargeting(draft, new Set([id, ...childPortIds]));
    return;
  }

  const portIndex = draft.ports.findIndex((p) => p.id === id);
  if (portIndex !== -1) {
    const port = draft.ports[portIndex];
    // Deleting a junction with exactly two through-edges HEALS the trunk back
    // into one edge (the inverse of the tap split) instead of nuking both halves.
    if (port.type === "junction") {
      const touching = draft.edges.filter((e) => e.sourcePortId === id || e.targetPortId === id);
      if (touching.length === 2) {
        const [a, b] = touching;
        const aEndsHere = a.targetPortId === id;
        const bStartsHere = b.sourcePortId === id;
        const first = aEndsHere ? a : b;
        const second = aEndsHere ? b : a;
        if (first.targetPortId === id && (bStartsHere || second.sourcePortId === id)) {
          first.path = [...first.path, ...second.path.slice(1)];
          first.targetPortId = second.targetPortId;
          draft.edges = draft.edges.filter((e) => e.id !== second.id);
          draft.ports.splice(portIndex, 1);
          removeContinuationsTargeting(draft, new Set([id]));
          // Slate 3.5: junction heals previously emitted NO note — the delta
          // differ would have flagged its own repair as an unexplained drop.
          notes?.push(
            `junction heal: merged edges ${first.id} + ${second.id} back into one trunk (${id} removed)`
          );
          return;
        }
      }
    }
    draft.ports.splice(portIndex, 1);
    // Page-11 lesson (blessed 2026-07-11): this cascade ran SILENT while a
    // delete+re-add re-parent dropped 3 of ELB50's conductors — the cascade
    // stays legal (teardown batches rely on it) but never unspoken.
    const cascaded = draft.edges.filter((e) => e.sourcePortId === id || e.targetPortId === id);
    draft.edges = draft.edges.filter(
      (e) => e.sourcePortId !== id && e.targetPortId !== id
    );
    if (cascaded.length) {
      notes?.push(
        `warning: deleting ${port.label || id} cascaded ${cascaded.length} attached wire(s): ` +
          `${cascaded.map((e) => e.label || e.id).slice(0, 4).join(", ")}${cascaded.length > 4 ? ", …" : ""}` +
          ` — re-parenting? use the reparent op (preserves wires); delete+re-add does not`
      );
    }
    removeContinuationsTargeting(draft, new Set([id]));
    return;
  }

  const edgeIndex = draft.edges.findIndex((e) => e.id === id);
  if (edgeIndex !== -1) {
    draft.edges.splice(edgeIndex, 1);
    return;
  }

  const contIndex = draft.continuations.findIndex((c) => c.id === id);
  if (contIndex !== -1) { draft.continuations.splice(contIndex, 1); return; }

  if (draft.cables) {
    const cIndex = draft.cables.findIndex((c) => c.id === id);
    if (cIndex !== -1) {
      // Cables never conduct — removing one touches nothing else. The
      // registry roster (document-level) survives: other pages may still
      // draw this cable.
      draft.cables.splice(cIndex, 1);
      return;
    }
  }

  if (draft.grounds) {
    const gIndex = draft.grounds.findIndex((g) => g.id === id);
    if (gIndex !== -1) {
      // Grounds carry border terminals now (2026-07-10) — cascade like a
      // component: child terminals go, and wires touching them go with them.
      const childPortIds = new Set(
        draft.ports.filter((p) => p.parentId === id).map((p) => p.id)
      );
      draft.grounds.splice(gIndex, 1);
      draft.ports = draft.ports.filter((p) => !childPortIds.has(p.id));
      draft.edges = draft.edges.filter(
        (e) => !childPortIds.has(e.sourcePortId) && !childPortIds.has(e.targetPortId)
      );
      removeContinuationsTargeting(draft, new Set([id, ...childPortIds]));
    }
  }
}

// Remove every element from the page's draft graph (nodes, terminals, wires,
// continuations). Used by the copilot `clear` op to reset a page for a fresh
// annotation pass; routed through updateGraph so it is a single undoable step.
export function clearGraph(draft: V2Graph): void {
  draft.nodes = [];
  draft.ports = [];
  draft.edges = [];
  draft.continuations = [];
  draft.grounds = [];
  draft.cables = [];
}

export type ClearLayer = "components" | "wires" | "terminals" | "continuations" | "grounds" | "cables";

// Selectively wipe layers, preserving referential integrity:
// - wires -> edges plus the junction ports that only exist for them
// - terminals -> only ports NOT still referenced by a kept wire (skips noted)
// - components -> boxes only; their terminals survive as unparented
// Returns notes including a post-wipe invariant line per cleared layer.
export function clearLayers(draft: V2Graph, layers: Set<ClearLayer>): string[] {
  const notes: string[] = [];
  if (layers.has("grounds")) {
    const n = (draft.grounds ?? []).length;
    draft.grounds = [];
    notes.push(`cleared grounds: ${n}`);
  }
  if (layers.has("cables")) {
    const n = (draft.cables ?? []).length;
    draft.cables = [];
    notes.push(`cleared cables: ${n} (registry rosters survive — other pages may draw them)`);
  }
  if (layers.has("wires")) {
    const edgeCount = draft.edges.length;
    draft.edges = [];
    const junctions = draft.ports.filter((p) => p.type === "junction").length;
    draft.ports = draft.ports.filter((p) => p.type !== "junction");
    notes.push(`cleared wires: ${edgeCount} edges${junctions ? ` (+${junctions} junction taps)` : ""}`);
  }
  if (layers.has("terminals")) {
    const inUse = new Set(draft.edges.flatMap((e) => [e.sourcePortId, e.targetPortId]));
    const before = draft.ports.length;
    const kept = draft.ports.filter((p) => p.type === "terminal" && inUse.has(p.id));
    draft.ports = draft.ports.filter((p) => (p.type === "terminal" ? inUse.has(p.id) : true));
    notes.push(
      `cleared terminals: ${before - draft.ports.length}`
      + (kept.length ? ` (${kept.length} kept — still endpoints of kept wires)` : "")
    );
  }
  if (layers.has("components")) {
    const count = draft.nodes.length;
    const ids = new Set(draft.nodes.map((n) => n.id));
    draft.nodes = [];
    let orphaned = 0;
    for (const p of draft.ports) {
      if (p.parentId && ids.has(p.parentId)) {
        p.parentId = "";
        orphaned += 1;
      }
    }
    draft.continuations = draft.continuations.filter((c) => !c.target || !ids.has(c.target.id));
    notes.push(`cleared components: ${count} boxes${orphaned ? ` (${orphaned} terminals now unparented)` : ""}`);
  }
  if (layers.has("continuations")) {
    const count = draft.continuations.length;
    draft.continuations = [];
    notes.push(`cleared continuations: ${count}`);
  }
  // Post-wipe invariant: every cleared layer must actually read zero (kept
  // wire-endpoint terminals are the one legitimate remainder).
  const counts: Record<ClearLayer, number> = {
    components: draft.nodes.length,
    wires: draft.edges.length,
    terminals: draft.ports.filter((p) => p.type === "terminal").length,
    continuations: draft.continuations.length,
    grounds: (draft.grounds ?? []).length,
    cables: (draft.cables ?? []).length,
  };
  for (const layer of layers) {
    if (layer === "terminals") continue; // kept-in-use remainder is legal and already noted
    if (counts[layer] !== 0) {
      notes.push(`warning: post-wipe invariant FAILED — ${layer} still has ${counts[layer]} elements`);
    }
  }
  const checked = [...layers].filter((l) => l !== "terminals");
  if (checked.length && checked.every((l) => counts[l] === 0)) {
    notes.push(`post-wipe invariant: ${checked.join("/")} = 0 ✓`);
  }
  return notes;
}

// Resize/move a component's bounding box. Child terminals keep their absolute
// page coordinates (they are physical connection points, not relative offsets),
// so growing the box to enclose the full symbol never disturbs existing wiring.
export function resizeComponent(
  draft: V2Graph,
  id: string,
  bbox: { x: number; y: number; width: number; height: number }
): void {
  const node = draft.nodes.find((n) => n.id === id);
  if (node) node.bbox = bbox;
}

// Where a border pin lands when its parent's bbox goes prev → next (the
// handle-resize riding rule): a pin on a moved edge FOLLOWS that edge; its
// along-border coordinate stays absolute, clamped into the new span. Interior
// pins return null — they are not ours to guess. Shared by the commit op below
// and the SVG drag preview, so the preview shows exactly what release will do.
export function resizedPortPoint(
  prev: { x: number; y: number; width: number; height: number },
  next: { x: number; y: number; width: number; height: number },
  point: Point,
  edgeTolPx = 6
): Point | null {
  const px0 = prev.x, px1 = prev.x + prev.width, py0 = prev.y, py1 = prev.y + prev.height;
  const nx0 = next.x, nx1 = next.x + next.width, ny0 = next.y, ny1 = next.y + next.height;
  // In an axis whose span is ≤ 2×tol, EVERY position reads as "on an edge" —
  // a mid-height side pin would spuriously snap to a corner. Edge affinity in
  // such an axis needs an (almost) exact hit instead.
  const xTol = prev.width > 2 * edgeTolPx ? edgeTolPx : 1;
  const yTol = prev.height > 2 * edgeTolPx ? edgeTolPx : 1;
  const onLeft = Math.abs(point.x - px0) <= xTol;
  const onRight = Math.abs(point.x - px1) <= xTol;
  const onTop = Math.abs(point.y - py0) <= yTol;
  const onBottom = Math.abs(point.y - py1) <= yTol;
  if (!onLeft && !onRight && !onTop && !onBottom) return null;
  const pt = { ...point };
  if (onLeft) pt.x = nx0;
  else if (onRight) pt.x = nx1;
  else pt.x = Math.min(nx1 - 4, Math.max(nx0 + 4, pt.x));
  if (onTop) pt.y = ny0;
  else if (onBottom) pt.y = ny1;
  else pt.y = Math.min(ny1 - 4, Math.max(ny0 + 4, pt.y));
  return pt;
}

// Handle-resize (Shane, 2026-07-09: "clicking a bbox reveals handles that
// allow them to be resized"). Unlike the bare resizeComponent above, border
// TERMINALS RIDE the border being moved (doctrine: terminals inherit their
// coordinates from box borders) — along-border positions stay absolute,
// clamped into the new span; attached wires follow BY PORT ID. Grounds (plain
// bboxes, no terminals) resize through the same entry. `ride` is the
// "Terminals ride resized borders" canvas setting: false resizes the box
// SHELL only — every terminal keeps its page coordinates (still one entry
// for nodes and grounds either way).
export function resizeBoxWithTerminals(
  draft: V2Graph,
  id: string,
  next: { x: number; y: number; width: number; height: number },
  edgeTolPx = 6,
  ride = true
): boolean {
  // Grounds carry border terminals too (2026-07-10) — one riding rule for
  // all box kinds; cables are bboxes as well (no ports of their own).
  const owner =
    draft.grounds?.find((g) => g.id === id) ??
    draft.cables?.find((c) => c.id === id) ??
    draft.nodes.find((n) => n.id === id);
  if (!owner) return false;
  const prev = owner.bbox;
  owner.bbox = { ...next };
  if (!ride) return true;
  for (const p of draft.ports) {
    if (p.parentId !== id && p.parentId2 !== id) continue;
    const pt = resizedPortPoint(prev, next, p.point, edgeTolPx);
    if (!pt || (pt.x === p.point.x && pt.y === p.point.y)) continue;
    p.point = pt;
    for (const e of draft.edges) {
      if (e.sourcePortId === p.id) e.path = movedEdgePath(e.path, "source", pt);
      if (e.targetPortId === p.id) e.path = movedEdgePath(e.path, "target", pt);
    }
  }
  return true;
}

// Adopt a pre-existing wire endpoint into a freshly drawn box (Shane's catch,
// 2026-07-10: drawing TB30 over already-wired endpoints minted DUPLICATE
// terminals beside them and the audit flagged every pair). The nearest
// UNPARENTED terminal within reach of a border crossing IS that conductor's
// endpoint — reparent it, slide it onto the border (its wires follow by port
// id), and let the caller rename it per convention. Ports owned by another
// component are never stolen. Returns the adopted port, or null.
export function adoptEndpointAt(
  draft: V2Graph,
  nodeId: string,
  point: Point,
  radiusPx = 30
): V2Graph["ports"][number] | null {
  let best: V2Graph["ports"][number] | null = null;
  let d = radiusPx;
  for (const p of draft.ports) {
    if (p.type !== "terminal" || p.parentId) continue;
    const dd = Math.hypot(p.point.x - point.x, p.point.y - point.y);
    if (dd <= d) { d = dd; best = p; }
  }
  if (!best) return null;
  best.parentId = nodeId;
  const pt = { x: Math.round(point.x), y: Math.round(point.y) };
  if (best.point.x !== pt.x || best.point.y !== pt.y) {
    for (const e of draft.edges) {
      if (e.sourcePortId === best.id) e.path = movedEdgePath(e.path, "source", pt);
      if (e.targetPortId === best.id) e.path = movedEdgePath(e.path, "target", pt);
    }
    best.point = pt;
  }
  return best;
}

// The net a port already knows: its convention name's last slot, else the
// wire number of an edge it terminates. Print truth captured earlier beats
// a fresh guess.
export function knownNetOf(draft: V2Graph, port: V2Graph["ports"][number]): string | null {
  if (port.label.startsWith("T~")) {
    const parts = port.label.split("~");
    if (parts.length >= 3) return parts[parts.length - 1] || null;
  }
  const edge = draft.edges.find((e) => e.sourcePortId === port.id || e.targetPortId === port.id);
  return edge?.label ?? null;
}

export type ReparentResult =
  | { ok: true; wiresPreserved: number; detail?: string }
  | { ok: false; reason: string };

// Attach a terminal to a component (fixes orphans minted outside a bbox, e.g.
// when a snap-tolerance miss left parentId empty). Blessed page-11 lesson
// (2026-07-11): re-parenting must PRESERVE attached wires — the delete+re-add
// recipe cascade-deleted 3 of ELB50's conductors silently, caught only by a
// 112s capture detour. Wires follow BY PORT ID (the port object survives,
// same mechanism as moveTerminal), the result carries the preserved count as
// receipt-proof, and any path that cannot guarantee preservation REFUSES with
// the count instead of silently cascading. Junctions refuse outright: taps
// are wire topology, never component pins. A mate keeps its second parent.
export function reparentPort(draft: V2Graph, portId: string, componentId: string): ReparentResult {
  const port = draft.ports.find((p) => p.id === portId);
  if (!port) return { ok: false, reason: `port ${portId} not found` };
  const node = draft.nodes.find((n) => n.id === componentId);
  if (!node) return { ok: false, reason: `component ${componentId} not found` };
  const attached = draft.edges.filter(
    (e) => e.sourcePortId === portId || e.targetPortId === portId
  );
  if (port.type === "junction") {
    return {
      ok: false,
      reason:
        `${port.label || portId} is a junction (${attached.length} wire(s) ride it) — ` +
        `taps are wire topology, never component pins; restructure by delete + re-tap`,
    };
  }
  if (port.parentId === componentId || port.parentId2 === componentId) {
    return {
      ok: true,
      wiresPreserved: attached.length,
      detail: `already parented to ${node.label || componentId} — no-op`,
    };
  }
  const prevParent = port.parentId;
  port.parentId = node.id;
  // The blessed invariant, checked not assumed: every wire attached before is
  // attached after. Unreachable while the mutation is a bare parentId set —
  // if a future edit breaks that, restore and refuse rather than cascade.
  const after = draft.edges.filter(
    (e) => e.sourcePortId === portId || e.targetPortId === portId
  ).length;
  if (after !== attached.length) {
    port.parentId = prevParent;
    return {
      ok: false,
      reason: `would drop ${attached.length - after} wire(s) — refused, graph unchanged`,
    };
  }
  const result: ReparentResult = { ok: true, wiresPreserved: attached.length };
  if (port.type === "mate" && port.parentId2) {
    const second = draft.nodes.find((n) => n.id === port.parentId2);
    result.detail = `mate's second parent ${second?.label ?? port.parentId2} unchanged`;
  }
  return result;
}

// Rename a component, terminal, or wire (wire label = wire number).
export function renameElement(draft: V2Graph, id: string, label: string): void {
  const node = draft.nodes.find((n) => n.id === id);
  if (node) {
    node.label = label;
    return;
  }
  const port = draft.ports.find((p) => p.id === id);
  if (port) {
    port.label = label;
    return;
  }
  const edge = draft.edges.find((e) => e.id === id);
  if (edge) { edge.label = label; return; }
  const ground = draft.grounds?.find((g) => g.id === id);
  if (ground) { ground.label = label; return; }
  const cable = draft.cables?.find((c) => c.id === id);
  if (cable) cable.label = label;
}

// Edit a continuation's sheet/zone cross-reference.
export function updateContinuation(
  draft: V2Graph,
  id: string,
  patch: { sheet?: string; zone?: string }
): void {
  const c = draft.continuations.find((x) => x.id === id);
  if (!c) return;
  if (patch.sheet !== undefined) c.sheet = patch.sheet;
  if (patch.zone !== undefined) c.zone = patch.zone;
}

// Where an element "is" for focus/highlight purposes (issues drawer
// click-to-locate, 2026-07-07): a point the viewport can center on. Pure;
// null when the element isn't in this page's graph.
export function findElementAnchor(
  graph: V2Graph,
  id: string
): { x: number; y: number; kind: "component" | "terminal" | "wire" | "continuation" | "ground" | "cable" } | null {
  const node = graph.nodes.find((n) => n.id === id);
  if (node) {
    return {
      x: node.bbox.x + node.bbox.width / 2,
      y: node.bbox.y + node.bbox.height / 2,
      kind: "component",
    };
  }
  const port = graph.ports.find((p) => p.id === id);
  if (port) return { x: port.point.x, y: port.point.y, kind: "terminal" };
  const edge = graph.edges.find((e) => e.id === id);
  if (edge && edge.path.length > 0) {
    const mid = edge.path[Math.floor(edge.path.length / 2)];
    return { x: mid.x, y: mid.y, kind: "wire" };
  }
  const cont = graph.continuations.find((c) => c.id === id);
  if (cont) return { x: cont.point.x, y: cont.point.y, kind: "continuation" };
  const gnd = graph.grounds?.find((g) => g.id === id);
  if (gnd) {
    return {
      x: gnd.bbox.x + gnd.bbox.width / 2,
      y: gnd.bbox.y + gnd.bbox.height / 2,
      kind: "ground",
    };
  }
  const cab = graph.cables?.find((c) => c.id === id);
  if (cab) {
    return {
      x: cab.bbox.x + cab.bbox.width / 2,
      y: cab.bbox.y + cab.bbox.height / 2,
      kind: "cable",
    };
  }
  return null;
}

// Pass-through devices (Shane's ruling, 2026-07-11, the MS2->THR2 motor
// phases): a thermal relay is electrically in SERIES — the conductor keeps
// its printed number through it, so a wire with no printed label of its own
// inherits the net from the device's far side ("the names should be inferred
// from the THR2 connection: U2, V2, W2"). Extend the class list only on a
// ruling, never by guess.
export const PASS_THROUGH_RE = /^THR\d/i;

const NET_SLOT_RE = /^T~[^~]+~(?:[^~]+~)?([^~]+)$/;
function netOfPortName(label: string | null | undefined): string | null {
  const m = (label ?? "").trim().match(NET_SLOT_RE);
  const net = m?.[1]?.trim();
  return net || null;
}

/** Infer an unlabeled wire's net at draw time:
 *  1. both endpoint terminals agree on a net -> that net;
 *  2. an endpoint sits on a PASS-THROUGH device (THR2): the device's
 *     same-row terminal on the far border carries the net -> inherit it. */
export function inferWireNet(draft: V2Graph, sId: string, tId: string): string | null {
  const sp = draft.ports.find((p) => p.id === sId);
  const tp = draft.ports.find((p) => p.id === tId);
  const sNet = netOfPortName(sp?.label);
  const tNet = netOfPortName(tp?.label);
  if (sNet && tNet && sNet === tNet) return sNet;
  // A generic auto-name (T-39 style) carries no identity — one REAL net end
  // names the run.
  const bare = (p?: { label?: string | null }) =>
    !p?.label || /^T-?\d+$/i.test(p.label.trim());
  if (sNet && bare(tp)) return sNet;
  if (tNet && bare(sp)) return tNet;
  for (const p of [sp, tp]) {
    if (!p) continue;
    const parent = draft.nodes.find((n) => n.id === p.parentId);
    if (!parent || !PASS_THROUGH_RE.test(parent.label ?? "")) continue;
    // Far-side sibling in the same row (horizontal device run) or column.
    for (const sib of draft.ports) {
      if (sib.parentId !== parent.id || sib.id === p.id) continue;
      const sameRow = Math.abs(sib.point.y - p.point.y) <= 14 && Math.abs(sib.point.x - p.point.x) > parent.bbox.width * 0.5;
      const sameCol = Math.abs(sib.point.x - p.point.x) <= 14 && Math.abs(sib.point.y - p.point.y) > parent.bbox.height * 0.5;
      if (!sameRow && !sameCol) continue;
      const viaName = netOfPortName(sib.label);
      if (viaName) return viaName;
      const viaEdge = draft.edges.find(
        (e) => (e.sourcePortId === sib.id || e.targetPortId === sib.id) && (e.label ?? "").trim()
      );
      if (viaEdge) return viaEdge.label!.trim();
    }
  }
  return null;
}

/** After inference, repair GENERIC endpoint names (T-39 style / empty) to the
 * convention using the inferred net — never touches names that already carry
 * a net or a pin slot. */
export function nameEndpointsFromNet(draft: V2Graph, portIds: string[], net: string): void {
  for (const id of portIds) {
    const p = draft.ports.find((q) => q.id === id);
    if (!p) continue;
    const label = (p.label ?? "").trim();
    if (label && !/^T-?\d+$/i.test(label)) continue; // real name — leave it
    const parent = draft.nodes.find((n) => n.id === p.parentId);
    if (parent?.label) p.label = `T~${parent.label}~${net}`;
  }
}
