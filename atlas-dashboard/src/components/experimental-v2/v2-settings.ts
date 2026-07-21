// Operator-tunable settings for the smart canvas. Centralized so the settings
// panel, the drawing hook, and rendering all read one source of truth. Persisted
// per-document in localStorage (separate from page graphs).

import type { SnapKind } from "./v2-snapping";
import type { DetectOptions } from "./v2-detect";

// Geometry detection tunables. Sizes are in render-px at the document's fixed
// 300dpi, so they're stable across pages; expose them so dense pages or other
// documents can be tuned. (A future, size-independent path is to classify on
// the vector item type — circle vs line vs rect — once /metadata carries it.)
export type V2DetectSettings = {
  terminalMaxPx: number; // largest blob counted as a terminal circle/dot
  clusterPx: number; // merge blobs whose centers are this close
  componentMinPx: number; // shortest box side that counts as a component
  labelRadiusPx: number; // attach the nearest label within this radius
};

export type V2Settings = {
  snapEnabled: boolean;
  snapRadiusPx: number;
  corridorPx: number; // how far a wire trace may wander from the real wire
  autoLabelTerminals: boolean;
  autoLabelWires: boolean;
  autoLabelComponents: boolean;
  orthogonalWires: boolean; // force H/V (vs. follow exact vector path)
  showGrid: boolean;
  showVectors: boolean;
  showYolo: boolean; // detector evidence layer: see what the model sees before trusting it
  // Ghost terminals: how far to walk OUT along a crossing conductor hunting
  // its printed net label (wire numbers often print far from the component).
  netLabelWalkPx: number;
  // Resize semantics (Shane's ruling, 2026-07-09): terminals sitting on a
  // moved border RIDE it by default — wires follow by port id. Off = resize
  // the box shell only, every terminal keeps its page coordinates. Governs
  // BOTH the hand grips and the copilot's resize op.
  resizeRideTerminals: boolean;
  // Continuation snap (Shane, 2026-07-11): how far a continuation grabs a
  // wire endpoint when placed, dragged, or Ctrl+V-pasted — the anchor that
  // makes the data say "this wire continues". Governs the hand tool, the
  // drag/paste snap, AND the copilot's add_continuation auto-target
  // (page 11's 6/1 refs floated 42px out and bound to nothing).
  contSnapPx: number;
  netColorMode: boolean; // read-only: paint each electrically-connected net a distinct color
  netGlowPx: number; // glow radius for the net wash (0 = crisp lines only)
  netBrightness: number; // brightness multiplier for the net wash (1 = as computed)
  // Which snap targets are active, in priority order.
  snapTargets: Record<SnapKind, boolean>;
  detection: V2DetectSettings;
};

export const DEFAULT_V2_SETTINGS: V2Settings = {
  snapEnabled: true,
  snapRadiusPx: 28,
  corridorPx: 40,
  autoLabelTerminals: true,
  autoLabelWires: true,
  autoLabelComponents: true,
  orthogonalWires: true,
  showGrid: false, // the schematic supplies its own structure; grid is noise
  showVectors: false,
  showYolo: false,
  netLabelWalkPx: 220,
  resizeRideTerminals: true,
  contSnapPx: 40,
  netColorMode: false,
  netGlowPx: 6,
  netBrightness: 1.25,
  snapTargets: { terminal: true, junction: true, endpoint: true, segment: true },
  detection: {
    terminalMaxPx: 42,
    clusterPx: 18,
    componentMinPx: 40,
    labelRadiusPx: 40,
  },
};

// Map the detection settings to the detector's option shape.
export function detectOptionsFrom(s: V2Settings): DetectOptions {
  return {
    terminalMaxPx: s.detection.terminalMaxPx,
    clusterPx: s.detection.clusterPx,
    componentMinPx: s.detection.componentMinPx,
    labelRadiusPx: s.detection.labelRadiusPx,
  };
}

export function enabledSnapKinds(s: V2Settings): Set<SnapKind> {
  const out = new Set<SnapKind>();
  (Object.keys(s.snapTargets) as SnapKind[]).forEach((k) => {
    if (s.snapTargets[k]) out.add(k);
  });
  return out;
}

const KEY_PREFIX = "atlas.v2settings";

export function loadSettings(documentId: string): V2Settings {
  if (typeof window === "undefined") return DEFAULT_V2_SETTINGS;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}:${documentId}`);
    if (!raw) return DEFAULT_V2_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_V2_SETTINGS,
      ...parsed,
      snapTargets: { ...DEFAULT_V2_SETTINGS.snapTargets, ...(parsed.snapTargets ?? {}) },
      detection: { ...DEFAULT_V2_SETTINGS.detection, ...(parsed.detection ?? {}) },
    };
  } catch {
    return DEFAULT_V2_SETTINGS;
  }
}

export function saveSettings(documentId: string, settings: V2Settings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}:${documentId}`, JSON.stringify(settings));
  } catch {
    /* non-fatal */
  }
}
