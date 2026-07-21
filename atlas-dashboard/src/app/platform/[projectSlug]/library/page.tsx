"use client";

// Library — the machine's document home (Platform Graduation IA #4).
// Slice 1: live documents list (R1 authority table), per-document routing
// map rollup (R11), and upload → hash → dedup → immutable original (R14/R3).
// Derivative fan-out honestly reads "awaits the intake worker".

import { useCallback, useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_PANEL_FROST, PT_STATUS } from "@/lib/platform-theme";
import { useProject } from "../layout";

type RoutingRange = { start: number; end: number; lane: string; source: string | null };

type IntakeState = {
  stages_total: number;
  stages_completed: number;
  running: { kind: string; pages_done: number | null; pages_total: number | null } | null;
} | null;

type LibraryDoc = {
  document_id: string;
  normalized_name: string | null;
  original_name: string | null;
  content_sha256: string | null;
  classification: string | null;
  classification_state: string | null;
  classification_detail: { method?: string; rule?: string; source?: string } | null;
  status: string;
  revision_label: string | null;
  created_at: string | null;
  description: string | null;
  skim_state: string | null;
  skim_detail: { mode?: string; confidence?: number } | null;
  source_path: string | null;
  source_label: string | null;
  working_path: string | null;
  intake: IntakeState;
  lanes: Record<string, number>;
  routing: RoutingRange[];
  extractions: { tables: number; certified: number } | null;
};

// Classification group order for the list (Shane's remodel: docs organized
// by HOW you extract them) — tabular families first (extraction-ready),
// then the visual prints, then reference material.
const CLASS_ORDER = ["cable-list", "parts-list", "plc-reference", "schematic",
  "manual", "other"] as const;
const CLASS_LABEL: Record<string, string> = {
  "cable-list": "Cable lists",
  "parts-list": "Parts lists",
  "plc-reference": "PLC reference",
  schematic: "Schematics & wiring diagrams",
  manual: "Manuals & datasheets",
  other: "Other",
  unclassified: "Unclassified",
};
const METHOD_COLOR: Record<string, string> = {
  tabular: "#22d3ee", visual: "#a78bfa", reference: "#94a3b8",
};

// Honest human names for the intake stages (Shane's requirement: the chips
// must show being-skimmed / working-copy-being-made, not internal kinds).
const STAGE_LABEL: Record<string, string> = {
  skim: "Arc skimming",
  classify: "classifying",
  "working-copy": "stamping working copy",
  "vector-dump": "extracting text",
  "workspace-png": "rendering workspace",
  "master-png": "rendering masters",
};

const STATUS_KIND: Record<string, keyof typeof PT_STATUS> = {
  available: "ok",
  processing: "working",
  gated: "pending",
  needs_attention: "warn",
  rejected: "gap",
  soft_deleted: "pending",
};

// The intake worker is SERIAL — one document at a time. A document only
// says "processing" when one of its jobs is actually running (with the live
// stage + page count); the rest of the line honestly says "queued".
function intakeChip(d: LibraryDoc): { kind: keyof typeof PT_STATUS; text: string } {
  if (d.status !== "processing") return { kind: STATUS_KIND[d.status] ?? "pending", text: d.status };
  const run = d.intake?.running;
  if (run) {
    const pages =
      run.pages_total != null
        ? ` · p${run.pages_done ?? 0}/${run.pages_total}`
        : run.pages_done
          ? ` · p${run.pages_done}`
          : "";
    return { kind: "working", text: `${STAGE_LABEL[run.kind] ?? run.kind}${pages}` };
  }
  const done = d.intake ? `${d.intake.stages_completed}/${d.intake.stages_total}` : "0";
  return { kind: "pending", text: `queued · ${done} stages done` };
}

