// Shared types for the live-canvas bridge (canvas <-> agent_server <-> copilot).
// Wire format mirrors agent_server/src/canvas_copilot/{bridge,tools}.py.

export type Point = { x: number; y: number };

// --- Commands (agent -> canvas) ------------------------------------------------

export type HighlightCommand = {
  type: "highlight";
  id: number;
  net_id?: number;
  segments?: number[];
  element_id?: string;
  point?: Point;
  color?: string;
  ttl_ms?: number;
  note?: string;
  // Flag layer (audit → canvas): a highlight tagged kind:"flag" is a live audit
  // violation mirrored onto the page. rule/severity let the pill offer check
  // (dispose false-positive) + hide without parsing the note string.
  kind?: "flag";
  rule?: string;
  severity?: string;
};

export type ViewCommand = {
  type: "view";
  id: number;
  center?: Point;
  zoom?: number;
  page?: number;
  tool?: string;
  net_color_mode?: boolean;
  select_id?: string | null;
};

export type AnnotateCommand = {
  type: "annotate";
  id: number;
  ops: AnnotateOp[];
  reason?: string | null;
  // Stable across server-side resends of the same logical command: the canvas
  // applies each key once and acks duplicates without re-applying.
  idempotency_key?: string;
  // Page the batch was authored for (run-3 prep, 2026-07-06): replays can land
  // minutes later on a canvas showing a DIFFERENT page — run 2 landed on the
  // right page by luck. A stamped command applying on a mismatched page is
  // refused-and-acked, never silently drawn onto the wrong sheet. Unstamped
  // commands (older server) apply as before.
  page?: number;
};

export type BridgeCommand =
  | HighlightCommand
  | ViewCommand
  | AnnotateCommand
  | { type: "clear_highlights"; id: number; kind?: "flag" }
  | { type: "clear_ask_marks"; id: number; marks?: number[] }
  | { type: "toast"; id: number; message: string };

// --- Annotate ops (agent-driven graph mutations) --------------------------------

export type AnnotateOp =
  // auto_terminals: mint a terminal at every printed conductor crossing the
  // border, named T~<owner>~<net> from the printed wire number (the same
  // engine as the drag-box ghost terminals).
  | { op: "add_component"; bbox: { x: number; y: number; width: number; height: number }; label?: string; auto_terminals?: boolean }
  // snap:"artwork" projects the given coordinates onto the nearest PDF vector
  // geometry (junction > endpoint > on-segment) within snap_radius px (default 28).
  | { op: "add_wire"; path: Point[]; label?: string; snap?: "artwork"; snap_radius?: number }
  | { op: "add_terminal"; component_id?: string; point: Point; label?: string; snap?: "artwork"; snap_radius?: number }
  // point is optional when target_id is given (bind-by-id): the executor
  // derives the chip's point from the target — a point-less continuation
  // crashed every later dedupe scan (2026-07-12).
  | { op: "add_continuation"; point?: Point; sheet?: string; zone?: string; raw_ref?: string; target_id?: string }
  // Connector pair (Shane, 2026-07-09): tap the INPUT pin on a connector's
  // border — mints the input terminal, the out-side mate on the opposite
  // border (adopting an aligned existing terminal within 4px when present),
  // and the internal conduction segment. One op per pin.
  | { op: "add_connector_pair"; point: Point; connector_id?: string; label?: string }
  | { op: "move_terminal"; id: string; point: Point }
  // Snap-and-bind a continuation onto a wire endpoint (parity with the canvas
  // drag gesture); open-space points move it and clear stale bindings.
  | { op: "move_continuation"; id: string; point: Point }
  // A first-class ground/earth reference: tap the glyph and the server snaps a
  // snug box to just its enclosing circle (leaving the stem free). Label is the
  // printed ground token (G/FG/PE/E…) when one is nearby, else "GND".
  | { op: "add_ground"; point: Point; label?: string }
  // A cable (never conducts): a BBOX around the printed bundle symbol
  // (YOLO-honest). Label auto-reads the printed cable name (CAB21) unless
  // given. Touching a terminal strip auto-links its conductors.
  | { op: "add_cable"; bbox: { x: number; y: number; width: number; height: number }; label?: string }
  | { op: "set_page_meta"; meta: Record<string, unknown> }
  | { op: "attach"; component_id: string; text: string; bbox: { x: number; y: number; width: number; height: number }; kind?: import("./experimental-v2-types").V2AttachmentKind }
  | { op: "detach"; attachment_id: string }
  | { op: "rename"; id: string; label: string }
  | { op: "reparent"; id: string; component_id: string }
  | { op: "delete"; id: string }
  // Scoped clear: layers = wipe just those; keep = wipe everything else.
  | { op: "clear"; layers?: ("components" | "wires" | "terminals" | "continuations" | "grounds")[]; keep?: ("components" | "wires" | "terminals" | "continuations" | "grounds")[] }
  // Delete every element whose id starts with prefix (e.g. "port-legacy-").
  | { op: "delete_prefix"; prefix: string }
  // Repair legacy dangling junction taps: split trunks through degree<2 junctions.
  | { op: "normalize_taps" }
  | { op: "resize"; id?: string; at?: Point; bbox: { x: number; y: number; width: number; height: number } };

