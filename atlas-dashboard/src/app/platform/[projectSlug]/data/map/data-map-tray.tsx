"use client";

// The source tray — Shane's toolbar, the old relations tray's design ported
// to the derived-cards world (his ruling, 2026-07-20): sources by FAMILY,
// each row a real table/view with its live row count. Drag a row onto the
// board to place it where you drop it, or click to place. Placed rows dim
// to "on board". Pointer-based drag (not HTML5 DnD) — same input paradigm
// as the board's own gestures.

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, ShieldCheck } from "lucide-react";

import { PT, PT_PANEL_FROST } from "@/lib/platform-theme";

import {
  KIND_COLOR, KIND_LABEL, type CardKind, type Source,
} from "./data-map-types";

const KIND_ORDER: CardKind[] = [
  "extraction", "schematic", "plc", "stock", "downtime", "view", "table",
];

function fmtRows(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function DataMapTray({
  sources,
  placedNames,
  busy,
  onPlace,
  onStartDrag,
  showDismissed,
  dismissedCount,
  onToggleDismissed,
}: {
  /** null = not loaded (backend unreachable) — say so, never "all placed" */
  sources: Source[] | null;
  placedNames: Set<string>;
  /** true while a board switch loads — placing would race the incoming world */
  busy: boolean;
  /** click-place: the page picks a cascade spot */
  onPlace: (tableName: string) => void;
  /** drag-place: the page tracks the pointer; dropping over the board lands
      the card at the drop point */
  onStartDrag: (tableName: string, e: React.PointerEvent) => void;
  showDismissed: boolean;
  dismissedCount: number;
  onToggleDismissed: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hidePlaced, setHidePlaced] = useState(false);

  const byKind = useMemo(() => {
    const m = new Map<CardKind, Source[]>();
    for (const s of sources ?? []) {
      const k = (s.kind ?? "table") as CardKind;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.table_name.localeCompare(b.table_name));
    }
    return m;
  }, [sources]);

  const q = query.trim().toLowerCase();

  return (
    <div
      className="flex h-full w-[250px] shrink-0 flex-col border-r"
      style={{ borderColor: PT.line, background: PT_PANEL_FROST }}
    >
      <div className="border-b px-3 py-2" style={{ borderColor: PT.line }}>
        <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: PT.textFaint }}>
          tables
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ borderColor: PT.lineStrong }}>
          <Search className="h-3 w-3" style={{ color: PT.textGhost }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="find a table"
            className="w-full bg-transparent text-[11px] outline-none"
            style={{ color: PT.text }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sources === null && (
          <div className="px-1.5 py-2 text-[10px]" style={{ color: "#fbbf24" }}>
            table list not loaded — backend unreachable or still starting
          </div>
        )}
        {KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => {
          const matches = byKind.get(kind)!.filter(
            (s) => !q || s.table_name.toLowerCase().includes(q));
          const rows = matches.filter((s) => !hidePlaced || !placedNames.has(s.table_name));
          if (matches.length === 0) return null;
          const hidden = matches.length - rows.length;
          if (rows.length === 0 && hidden === 0) return null;
          const isOpen = open[kind] ?? true;
          return (
            <div key={kind} className="mb-2">
              <button
                type="button"
                onClick={() => setOpen((p) => ({ ...p, [kind]: !isOpen }))}
                className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1 py-1 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3 shrink-0" style={{ color: PT.textGhost }} />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" style={{ color: PT.textGhost }} />
                )}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[kind] }} />
                <span className="truncate text-[11px] font-semibold" style={{ color: PT.text }}>
                  {KIND_LABEL[kind]}
                </span>
                <span className="ml-auto shrink-0 text-[9px] tabular-nums" style={{ color: PT.textGhost }}>
                  {matches.length}
                </span>
              </button>
              {isOpen && (
                <div className="ml-4 mt-0.5 flex flex-col gap-0.5">
                  {hidden > 0 && (
                    <div className="px-1.5 py-0.5 text-[9.5px]" style={{ color: PT.textGhost }}>
                      {hidden} on the board (hidden)
                    </div>
                  )}
                  {rows.map((s) => {
                    const placed = placedNames.has(s.table_name);
                    return (
                      <button
                        key={s.table_name}
                        type="button"
                        disabled={placed || busy}
                        onClick={() => onPlace(s.table_name)}
                        onPointerDown={(e) => {
                          if (placed || busy) return;
                          onStartDrag(s.table_name, e);
                        }}
                        title={busy ? "board is loading…"
                          : placed ? "on the board"
                          : "drag onto the board, or click to place"}
                        className="flex cursor-grab items-center justify-between rounded border-0 bg-transparent px-1.5 py-0.5 text-left text-[11px]"
                        style={{ color: placed ? PT.textGhost : PT.textDim,
                                 opacity: placed ? 0.55 : 1, touchAction: "none" }}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate">{s.table_name}</span>
                          {s.status === "certified" && (
                            <ShieldCheck className="h-2.5 w-2.5 shrink-0" style={{ color: "#34d399" }} />
                          )}
                        </span>
                        <span className="ml-2 shrink-0 text-[9px] tabular-nums" style={{ color: PT.textGhost }}>
                          {placed ? "on board" : fmtRows(s.row_count)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1 border-t px-3 py-2" style={{ borderColor: PT.line }}>
        <label className="flex cursor-pointer items-center gap-2 text-[10px]"
               style={{ color: dismissedCount ? PT.textDim : PT.textGhost }}>
          <input type="checkbox" checked={showDismissed} onChange={onToggleDismissed} />
          show dismissed ({dismissedCount})
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[10px]" style={{ color: PT.textGhost }}
               title="hide tables already placed on this board">
          <input type="checkbox" checked={hidePlaced} onChange={() => setHidePlaced((v) => !v)} />
          hide tables on this board
        </label>
      </div>
    </div>
  );
}
