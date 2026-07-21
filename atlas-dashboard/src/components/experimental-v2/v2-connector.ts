// Connector pairs (Shane's design, 2026-07-09): the tool that turns the
// manufacturer's most repetitive structure — mating connector tables
// (CON23/CN23A, CON24/CN23B, the FAN connector on M1, CON22) — into one tap
// per pin. Tap the INPUT pin on a connector's border:
//
//   1. an input terminal mints on that border (owner = the connector),
//   2. the pair projects to the OPPOSITE border along the pin's row/column,
//   3. the out side ADOPTS an existing aligned terminal when one is there
//      (upgrading it to a dual-parent MATE — its exact artwork-snapped point
//      wins over our projection), else mints fresh (auto-mating if another
//      component's border abuts),
//   4. an internal wire segment records the conduction (Shane's own ruling:
//      "placing 3 wire segments inside the connector wires it up to the
//      3 phases" — edges through ports stay the single electrical mechanism).
//
// Adoption is TIGHT by design (pages 13+ have dense pin pitches): the two
// failure modes are not symmetric — a loose match adopts the WRONG pin
// silently (corrupt data that looks fine); a tight miss makes a visible twin
// that audits catch. Ambiguity refuses entirely: two candidates near the
// projection means a human (or the copilot with its eyes) must pair it.
//
// Pure module — no React. Both the canvas Connector tool and the copilot's
// add_connector_pair op call mintConnectorPair, so both hands behave
// identically.

import type { V2Graph, V2Node, V2Port } from "./experimental-v2-types";
import { type Point, distance, distanceToRectBorder, mateParentsAt } from "./v2-geometry.ts";

/** Row tolerance for adopting an existing terminal as the pair's out side.
 *  One-line tune (like the ground snap's seedRadiusPx) — tighter than every
 *  other radius in the stack (port reuse 12, mate borders 6, junctions 3). */
export const MATE_ADOPT_ROW_TOL_PX = 4;
/** Candidates within FACTOR×tol trigger the ambiguity refusal. */
export const ADOPT_AMBIGUITY_FACTOR = 2;

const PORT_REUSE_PX = 12; // keep in sync with use-v2-drawing / v2-bridge-ops
const BORDER_TAP_TOL_PX = 8; // the tap must be ON a connector border
const MATE_BORDER_TOL_PX = 6; // matches mateParentsAt

const newId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

type Side = "left" | "right" | "top" | "bottom";

function nearestSide(p: Point, n: V2Node): { side: Side; d: number } {
  const b = n.bbox;
  const sides: [Side, number][] = [
    ["left", Math.abs(p.x - b.x)],
    ["right", Math.abs(p.x - (b.x + b.width))],
    ["top", Math.abs(p.y - b.y)],
    ["bottom", Math.abs(p.y - (b.y + b.height))],
  ];
  sides.sort((a, c) => a[1] - c[1]);
  return { side: sides[0][0], d: sides[0][1] };
}

export type ConnectorPairResult = {
  ok: boolean;
  notes: string[];
  minted: Record<string, string> | null;
};

