"use client";

// The edge layer — every join contract as a line. Dashed amber = a
// proposal awaiting Shane; solid cyan = drawn law; the mid-edge badge is
// the LIVE match survey (k/N against the real tables). Cards key by
// table_name now — a card IS its table.

import React from "react";

import { fieldAnchor, type Card, type Relation } from "./data-map-types";

const CYAN = "#22d3ee";
const AMBER = "#f59e0b";

export type EdgeGeom = {
  relation: Relation;
  a: { x: number; y: number };
  b: { x: number; y: number };
};

export function computeEdges(
  relations: Relation[],
  cards: (Card & { pos: { x: number; y: number } })[],
  collapsed: Set<string>,
  showDismissed: boolean
): EdgeGeom[] {
  const byName = new Map(cards.map((c) => [c.table_name, c]));
  const out: EdgeGeom[] = [];
  for (const r of relations) {
    if (r.status === "dismissed" && !showDismissed) continue;
    const from = byName.get(r.from_table);
    const to = byName.get(r.to_table);
    if (!from || !to) continue; // both cards must be on the board
    // A column the live table no longer carries must never silently anchor
    // to row 0 — skip the edge (the contract row survives; the inspector
    // shows it as drifted via from_bound/to_bound).
    const fIdx = from.columns.indexOf(r.from_field);
    const tIdx = to.columns.indexOf(r.to_field);
    if (fIdx === -1 || tIdx === -1) continue;
    const fromSide = from.pos.x <= to.pos.x ? "right" : "left";
    const toSide = from.pos.x <= to.pos.x ? "left" : "right";
    out.push({
      relation: r,
      a: fieldAnchor(from.pos, fIdx, collapsed.has(from.table_name), fromSide),
      b: fieldAnchor(to.pos, tIdx, collapsed.has(to.table_name), toSide),
    });
  }
  return out;
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.45);
  const c1x = a.x + (a.x <= b.x ? dx : -dx);
  const c2x = b.x + (a.x <= b.x ? -dx : dx);
  return `M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`;
}

export function DataMapEdges({
  edges,
  selectedId,
  onSelect,
  ghost,
}: {
  edges: EdgeGeom[];
  selectedId: string | null;
  onSelect: (relationId: string) => void;
  ghost: { a: { x: number; y: number }; b: { x: number; y: number } } | null;
}) {
  // The transform container has no intrinsic size (every child is
  // absolutely positioned), so inset-0 sizing collapses to 0x0 and the
  // paths never paint. Explicit giant viewport in board space instead —
  // covers drags into negative coordinates too.
  return (
    <svg
      viewBox="-20000 -20000 40000 40000"
      style={{
        position: "absolute", left: -20000, top: -20000,
        width: 40000, height: 40000, pointerEvents: "none",
      }}
    >
      {edges.map(({ relation: r, a, b }) => {
        const proposed = r.status === "proposed";
        const dismissed = r.status === "dismissed";
        // Dismissed reads as MUTED, not invisible: 0.35-opacity slate on the
        // near-black board was imperceptible — "show dismissed" appeared
        // broken (Shane's report, POV test 2026-07-20).
        const color = dismissed ? "#94a3b8" : proposed ? AMBER : CYAN;
        const selected = selectedId === r.relation_id;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const badge = r.match_den != null && r.match_num != null
          ? `${r.match_num}/${r.match_den}`
          : (!r.from_bound || !r.to_bound) ? "—" : "?";
        const badgeTitle = r.match_den != null
          ? `match survey: ${r.match_num}/${r.match_den} distinct values matched (live against the real tables)`
          : (!r.from_bound || !r.to_bound)
            ? "unbacked — one endpoint's table or column no longer exists"
            : "not surveyed yet";
        return (
          <g key={r.relation_id}>
            {/* wide invisible hit path so edges are clickable */}
            <path
              d={edgePath(a, b)}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onClick={() => onSelect(r.relation_id)}
            />
            <path
              d={edgePath(a, b)}
              fill="none"
              stroke={color}
              strokeWidth={selected ? 2.5 : 1.75}
              strokeDasharray={proposed || dismissed ? "6 5" : undefined}
              opacity={dismissed ? 0.7 : selected ? 1 : 0.8}
            />
            <circle cx={a.x} cy={a.y} r={3} fill={color} opacity={dismissed ? 0.7 : 0.9} />
            <circle cx={b.x} cy={b.y} r={3} fill={color} opacity={dismissed ? 0.7 : 0.9} />
            <g style={{ pointerEvents: "all", cursor: "pointer" }} onClick={() => onSelect(r.relation_id)}>
              <title>{badgeTitle}</title>
              <rect
                x={mx - 24} y={my - 9} width={48} height={18} rx={9}
                fill="rgba(6,12,24,.95)" stroke={color} strokeWidth={1}
              />
              <text
                x={mx} y={my} textAnchor="middle" dominantBaseline="central"
                fontSize={9} fontFamily="ui-monospace, monospace" fontWeight={700}
                fill={color}
              >
                {badge}
              </text>
            </g>
          </g>
        );
      })}
      {ghost && (
        <path
          d={edgePath(ghost.a, ghost.b)}
          fill="none"
          stroke={CYAN}
          strokeWidth={1.75}
          strokeDasharray="2 6"
          opacity={0.7}
        />
      )}
    </svg>
  );
}