// --- Events (canvas -> agent) ----------------------------------------------------

export type PenTarget = {
  segment_index?: number;
  // The hit artwork segment's actual endpoints (page px) — the copilot's
  // ground truth for "which printed line is Shane touching".
  segment?: { x1: number; y1: number; x2: number; y2: number };
  net_id?: number;
  component_id?: string;
  component_label?: string;
  // Nearest drawn overlay element (the copilot's own wires/terminals) within
  // hit range — so "you drew this wrong" resolves to a concrete graph id.
  element_id?: string;
  element_kind?: "wire" | "terminal" | "junction" | "ground";
  element_label?: string | null;
  element_distance_px?: number;
};

// One selected overlay element in a bless (2026-07-08). A bless can carry
// several (a ground + its border terminals) so the card captures the whole
// pattern, not a single point.
export type BlessTarget = {
  element_id: string;
  element_kind: "ground" | "component" | "terminal" | "junction" | "mate" | "continuation" | "wire";
  element_label?: string | null;
  x: number;
  y: number;
  bbox?: { x: number; y: number; width: number; height: number };
};

export type BridgeEvent =
  | ({ kind: "pen"; phase: "down" | "up"; page: number; x: number; y: number; pointer: string; tool: string } & { target?: PenTarget })
  | { kind: "select"; page: number; element_id: string | null }
  | ({ kind: "ask"; page: number; x: number; y: number; question?: string } & { target?: PenTarget })
  // Lasso (2026-07-08): Shane draws a freehand region to scope the copilot's
  // attention. Like `ask` it's a conversational turn — the region + its bbox
  // ride to the copilot, which frames a capture of the area. `n` is the mark
  // number so message text can reference "the marked area".
  | { kind: "lasso"; page: number; n: number; bbox: { x: number; y: number; width: number; height: number }; points: { x: number; y: number }[]; instruction?: string }
  // Pen (2026-07-08): Shane draws freehand INK on the print. Like the lasso it
  // is a conversational turn — but it's an OPEN stroke anchored to the nearest
  // element (the copilot's own drawn wire/terminal/component, or the printed
  // artwork underneath), not a closed region. "Circle/underline THIS and let's
  // talk about it." bbox frames the ink for capture; anchor is the resolved
  // nearest element so "this" is unambiguous.
  | ({ kind: "pen_mark"; page: number; n: number; bbox: { x: number; y: number; width: number; height: number }; points: { x: number; y: number }[]; instruction?: string } & { anchor?: PenTarget })
  // Arrow mark (v4 mark family): tail→head vector; the head is the subject —
  // it anchors to the nearest element exactly like pen ink does.
  | ({ kind: "arrow"; page: number; n: number; tail: Point; head: Point; instruction?: string } & { anchor?: PenTarget })
  // Text callout (v4 mark family): a pinned note at page coords; the typed
  // text IS the instruction. (Box marks ride kind:"lasso" — a box is just a
  // rectangular region; the server's region contract is unchanged.)
  | ({ kind: "note"; page: number; n: number; x: number; y: number; instruction?: string } & { anchor?: PenTarget })
  // Bless (2026-07-06): Shane taps excellent work and says WHY — the server
  // mints a playbook card (crop + his verbatim text + situation key) so the
  // exemplar becomes retrievable doctrine. text is required: the why IS the card.
  // `targets` (2026-07-08): bless SELECTS the overlay element(s) under the tap
  // (ground/component/terminal/wire), and Ctrl+click adds more into ONE card —
  // so a ground + its two border terminals bless together. `target` stays as the
  // primary (first) selection for back-compat.
  | ({ kind: "bless"; page: number; x: number; y: number; text: string } & { target?: PenTarget; targets?: BlessTarget[] })
  // Apply-receipt for an annotate command: the agent's `annotate` tool blocks on
  // this instead of fire-and-forget. `duplicate` = the key was already applied
  // (server resend landed after the original) so nothing changed. `refused` =
  // the canvas declined to apply (page-mismatch: the command's page stamp
  // differs from the page on screen) — acked so the server stops replaying,
  // but NOTHING was drawn.
  | { kind: "annotate_applied"; command_id: number; key?: string; page: number; ops: number; duplicate?: boolean; refused?: string; stamped_page?: number };