// Spreadsheet ergonomics (Shane's call): drag-resizable columns, widths
// remembered locally; every row exactly one line high, ellipsis + hover
// tooltip carrying the full text.
const DEFAULT_WIDTHS: Record<string, number> = {
  document: 300,
  classification: 190,
  description: 280,
  status: 130,
  routing: 230,
  source: 150,
  uploaded: 130,
  sha: 100,
  actions: 44,
};
const COL_KEY = "atlas.library.colWidths";
const COLUMNS = [
  { key: "document", label: "document" },
  { key: "classification", label: "classification" },
  { key: "description", label: "description" },
  { key: "status", label: "status" },
  { key: "routing", label: "routing map (R11)" },
  { key: "source", label: "source" },
  { key: "uploaded", label: "uploaded" },
  { key: "sha", label: "sha-256" },
  { key: "actions", label: "" },
] as const;

function useColumnWidths() {
  const [widths, setWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COL_KEY);
      if (raw) setWidths({ ...DEFAULT_WIDTHS, ...JSON.parse(raw) });
    } catch {
      /* defaults */
    }
  }, []);
  // Listeners register synchronously on pointerdown (a state-updater
  // side-effect would defer past the first moves and leak on bail-out).
  const startResize = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthsRef.current[key] ?? 150;
    const move = (ev: PointerEvent) =>
      setWidths((prev) => ({ ...prev, [key]: Math.max(60, startW + (ev.clientX - startX)) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidths((prev) => {
        try {
          window.localStorage.setItem(COL_KEY, JSON.stringify(prev));
        } catch {
          /* session-only then */
        }
        return prev;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  return { widths, startResize };
}

function Chip({ kind, children }: { kind: keyof typeof PT_STATUS; children: React.ReactNode }) {
  const s = PT_STATUS[kind];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-px text-[8.5px] font-semibold tracking-[.02em]"
      style={{ color: s.fg, background: s.bg }}
    >
      {children}
    </span>
  );
}

export default function LibraryPage() {
  const project = useProject();
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [notice, setNotice] = useState<{ kind: keyof typeof PT_STATUS; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<{ name: string; result: string; kind: keyof typeof PT_STATUS }[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // In-UI replacements for native confirm()/prompt() — the embedded preview
  // browser can't render native dialogs; they block the page on an invisible
  // modal (black screen). Nothing in the platform may call them.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const { widths, startResize } = useColumnWidths();

  const reload = useCallback(() => {
    if (!project) return;
    fetch(`${agentBaseUrl()}/projects/${project.project_id}/documents`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setDocs(d.documents ?? []))
      .catch(() => setDocs([]));
  }, [project]);

  useEffect(reload, [reload]);

  const deleteDoc = useCallback(
    async (d: LibraryDoc) => {
      if (!project) return;
      const label = d.normalized_name ?? d.original_name ?? d.document_id;
      setConfirmDeleteId(null);
      try {
        const res = await fetch(
          `${agentBaseUrl()}/projects/${project.project_id}/documents/${encodeURIComponent(d.document_id)}`,
          { method: "DELETE" }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNotice({ kind: "warn", text: typeof body?.detail === "string" ? body.detail : `delete failed (HTTP ${res.status})` });
        } else {
          setNotice({ kind: "ok", text: `deleted ${label}` });
        }
      } catch {
        setNotice({ kind: "gap", text: "delete failed — backend unreachable" });
      }
      reload();
    },
    [project, reload]
  );

  // Classification verbs (phase 3, Shane's remodel): confirm a proposed
  // class (the confirm-routing door — the ONLY minter of shane-confirmed),
  // and re-run the deterministic title rules over unconfirmed docs.
  const confirmClassification = useCallback(async (d: LibraryDoc) => {
    if (!project) return;
    try {
      const res = await fetch(
        `${agentBaseUrl()}/projects/${project.project_id}/documents/${encodeURIComponent(d.document_id)}/confirm-routing`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: [] }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ kind: "warn", text: typeof body?.detail === "string" ? body.detail : `confirm failed (HTTP ${res.status})` });
      } else {
        setNotice({ kind: "ok", text: `classification confirmed — ${d.classification}` });
      }
    } catch {
      setNotice({ kind: "gap", text: "confirm failed — backend unreachable" });
    }
    reload();
  }, [project, reload]);

  const [classifying, setClassifying] = useState(false);
  const runTitleRules = useCallback(async () => {
    if (!project || classifying) return;
    setClassifying(true);
    try {
      const res = await fetch(
        `${agentBaseUrl()}/projects/${project.project_id}/documents/classify-by-title`,
        { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "warn", text: `classify failed (HTTP ${res.status})` });
      } else {
        setNotice({
          kind: "ok",
          text: `title rules: ${body.proposed_count ?? 0} proposed · ${body.unmatched?.length ?? 0} unmatched · ${body.skipped_confirmed ?? 0} already confirmed`,
        });
      }
    } catch {
      setNotice({ kind: "gap", text: "classify failed — backend unreachable" });
    }
    setClassifying(false);
    reload();
  }, [project, classifying, reload]);

  // While intake is churning, keep the list live — the queue visibly drains
  // and the one active document's page counter ticks.
  useEffect(() => {
    if (!docs?.some((d) => d.status === "processing")) return;
    const t = window.setInterval(reload, 5000);
    return () => window.clearInterval(t);
  }, [docs, reload]);

  const uploadOne = useCallback(
    async (file: File): Promise<{ result: string; kind: keyof typeof PT_STATUS }> => {
      if (!project) return { result: "no project", kind: "gap" };
      const form = new FormData();
      form.append("file", file);
      // Source = the file location as captured from the browse dialog
      // (Shane's ruling). Folder uploads carry the relative path; single-file
      // picks expose only the name (browser sandbox), recorded as such.
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      form.append("relative_path", rel || file.name);
      try {
        const res = await fetch(`${agentBaseUrl()}/projects/${project.project_id}/documents/upload`, {
          method: "POST",
          body: form,
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          return { result: `duplicate — ${body?.detail?.message ?? "identical content already here"}`, kind: "warn" };
        }
        if (!res.ok) return { result: `failed (HTTP ${res.status})`, kind: "gap" };
        return { result: `secured as ${body.document_id} · ${String(body.content_sha256).slice(0, 10)}…`, kind: "ok" };
      } catch {
        return { result: "failed — backend unreachable", kind: "gap" };
      }
    },
    [project]
  );

  // Server-side import: the platform reads the path directly, so the source
  // records the TRUE absolute location — the provenance browsers sandbox
  // away (Shane's ask). Works for a file or a folder (recursive, PDFs).
  const importFromPath = useCallback(async (path: string) => {
    if (!project || !path.trim()) return;
    setImportPath(null);
    setBusy(true);
    setNotice(null);
    setBatch([]);
    try {
      const res = await fetch(`${agentBaseUrl()}/projects/${project.project_id}/documents/import-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "warn", text: typeof body?.detail === "string" ? body.detail : `import failed (HTTP ${res.status})` });
      } else {
        const s = body.summary ?? {};
        setBatch(
          (body.results ?? []).map((r: { file: string; status: string; detail?: string; document_id?: string }) => ({
            name: r.file,
            result: r.status === "secured" ? `secured as ${r.document_id}` : `${r.status}${r.detail ? ` — ${r.detail}` : ""}`,
            kind: r.status === "secured" ? "ok" : r.status === "duplicate" ? "warn" : "gap",
          }))
        );
        setNotice({ kind: s.failed ? "warn" : "ok", text: `Import done: ${s.secured ?? 0} secured · ${s.duplicates ?? 0} duplicate(s) · ${s.failed ?? 0} failed` });
      }
    } catch {
      setNotice({ kind: "gap", text: "import failed — backend unreachable" });
    }
    setBusy(false);
    reload();
  }, [project, reload]);

  // Batch intake (Shane's ruling: directories, nested, PDFs only). The
  // browser's directory picker delivers the full recursive file list; we
  // filter to PDFs, upload with small concurrency, and report every file —
  // including the honest skip count for non-PDFs.
  const uploadMany = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      const skipped = files.length - pdfs.length;
      if (pdfs.length === 0) {
        setNotice({ kind: "warn", text: `No PDFs found (${skipped} non-PDF file(s) skipped)` });
        return;
      }
      setBusy(true);
      setNotice(null);
      setBatch([]);
      setProgress({ done: 0, total: pdfs.length });
      const results: { name: string; result: string; kind: keyof typeof PT_STATUS }[] = [];
      const queue = [...pdfs];
      const CONCURRENCY = 3;
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const f = queue.shift();
          if (!f) return;
          const r = await uploadOne(f);
          results.push({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, ...r });
          setBatch([...results]);
          setProgress({ done: results.length, total: pdfs.length });
        }
      });
      await Promise.all(workers);
      const ok = results.filter((r) => r.kind === "ok").length;
      const dup = results.filter((r) => r.kind === "warn").length;
      const bad = results.filter((r) => r.kind === "gap").length;
      setNotice({
        kind: bad ? "warn" : "ok",
        text: `Batch done: ${ok} secured · ${dup} duplicate(s) · ${bad} failed · ${skipped} non-PDF skipped`,
      });
      setBusy(false);
      reload();
    },
    [uploadOne, reload]
  );

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-6 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: PT.text }}>
            Library
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !project}
            onClick={() => dirRef.current?.click()}
            className="cursor-pointer rounded-lg border-0 px-4 py-2 text-[12px] font-bold"
            style={{
              background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`,
              color: "#062430",
              boxShadow: "rgba(34,211,238,0.4) 0px 2px 8px",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy && progress ? `Securing ${progress.done}/${progress.total}…` : "Upload folder"}
          </button>
          <button
            type="button"
            disabled={busy || !project}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-lg px-4 py-2 text-[12px] font-bold"
            style={{
              background: "transparent",
              border: `1px solid ${PT.lineStrong}`,
              color: PT.textDim,
              opacity: busy ? 0.6 : 1,
            }}
          >
            Upload files
          </button>
          <button
            type="button"
            disabled={classifying || !project}
            onClick={() => void runTitleRules()}
            className="cursor-pointer rounded-lg px-4 py-2 text-[12px] font-bold"
            style={{
              background: "transparent",
              border: `1px solid ${PT.lineStrong}`,
              color: PT.textDim,
              opacity: classifying ? 0.6 : 1,
            }}
            title="Deterministic title-keyword classification — proposes only; never touches a confirmed row"
          >
            {classifying ? "Classifying…" : "Classify by title"}
          </button>
          <button
            type="button"
            disabled={busy || !project}
            onClick={() => setImportPath((p) => (p === null ? "" : null))}
            title="The platform reads files straight off this machine — records the TRUE absolute path as the source (browsers hide it)"
            className="cursor-pointer rounded-lg px-4 py-2 text-[12px] font-bold"
            style={{
              background: "transparent",
              border: `1px solid ${PT.lineStrong}`,
              color: PT.textDim,
              opacity: busy ? 0.6 : 1,
            }}
          >
            Import from path
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void uploadMany(fs);
            e.target.value = "";
          }}
        />
        <input
          ref={dirRef}
          type="file"
          className="hidden"
          // @ts-expect-error webkitdirectory is the de-facto standard for
          // recursive directory pickers (Chrome/Edge/Firefox all honor it)
          webkitdirectory=""
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void uploadMany(fs);
            e.target.value = "";
          }}
        />
      </div>

      {importPath !== null && (
        <div className="flex items-center gap-2 rounded-xl border p-3" style={{ borderColor: PT.line, background: PT_PANEL_FROST }}>
          <input
            autoFocus
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void importFromPath(importPath);
              if (e.key === "Escape") setImportPath(null);
            }}
            placeholder="/absolute/path/to/file-or-folder — folders recurse, PDFs only; the true path is recorded as each file's source"
            className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-[11.5px] outline-none"
            style={{ border: `1px solid ${PT.lineStrong}`, background: "rgba(3,8,18,.5)", color: PT.text }}
          />
          <button
            type="button"
            disabled={busy || !importPath.trim()}
            onClick={() => void importFromPath(importPath)}
            className="cursor-pointer rounded-md px-3 py-1.5 text-[11px] font-bold"
            style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: busy || !importPath.trim() ? 0.5 : 1 }}
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => setImportPath(null)}
            className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1.5 text-[11px] font-semibold"
            style={{ color: PT.textGhost }}
          >
            cancel
          </button>
        </div>
      )}

      {notice && <Chip kind={notice.kind}>{notice.text}</Chip>}

      {/* Classification triage is ON HOLD (Shane's 2026-07-13 ruling: no
          content-interpreting features until the UI is built; then each is
          designed together, one at a time). Recorded arc proposals stay in
          Neon, inert and invisible — only shane-confirmed routing renders. */}

      {batch && batch.length > 0 && (
        <section
          className="max-h-64 overflow-y-auto rounded-2xl border p-4 backdrop-blur-2xl"
          style={{ borderColor: PT.line, background: PT_PANEL_FROST }}
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: PT.textFaint }}>
            batch results
          </div>
          <div className="flex flex-col gap-1">
            {batch.map((b, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="min-w-0 flex-shrink truncate font-semibold" style={{ color: PT.textDim }}>
                  {b.name}
                </span>
                <span style={{ color: PT_STATUS[b.kind].fg }}>{b.result}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section
        className="rounded-2xl border backdrop-blur-2xl"
        style={{ borderColor: PT.line, background: PT_PANEL_FROST }}
      >
        {docs === null ? (
          <div className="p-5 text-[12px]" style={{ color: PT.textMute }}>
            loading…
          </div>
        ) : docs.length === 0 ? (
          <div className="p-5 text-[12px]" style={{ color: PT.textMute }}>
            No documents yet — upload the machine&rsquo;s first document to begin intake.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="table-fixed border-collapse text-left"
              style={{ width: COLUMNS.reduce((sum, c) => sum + (widths[c.key] ?? 150), 0) }}
            >
              <colgroup>
                {COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: widths[c.key] ?? 150 }} />
                ))}
              </colgroup>
              <thead>
                <tr className="text-[8.5px] uppercase tracking-[.12em]" style={{ color: PT.textFaint }}>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="relative select-none px-3 py-2.5 font-bold">
                      {c.label}
                      <span
                        onPointerDown={(e) => startResize(c.key, e)}
                        className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize"
                        style={{ borderRight: `1px solid ${PT.line}` }}
                        title="drag to resize"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* soft-deleted rows (merged duplicates) keep their Neon
                    history but stay out of the working table. Rows group by
                    classification (Shane's remodel: organized by how you
                    extract, tabular families first); a full-width header row
                    marks each group so the resizable columns survive. */}
                {docs
                  .filter((d) => d.status !== "soft_deleted")
                  .sort((a, b) => {
                    const ga = CLASS_ORDER.indexOf((a.classification ?? "zz") as typeof CLASS_ORDER[number]);
                    const gb = CLASS_ORDER.indexOf((b.classification ?? "zz") as typeof CLASS_ORDER[number]);
                    if (ga !== gb) return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
                    return (a.normalized_name ?? a.document_id).localeCompare(b.normalized_name ?? b.document_id);
                  })
                  .flatMap((d, i, arr) => {
                    const cls = d.classification ?? "unclassified";
                    const prev = i > 0 ? (arr[i - 1].classification ?? "unclassified") : null;
                    const rows: React.ReactNode[] = [];
                    if (cls !== prev) {
                      const n = arr.filter((x) => (x.classification ?? "unclassified") === cls).length;
                      rows.push(
                        <tr key={`hdr-${cls}`}>
                          <td colSpan={COLUMNS.length} className="border-t px-3 pb-1 pt-2.5"
                              style={{ borderColor: PT.lineStrong, background: "rgba(10,18,34,.55)" }}>
                            <span className="text-[9px] font-bold uppercase tracking-[.14em]"
                                  style={{ color: PT.cyanText }}>
                              {CLASS_LABEL[cls] ?? cls}
                            </span>
                            <span className="ml-2 text-[8.5px]" style={{ color: PT.textGhost }}>
                              {n} document{n === 1 ? "" : "s"}
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    rows.push(renderDocRow(d));
                    return rows;
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );

  // one document row — extracted so the grouped flatMap above stays readable
  function renderDocRow(d: LibraryDoc): React.ReactNode {
    return (
                  <tr key={d.document_id} className="border-t" style={{ borderColor: PT.line }}>
                    <td className="overflow-hidden px-3 py-1.5">
                      {/* Shane's layout: the MAIN name is one truncating
                          line; the small identifier line lives beneath it. */}
                      <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                        <a
                          href={`/platform/${project?.slug}/library/${encodeURIComponent(d.document_id)}`}
                          className="min-w-0 truncate text-[10.5px] font-semibold hover:underline"
                          style={{ color: PT.text }}
                          title={`${d.normalized_name ?? d.document_id} · ${d.document_id}`}
                        >
                          {d.normalized_name ?? d.document_id}
                        </a>
                        {/* Auto-approve ruling: no pending-action marks; only a
                            low-confidence read earns an informational flag. */}
                        {d.skim_state === "needs-shane" && (
                          <span
                            className="shrink-0 text-[7.5px] font-bold uppercase tracking-[.08em]"
                            style={{ color: PT.amberText }}
                            title="Arc read this with low confidence — the name/description are worth a glance (edit in the viewer)"
                          >
                            low conf
                          </span>
                        )}
                      </div>
                      <div
                        className="truncate text-[8.5px]"
                        style={{ color: PT.textGhost }}
                        title={d.original_name ?? d.document_id}
                      >
                        {d.original_name ?? d.document_id}
                      </div>
                    </td>
                    <td className="overflow-hidden px-3 py-1.5">
                      {/* classification (phase 3): class + confirm state on
                          line 1; method / vector-text / extraction rollup
                          chips on line 2 — the four organizing metrics. */}
                      {d.classification ? (
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="truncate text-[9.5px] font-semibold"
                                style={{ color: d.classification_state === "shane-confirmed" ? PT.text : PT.amberText }}
                                title={d.classification_detail?.rule
                                  ? `rule: ${d.classification_detail.rule} (${d.classification_detail.source ?? "?"})`
                                  : undefined}>
                            {d.classification}
                            {d.classification_state === "shane-confirmed" ? " ✓" : ""}
                          </span>
                          {d.classification_state !== "shane-confirmed" && (
                            <button
                              type="button"
                              onClick={() => void confirmClassification(d)}
                              className="shrink-0 cursor-pointer rounded border px-1 text-[8px] font-bold uppercase"
                              style={{ borderColor: PT.lineStrong, color: PT.textDim, background: "transparent" }}
                              title="confirm this classification (proposed by title rule)"
                            >
                              confirm
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-[9px]" style={{ color: PT.textGhost }}>unclassified</div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[7.5px] font-bold uppercase tracking-[.08em]">
                        {d.classification_detail?.method && (
                          <span style={{ color: METHOD_COLOR[d.classification_detail.method] ?? PT.textGhost }}
                                title="extraction method inferred from the title">
                            {d.classification_detail.method}
                          </span>
                        )}
                        <span style={{ color: d.skim_detail?.mode === "vision" ? PT.amberText : PT.textGhost }}
                              title={d.skim_detail?.mode === "vision"
                                ? "no text layer — scanned; extraction is visual-only"
                                : "PDF text layer present"}>
                          {d.skim_detail?.mode === "vision" ? "scanned" : "text"}
                        </span>
                        {d.extractions ? (
                          <span style={{ color: d.extractions.certified === d.extractions.tables ? "#34d399" : PT.cyanText }}
                                title={`${d.extractions.tables} extraction table(s), ${d.extractions.certified} certified`}>
                            {d.extractions.certified}/{d.extractions.tables} certified
                          </span>
                        ) : (
                          <span style={{ color: PT.textGhost }} title="no extraction tables yet">no tables</span>
                        )}
                      </div>
                    </td>
                    <td className="overflow-hidden px-3 py-1.5">
                      {/* Two clamped lines — the row is already two lines tall
                          (name + original name), so this costs no height. */}
                      <div className="line-clamp-2 text-[9px] leading-snug" style={{ color: PT.textDim }} title={d.description ?? undefined}>
                        {d.description ?? <span style={{ color: PT.textGhost }}>—</span>}
                      </div>
                    </td>
                    <td className="overflow-hidden whitespace-nowrap px-3 py-1.5">
                      <Chip kind={intakeChip(d).kind}>{intakeChip(d).text}</Chip>
                    </td>
                    <td className="overflow-hidden px-3 py-1.5">
                      {d.routing.filter((r) => r.source === "shane-confirmed").length === 0 ? (
                        <Chip kind="pending">not routed</Chip>
                      ) : (
                        <div
                          className="flex gap-1 overflow-hidden whitespace-nowrap"
                          title={d.routing
                            .filter((r) => r.source === "shane-confirmed")
                            .map((r) => `${r.start === r.end ? `p${r.start}` : `p${r.start}–${r.end}`} ${r.lane}`)
                            .join(" · ")}
                        >
                          {d.routing
                            .filter((r) => r.source === "shane-confirmed")
                            .map((r) => (
                              <Chip key={`${r.start}-${r.end}`} kind="ok">
                                {r.start === r.end ? `p${r.start}` : `p${r.start}–${r.end}`} {r.lane} ✓
                              </Chip>
                            ))}
                        </div>
                      )}
                    </td>
                    <td className="overflow-hidden px-3 py-1.5 text-[8.5px]" style={{ color: PT.textMute }}>
                      <div className="truncate" title={[d.source_path, d.source_label].filter(Boolean).join(" · ") || undefined}>
                        {d.source_path || d.source_label ? (
                          [d.source_path, d.source_label].filter(Boolean).join(" · ")
                        ) : (
                          <span style={{ color: PT.textGhost }}>unrecorded</span>
                        )}
                      </div>
                    </td>
                    <td className="overflow-hidden whitespace-nowrap px-3 py-1.5 text-[8.5px]" style={{ color: PT.textMute }}>
                      <div className="truncate">{d.created_at ? new Date(d.created_at).toLocaleString() : "—"}</div>
                    </td>
                    <td className="overflow-hidden px-3 py-1.5 text-[8.5px]" style={{ color: PT.textMute }}>
                      <div className="truncate" title={d.content_sha256 ?? undefined}>
                        {d.content_sha256 ? `${d.content_sha256.slice(0, 12)}…` : <Chip kind="pending">awaits retrofit (R16)</Chip>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">
                      {confirmDeleteId === d.document_id ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void deleteDoc(d)}
                            title="Really delete — removes the record, derived data, and files (certified documents are refused)"
                            className="cursor-pointer rounded px-1.5 py-0.5 text-[9px] font-bold leading-none"
                            style={{ border: "1px solid rgba(248,113,113,.45)", color: "#f87171", background: "rgba(248,113,113,.08)" }}
                          >
                            delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="cursor-pointer rounded px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                            style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent" }}
                          >
                            keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(d.document_id)}
                          title={`Delete ${d.normalized_name ?? d.document_id} from the library`}
                          className="cursor-pointer rounded border-0 bg-transparent px-1 text-[10px] leading-none"
                          style={{ color: PT.textGhost }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = PT.gapRed)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = PT.textGhost)}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
    );
  }
}
