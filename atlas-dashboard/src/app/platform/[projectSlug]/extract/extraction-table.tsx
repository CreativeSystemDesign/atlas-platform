"use client";

// The one bottom panel of the Data › Extraction workbench: the single
// data-extraction table for this document. Its NAME and COLUMNS are the
// schema Arc and Shane design together (the column designer); its ROWS are
// the extracted data Arc writes and Shane edits. This table is its own thing
// in Neon (document_extractions) — nothing to do with the Schema-Builder's
// tables. Verify banks it; compare checks it against an earlier pass of the
// same document. Every write is Shane-gated.

import { useEffect, useMemo, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_STATUS } from "@/lib/platform-theme";

const DEFAULT_COL_W = 150;   // px, a fresh column's width before any resize
const IDX_W = 46;            // the # (row index) column
const PG_W = 46;             // the pg (source page) column
const ACT_W = 34;            // the trailing row-action column

type SortState = { field: string; dir: "asc" | "desc" } | null;

// Value a row contributes to a sort/compare on a given field. __idx/__pg are
// the fixed row-index and page columns; everything else is a data cell.
function sortVal(r: Row, field: string): string | number {
  if (field === "__idx") return r.row_index;
  if (field === "__pg") return r.source_page ?? Number.NEGATIVE_INFINITY;
  return r.row_data[field] ?? "";
}

// Numeric-aware compare — "X241" sorts before "X2410", "9" before "10".
function compareVals(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a), bs = String(b);
  const ae = as.trim() === "", be = bs.trim() === "";
  if (ae && !be) return 1;   // blanks sink to the bottom in asc
  if (be && !ae) return -1;
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}

const INPUT_STYLE = { background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.text } as const;
const FIELD_TYPES = ["text", "identifier", "code", "number", "reference", "date", "boolean"];
const isPageField = (name: string) => /^source.?page$/i.test(name.trim());

export type Column = { name: string; type: string; description: string };
export type DraftSummary = {
  extraction_id: string;
  table_name: string;
  columns: Column[];
  status: string | null;
  row_count: number;
};

type Row = { extraction_row_id: number; row_index: number; source_page: number | null; row_data: Record<string, string> };

function mapRows(raw: unknown): Row[] {
  return (Array.isArray(raw) ? raw : []).map((x: Record<string, unknown>) => ({
    extraction_row_id: x.extraction_row_id as number,
    row_index: x.row_index as number,
    source_page: (x.source_page as number | null) ?? null,
    row_data: (x.row_data as Record<string, string>) ?? {},
  }));
}

type CompareColumn = { field: string; draft_distinct: number; other_distinct: number; overlap: number; only_in_draft: string[]; only_in_other: string[] };
type CompareResult = { compared: boolean; reason?: string; other_extraction_id?: string; other_verified?: boolean; draft_rows?: number; other_rows?: number; columns?: CompareColumn[] };

