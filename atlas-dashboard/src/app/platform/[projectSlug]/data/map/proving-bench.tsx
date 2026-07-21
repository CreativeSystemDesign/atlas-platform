"use client";

// The Proving Bench (Shane's design, 2026-07-20) — the QBE result panel.
// Picked columns are the SELECT; the drawn contracts above are the JOIN
// clauses. Draw the join on the board and watch the column flood — the
// blank cells under a drawn join ARE the unmatched remainder the survey
// badge counts. Unjoined columns teach instead of sitting silent.

import React from "react";
import { Eraser } from "lucide-react";

import { PT } from "@/lib/platform-theme";

import { kindColor, type BenchPick, type BenchResult, type Card } from "./data-map-types";

export function ProvingBench({
  picks,
  result,
  loading,
  error,
  cards,
  onRemovePick,
  onClear,
}: {
  picks: BenchPick[];
  result: BenchResult | null;
  loading: boolean;
  /** preview failure detail — a stale pick or timed-out join says WHY */
  error: string | null;
  cards: Card[];
  onRemovePick: (table: string, column: string) => void;
  onClear: () => void;
}) {
  const kindOf = (table: string) => cards.find((c) => c.table_name === table)?.kind ?? null;
  const joinedOf = (p: BenchPick): boolean | null => {
    const col = result?.columns.find((c) => c.table === p.table && c.column === p.column);
    return col ? col.joined : null;
  };

  if (picks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <div className="text-[11.5px] font-semibold" style={{ color: PT.textMute }}>
            The Proving Bench — click columns on the cards above to see their real rows here.
          </div>
          <div className="mt-1 text-[10px]" style={{ color: PT.textGhost }}>
            Pick columns from two tables and they stitch together the moment you draw the join.
            What stays blank is what didn&apos;t match — the survey badge, made visible.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* pick chips + stats strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5"
           style={{ borderColor: PT.line }}>
        {picks.map((p) => {
          const joined = joinedOf(p);
          return (
            <button
              key={`${p.table}.${p.column}`}
              type="button"
              onClick={() => onRemovePick(p.table, p.column)}
              className="flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold"
              style={{
                borderColor: joined === false ? "rgba(245,158,11,.5)" : PT.lineStrong,
                color: joined === false ? "#fbbf24" : PT.text,
                background: "rgba(3,8,18,.6)",
              }}
              title={joined === false
                ? "no drawn path to this table — draw a join on the board to populate it (click to remove)"
                : "click to remove from the bench"}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: kindColor(kindOf(p.table)) }} />
              <span style={{ color: PT.textGhost }}>{p.table}.</span>{p.column}
              <span style={{ color: PT.textGhost }}>×</span>
            </button>
          );
        })}
        <div className="min-w-0 flex-1" />
        {error && !loading && (
          <span className="max-w-[420px] shrink-0 truncate text-[9.5px] font-semibold"
                style={{ color: "#f87171" }} title={error}>
            {error}
          </span>
        )}
        {result && !error && (
          <span className="shrink-0 font-mono text-[9.5px]" style={{ color: PT.textDim }}
                title={[
                  result.joins.length
                    ? `stitched via: ${result.joins.map((j) => `${j.via} (${j.semantics})`).join(" · ")}`
                    : "single table — no joins in play",
                  result.skipped_unbacked?.length
                    ? `skipped drifted contracts: ${result.skipped_unbacked.join(" · ")}`
                    : "",
                ].filter(Boolean).join("\n")}>
            {loading ? "stitching…"
              : `${Math.min(result.rows.length, result.row_total)} shown · ${result.row_total.toLocaleString()}${result.row_total_capped ? "+" : ""} rows`}
            {result.joins.length > 0 && !loading && (
              <span style={{ color: "#22d3ee" }}> · {result.joins.length} join{result.joins.length > 1 ? "s" : ""}</span>
            )}
            {!!result.skipped_unbacked?.length && !loading && (
              <span style={{ color: "#fbbf24" }}> · {result.skipped_unbacked.length} drifted contract{result.skipped_unbacked.length > 1 ? "s" : ""} skipped</span>
            )}
          </span>
        )}
        {!result && loading && (
          <span className="shrink-0 font-mono text-[9.5px]" style={{ color: PT.textDim }}>stitching…</span>
        )}
        <button
          type="button"
          onClick={onClear}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold"
          style={{ borderColor: PT.lineStrong, color: PT.textGhost, background: "transparent" }}
          title="clear the bench"
        >
          <Eraser className="h-2.5 w-2.5" /> clear
        </button>
      </div>

      {/* the result grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[10.5px]" style={{ color: PT.text }}>
          <thead>
            <tr>
              {picks.map((p) => {
                const joined = joinedOf(p);
                return (
                  <th
                    key={`${p.table}.${p.column}`}
                    className="sticky top-0 whitespace-nowrap border-b px-2.5 py-1 text-left text-[9px] font-bold uppercase tracking-[.08em]"
                    style={{
                      borderColor: PT.lineStrong,
                      background: "rgba(6,12,24,.98)",
                      color: joined === false ? "#fbbf24" : kindColor(kindOf(p.table)),
                    }}
                    title={joined === false
                      ? `no drawn path from ${result?.base_table ?? "the base table"} to ${p.table} — draw the join above`
                      : `${p.table}.${p.column}`}
                  >
                    {p.column}
                    <span className="ml-1 font-normal normal-case" style={{ color: PT.textGhost }}>
                      {p.table}
                    </span>
                    {joined === false && <span className="ml-1">⚠ unjoined</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(result?.rows ?? []).map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? "rgba(148,163,184,.03)" : "transparent" }}>
                {row.map((v, j) => (
                  <td key={j} className="max-w-[280px] truncate border-b px-2.5 py-0.5"
                      style={{ borderColor: PT.line }}
                      title={v ?? ""}>
                    {v === null
                      ? <span style={{ color: PT.textGhost }}>—</span>
                      : v === "" ? <span style={{ color: PT.textGhost }}>(blank)</span> : v}
                  </td>
                ))}
              </tr>
            ))}
            {result && result.rows.length === 0 && !loading && (
              <tr>
                <td colSpan={picks.length} className="px-3 py-3 text-[10.5px]" style={{ color: PT.textMute }}>
                  no rows — the base table is empty or every row was filtered by scoping
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
