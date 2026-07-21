"use client";

// Right-click-a-column preview (Shane, 2026-07-18; ported to the Data Map
// 2026-07-20): sample a column's real values live from Neon so you can
// refresh your memory of its actual data shape before drawing a join.
// Distinct + non-blank = the value VOCABULARY, not six identical or empty
// rows. Cards are real tables now, so the physical-table path answers —
// document_id rides along only for legacy extraction resolution.
//
// Self-contained: owns its own fetch, positioned host-relative. Dismissal
// (Escape / outside click) is handled by the board.

import React, { useEffect, useRef, useState } from "react";

import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT } from "@/lib/platform-theme";

type PeekOk = {
  ok: true;
  mode: "column";
  source: "table" | "extraction";
  table: string;
  column: string;
  values: (string | null)[];
  distinct_total: number;
  row_total: number;
};
type PeekMiss = {
  ok: false;
  table: string;
  column: string | null;
  columns?: string[];
  note: string;
};
type PeekResult = PeekOk | PeekMiss;

export type FieldPeek = {
  projectId: string;
  documentId: string | null;
  table: string;
  column: string;
  hostX: number;
  hostY: number;
};

export function FieldPeekPopover({ peek, onClose }: { peek: FieldPeek; onClose: () => void }) {
  const [state, setState] = useState<PeekResult | "loading" | "error">("loading");
  const scrollRef = useRef<HTMLDivElement>(null);

  // The board's wheel-zoom is a native non-passive listener on its host, so a
  // React onWheel can't stop it. Attach our own native listener that stops
  // propagation — the popover scrolls internally, the board doesn't zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", stop, { passive: true });
    return () => el.removeEventListener("wheel", stop);
  }, [state]);

  useEffect(() => {
    let live = true;
    setState("loading");
    const url =
      `${agentBaseUrl()}/projects/${peek.projectId}/schemas/peek` +
      `?table=${encodeURIComponent(peek.table)}&column=${encodeURIComponent(peek.column)}` +
      (peek.documentId ? `&document_id=${encodeURIComponent(peek.documentId)}` : "") +
      `&limit=20`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PeekResult) => { if (live) setState(d); })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [peek.projectId, peek.documentId, peek.table, peek.column]);

  return (
    <div
      data-board-menu
      className="absolute z-40 w-[236px] rounded-xl border p-2 shadow-2xl backdrop-blur-xl"
      style={{
        left: Math.max(8, peek.hostX),
        top: Math.max(8, peek.hostY),
        borderColor: PT.lineStrong,
        background: "rgba(6,12,24,.96)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-bold" style={{ color: PT.text }}>
          <span style={{ color: PT.textGhost }}>{peek.table}.</span>{peek.column}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border-0 bg-transparent px-1 text-[11px] leading-none"
          style={{ color: PT.textGhost }}
          title="close (Esc)"
        >
          ✕
        </button>
      </div>

      {state === "loading" && (
        <div className="px-1 py-2 text-[10px]" style={{ color: PT.textMute }}>
          sampling live values…
        </div>
      )}

      {state === "error" && (
        <div className="px-1 py-2 text-[10px]" style={{ color: "#f87171" }}>
          couldn&apos;t reach the data — backend unreachable
        </div>
      )}

      {state !== "loading" && state !== "error" && state.ok && (
        <>
          <div
            ref={scrollRef}
            className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
          >
            {state.values.length === 0 ? (
              <div className="px-1 py-1 text-[10px]" style={{ color: PT.textMute }}>
                every value is null or blank
              </div>
            ) : (
              state.values.map((v, i) => (
                <div
                  key={i}
                  className="truncate rounded px-1.5 py-0.5 text-[10.5px]"
                  style={{ background: "rgba(34,211,238,.06)", color: PT.text }}
                  title={v ?? ""}
                >
                  {v === "" ? <span style={{ color: PT.textGhost }}>(blank)</span> : v}
                </div>
              ))
            )}
          </div>
          <div className="mt-1.5 border-t pt-1 text-[8.5px] uppercase tracking-[.1em]"
               style={{ borderColor: PT.line, color: PT.textFaint }}>
            {state.values.length} shown · {state.distinct_total} distinct · {state.row_total} rows
            <span style={{ color: PT.textGhost }}> · {state.source}</span>
          </div>
        </>
      )}

      {state !== "loading" && state !== "error" && !state.ok && (
        <div className="px-1 py-1">
          <div className="text-[10px] leading-snug" style={{ color: "#fbbf24" }}>
            {state.note}
          </div>
          {state.columns && state.columns.length > 0 && (
            <div className="mt-1.5 border-t pt-1" style={{ borderColor: PT.line }}>
              <div className="mb-0.5 text-[8.5px] uppercase tracking-[.1em]" style={{ color: PT.textFaint }}>
                live columns
              </div>
              <div className="text-[9.5px] leading-relaxed" style={{ color: PT.textDim }}>
                {state.columns.join(" · ")}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
