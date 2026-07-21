import { describe, it, expect } from "vitest";
import { groundClusterAtPoint } from "../v2-snapping";
import type { PageGeometry } from "../v2-snapping";

// Only `segments` is read by groundClusterAtPoint — a minimal geometry suffices.
function geom(segments: { x1: number; y1: number; x2: number; y2: number }[]): PageGeometry {
  return { segments } as unknown as PageGeometry;
}

// An IEC earth glyph: a stem (y90→100) into three decreasing horizontal bars
// (y100/105/110), PLUS a long conductor dropping away (y100→400) that the glyph
// connects to. The snap must hug the glyph and NOT crawl down the conductor.
const GLYPH = [
  { x1: 100, y1: 90, x2: 100, y2: 100 }, // stem
  { x1: 90, y1: 100, x2: 110, y2: 100 }, // top bar
  { x1: 93, y1: 105, x2: 107, y2: 105 }, // mid bar
  { x1: 96, y1: 110, x2: 104, y2: 110 }, // bottom bar
];
const RUNAWAY_WIRE = { x1: 100, y1: 100, x2: 100, y2: 400 }; // attached at the stem top

// A ground drawn as an enclosing circle: every raw shape becomes a segment
// spanning its bbox corners, so the circle is a DIAGONAL 45x45 segment. The
// earth glyph (stem + shrinking bars) sits inside/below, the stem exits above.
// (Real page-7 numbers, ground 1.)
const CIRCLE = { x1: 591, y1: 679, x2: 636, y2: 724 }; // 45x45 circle bbox
const EARTH = [
  { x1: 614, y1: 668, x2: 614, y2: 701 }, // stem — exits ABOVE the circle top
  { x1: 597, y1: 701, x2: 630, y2: 701 }, // top bar
  { x1: 605, y1: 710, x2: 622, y2: 710 }, // mid bar
  { x1: 609, y1: 718, x2: 618, y2: 718 }, // bottom bar
];

describe("groundClusterAtPoint", () => {
  it("hugs just the enclosing circle, leaving the stem/bars free", () => {
    const bbox = groundClusterAtPoint(geom([CIRCLE, ...EARTH]), { x: 613, y: 701 });
    expect(bbox).not.toBeNull();
    // Box must be ~circle size (45 + small pad), NOT stretched up to the stem.
    expect(bbox!.width).toBeGreaterThan(43);
    expect(bbox!.width).toBeLessThan(52);
    expect(bbox!.height).toBeGreaterThan(43);
    expect(bbox!.height).toBeLessThan(52);
    // Top edge sits at the circle (679), not the stem top (668).
    expect(bbox!.y).toBeGreaterThan(674);
  });

  it("hugs a bare earth glyph and does not run down the attached conductor", () => {
    const bbox = groundClusterAtPoint(geom([...GLYPH, RUNAWAY_WIRE]), { x: 100, y: 103 });
    expect(bbox).not.toBeNull();
    // Glyph is ~20px tall (y90..110). The wire would blow height to ~300 — rejected.
    expect(bbox!.height).toBeLessThan(60);
    expect(bbox!.width).toBeLessThan(60);
    expect(bbox!.y).toBeGreaterThan(80);
    expect(bbox!.y).toBeLessThan(95);
  });

  it("returns null when the tap misses all artwork", () => {
    expect(groundClusterAtPoint(geom(GLYPH), { x: 900, y: 900 })).toBeNull();
  });

  it("returns null with no geometry", () => {
    expect(groundClusterAtPoint(null, { x: 100, y: 100 })).toBeNull();
  });
});
