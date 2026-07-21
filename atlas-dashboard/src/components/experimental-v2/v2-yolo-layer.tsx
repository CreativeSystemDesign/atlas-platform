"use client";

// YOLO evidence layer (v4 layer pills): the detector's precomputed boxes drawn
// in the copilot's own visual language — short-dash emerald with class +
// confidence tags — so evidence can never be mistaken for drawn truth (the
// amber/blue graph overlay). Pointer-transparent, page-space, read-only.

import React from "react";
import { PAGE_WIDTH_PX, PAGE_HEIGHT_PX } from "../extraction-workbench/studio-types";
import { type YoloDetection } from "./use-v2-yolo";

const STRONG = "#34d399"; // emerald — strong-tier detections
const WEAK = "#6ee7b7"; // paler — everything below

export function V2YoloLayer({ detections }: { detections: YoloDetection[] }) {
  if (detections.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
      viewBox={`0 0 ${PAGE_WIDTH_PX} ${PAGE_HEIGHT_PX}`}
      aria-hidden
    >
      {detections.map((d) => {
        const strong = (d.tier ?? "strong") === "strong";
        const color = strong ? STRONG : WEAK;
        return (
          <g key={d.id} opacity={strong ? 0.9 : 0.55}>
            <rect
              x={d.bbox.x}
              y={d.bbox.y}
              width={d.bbox.width}
              height={d.bbox.height}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="4 3"
            />
            <text
              x={d.bbox.x + 2}
              y={d.bbox.y - 4}
              fontSize={11}
              fontFamily="ui-monospace, monospace"
              fill={color}
            >
              {d.class_name} {(d.confidence * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
