"use client";

// Layer toggle pills (v4 mockup port): YOLO / Nets / Vectors as first-class
// viewport controls — the render paths lived buried in the settings panel.
// Wired to the SAME v2-settings flags so panel and pills never disagree.

import React from "react";
import { InfoTip } from "./smart-canvas-infotip";
import { MG } from "./smart-canvas-theme";

export type LayerKey = "showYolo" | "netColorMode" | "showVectors";

type PillDef = {
  key: LayerKey;
  label: string;
  tip: { title: string; body: string };
};

const PILLS: PillDef[] = [
  { key: "showYolo", label: "YOLO", tip: { title: "Detector evidence", body: "The model's precomputed detections, short-dash emerald with class + confidence — spot what the model sees before you trust it. Evidence only; never drawn truth." } },
  { key: "netColorMode", label: "Nets", tip: { title: "Net continuity", body: "Paint each electrically-connected net a distinct color — shorts show as merged colors, opens as one wire split into two." } },
  { key: "showVectors", label: "Vectors", tip: { title: "PDF vector overlay", body: "The page's raw printed geometry — the artwork your strokes snap to." } },
];

const ON: React.CSSProperties = {
  border: "1px solid rgba(34,211,238,.5)",
  background: "rgba(14,116,144,.3)",
  color: "#a5f3fc",
};
const OFF: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.18)",
  background: "rgba(6,11,22,.8)",
  color: "#5b6778",
};

export function SmartCanvasLayerPills({
  values,
  onToggle,
}: {
  values: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey, next: boolean) => void;
}) {
  // Inline cluster — lives in the canvas toolbar (the canvas card owns its
  // controls), not floating over the sheet.
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="mr-0.5 text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: MG.textFaint }}>
        Layers
      </span>
      {PILLS.map((p) => (
        <InfoTip key={p.key} title={p.tip.title} body={p.tip.body}>
          <button
            type="button"
            onClick={() => onToggle(p.key, !values[p.key])}
            className="cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors"
            style={values[p.key] ? ON : OFF}
            aria-pressed={values[p.key]}
          >
            {p.label}
          </button>
        </InfoTip>
      ))}
    </div>
  );
}
