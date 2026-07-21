import { type BBoxPx, MIN_BOX_SIZE } from "./studio-geometry.ts";

const MANUAL_WIRE_THICKNESS_PX = 16;
const MIN_MANUAL_WIRE_LENGTH_PX = 16;

export function normalizeManualWireSegmentBox(
  roughBox: BBoxPx,
  { clampBox }: { clampBox: (box: BBoxPx) => BBoxPx }
): BBoxPx | null {
  const horizontal = roughBox.width >= roughBox.height;
  const length = horizontal ? roughBox.width : roughBox.height;
  if (length < MIN_MANUAL_WIRE_LENGTH_PX) return null;

  const thickness = Math.max(MIN_BOX_SIZE, MANUAL_WIRE_THICKNESS_PX);
  const centerX = roughBox.x + roughBox.width / 2;
  const centerY = roughBox.y + roughBox.height / 2;
  const box = horizontal
    ? {
        x: roughBox.x,
        y: centerY - thickness / 2,
        width: roughBox.width,
        height: thickness,
      }
    : {
        x: centerX - thickness / 2,
        y: roughBox.y,
        width: thickness,
        height: roughBox.height,
      };

  return clampBox(box);
}
