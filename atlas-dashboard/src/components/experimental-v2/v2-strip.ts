// Terminal strips (Shane's design, 2026-07-10): a strip is a COMPONENT with a
// printed table inside (PIN No. | NAME) — same graph citizen, extra structure.
// Rows are extracted from the vector text and become the source of truth for
// terminal pin slots (T~TB30~20~N24); the signal NAME (DICOM, EMG(E-STOP)…)
// rides as row metadata and never pollutes the pin slot. Rows conduct in
// PAIRED sets: a row's left-side and right-side ports are one circuit through
// the screw — minted LAZILY (the conduction edge appears only when both sides
// exist), because strips are where nets get RENAMED and that join is what
// makes cross-strip tracing work.
//
// Print facts this extractor is calibrated to (TB30, page 9 of the reference print):
//   - pin numbers arrive as PER-DIGIT text fragments ("20" = "2" + "0";
//     "PLATE" = "P" + "LA" + "TE") — merge within a row band, x-ordered
//   - two-line names: "EMG" + "(E-STOP)" ~20px below → "EMG(E-STOP)"
//   - variable row pitch WITH blank rows — anchor rows on pin tokens only
//   - the header band ("PIN No." | "NAME") has no pin token → self-excludes

import type { PageGeometry } from "./v2-snapping";
import type { V2Graph, V2Node, V2StripRow } from "./experimental-v2-types";

type Bbox = { x: number; y: number; width: number; height: number };

/** A dragged box containing at least this many parsed rows classifies as a
 *  strip. Below it, table-ish text is treated as ordinary component art. */
export const STRIP_MIN_ROWS = 4;

// Fragments of one pin number share a baseline; the NAME's continuation line
// prints ~20px below its primary. Measured on TB30 (row pitch 80-160px).
const BAND_TOL = 14;
const SUBLINE_MAX = 34;

const PIN_RE = /^(?:\d{1,3}|PLATE)$/;

export function extractStripRows(bbox: Bbox, geom: PageGeometry | null): V2StripRow[] {
  if (!geom || bbox.width < 60 || bbox.height < 60) return [];
  const x1 = bbox.x + bbox.width, y1 = bbox.y + bbox.height;
  const inBox = geom.texts.filter(
    (t) => t.center.x > bbox.x && t.center.x < x1 && t.center.y > bbox.y && t.center.y < y1
  );
  if (inBox.length === 0) return [];
  // The pin column lives in the left part of the table; names to its right.
  const leftMax = bbox.x + bbox.width * 0.45;
  const pinFrags = inBox
    .filter((t) => t.center.x <= leftMax && /^[A-Z0-9.]{1,5}$/.test(t.text.trim()))
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
  // Band the fragments by baseline, merge x-ordered, validate the merge.
  const rows: V2StripRow[] = [];
  let band: typeof pinFrags = [];
  const flush = () => {
    if (band.length === 0) return;
    const pin = band
      .slice()
      .sort((a, b) => a.center.x - b.center.x)
      .map((t) => t.text.trim())
      .join("");
    const y = band.reduce((s, t) => s + t.center.y, 0) / band.length;
    if (PIN_RE.test(pin)) rows.push({ pin, y: Math.round(y), portIds: [] });
    band = [];
  };
  for (const f of pinFrags) {
    if (band.length > 0 && f.center.y - band[band.length - 1].center.y > BAND_TOL) flush();
    band.push(f);
  }
  flush();
  if (rows.length === 0) return [];
  // Names: right-side tokens claim the nearest row band; a continuation line
  // (typically "(...)") joins the row above it. Verbatim, x-ordered, joined
  // without a space before "(" — EMG + (E-STOP) reads as printed.
  const nameFrags = inBox
    .filter((t) => t.center.x > leftMax && t.text.trim().length > 0)
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x);
  for (const row of rows) {
    const parts = nameFrags
      .filter((t) => Math.abs(t.center.y - row.y) <= BAND_TOL ||
        (t.center.y > row.y + BAND_TOL && t.center.y <= row.y + SUBLINE_MAX))
      .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)
      .map((t) => t.text.trim());
    if (parts.length > 0) {
      row.name = parts.reduce((s, p) => (p.startsWith("(") || s === "" ? s + p : `${s} ${p}`), "");
    }
  }
  return rows;
}

/** Strip designators print ABOVE the table (TB30 over "CONNECTOR TERMINAL"
 *  over the header row) — the tight, YOLO-honest box excludes them, and the
 *  table's own header words ("NAME") would otherwise win the label engine's
 *  inside zone. Nearest designator-shaped token above the box wins. */
const TITLE_RE = /^[A-Z]{1,4}\d{1,4}[A-Z]?$/;
export function stripTitleAbove(
  bbox: Bbox,
  geom: PageGeometry | null,
  reachPx = 150
): string | null {
  if (!geom) return null;
  const x1 = bbox.x + bbox.width;
  const above = geom.texts
    .filter((t) => t.center.y < bbox.y && t.center.y > bbox.y - reachPx && t.center.x > bbox.x && t.center.x < x1)
    .sort((a, b) => bbox.y - a.center.y - (bbox.y - b.center.y));
  for (const t of above) {
    const tok = t.text.trim().toUpperCase();
    if (TITLE_RE.test(tok)) return tok;
  }
  return null;
}

/** The row a border crossing belongs to — nearest by the row's printed line,
 *  within half the tightest observed pitch. Null = not a row's wire. */
