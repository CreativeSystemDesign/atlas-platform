// Full parts-list identity resolved from the symbol bank (digital-twin depth),
// salvaged from the Extraction Studio component identity model.
export type V2ComponentIdentity = {
  fullSymbol: string;
  family: string;
  description: string;
  partNumber: string;
  location: string;
  sourcePage: string;
  // How the identity was established (mirrors the digital-twin workspace):
  // part_number_attachment_match = joined to the parts list via attached evidence;
  // no_parts_list_match_schematic_attachments = evidence-only fallback.
  matchStatus?: string;
};

// Typed evidence anchored to printed text on the drawing (Shane's digital-twin
// attachment pattern): Ctrl-click text while a component is selected. Identity
// is DERIVED from these via the symbol-bank join — never asserted directly.
// The kind vocabulary is Studio's (canonical) — part_number, spec, wire_label,
// location, ground_label, terminal, terminal_label, text, ...
import type { AttachmentKind as StudioAttachmentKind } from "../extraction-workbench/annotation-model";
export type V2AttachmentKind = StudioAttachmentKind;
export type V2Attachment = {
  id: string;
  kind: V2AttachmentKind;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  source: "ctrl_click" | "agent";
  snapped: boolean;
  createdAt: string;
};

// A terminal-strip row parsed from the printed table (PIN No. | NAME).
// Shane's ruling (2026-07-10): rows dictate terminal pin slots
// (T~TB30~20~N24); the signal NAME (DICOM, EMG(E-STOP)…) is row metadata,
// never the pin slot. Rows conduct in PAIRED sets — left-side and right-side
// ports of one row are one circuit through the screw (nets get RENAMED
// across strips; the row join is what makes cross-strip tracing work).
export type V2StripRow = {
  pin: string; // printed pin designator: "20", "1", "PLATE"
  name?: string; // printed signal name: "DICOM", "EMG(E-STOP)"
  y: number; // the row's line on the page (terminal ↔ row matching)
  portIds: string[]; // ports minted on this row (either side; lazy)
};

export type V2Node = {
  id: string;
  type: "component";
  bbox: { x: number; y: number; width: number; height: number };
  label: string;
  identity?: V2ComponentIdentity | null;
  attachments?: V2Attachment[];
  // Terminal strips are components WITH A TABLE INSIDE — same graph
  // citizen, extra structure. Absent = ordinary component.
  kind?: "strip";
  rows?: V2StripRow[];
};

export type V2Port = {
  id: string;
  parentId: string;
  // terminal: physical connection point on a component (parentId set).
  // junction: the ● dot where a branch taps a continuing conductor — the
  // conductor remains ONE net; a junction is never a terminal and never
  // segments the trunk (see vault: Canonical Wire and Trace Semantics).
  // mate (Shane, 2026-07-09): ONE terminal owned by TWO flush-abutting
  // components — connection by MATING, not by wire (CON20 plug ⇔ CN40B/INV1
  // socket). The dual-parent is the explicit, typed exception to the
  // single-parent law: both parents conduct at this point, electrically and
  // in the data. parentId2 is set ONLY when type === "mate".
  type: "terminal" | "junction" | "mate";
  point: { x: number; y: number };
  label: string;
  parentId2?: string;
};

export type V2Edge = {
  id: string;
  sourcePortId: string;
  targetPortId: string;
  path: { x: number; y: number }[];
  // The wire number (101K, R100, ...), auto-captured from the artwork.
  label?: string | null;
};

// An off-page cross-reference (the boxed sheet/zone marks like 12/9, 11/24).
// Attaches to an explicit wire end when one is there, otherwise to the immediate
// component/system it sits beside.
// A ground reference (the ▽/earth glyph): its own first-class element, NOT a
// component (vault: Canonical Wire and Trace Semantics — ground is distinct,
// and later carries the termination-vs-tap distinction). Placed by the Ground
// tool, which snaps a snug box to the clicked glyph's vector cluster.
export type V2Ground = {
  id: string;
  type: "ground";
  bbox: { x: number; y: number; width: number; height: number };
  label: string; // the ground label if printed (G / FG / PE / E…), else "GND"
};

