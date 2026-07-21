// Fit-relative zoom — single source of truth (v4 port, Shane's spec).
// The page opens framed whole (fit-to-screen = 100%) and zooms IN from there.
// Max raised to 600% (Shane, 2026-07-09): dense sheets need deeper magnification
// than 400% under the fit-relative basis.

export const FIT_MARGIN = 0.98; // whisper of breathing room around the sheet
export const MAX_ZOOM_OF_FIT = 6; // 600% — deep enough for the densest pages
export const FALLBACK_FIT = 0.4; // pre-measure fallback only (first frame)

export function computeFitZoom(
  viewportW: number,
  viewportH: number,
  pageW: number,
  pageH: number
): number {
  return Math.min(viewportW / pageW, viewportH / pageH) * FIT_MARGIN;
}

/** Clamp an absolute zoom into the fit-relative range [100%, MAX_ZOOM_OF_FIT×]. */
export function clampToFit(z: number, fit: number | null | undefined): number {
  const f = fit || FALLBACK_FIT;
  return Math.min(f * MAX_ZOOM_OF_FIT, Math.max(f, z));
}
