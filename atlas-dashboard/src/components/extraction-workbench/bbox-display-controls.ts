export type BBoxStrokeTarget = "root" | "attachments";

export type BBoxStrokeWidths = Record<BBoxStrokeTarget, number>;

export const DEFAULT_BBOX_STROKE_WIDTHS: BBoxStrokeWidths = {
  root: 2,
  attachments: 2,
};

export const BBOX_STROKE_MIN = 1;
export const BBOX_STROKE_MAX = 8;

export function clampBBoxStrokeWidth(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BBOX_STROKE_WIDTHS.root;
  return Math.max(BBOX_STROKE_MIN, Math.min(BBOX_STROKE_MAX, value));
}
