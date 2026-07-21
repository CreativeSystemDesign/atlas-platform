import type { SnapStrength } from "./studio-types.ts";

export const TIGHT_TEXT_AUTOSNAP_MERGE_SCALE = 0.08;

type SnapStrengthConfig = {
  toleranceScale: number;
  centerFallbackPx: number;
  directShapeFallbackPx: number;
  shapeFallbackPx: number;
  textMergeScale: number;
  componentPaddingScale: number;
};

const SNAP_STRENGTH_CONFIG: Record<SnapStrength, SnapStrengthConfig> = {
  off: {
    toleranceScale: 0,
    centerFallbackPx: 0,
    directShapeFallbackPx: 0,
    shapeFallbackPx: 0,
    textMergeScale: 0,
    componentPaddingScale: 0,
  },
  low: {
    toleranceScale: 0.28,
    centerFallbackPx: 8,
    directShapeFallbackPx: 8,
    shapeFallbackPx: 12,
    textMergeScale: 0.45,
    componentPaddingScale: 0.35,
  },
  normal: {
    toleranceScale: 1,
    centerFallbackPx: 80,
    directShapeFallbackPx: 20,
    shapeFallbackPx: 34,
    textMergeScale: 1,
    componentPaddingScale: 1,
  },
  high: {
    toleranceScale: 1.6,
    centerFallbackPx: 120,
    directShapeFallbackPx: 32,
    shapeFallbackPx: 48,
    textMergeScale: 1.45,
    componentPaddingScale: 1.6,
  },
};

export function snapStrengthConfig(
  strength: SnapStrength = "normal"
): SnapStrengthConfig {
  return SNAP_STRENGTH_CONFIG[strength];
}

export function snapToleranceForZoom({
  strength = "normal",
  zoom,
  normalScreenPx,
  minPagePx,
}: {
  strength?: SnapStrength;
  zoom: number;
  normalScreenPx: number;
  minPagePx: number;
}) {
  const config = snapStrengthConfig(strength);
  if (config.toleranceScale <= 0) return 0;
  return Math.max(minPagePx, (normalScreenPx * config.toleranceScale) / zoom);
}

export function componentSnapPadding({
  strength = "normal",
  normalPaddingPdf,
}: {
  strength?: SnapStrength;
  normalPaddingPdf: number;
}) {
  return normalPaddingPdf * snapStrengthConfig(strength).componentPaddingScale;
}
