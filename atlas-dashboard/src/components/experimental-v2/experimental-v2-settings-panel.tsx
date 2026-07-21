"use client";

// Smart Canvas settings — Midnight Gallery skin (v4 port, restyle only: every
// setting, handler, and persistence path unchanged). Frost chassis + cyan
// micro-headers matching the copilot rail; InfoTips carry the instructional
// copy per the v4 tooltip contract.

import React from "react";
import { X } from "lucide-react";
import { type V2Settings } from "./v2-settings";
import { type SnapKind } from "./v2-snapping";
import { InfoTip } from "./smart-canvas-infotip";
import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";

type Props = {
  open: boolean;
  settings: V2Settings;
  onChange: (next: V2Settings) => void;
  onClose: () => void;
};

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const row = (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-[11px]" style={{ color: MG.textDim }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
    </label>
  );
  return hint ? <InfoTip title={label} body={hint}>{row}</InfoTip> : row;
}

function Slider({ label, value, min, max, step = 1, unit = "px", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="block py-1">
      <div className="flex items-center justify-between text-[11px]" style={{ color: MG.textDim }}>
        <span>{label}</span>
        <span className="font-mono" style={{ color: MG.textMute }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-cyan-400" />
    </label>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: MG.cyanText }}>
      {children}
    </div>
  );
}

const SNAP_KIND_LABEL: Record<SnapKind, string> = {
  terminal: "Terminals (circles)",
  junction: "Junctions (dots)",
  endpoint: "Wire endpoints",
  segment: "Wire bodies",
};

export function ExperimentalV2SettingsPanel({ open, settings, onChange, onClose }: Props) {
  if (!open) return null;
  const set = (patch: Partial<V2Settings>) => onChange({ ...settings, ...patch });
  const setTarget = (k: SnapKind, v: boolean) =>
    onChange({ ...settings, snapTargets: { ...settings.snapTargets, [k]: v } });
  const setDetect = (k: keyof V2Settings["detection"], v: number) =>
    onChange({ ...settings, detection: { ...settings.detection, [k]: v } });

  const rule = { borderBottom: `1px solid ${MG.line}` };

  return (
    <div
      className="absolute right-4 top-4 z-30 w-72 rounded-[14px] p-3 backdrop-blur-2xl backdrop-saturate-150 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
      style={{ background: MG_PANEL_FROST, border: `1px solid ${MG.lineStrong}` }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MG.cyanText }}>Smart Canvas Settings</h3>
        <button onClick={onClose} className="transition-colors" style={{ color: MG.textMute }}
          onMouseEnter={(e) => (e.currentTarget.style.color = MG.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = MG.textMute)}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1 pb-2" style={rule}>
        <Toggle label="PDF snapping" checked={settings.snapEnabled} onChange={(v) => set({ snapEnabled: v })} hint="Snap drawing to the underlying vector artwork — strokes resolve to the real printed geometry." />
        <Slider label="Snap radius" value={settings.snapRadiusPx} min={8} max={60} onChange={(v) => set({ snapRadiusPx: v })} />
        <Slider label="Wire trace tolerance" value={settings.corridorPx} min={12} max={90} onChange={(v) => set({ corridorPx: v })} />
      </div>

      <div className="space-y-1 py-2" style={rule}>
        <SectionHead>Snap targets (priority order)</SectionHead>
        {(Object.keys(SNAP_KIND_LABEL) as SnapKind[]).map((k) => (
          <Toggle key={k} label={SNAP_KIND_LABEL[k]} checked={settings.snapTargets[k]} onChange={(v) => setTarget(k, v)} />
        ))}
      </div>

      <div className="space-y-1 py-2" style={rule}>
        <SectionHead>Auto-labeling</SectionHead>
        <Toggle label="Terminals from circle numbers" checked={settings.autoLabelTerminals} onChange={(v) => set({ autoLabelTerminals: v })} />
        <Toggle label="Wires from wire numbers" checked={settings.autoLabelWires} onChange={(v) => set({ autoLabelWires: v })} />
        <Toggle label="Components from designators" checked={settings.autoLabelComponents} onChange={(v) => set({ autoLabelComponents: v })} />
      </div>

      <div className="space-y-1 py-2" style={rule}>
        <SectionHead>Detection (per-document, 300dpi px)</SectionHead>
        <Slider label="Terminal max size" value={settings.detection.terminalMaxPx} min={12} max={80} onChange={(v) => setDetect("terminalMaxPx", v)} />
        <Slider label="Terminal cluster gap" value={settings.detection.clusterPx} min={4} max={40} onChange={(v) => setDetect("clusterPx", v)} />
        <Slider label="Component min size" value={settings.detection.componentMinPx} min={20} max={120} onChange={(v) => setDetect("componentMinPx", v)} />
        <Slider label="Label search radius" value={settings.detection.labelRadiusPx} min={12} max={90} onChange={(v) => setDetect("labelRadiusPx", v)} />
        <Slider label="Terminal net-label walk" value={settings.netLabelWalkPx} min={60} max={500} step={20} onChange={(v) => set({ netLabelWalkPx: v })} />
        <Slider label="Continuation snap" value={settings.contSnapPx} min={5} max={80} step={5} onChange={(v) => set({ contSnapPx: v })} />
      </div>

      <div className="space-y-1 pt-2">
        <Toggle label="Orthogonal wires (H/V only)" checked={settings.orthogonalWires} onChange={(v) => set({ orthogonalWires: v })} />
        <Toggle label="Terminals ride resized borders" checked={settings.resizeRideTerminals} onChange={(v) => set({ resizeRideTerminals: v })} hint="When a box is resized — by grip or by Arc — terminals sitting on a moved border move with it and their wires follow. Off resizes the box shell only, leaving every terminal at its page coordinates." />
        <Toggle label="Show PDF vector overlay" checked={settings.showVectors} onChange={(v) => set({ showVectors: v })} />
        <Toggle label="Detector evidence (YOLO)" checked={settings.showYolo} onChange={(v) => set({ showYolo: v })} hint="The model's precomputed detections — emerald short-dash evidence, never drawn truth. Same switch as the viewport YOLO pill." />
        <Toggle label="Net color mode" checked={settings.netColorMode} onChange={(v) => set({ netColorMode: v })} hint="Paint each electrically-connected net a distinct color — spot shorts (merged colors) and opens (a wire split into two colors)." />
        <Slider label="Net glow" value={settings.netGlowPx} min={0} max={16} onChange={(v) => set({ netGlowPx: v })} />
        <Slider label="Net brightness" value={settings.netBrightness} min={0.5} max={2} step={0.05} unit="×" onChange={(v) => set({ netBrightness: v })} />
        <Toggle label="Show alignment grid" checked={settings.showGrid} onChange={(v) => set({ showGrid: v })} />
      </div>
    </div>
  );
}