export function rowForY(rows: V2StripRow[], y: number, tolPx = 40): V2StripRow | null {
  let best: V2StripRow | null = null;
  let d = tolPx;
  for (const r of rows) {
    const dd = Math.abs(r.y - y);
    if (dd <= d) { d = dd; best = r; }
  }
  return best;
}

// --- Cable ⇄ strip linking (Shane, 2026-07-10: "when it touches it links
// all conductors" — geometric adoption, previewed as a chain-link ghost
// while dragging, committed automatically on release) -----------------------

export const CABLE_TOUCH_TOL = 14;

export function bboxesTouch(a: Bbox, b: Bbox, tol = CABLE_TOUCH_TOL): boolean {
  return (
    a.x <= b.x + b.width + tol && b.x <= a.x + a.width + tol &&
    a.y <= b.y + b.height + tol && b.y <= a.y + a.height + tol
  );
}

/** Where the link ghost sits: the midpoint of the overlap between the two
 *  (tolerance-expanded) boxes — visually, the point of contact. */
export function touchPoint(a: Bbox, b: Bbox, tol = CABLE_TOUCH_TOL): { x: number; y: number } {
  const x0 = Math.max(a.x - tol, b.x), x1 = Math.min(a.x + a.width + tol, b.x + b.width);
  const y0 = Math.max(a.y - tol, b.y), y1 = Math.min(a.y + a.height + tol, b.y + b.height);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** The strips a cable bbox touches — the auto-link candidates. Pure; shared
 *  by the mid-drag ghost preview and the commit-time adoption. */
export function stripsTouchingBox(
  nodes: V2Node[],
  bbox: Bbox,
  tol = CABLE_TOUCH_TOL
): V2Node[] {
  return nodes.filter((n) => n.kind === "strip" && n.rows && bboxesTouch(bbox, n.bbox, tol));
}

/** The conductor entries adopting `strip` would add — {core=pin, signal, net}
 *  triples; unwired rows ride as SPARE (the cable table enumerates those
 *  cores too). Pure: dedupe against `existingCores` so re-touching is a
 *  no-op, never a duplicate. */
export function adoptionEntries(
  strip: V2Node,
  ports: { id: string; label: string }[],
  existingCores: Set<string>
): { net: string; core: string; signal?: string; source: "adopt" }[] {
  const out: { net: string; core: string; signal?: string; source: "adopt" }[] = [];
  for (const row of strip.rows ?? []) {
    if (existingCores.has(row.pin)) continue;
    const port = row.portIds.map((pid) => ports.find((p) => p.id === pid)).find(Boolean);
    const net = port ? port.label.split("~").pop() ?? "SPARE" : "SPARE";
    out.push({ net, core: row.pin, signal: row.name, source: "adopt" });
  }
  return out;
}

/** Component-side linking (Shane, 2026-07-10: cables between two components,
 *  page 8): a component's terminals within the CABLE's box (+tolerance) are
 *  the conductors entering the bundle — proximity, not identity, because a
 *  cable touching INV70 carries only the pins under its landing, never all
 *  20 terminals. Only convention-named ports qualify (T~owner~[pin~]net);
 *  counter-named pins carry no net worth adopting. */
export function portsTouchingBox(
  ports: { id: string; parentId: string; type: string; label: string; point: { x: number; y: number } }[],
  bbox: Bbox,
  tol = CABLE_TOUCH_TOL
): { parentId: string; core?: string; net: string; point: { x: number; y: number } }[] {
  const out: { parentId: string; core?: string; net: string; point: { x: number; y: number } }[] = [];
  for (const p of ports) {
    if (p.type === "junction") continue;
    if (
      p.point.x < bbox.x - tol || p.point.x > bbox.x + bbox.width + tol ||
      p.point.y < bbox.y - tol || p.point.y > bbox.y + bbox.height + tol
    ) continue;
    const parts = p.label.split("~");
    if (parts.length < 3 || parts[0] !== "T") continue; // counter names carry no net
    const net = parts[parts.length - 1];
    const core = parts.length >= 4 ? parts[2] : undefined;
    out.push({ parentId: p.parentId, core, net, point: p.point });
  }
  return out;
}

/** Lazy row-paired conduction: when a row has ports on BOTH side borders,
 *  mint the internal conduction edge (once). The strip's electrical law —
 *  rows conduct across, never to each other. Returns notes for receipts. */
export function ensureRowConduction(
  draft: V2Graph,
  node: V2Node,
  mkId: () => string
): string[] {
  const notes: string[] = [];
  if (node.kind !== "strip" || !node.rows) return notes;
  const xL = node.bbox.x, xR = node.bbox.x + node.bbox.width;
  for (const row of node.rows) {
    const ports = row.portIds
      .map((id) => draft.ports.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    const left = ports.find((p) => Math.abs(p.point.x - xL) <= 8);
    const right = ports.find((p) => Math.abs(p.point.x - xR) <= 8);
    if (!left || !right) continue;
    const joined = draft.edges.some(
      (e) =>
        (e.sourcePortId === left.id && e.targetPortId === right.id) ||
        (e.sourcePortId === right.id && e.targetPortId === left.id)
    );
    if (joined) continue;
    draft.edges.push({
      id: mkId(),
      sourcePortId: left.id,
      targetPortId: right.id,
      path: [{ ...left.point }, { ...right.point }],
      label: null,
    });
    notes.push(`row ${row.pin}: left and right pins joined (one circuit through the screw)`);
  }
  return notes;
}