export type V2Continuation = {
  id: string;
  type: "continuation";
  point: { x: number; y: number };
  sheet: string | null;
  zone: string | null;
  rawRef: string | null;
  // port = a wire continues there; component = device cross-ref; cable = the
  // CABLE continues there (Shane, 2026-07-11: cables never conduct, so their
  // refs bind to the cable BOX — continuity is name-identity via the registry).
  target: { kind: "port" | "component" | "cable"; id: string } | null;
};

// Page-level metadata read off the drawing itself (title block + right-margin
// circuit descriptions): queryable context for every element on the page.
export type V2PageMeta = {
  description?: string;
  description_ja?: string;
  drawing_number?: string;
  sheet_ref?: string; // e.g. "1/207"
  // Right-margin circuit descriptions; `at` is where the printed label sits,
  // so each band can be related back to the elements beside it. Convention:
  // a description always describes the circuit to its LEFT. `bbox` is the
  // printed text extent — rendered as a meta box so it's visually apparent
  // the metadata has been recorded.
  circuits?: { en: string; ja?: string; at?: { x: number; y: number }; bbox?: { x: number; y: number; width: number; height: number } }[];
  description_bbox?: { x: number; y: number; width: number; height: number };
  drawing_number_bbox?: { x: number; y: number; width: number; height: number };
};

// A cable (Shane's design, ratified 2026-07-10): a first-class element that
// NEVER CONDUCTS — electrical continuity flows through wire-number identity;
// the cable is the named physical carrier. The drawn element is a per-page
// VIEW of a document-level cable (the registry, keyed by label, holds the
// shared conductor roster — same name on any page IS the same cable).
export type V2Cable = {
  id: string;
  type: "cable";
  label: string; // the printed cable name (CAB21) — the registry key
  // A BBOX around the printed cable symbol (Shane, 2026-07-10: annotations
  // are YOLO training data — bboxes, never polylines). Touching a terminal
  // strip's bbox auto-links all its conductors into the roster.
  bbox: { x: number; y: number; width: number; height: number };
};

export type V2Graph = {
  nodes: V2Node[];
  ports: V2Port[];
  edges: V2Edge[];
  continuations: V2Continuation[];
  grounds?: V2Ground[];
  cables?: V2Cable[];
  meta?: V2PageMeta;
};

// Interaction modes for the smart canvas. Component/Wire are freehand-first
// Component is a rubber-band DRAG-BOX (Shane 2026-07-09: "click to drag a box"
// — the encircle gesture had swallowed it); Freehand is the encircle-and-snap
// loop as its own tool; Wire traces; Terminal/Continuation are taps; Select
// edits; Ask points things out to the canvas copilot without touching the
// graph. Bless captures Shane's praise as a playbook card (2026-07-06): tap
// excellent work, say why, and the exemplar becomes retrievable doctrine.
export type V2Tool = "select" | "component" | "freehand" | "wire" | "terminal" | "continuation" | "ground" | "connector" | "cable" | "ask" | "bless" | "lasso" | "pen" | "arrow" | "box" | "text";

// Monotonic counters used to mint short auto-labels (COMP-1, T1, W1) without a
// blocking prompt. Kept beside the graph so labels stay stable across undo/redo
// and reloads. Operators rename inline afterwards.
export type V2Counters = {
  component: number;
  terminal: number;
  wire: number;
};

export const EMPTY_V2_GRAPH: V2Graph = { nodes: [], ports: [], edges: [], continuations: [], grounds: [], cables: [] };

// --- Cable registry (document-level, Neon-backed) ---------------------------
// One conductor riding a cable: evidence-grade (the cable-lists-are-hints
// doctrine) — net label when known, printed core/pin and signal name when a
// strip adoption or the cable-table join supplied them. NO electrical
// inference is ever made from this roster.
export type V2CableConductor = {
  net: string | null; // wire number / rail / SPARE
  core?: string; // pin/core designator (from a strip row or the cable table)
  signal?: string; // printed signal name (DICOM, EMG(E-STOP))
  source: "adopt" | "ctrl_click" | "manual" | "table";
};

export type V2CableRegistryEntry = {
  conductors: V2CableConductor[];
  pages: number[]; // where this cable is drawn
  // The printed cable part number (MR-J2M-CN1TBL1M) — machine-level cable
  // identity, Ctrl-click captured, verified later by the cable-table join.
  partNumber?: string;
};

export type V2CableRegistry = Record<string, V2CableRegistryEntry>;
