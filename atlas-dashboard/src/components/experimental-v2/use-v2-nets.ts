"use client";

import { useMemo } from "react";
import { type PageGeometry } from "./v2-snapping";
import { computeNets, withDrawnComponents, type NetColoring, type JunctionOverride } from "./v2-nets";

// Compute per-page net coloring, memoized on geometry identity (which only
// changes when the raw payload or detection settings change) so it never reruns
// on hover/zoom/pan. Drawn components (the annotated graph) bound nets exactly
// like detected ones. Returns null when disabled or geometry isn't loaded yet.
export function useV2Nets(
  geometry: PageGeometry | null,
  enabled: boolean,
  overrides?: Map<string, JunctionOverride>,
  drawnComponents?: { bbox: { x: number; y: number; width: number; height: number }; label?: string | null }[]
): NetColoring | null {
  return useMemo(() => {
    if (!enabled || !geometry) return null;
    return computeNets(withDrawnComponents(geometry, drawnComponents ?? []), overrides);
  }, [enabled, geometry, overrides, drawnComponents]);
}
