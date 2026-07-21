"use client";

// The Data › Extraction workbench body — document pages LEFT (shared
// DocumentViewer), Arc RIGHT (data-extraction seat), and the bottom panel = a
// horizontally-scrolling strip of this document's tables (usually one; a
// second when the print carries a second grain, e.g. cables + their
// conductors). Each table is a self-contained ExtractionTable card. Tables
// live in document_extractions — their own Neon store, separate from the
// Schema-Builder. Arc creates/fills them; every write is Shane-gated; nothing
// loops. Mirrors the Schema-Builder's schema-strip idiom.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_PANEL_FROST } from "@/lib/platform-theme";
import { useProject } from "../layout";
import { ExperimentalV2CopilotPanel } from "@/components/experimental-v2/experimental-v2-copilot-panel";
import { DocumentViewer, type DocumentViewerHandle } from "@/components/experimental-v2/document-viewer";
import type { ComposerInjection } from "@/components/experimental-v2/copilot/composer";
import { ExtractionTable, type DraftSummary } from "./extraction-table";

const INPUT_STYLE = { background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.text } as const;

export function ExtractionWorkbench({ documentId, onBack }: { documentId: string; onBack?: () => void }) {
  const project = useProject();
  const params = useParams<{ projectSlug: string }>();
  const [docName, setDocName] = useState<string | null>(null);
  // The document's tables (0..N), laid out left-to-right. null = still loading.
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  // Which table Arc targets by default + which card is highlighted.
  const [focusedEid, setFocusedEid] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [viewingPage, setViewingPage] = useState(1);
  const [arcOpen, setArcOpen] = useState(true);
  const [newTableName, setNewTableName] = useState("");
  const [adding, setAdding] = useState(false);
  // A crop from the viewer's Capture tool, pushed into Arc's composer.
  const [injectedCrop, setInjectedCrop] = useState<ComposerInjection | null>(null);
  const viewerRef = useRef<DocumentViewerHandle>(null);
  // Live per-table row counts (keyed by extraction_id) for the seat context —
  // write-only for the parent, read at message-send time, so a ref.
  const rowCountsRef = useRef<Record<string, number>>({});
  // The document's source PDF path, for provenance when minting a table.
  const srcRef = useRef("");

  // Movable bottom border — strip height, dragged at the divider, remembered.
  const LAYOUT_KEY = "atlas.extractWorkbench.layout";
  const [stripHeight, setStripHeight] = useState<number>(340);
  const stripHeightRef = useRef(stripHeight);
  useEffect(() => { stripHeightRef.current = stripHeight; }, [stripHeight]);
  // Restore the saved height after hydration — never during it (a lazy
  // initializer reading localStorage diverges from the server render).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAYOUT_KEY);
      if (raw) { const s = JSON.parse(raw); if (typeof s.stripHeight === "number") setStripHeight(s.stripHeight); }
    } catch { /* defaults */ }
  }, [LAYOUT_KEY]);

  // Per-table card WIDTHS (dragged at the border between tables). A card with
  // no stored width flexes to fill; once dragged it becomes fixed. Remembered.
  const CARDW_KEY = "atlas.extractWorkbench.cardWidths";
  const [cardWidths, setCardWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    try { const raw = window.localStorage.getItem(CARDW_KEY); if (raw) setCardWidths(JSON.parse(raw)); } catch { /* defaults */ }
  }, [CARDW_KEY]);
  const startCardResize = useCallback((eid: string, e: React.PointerEvent) => {
    e.preventDefault();
    const cardEl = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    if (!cardEl) return;
    const startX = e.clientX;
    const startW = cardEl.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setCardWidths((w) => ({ ...w, [eid]: Math.max(340, Math.min(1600, Math.round(startW + (ev.clientX - startX)))) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setCardWidths((w) => { try { window.localStorage.setItem(CARDW_KEY, JSON.stringify(w)); } catch { /* session-only */ } return w; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  const startStripDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startVal = stripHeightRef.current;
    const move = (ev: PointerEvent) => setStripHeight(Math.min(680, Math.max(180, startVal + (startY - ev.clientY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setStripHeight((prev) => {
        try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ stripHeight: prev })); } catch { /* session-only */ }
        return prev;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const base = useMemo(
    () => (project ? `${agentBaseUrl()}/projects/${project.project_id}` : null),
    [project]
  );
  const docBase = base ? `${base}/documents/${encodeURIComponent(documentId)}` : null;

  // Load (or reload) the document's tables. setState lands in the .then.
  const loadDrafts = useCallback(() => {
    if (!base) return;
    fetch(`${base}/extractions/drafts?document_id=${encodeURIComponent(documentId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const tables: DraftSummary[] = d.tables ?? [];
        for (const t of tables) rowCountsRef.current[t.extraction_id] = t.row_count ?? 0;
        setDrafts(tables);
      })
      .catch(() => setDrafts([]));
  }, [base, documentId]);

  // Doc identity + provenance, then the tables list.
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    fetch(`${base}/documents`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return;
        const doc = (d.documents ?? []).find((x: { document_id: string }) => x.document_id === documentId);
        setDocName(doc?.normalized_name ?? documentId);
        srcRef.current = doc?.working_path ?? doc?.source_path ?? "";
        loadDrafts();
      })
      .catch(() => { if (!cancelled) setDocName(documentId); });
    return () => { cancelled = true; };
  }, [base, documentId, loadDrafts]);

  // Manual reload: re-list the tables AND reload every grid's rows. The push
  // broadcast covers writes made through Arc's tools, but anything that reaches
  // Neon another way (a repair script, a second seat, the API direct) leaves the
  // panel showing stale counts with no recourse short of reloading the project.
  const refreshAll = useCallback(() => {
    loadDrafts();
    setRefreshSignal((s) => s + 1);
  }, [loadDrafts]);

  // Seat command routing — pointing comes from the viewer. rows_written (from
  // document_write_rows) reloads grids; schema_written (from document_set_schema)
  // re-lists tables so new/renamed columns and new tables appear.
  const onCommand = useCallback((cmd: Record<string, unknown>) => {
    const mine = cmd.document_id === documentId || cmd.document_id === undefined;
    if (cmd.action === "rows_written") {
      if (mine) setRefreshSignal((s) => s + 1);
      return;
    }
    if (cmd.action === "schema_written") {
      if (mine) { loadDrafts(); setRefreshSignal((s) => s + 1); }
      return;
    }
    viewerRef.current?.handleCommand(cmd);
  }, [documentId, loadDrafts]);

  // Create a new named table for this document.
  const addTable = useCallback(() => {
    const name = newTableName.trim();
    if (!base || !name || adding) return;
    setAdding(true);
    fetch(`${base}/extractions/draft`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: documentId, table_name: name, source_pdf_path: srcRef.current }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: DraftSummary) => { setNewTableName(""); setFocusedEid(s.extraction_id); loadDrafts(); })
      .catch(() => {})
      .finally(() => setAdding(false));
  }, [base, documentId, newTableName, adding, loadDrafts]);

  const deleteTable = useCallback((eid: string) => {
    if (!base) return;
    fetch(`${base}/extractions/${eid}`, { method: "DELETE" })
      .then(() => loadDrafts())
      .catch(() => {});
  }, [base, loadDrafts]);

  const replaceDraft = useCallback((d: DraftSummary) => {
    rowCountsRef.current[d.extraction_id] = d.row_count ?? rowCountsRef.current[d.extraction_id] ?? 0;
    setDrafts((prev) => prev?.map((x) => (x.extraction_id === d.extraction_id ? d : x)) ?? prev);
  }, []);

  // The focused table (Arc's default target), derived — never stale after a
  // delete/rename because it falls back to the first table.
  const focused = drafts?.find((d) => d.extraction_id === focusedEid) ?? drafts?.[0] ?? null;

  return (
    <div className="flex min-h-0 flex-col" style={{ height: "calc(100vh - 100px)" }}>
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-2" style={{ borderColor: PT.line, background: PT_PANEL_FROST }}>
        {onBack ? (
          <button type="button" onClick={onBack} className="cursor-pointer border-0 bg-transparent text-[11px] font-semibold" style={{ color: PT.textMute }}>
            ← documents
          </button>
        ) : (
          <Link href={`/platform/${params.projectSlug}/extract`} className="text-[11px] font-semibold" style={{ color: PT.textMute }}>
            ← documents
          </Link>
        )}
        <div className="truncate text-[12.5px] font-bold" style={{ color: PT.text }}>
          {docName ?? documentId}
        </div>
      </div>

      {/* viewer + Arc */}
      <div className="flex min-h-0 flex-1">
        <DocumentViewer
          ref={viewerRef}
          docBase={docBase}
          documentId={documentId}
          onPageChange={(p) => setViewingPage(p)}
          onCapture={(crop) => setInjectedCrop((p) => ({ image: crop, seq: (p?.seq ?? 0) + 1 }))}
        />

        {arcOpen ? (
          <ExperimentalV2CopilotPanel
            open
            onClose={() => setArcOpen(false)}
            seat={{
              area: "data-extraction",
              context: () => ({
                document_id: documentId,
                document_name: docName,
                tables: (drafts ?? []).map((d) => ({
                  name: d.table_name || "(unnamed)",
                  fields: d.columns.map((c) => c.name),
                  rows: rowCountsRef.current[d.extraction_id] ?? d.row_count ?? 0,
                  status: d.status,
                })),
                ...(focused?.table_name ? { active_table: focused.table_name } : {}),
                ...(focused?.columns?.length ? { table_fields: focused.columns.map((c) => c.name) } : {}),
                draft_rows: focused ? (rowCountsRef.current[focused.extraction_id] ?? focused.row_count ?? 0) : 0,
                ...viewerRef.current?.getPointerContext(),
              }),
              onCommand,
            }}
            injectedAttachment={injectedCrop ?? undefined}
            title="Arc · Data Extraction"
            composerPlaceholder="Ask Arc to help design a table, extract a page, or /command…"
            kickoff={docName
              ? `Data-extraction workbench opened — document "${docName}" (${documentId}). We'll design the table(s) this document needs together, then extract the rows.`
              : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={() => setArcOpen(true)}
            className="w-[26px] shrink-0 cursor-pointer border-0 text-[10px] font-bold uppercase tracking-[.14em]"
            style={{ background: "rgba(3,8,18,.55)", color: PT.cyanText, writingMode: "vertical-rl" }}
            title="Open Arc"
          >
            Arc
          </button>
        )}
      </div>

      <div onPointerDown={startStripDrag} className="h-[5px] shrink-0 cursor-row-resize" style={{ background: PT.line }} title="drag to resize" />

      {/* the document's tables — a horizontally-scrolling strip */}
      <div
        className="flex shrink-0 items-stretch overflow-x-auto p-2.5"
        style={{ height: stripHeight, background: "rgba(3,8,18,.5)" }}
      >
        {drafts === null ? (
          <div className="flex h-full w-full items-center justify-center text-[12px]" style={{ color: PT.textMute }}>
            opening this document&apos;s tables…
          </div>
        ) : (
          <>
            {drafts.map((d) => {
              const isFocused = focused?.extraction_id === d.extraction_id;
              const w = cardWidths[d.extraction_id];
              return (
                <Fragment key={d.extraction_id}>
                  <div
                    onPointerDown={() => setFocusedEid(d.extraction_id)}
                    className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border"
                    style={{
                      flex: w != null ? `0 0 ${w}px` : "1 0 560px",
                      borderColor: isFocused ? PT.cyanDeep : PT.line,
                      background: "rgba(3,8,18,.4)",
                      boxShadow: isFocused ? `0 0 0 1px ${PT.cyanDeep}` : "none",
                    }}
                  >
                    {project && (
                      <ExtractionTable
                        projectId={project.project_id}
                        draft={d}
                        viewingPage={viewingPage}
                        refreshSignal={refreshSignal}
                        onDraftChanged={replaceDraft}
                        onRowCount={(n) => { rowCountsRef.current[d.extraction_id] = n; }}
                        onDelete={() => deleteTable(d.extraction_id)}
                        onRefresh={refreshAll}
                      />
                    )}
                  </div>
                  {/* drag this border to resize the table to its left */}
                  <div
                    onPointerDown={(e) => startCardResize(d.extraction_id, e)}
                    className="group flex h-full w-[12px] shrink-0 cursor-col-resize items-center justify-center"
                    title="drag to resize this table"
                    style={{ touchAction: "none" }}
                  >
                    <span className="h-10 w-px opacity-30 transition-all group-hover:w-[3px] group-hover:opacity-100" style={{ background: PT.cyanDeep, borderRadius: 2 }} />
                  </div>
                </Fragment>
              );
            })}

            {/* + new table creator */}
            <div
              className="flex h-full w-[260px] shrink-0 flex-col gap-2 rounded-xl border border-dashed p-3"
              style={{ borderColor: PT.line, background: "rgba(3,8,18,.25)" }}
            >
              <div className="text-[9px] font-bold uppercase tracking-[.12em]" style={{ color: PT.textFaint }}>New table</div>
              <input
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addTable(); }}
                placeholder="name this table…"
                className="rounded-md px-2.5 py-1.5 text-[12px] font-semibold outline-none"
                style={INPUT_STYLE}
              />
              <button
                type="button"
                onClick={addTable}
                disabled={!newTableName.trim() || adding}
                className="cursor-pointer rounded-md border-0 px-3 py-1.5 text-[11px] font-bold"
                style={{ background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`, color: "#062430", opacity: !newTableName.trim() || adding ? 0.5 : 1 }}
              >
                ＋ add table
              </button>
              <p className="text-[10px] leading-snug" style={{ color: PT.textGhost }}>
                Most documents need one. Add a second only when the print carries a second grain — Arc can create these for you too.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