export function ExtractionTable({
  projectId,
  draft,
  viewingPage,
  refreshSignal,
  onDraftChanged,
  onRowCount,
  onDelete,
  onRefresh,
}: {
  projectId: string;
  draft: DraftSummary;
  viewingPage: number;
  /** Bumps when Arc's document_write_rows broadcasts rows_written — reload. */
  refreshSignal: number;
  /** Fresh summary after a schema/verify write (workbench updates its state). */
  onDraftChanged: (d: DraftSummary) => void;
  onRowCount: (n: number) => void;
  /** Remove this whole table from the document (drafts only). */
  onDelete?: () => void;
  /** Re-list the document's tables AND reload every grid. The push broadcast
   *  only fires on writes that go through Arc's tools; anything that touches
   *  Neon directly leaves the panel stale with no way back but a full reload. */
  onRefresh?: () => void;
}) {
  const exBase = `${agentBaseUrl()}/projects/${projectId}/extractions`;
  const eid = draft.extraction_id;
  const columns = draft.columns;
  // 'certified' = Shane's seal (read-only); 'verified' is the legacy value.
  const verified = draft.status === "certified" || draft.status === "verified";

  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [tableName, setTableName] = useState(draft.table_name);
  const [confirmDel, setConfirmDel] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [colDraft, setColDraft] = useState<Column[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  // Column drag-to-reorder (persists as the real column order).
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const dragHappened = useRef(false);
  // Per-column widths, remembered per table. Only explicitly-resized columns
  // are stored; the rest fall back to DEFAULT_COL_W.
  const WKEY = `atlas.extract.cols.${eid}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    try { const raw = window.localStorage.getItem(WKEY); if (raw) setWidths(JSON.parse(raw)); } catch { /* defaults */ }
  }, [WKEY]);
  const dirtyRef = useRef<Set<number>>(new Set());
  const onRowCountRef = useRef(onRowCount);
  useEffect(() => { onRowCountRef.current = onRowCount; }, [onRowCount]);

  // Follow the server's table name when it changes underneath us (Arc rename,
  // reload) — derived-state-during-render, the sanctioned reset pattern.
  const [seenName, setSeenName] = useState(draft.table_name);
  if (draft.table_name !== seenName) { setSeenName(draft.table_name); setTableName(draft.table_name); }

  // Load rows on mount + whenever Arc writes. setRows lands in a .then
  // callback (never synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;
    fetch(`${exBase}/${eid}/rows?limit=5000`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return;
        const mapped = mapRows(d.rows);
        setRows(mapped);
        dirtyRef.current.clear();
        onRowCountRef.current(mapped.length);
      })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [exBase, eid, refreshSignal]);

  function setCell(rowId: number, field: string, value: string) {
    setRows((prev) => prev?.map((r) => (r.extraction_row_id === rowId ? { ...r, row_data: { ...r.row_data, [field]: value } } : r)) ?? prev);
    dirtyRef.current.add(rowId);
  }

  async function flushRow(rowId: number) {
    if (!dirtyRef.current.has(rowId)) return;
    const row = rows?.find((r) => r.extraction_row_id === rowId);
    if (!row) return;
    dirtyRef.current.delete(rowId);
    await fetch(`${exBase}/${eid}/rows/${rowId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_data: row.row_data, source_page: row.source_page ?? undefined }),
    }).catch(() => { dirtyRef.current.add(rowId); });
  }

  async function addRow() {
    setBusy(true);
    const seed: Record<string, string> = {};
    const pageField = columns.map((c) => c.name).find(isPageField);
    if (pageField) seed[pageField] = String(viewingPage);
    const r = await fetch(`${exBase}/${eid}/rows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_data: seed, source_page: viewingPage }),
    }).catch(() => null);
    if (r?.ok) {
      const d = await fetch(`${exBase}/${eid}/rows?limit=5000`).then((x) => x.json()).catch(() => null);
      if (d) { const m = mapRows(d.rows); setRows(m); onRowCountRef.current(m.length); }
    }
    setBusy(false);
  }

  async function deleteRow(rowId: number) {
    await fetch(`${exBase}/${eid}/rows/${rowId}`, { method: "DELETE" }).catch(() => null);
    setRows((prev) => {
      const next = prev?.filter((r) => r.extraction_row_id !== rowId) ?? prev;
      if (next) onRowCountRef.current(next.length);
      return next;
    });
  }

  async function saveSchema(nextCols: Column[], nextName: string) {
    const clean = nextCols.map((c) => ({ name: c.name.trim(), type: c.type || "text", description: c.description || "" })).filter((c) => c.name);
    const r = await fetch(`${exBase}/${eid}/schema`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_name: nextName.trim(), columns: clean }),
    }).catch(() => null);
    if (r?.ok) { onDraftChanged(await r.json()); return true; }
    setError("could not save the schema");
    return false;
  }

  // Move column `from` to sit just before `to`, and persist the new order
  // (column order is part of the table's design → a schema write).
  async function reorderColumns(from: string, to: string) {
    if (from === to) return;
    const without = columns.filter((c) => c.name !== from);
    const moved = columns.find((c) => c.name === from);
    const idx = without.findIndex((c) => c.name === to);
    if (!moved || idx < 0) return;
    const next = [...without.slice(0, idx), moved, ...without.slice(idx)];
    await saveSchema(next, tableName);
  }

  async function runCompare() {
    setComparing(true);
    setCompare(null);
    const r = await fetch(`${exBase}/${eid}/compare`).catch(() => null);
    setCompare(r?.ok ? await r.json() : { compared: false, reason: "compare failed" });
    setComparing(false);
  }

  async function verify() {
    setBusy(true);
    const r = await fetch(`${exBase}/${eid}/verify`, { method: "POST" }).catch(() => null);
    if (r?.ok) onDraftChanged(await r.json());
    else setError("verify failed");
    setBusy(false);
  }

  const rowCount = rows?.length ?? 0;

  // Click a header to cycle sort: none → asc → desc → none.
  function toggleSort(field: string) {
    setSort((s) => (!s || s.field !== field ? { field, dir: "asc" }
      : s.dir === "asc" ? { field, dir: "desc" } : null));
  }

  const colW = (name: string) => widths[name] ?? DEFAULT_COL_W;
  const tableWidth = IDX_W + PG_W + ACT_W + columns.reduce((n, c) => n + colW(c.name), 0);

  // Drag a column's right edge to resize; persist on release.
  function startColResize(field: string, e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colW(field);
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [field]: Math.max(56, Math.round(startW + (ev.clientX - startX))) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidths((w) => { try { window.localStorage.setItem(WKEY, JSON.stringify(w)); } catch { /* session-only */ } return w; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // The rows in display order — a sorted VIEW; editing still targets rows by id.
  const displayed = useMemo(() => {
    if (!rows || !sort) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const r = compareVals(sortVal(a, sort.field), sortVal(b, sort.field));
      return sort.dir === "asc" ? r : -r;
    });
    return arr;
  }, [rows, sort]);

  const sortArrow = (field: string) => (sort?.field === field ? (sort.dir === "asc" ? "▲" : "▼") : "");

  return (
    <div className="flex h-full flex-col">
      {/* toolbar: table name, status, design columns, compare, verify */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: PT.line }}>
        <input
          value={tableName}
          disabled={verified}
          onChange={(e) => setTableName(e.target.value)}
          onBlur={() => { if (tableName.trim() && tableName !== draft.table_name) void saveSchema(columns, tableName); }}
          placeholder="name this table…"
          className="w-[220px] rounded-md px-2.5 py-1 text-[12px] font-bold outline-none"
          style={{ ...INPUT_STYLE, opacity: verified ? 0.7 : 1 }}
        />
        {verified ? (
          <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ color: PT_STATUS.ok.fg, background: PT_STATUS.ok.bg }}>certified</span>
        ) : (
          <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ color: PT_STATUS.working.fg, background: PT_STATUS.working.bg }}>
            draft · {rowCount} row{rowCount === 1 ? "" : "s"} · {columns.length} col{columns.length === 1 ? "" : "s"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!verified && (
            <button type="button" onClick={() => { setColDraft(columns.map((c) => ({ ...c }))); setDesigning((v) => !v); }}
              className="cursor-pointer rounded-md px-2.5 py-1 text-[10.5px] font-bold"
              style={{ border: `1px solid ${designing ? PT.cyanDeep : PT.lineStrong}`, color: designing ? PT.cyanText : PT.textDim, background: "transparent" }}
              title="design this table's columns">
              ⚙ columns
            </button>
          )}
          {onRefresh && (
            <button type="button" onClick={onRefresh}
              className="cursor-pointer rounded-md px-2.5 py-1 text-[10.5px] font-bold"
              style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent" }}
              title="reload tables and rows from the database">
              ↻ refresh
            </button>
          )}
          <button type="button" disabled={comparing} onClick={() => void runCompare()}
            className="cursor-pointer rounded-md px-2.5 py-1 text-[10.5px] font-bold"
            style={{ border: `1px solid ${PT.lineStrong}`, color: PT.cyanText, background: "transparent", opacity: comparing ? 0.5 : 1 }}>
            {comparing ? "comparing…" : "compare"}
          </button>
          <button type="button" disabled={busy || verified || rowCount === 0} onClick={() => void verify()}
            className="cursor-pointer rounded-md border-0 px-3 py-1 text-[10.5px] font-bold"
            style={{ background: verified ? "rgba(52,211,153,.2)" : `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`, color: verified ? PT_STATUS.ok.fg : "#062430", opacity: busy || verified || rowCount === 0 ? 0.5 : 1 }}
            title={verified ? "certified — sealed read-only" : "Certify — seal this table as Shane-verified truth (the verification protocol is whatever you and Arc agreed for this document)"}>
            {verified ? "certified ✓" : "Certify"}
          </button>
          {onDelete && !verified && (
            confirmDel ? (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: PT.gapRed }}>
                delete table?
                <button type="button" onClick={() => { setConfirmDel(false); onDelete(); }}
                  className="cursor-pointer rounded border-0 px-1.5 py-0.5 font-bold" style={{ background: PT.gapRed, color: "#160406" }}>yes</button>
                <button type="button" onClick={() => setConfirmDel(false)}
                  className="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 font-semibold" style={{ color: PT.textMute }}>no</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDel(true)} title="delete this table"
                className="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-[12px]" style={{ color: PT.textGhost }}>🗑</button>
            )
          )}
        </div>
      </div>

      {designing && <ColumnDesigner cols={colDraft} setCols={setColDraft}
        onSave={async () => { if (await saveSchema(colDraft, tableName)) setDesigning(false); }}
        onCancel={() => setDesigning(false)} />}
      {compare && <CompareStrip compare={compare} onClose={() => setCompare(null)} />}
      {error && <div className="px-3 py-1 text-[10.5px] font-semibold" style={{ color: PT.gapRed }}>{error}</div>}

      {/* the table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11.5px]" style={{ color: PT.textMute }}>
            No columns yet — review the document with Arc and design this table&apos;s columns together, or{" "}
            <button type="button" onClick={() => { setColDraft([{ name: "", type: "text", description: "" }]); setDesigning(true); }} className="cursor-pointer underline" style={{ color: PT.cyanText }}>add them here</button>.
          </div>
        ) : (
          <table className="border-collapse text-left" style={{ tableLayout: "fixed", width: tableWidth, minWidth: "100%" }}>
            <colgroup>
              <col style={{ width: IDX_W }} />
              <col style={{ width: PG_W }} />
              {columns.map((c) => <col key={c.name} style={{ width: colW(c.name) }} />)}
              <col style={{ width: ACT_W }} />
            </colgroup>
            <thead className="sticky top-0 z-10" style={{ background: PT.panelSolid }}>
              <tr className="text-[9px] uppercase tracking-[.09em]" style={{ color: PT.textFaint }}>
                <th onClick={() => toggleSort("__idx")} title="row order — click to sort"
                  className="cursor-pointer select-none px-2 py-2 font-bold" style={{ borderBottom: `1px solid ${PT.line}` }}>
                  #<span style={{ color: PT.cyanText }}> {sortArrow("__idx")}</span>
                </th>
                <th onClick={() => toggleSort("__pg")} title="source page — click to sort"
                  className="cursor-pointer select-none px-1.5 py-2 font-bold" style={{ borderBottom: `1px solid ${PT.line}` }}>
                  pg<span style={{ color: PT.cyanText }}> {sortArrow("__pg")}</span>
                </th>
                {columns.map((c) => {
                  const isDropTarget = !!dragCol && dragCol !== c.name && dropCol === c.name;
                  return (
                  <th key={c.name} title={c.description || c.type}
                    onDragOver={(e) => { if (dragCol && dragCol !== c.name) { e.preventDefault(); dragHappened.current = true; setDropCol(c.name); } }}
                    onDrop={(e) => { e.preventDefault(); const from = dragCol; setDragCol(null); setDropCol(null); if (from) void reorderColumns(from, c.name); }}
                    className="group relative select-none px-1.5 py-2 font-bold"
                    style={{ borderBottom: `1px solid ${PT.line}`, opacity: dragCol === c.name ? 0.4 : 1, boxShadow: isDropTarget ? `inset 2px 0 0 ${PT.cyanText}` : "none" }}>
                    <span
                      draggable={!verified}
                      onDragStart={(e) => { dragHappened.current = false; setDragCol(c.name); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.name); } catch { /* some browsers */ } }}
                      onDragEnd={() => { setDragCol(null); setDropCol(null); setTimeout(() => { dragHappened.current = false; }, 0); }}
                      onClick={() => { if (dragHappened.current) return; toggleSort(c.name); }}
                      className="flex items-center gap-1 overflow-hidden"
                      style={{ cursor: verified ? "pointer" : "grab" }}>
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0" style={{ color: PT.cyanText }}>{sortArrow(c.name)}</span>
                    </span>
                    <span onPointerDown={(e) => startColResize(c.name, e)} title="drag to resize"
                      className="absolute top-0 right-0 z-20 flex h-full w-[9px] cursor-col-resize items-center justify-end"
                      style={{ touchAction: "none" }}>
                      <span className="h-[14px] w-px opacity-0 transition-opacity group-hover:opacity-100" style={{ background: PT.cyanDeep }} />
                    </span>
                  </th>
                  );
                })}
                <th className="px-1 py-2" style={{ borderBottom: `1px solid ${PT.line}` }} />
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={columns.length + 3} className="px-3 py-4 text-[11.5px]" style={{ color: PT.textMute }}>loading rows…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={columns.length + 3} className="px-3 py-5 text-[11.5px]" style={{ color: PT.textMute }}>
                  no rows yet — box a table region for Arc and ask it to extract this page, or + row to type one.
                </td></tr>
              ) : (
                (displayed ?? []).map((r) => (
                  <tr key={r.extraction_row_id} className="border-t transition-colors hover:bg-[rgba(148,163,184,.06)]" style={{ borderColor: PT.line }}>
                    <td className="px-2 py-1 text-[10px] tabular-nums" style={{ color: PT.textGhost }}>{r.row_index}</td>
                    <td className="px-1.5 py-1 text-[10px] tabular-nums" style={{ color: PT.textGhost }}>{r.source_page ?? "—"}</td>
                    {columns.map((c) => (
                      <td key={c.name} className="overflow-hidden px-1 py-0.5">
                        <input value={r.row_data[c.name] ?? ""} disabled={verified}
                          onChange={(e) => setCell(r.extraction_row_id, c.name, e.target.value)}
                          onBlur={() => void flushRow(r.extraction_row_id)}
                          className="w-full min-w-0 rounded px-1.5 py-1 text-[10.5px] outline-none"
                          style={{ ...INPUT_STYLE, color: PT.textDim, opacity: verified ? 0.75 : 1 }} />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-center">
                      {!verified && (
                        <button type="button" title="delete row" onClick={() => void deleteRow(r.extraction_row_id)}
                          className="cursor-pointer rounded border-0 bg-transparent text-[10px]" style={{ color: PT.textGhost }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {!verified && columns.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5" style={{ borderColor: PT.line }}>
          <button type="button" disabled={busy} onClick={() => void addRow()}
            className="cursor-pointer rounded-md px-2.5 py-1 text-[10.5px] font-bold"
            style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: busy ? 0.5 : 1 }}>
            + row
          </button>
          <span className="text-[10px]" style={{ color: PT.textGhost }}>editing on page {viewingPage} · edits save when you leave a cell</span>
        </div>
      )}
    </div>
  );
}

function ColumnDesigner({ cols, setCols, onSave, onCancel }: {
  cols: Column[]; setCols: (c: Column[]) => void; onSave: () => void; onCancel: () => void;
}) {
  const set = (i: number, patch: Partial<Column>) => setCols(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="border-b px-3 py-2" style={{ borderColor: PT.line, background: "rgba(34,211,238,.04)" }}>
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[.1em]" style={{ color: PT.textFaint }}>design columns</div>
      <div className="flex flex-col gap-1">
        {cols.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={c.name} placeholder="column name" onChange={(e) => set(i, { name: e.target.value })}
              className="w-[180px] rounded px-2 py-1 text-[11px] font-semibold outline-none" style={INPUT_STYLE} />
            <select value={c.type} onChange={(e) => set(i, { type: e.target.value })}
              className="cursor-pointer rounded px-1.5 py-1 text-[10.5px] outline-none" style={INPUT_STYLE}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={c.description} placeholder="what this column holds (helps Arc)" onChange={(e) => set(i, { description: e.target.value })}
              className="min-w-0 flex-1 rounded px-2 py-1 text-[10.5px] outline-none" style={{ ...INPUT_STYLE, color: PT.textDim }} />
            <button type="button" title="remove column" onClick={() => setCols(cols.filter((_, j) => j !== i))}
              className="cursor-pointer rounded border-0 bg-transparent text-[11px]" style={{ color: PT.textGhost }}>✕</button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => setCols([...cols, { name: "", type: "text", description: "" }])}
          className="cursor-pointer rounded-md px-2.5 py-1 text-[10.5px] font-bold" style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent" }}>
          + column
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onCancel} className="cursor-pointer rounded-md px-2.5 py-1 text-[10.5px] font-semibold" style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textMute, background: "transparent" }}>cancel</button>
          <button type="button" onClick={onSave} className="cursor-pointer rounded-md border-0 px-3 py-1 text-[10.5px] font-bold" style={{ background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`, color: "#062430" }}>save columns</button>
        </div>
      </div>
    </div>
  );
}