// A numbered point Shane placed with the Ask tool: visible on the canvas,
// painted into copilot captures, and carried in the snapshot as metadata.
export type AskMark = { n: number; x: number; y: number; target?: PenTarget };

// A freehand region Shane lassoed to scope the copilot's attention: the raw
// smoothed loop (page px) plus its bounding box. The region-shaped sibling of
// AskMark — same rails (snapshot → backend frames a capture of the bbox).
// Drawing one is a conversational turn: the region enters the active
// conversation as a captured area the copilot then reasons about.
export type LassoRegion = {
  n: number;
  points: Point[];
  bbox: { x: number; y: number; width: number; height: number };
};

// A freehand ink stroke Shane drew with the Pen tool: the raw smoothed OPEN
// polyline (page px), its bounding box (what the backend frames its capture
// around), and the resolved nearest element it anchors to. The element-anchored
// sibling of LassoRegion (region) and AskMark (point). Drawing one is a
// conversational turn — the ink + its anchor enter the active conversation.
export type PenMark = {
  n: number;
  points: Point[];
  bbox: { x: number; y: number; width: number; height: number };
  anchor?: PenTarget;
};

// Arrow mark: user-ink cyan vector pointing the copilot at something specific.
export type ArrowMark = {
  n: number;
  tail: Point;
  head: Point;
  anchor?: PenTarget;
};

// Box mark: an amber rectangular region (the lasso's right-angled sibling).
export type BoxMark = {
  n: number;
  bbox: { x: number; y: number; width: number; height: number };
};

// Text callout: a pinned label chip anchored to page coords.
export type TextCallout = {
  n: number;
  x: number;
  y: number;
  text: string;
};

// --- Overlay state ----------------------------------------------------------------

export type BridgeHighlight = {
  key: number;
  netId?: number;
  segments?: number[];
  elementId?: string;
  point?: Point;
  color: string;
  note?: string;
  expiresAt: number | null; // epoch ms; null = until cleared
  // Flag-layer identity (audit violation mirrored to the canvas): present only
  // for kind:"flag" highlights. Drives the pill's check/hide affordances.
  kind?: "flag";
  rule?: string;
  severity?: string;
};

export type BridgeToast = { key: number; message: string };
