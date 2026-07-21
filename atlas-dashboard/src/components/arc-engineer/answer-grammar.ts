// Answer grammar v0 — the declarative composition Arc emits and the
// presentation canvas renders (design: docs/vault/Arc Industrial Engineer —
// Design.md §5). Generative at composition time, deterministic at render
// time. Claim-bearing primitives REQUIRE anchor fields — a step without a
// source cannot render (enforced by the renderer, later by the server).
//
// Phase 1 (UI): the layouts come from manufactured fixtures; the types are
// the real contract the backend will validate against in later phases.

/** Where a claim comes from — document/page (bbox arrives with real data).
    No trust field: everything Arc can see IS certified by construction
    (Shane, 2026-07-17) — certification is the seat's precondition, never a
    per-claim badge. */
export interface Anchor {
  document: string;
  page: number;
  /** Page-space crop region, when the source supports row-level location. */
  bbox?: [number, number, number, number];
}

/** A rendered print region shown beside the analysis. In phase 1 the crop
    is manufactured artwork keyed by `sketch`. */
export interface DocCrop {
  kind: "doc_crop";
  anchor: Anchor;
  caption?: string;
  /** Which manufactured print fragment to draw (phase-1 stand-in for a
      real render of anchor.document/page/bbox). */
  sketch: "coil" | "cable-run" | "terminal-strip" | "parts-row" | "plc-output";
  /** Text the crop highlights (drawn as the find-marker on the fragment). */
  highlight?: string;
}

export interface Narrative {
  kind: "narrative";
  text: string;
}

/** One side of a connection: a physical landing point inside an enclosure
    or system ("TB-A : 7" in "JB-3 · junction box"). */
export interface Endpoint {
  enclosure: string;
  point: string;
}

/** The whole route at a glance — the systems the circuit crosses, in path
    order (RULED 2026-07-17: a trace is laid out by connection, origination
    → termination). vias[i] labels the leg stops[i] → stops[i+1]. */
export interface RouteRibbon {
  kind: "route";
  stops: { label: string; sublabel?: string }[];
  vias?: (string | null)[];
}

export interface KeyValue {
  kind: "key_value";
  anchor?: Anchor;
  rows: { key: string; value: string }[];
}

export interface DataTable {
  kind: "table";
  anchor: Anchor;
  caption?: string;
  columns: string[];
  rows: string[][];
}

/** A hop the data doesn't cover yet — rendered quietly and honestly (no
    alarm chrome; Shane, 2026-07-17). */
export interface GapNotice {
  kind: "gap";
  reason: string;
  closes_with?: string;
}

export interface Callout {
  kind: "callout";
  tone: "info" | "caution";
  text: string;
}

/** One CONNECTION of a trace (RULED 2026-07-17): the conductor leaves
    `from`, travels `via`, and lands at `to` — steps follow the path in
    order, never topical groupings. THE CHAIN RULE: the last location of one
    step IS the first location of the next (step N's `to` = step N+1's
    `from`); titles read "A to B". */
export interface TraceStep {
  kind: "step";
  /** Engine step id — narration references these; phase 1 manufactures them. */
  id: string;
  title: string;
  claim: string;
  anchor: Anchor;
  from?: Endpoint;
  to?: Endpoint;
  /** What carries the connection: wire label, cable + conductor, the load. */
  via?: string;
  body?: ContentNode[];
}

export interface StepList {
  kind: "step_list";
  steps: (TraceStep | GapNotice)[];
}

// Layout primitives.
export interface Stack {
  kind: "stack";
  children: AnswerNode[];
}
export interface Columns {
  kind: "columns";
  children: AnswerNode[];
}
export interface Card {
  kind: "card";
  title?: string;
  children: AnswerNode[];
}

export type ContentNode =
  | Narrative
  | RouteRibbon
  | KeyValue
  | DataTable
  | DocCrop
  | GapNotice
  | Callout;
export type AnswerNode = Stack | Columns | Card | StepList | ContentNode;

/** A full answer pushed to the presentation canvas. */
export interface AnswerLayout {
  /** Canvas headline — what was asked, resolved. */
  title: string;
  subtitle?: string;
  root: AnswerNode;
}