export function mintConnectorPair(
  draft: V2Graph,
  tap: Point,
  opts: { connectorId?: string; label?: string | null } = {}
): ConnectorPairResult {
  const notes: string[] = [];

  // 1. The connector: explicit id, else the component whose border the tap is on.
  let connector: V2Node | undefined;
  if (opts.connectorId) {
    connector = draft.nodes.find((n) => n.id === opts.connectorId);
    if (!connector) {
      notes.push(`skipped connector pair: connector ${opts.connectorId} not found`);
      return { ok: false, notes, minted: null };
    }
  } else {
    connector = draft.nodes
      .map((n) => ({ n, d: distanceToRectBorder(tap, n.bbox) }))
      .filter((e) => e.d <= BORDER_TAP_TOL_PX)
      .sort((a, b) => a.d - b.d)[0]?.n;
    if (!connector) {
      notes.push(
        `skipped connector pair: no component border within ${BORDER_TAP_TOL_PX}px of ` +
          `(${Math.round(tap.x)},${Math.round(tap.y)}) — tap the INPUT pin on the connector's border`
      );
      return { ok: false, notes, minted: null };
    }
  }
  const b = connector.bbox;

  // 2. Which border was tapped decides the pair axis; the tap's row/column is
  //    the pin position. The geometry decides — no hardcoded left/right.
  const { side } = nearestSide(tap, connector);
  const horizontal = side === "left" || side === "right";
  const inputPoint: Point = horizontal
    ? { x: side === "left" ? b.x : b.x + b.width, y: tap.y }
    : { x: tap.x, y: side === "top" ? b.y : b.y + b.height };
  const outProjected: Point = horizontal
    ? { x: side === "left" ? b.x + b.width : b.x, y: tap.y }
    : { x: tap.x, y: side === "top" ? b.y + b.height : b.y };
  const rowOf = (p: Point) => (horizontal ? p.y : p.x);
  const perpToOutBorder = (p: Point) =>
    horizontal ? Math.abs(p.x - outProjected.x) : Math.abs(p.y - outProjected.y);

  // 3. Out-side adoption BEFORE any minting (ambiguity must abort the whole
  //    pair — never a half-built pair).
  const adoptTol = MATE_ADOPT_ROW_TOL_PX;
  const ambiguityWindow = adoptTol * ADOPT_AMBIGUITY_FACTOR;
  const candidates = draft.ports
    .filter(
      (p) =>
        p.type !== "junction" &&
        p.parentId !== connector.id &&
        p.parentId2 !== connector.id &&
        perpToOutBorder(p.point) <= MATE_BORDER_TOL_PX &&
        Math.abs(rowOf(p.point) - rowOf(outProjected)) <= ambiguityWindow
    )
    .map((p) => ({ p, rowD: Math.abs(rowOf(p.point) - rowOf(outProjected)) }))
    .sort((a, c) => a.rowD - c.rowD);
  if (candidates.length >= 2) {
    notes.push(
      `skipped connector pair: AMBIGUOUS adoption — ${candidates.length} terminals within ` +
        `${ambiguityWindow}px of the projected pin row (${candidates
          .map((c) => c.p.label)
          .slice(0, 3)
          .join(", ")}); pair manually`
    );
    return { ok: false, notes, minted: null };
  }
  if (candidates.length === 1 && candidates[0].rowD > adoptTol) {
    notes.push(
      `skipped connector pair: near-miss adoption — ${candidates[0].p.label} is ` +
        `${candidates[0].rowD.toFixed(0)}px off the projected row (adopt tolerance ${adoptTol}px); ` +
        "align the terminal or the tap, then retry"
    );
    return { ok: false, notes, minted: null };
  }

  // 4. Input terminal: reuse an existing port at the input point, else mint.
  let inputPort = draft.ports.find((p) => distance(p.point, inputPoint) <= PORT_REUSE_PX);
  if (inputPort) {
    notes.push(`connector pair: input reuses ${inputPort.label}`);
  } else {
    inputPort = {
      id: newId("port"),
      parentId: connector.id,
      type: "terminal",
      point: inputPoint,
      label: opts.label ?? nextPinLabel(draft),
    };
    draft.ports.push(inputPort);
    notes.push(`connector pair: input terminal ${inputPort.label} on ${connector.label}'s ${side} border`);
  }

  // 5. Out side: adopt-and-upgrade, else fresh (auto-mating when another
  //    component's border abuts the projection).
  let outPort: V2Port;
  const adopted = candidates[0]?.p;
  if (adopted) {
    if (adopted.parentId && adopted.parentId !== connector.id) {
      const otherLabel = draft.nodes.find((n) => n.id === adopted.parentId)?.label ?? adopted.parentId;
      adopted.type = "mate";
      adopted.parentId2 = connector.id;
      notes.push(
        `connector pair: adopted existing terminal ${adopted.label} — upgraded to MATE, ` +
          `${connector.label} ⇔ ${otherLabel} conduct at its exact point (its position wins over the projection)`
      );
    } else {
      adopted.parentId = connector.id;
      notes.push(`connector pair: adopted parent-less terminal ${adopted.label} as ${connector.label}'s out pin`);
    }
    outPort = adopted;
  } else {
    const abutting = mateParentsAt(outProjected, draft.nodes).filter((id) => id !== connector.id);
    const other = abutting[0];
    outPort = {
      id: newId("port"),
      parentId: connector.id,
      ...(other ? { parentId2: other } : {}),
      type: other ? "mate" : "terminal",
      point: outProjected,
      label: nextPinLabel(draft),
    };
    draft.ports.push(outPort);
    const otherLabel = other ? draft.nodes.find((n) => n.id === other)?.label ?? other : null;
    notes.push(
      other
        ? `connector pair: out MATE ${outPort.label} — ${connector.label} ⇔ ${otherLabel} conduct at the shared border`
        : `connector pair: out terminal ${outPort.label} on the ${connector.label} opposite border (will upgrade to a mate when the facing component lands)`
    );
  }

  // 6. Internal conduction segment (idempotent — redelivery mints nothing).
  const existingEdge = draft.edges.find(
    (e) =>
      (e.sourcePortId === inputPort.id && e.targetPortId === outPort.id) ||
      (e.sourcePortId === outPort.id && e.targetPortId === inputPort.id)
  );
  let edgeId = existingEdge?.id;
  if (existingEdge) {
    notes.push("connector pair: internal segment already exists (redelivered command?)");
  } else {
    edgeId = newId("edge");
    draft.edges.push({
      id: edgeId,
      sourcePortId: inputPort.id,
      targetPortId: outPort.id,
      path: [inputPoint, adopted ? adopted.point : outProjected],
      label: null,
    });
    notes.push(`connector pair: internal segment ${inputPort.label} → ${outPort.label} (conduction recorded)`);
  }

  return {
    ok: true,
    notes,
    minted: { input_port: inputPort.id, out_port: outPort.id, internal_edge: edgeId! },
  };
}

function nextPinLabel(draft: V2Graph): string {
  let n = draft.ports.length + 1;
  while (draft.ports.some((p) => p.label === `T-${n}`)) n += 1;
  return `T-${n}`;
}