function CompareStrip({ compare, onClose }: { compare: CompareResult; onClose: () => void }) {
  if (!compare.compared) {
    return (
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[10.5px]" style={{ borderColor: PT.line, color: PT.textMute }}>
        <span>compare: {compare.reason ?? "nothing to compare against yet"}</span>
        <button type="button" onClick={onClose} className="ml-auto cursor-pointer text-[11px]" style={{ color: PT.textGhost }}>✕</button>
      </div>
    );
  }
  return (
    <div className="border-b px-3 py-2" style={{ borderColor: PT.line, background: "rgba(34,211,238,.04)" }}>
      <div className="mb-1.5 flex items-center gap-2 text-[10.5px]">
        <span className="font-semibold" style={{ color: PT.cyanText }}>draft {compare.draft_rows} rows vs {compare.other_verified ? "verified" : "earlier"} {compare.other_rows} rows</span>
        <span className="font-mono text-[9px]" style={{ color: PT.textGhost }}>{compare.other_extraction_id?.slice(0, 8)}</span>
        <button type="button" onClick={onClose} className="ml-auto cursor-pointer text-[11px]" style={{ color: PT.textGhost }}>✕</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(compare.columns ?? []).map((c) => {
          const denom = Math.max(c.draft_distinct, c.other_distinct, 1);
          const pct = Math.round((c.overlap / denom) * 100);
          const tone = pct >= 90 ? PT_STATUS.ok : pct >= 60 ? PT_STATUS.warn : PT_STATUS.gap;
          return (
            <div key={c.field} className="rounded-md border px-2 py-1" style={{ borderColor: PT.line, minWidth: 128 }}
              title={`draft-only: ${c.only_in_draft.join(", ") || "—"}\nref-only: ${c.only_in_other.join(", ") || "—"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold" style={{ color: PT.textDim }}>{c.field}</span>
                <span className="text-[10px] font-bold" style={{ color: tone.fg }}>{pct}%</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(148,163,184,.14)" }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone.fg }} />
              </div>
              <div className="mt-1 text-[8.5px]" style={{ color: PT.textGhost }}>{c.overlap}/{c.draft_distinct} draft · {c.other_distinct} ref</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
