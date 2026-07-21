// Data Map — shared types + card geometry constants. Cards are DERIVED
// (2026-07-20 remodel): a card IS a real Postgres table/view; the backend
// sends its live columns/rows/status and stores only placement + prose.
// Anchors are computed ARITHMETICALLY from these constants (no DOM
// measuring), so the card component and the edge layer must agree through
// this file alone.

export type CardKind =
  | "extraction" | "schematic" | "plc" | "stock" | "downtime" | "view" | "table";

export type Source = {
  table_name: string;
  source_type: "table" | "view" | null;
  kind: CardKind | null;
  status: string | null;          // 'certified' | 'draft' | null (non-extraction)
  document_id: string | null;
  columns: string[];
  row_count: number;
};

export type Card = Source & {
  x: number;
  y: number;
  collapsed: boolean;
  missing: boolean;               // the table vanished under the card
  description: string | null;
  provenance: string | null;      // e.g. the deep-agent scout-evidence flag
  field_notes: Record<string, string>;
};

export type Board = {
  board_id: string;
  name: string;
  is_default: boolean;
  seed_arc: boolean;
  settings: { hide_unplaced?: boolean } | null;
  created_at: string | null;
  updated_at: string | null;
};

export type Relation = {
  relation_id: string;
  board_id: string | null;
  from_document_id: string;
  from_table: string;
  from_field: string;
  to_document_id: string;
  to_table: string;
  to_field: string;
  semantics: "exact" | "membership" | "vocabulary";
  status: "proposed" | "drawn" | "dismissed";
  origin: string;
  basis: string | null;
  notes: string | null;
  match_num: number | null;
  match_den: number | null;
  matched_at: string | null;
  from_bound: boolean;
  to_bound: boolean;
};

export type BenchPick = { table: string; column: string };

export type BenchColumn = BenchPick & { joined: boolean };

export type BenchResult = {
  board_id: string;
  base_table: string;
  columns: BenchColumn[];
  rows: (string | null)[][];
  row_total: number;
  /** true when the true total exceeds the count cap — display "N+" */
  row_total_capped?: boolean;
  joins: { table: string; via: string; semantics: string }[];
  unreachable: string[];
  /** drawn contracts skipped because an endpoint column no longer exists */
  skipped_unbacked?: string[];
};

export const CARD_W = 248;
export const HEADER_H = 46;
export const ROW_H = 22;
export const FIELDS_PAD = 6;
export const COLLAPSED_H = HEADER_H;

export function cardHeight(columnCount: number, collapsed: boolean): number {
  if (collapsed) return COLLAPSED_H;
  return HEADER_H + FIELDS_PAD * 2 + columnCount * ROW_H;
}

/** Board-space anchor of a column row's connection point on one card side. */
export function fieldAnchor(
  pos: { x: number; y: number },
  fieldIndex: number,
  collapsed: boolean,
  side: "left" | "right"
): { x: number; y: number } {
  const x = side === "left" ? pos.x : pos.x + CARD_W;
  if (collapsed) return { x, y: pos.y + COLLAPSED_H / 2 };
  return { x, y: pos.y + HEADER_H + FIELDS_PAD + fieldIndex * ROW_H + ROW_H / 2 };
}

// Family identity colors — by SOURCE KIND (the document palette died with
// the schema-card world; a table's family is what orients you now).
export const KIND_COLOR: Record<CardKind, string> = {
  extraction: "#22d3ee", // cyan — the certified extraction family
  schematic: "#a78bfa",  // violet — the annotation graph views
  plc: "#f59e0b",        // amber — deep-agent scout evidence
  stock: "#34d399",      // emerald — plant stock cage
  downtime: "#fb923c",   // orange — downtime history
  view: "#60a5fa",       // blue — convenience views
  table: "#94a3b8",      // slate — anything else
};

export const KIND_LABEL: Record<CardKind, string> = {
  extraction: "extraction",
  schematic: "schematic graph",
  plc: "PLC · scout evidence",
  stock: "stock cage",
  downtime: "downtime",
  view: "view",
  table: "table",
};

export const SEMANTICS_LABEL: Record<Relation["semantics"], string> = {
  exact: "exact — values equal as printed",
  membership: "membership — value is a member of the other side's cell/list",
  vocabulary: "vocabulary — same code, normalized ((PP) = PP = ＰＰ)",
};

export function kindColor(kind: CardKind | null): string {
  return KIND_COLOR[kind ?? "table"];
}
