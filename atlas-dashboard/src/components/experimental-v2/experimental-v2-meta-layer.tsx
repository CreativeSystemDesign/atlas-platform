"use client";

// Visual layer for recorded page metadata (V2Graph.meta): draws a slate
// dashed box around each captured text region (page title, drawing number,
// right-margin circuit descriptions) with a tiny "meta" tag — so it's
// visually apparent on the canvas that the text has been recorded as data.
// manufacturer convention: a right-margin description describes the circuit to its LEFT.

import React from "react";
import type { V2PageMeta } from "./experimental-v2-types";

const META_STROKE = "#64748b"; // slate — clearly not a component (amber) box

type Box = { x: number; y: number; width: number; height: number };

function MetaBox({ box, tag }: { box: Box; tag: string }) {
  return (
    <g className="pointer-events-none">
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke={META_STROKE}
        strokeWidth={1.5}
        strokeDasharray="6 4"
        rx={3}
      />
      <text x={box.x + 2} y={box.y - 4} fill={META_STROKE} className="text-[10px] font-mono">
        {tag}
      </text>
    </g>
  );
}

export function ExperimentalV2MetaLayer({ meta }: { meta: V2PageMeta | undefined }) {
  if (!meta) return null;
  return (
    <g>
      {meta.description_bbox && <MetaBox box={meta.description_bbox} tag="meta: page title" />}
      {meta.drawing_number_bbox && <MetaBox box={meta.drawing_number_bbox} tag="meta: dwg no." />}
      {(meta.circuits ?? []).map(
        (c, i) => c.bbox && <MetaBox key={`${c.en}-${i}`} box={c.bbox} tag="meta: circuit ←" />
      )}
    </g>
  );
}
