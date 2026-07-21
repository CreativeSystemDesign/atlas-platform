"use client";

// Document Extraction — the unified page. It doubles as browser AND
// workbench: the library renders GROUPED by classification (Shane's
// remodel, phase 4 — tabular families first, since those are the
// extraction-ready docs), each row carrying the four organizing metrics
// (class · method · text/scanned · extraction status). Search filters the
// groups; picking a document renders its PDF + extraction table right
// here (no navigation). Arc rides the right rail throughout (picker seat
// here; data-extraction seat inside the workbench).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_PANEL_FROST } from "@/lib/platform-theme";
import { useProject } from "../layout";
import { ExperimentalV2CopilotPanel } from "@/components/experimental-v2/experimental-v2-copilot-panel";
import { ExtractionWorkbench } from "./extraction-workbench";

type LibraryDoc = {
  document_id: string;
  normalized_name: string | null;
  status: string;
  classification: string | null;
  classification_state: string | null;
  classification_detail: { method?: string; rule?: string } | null;
  skim_detail: { mode?: string } | null;
  extractions: { tables: number; certified: number } | null;
};

// Group order: tabular families first — they're what this surface exists
// to extract — then the visual prints, then reference material.
const CLASS_ORDER = ["cable-list", "parts-list", "plc-reference", "schematic",
  "manual", "other", "unclassified"] as const;
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

export default function ExtractPage() {
  const project = useProject();
  const params = useParams<{ projectSlug: string }>();
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [arcOpen, setArcOpen] = useState(true);
  const [search, setSearch] = useState("");

  // Error state distinct from genuinely-empty (review 2026-07-20: a failed
  // fetch must never claim "the library is empty").
  const [loadError, setLoadError] = useState(false);
  const loadDocs = useCallback(() => {
    if (!project) return;
    fetch(`${agentBaseUrl()}/projects/${project.project_id}/documents`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setDocs(d.documents ?? []); setLoadError(false); })
      .catch(() => { setDocs((prev) => prev ?? null); setLoadError(true); });
  }, [project]);
  useEffect(loadDocs, [loadDocs]);

  // The whole library exposed to Arc's picker seat (id + name + the metrics).
  const libraryForArc = useMemo(
    () => (docs ?? [])
      .filter((d) => d.status !== "soft_deleted")
      .map((d) => ({
        id: d.document_id,
        name: d.normalized_name ?? d.document_id,
        classification: d.classification,
        method: d.classification_detail?.method ?? null,
        tables_certified: d.extractions ? `${d.extractions.certified}/${d.extractions.tables}` : null,
      })),
    [docs]
  );

  // The grouped browser: every doc listed, search narrows. Certified-complete
  // docs sort to the bottom of their group ("what's left" reads top-down).
  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const live = (docs ?? [])
      .filter((d) => d.status !== "soft_deleted")
      .filter((d) => !q
        || (d.normalized_name ?? d.document_id).toLowerCase().includes(q)
        || d.document_id.toLowerCase().includes(q));
    const byClass = new Map<string, LibraryDoc[]>();
    for (const d of live) {
      const cls = d.classification ?? "unclassified";
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls)!.push(d);
    }
    const done = (d: LibraryDoc) =>
      d.extractions != null && d.extractions.tables > 0 && d.extractions.certified === d.extractions.tables;
    for (const list of byClass.values()) {
      list.sort((a, b) => (Number(done(a)) - Number(done(b)))
        || (a.normalized_name ?? a.document_id).localeCompare(b.normalized_name ?? b.document_id));
    }
    return CLASS_ORDER
      .filter((c) => byClass.has(c))
      .map((c) => ({ cls: c, docs: byClass.get(c)! }))
      .concat([...byClass.keys()]
        .filter((c) => !(CLASS_ORDER as readonly string[]).includes(c))
        .map((c) => ({ cls: c as typeof CLASS_ORDER[number], docs: byClass.get(c)! })));
  }, [docs, q]);

  // Picked a document → its workbench renders right here (viewer + table + Arc
  // on the data-extraction seat). Back returns to the browser.
  if (selectedDoc) {
    // refetch on back — certification/tables may have changed in the
    // workbench, and the browser displays those metrics (review 2026-07-20)
    return <ExtractionWorkbench key={selectedDoc} documentId={selectedDoc}
      onBack={() => { setSelectedDoc(null); loadDocs(); }} />;
  }

  return (
    <div className="flex min-h-0" style={{ height: "calc(100vh - 100px)" }}>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-6 py-8">
          <div>
            <h1 className="text-[20px] font-bold" style={{ color: PT.text }}>Document Extraction</h1>
            <p className="mt-1 text-[12px]" style={{ color: PT.textMute }}>
              Every document, organized by how it extracts — tabular lists first.
              Opening one brings up its PDF and extraction table right here.
            </p>
          </div>

          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter the library — name or keyword…"
            className="w-full rounded-lg px-3.5 py-2.5 text-[13px] outline-none"
            style={{ background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.text }}
          />

          {loadError && docs === null ? (
            <div className="text-[12px]" style={{ color: "#f87171" }}>
              Couldn&apos;t reach the agent server — the library can&apos;t load. Check the backend and reload.
            </div>
          ) : docs === null ? (
            <div className="text-[12px]" style={{ color: PT.textMute }}>loading the library…</div>
          ) : groups.length === 0 ? (
            <div className="text-[12px]" style={{ color: PT.textMute }}>
              {q ? <>No documents match “{search.trim()}”.</> : "The library is empty — upload documents first."}
            </div>
          ) : (
            groups.map(({ cls, docs: list }) => (
              <div key={cls}>
                <div className="mb-1.5 flex items-baseline gap-2 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: PT.cyanText }}>
                    {CLASS_LABEL[cls] ?? cls}
                  </span>
                  <span className="text-[9px]" style={{ color: PT.textGhost }}>
                    {list.length} document{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex flex-col overflow-hidden rounded-xl border" style={{ borderColor: PT.line, background: PT_PANEL_FROST }}>
                  {list.map((d) => {
                    const method = d.classification_detail?.method;
                    const scanned = d.skim_detail?.mode === "vision";
                    const ext = d.extractions;
                    const complete = ext != null && ext.tables > 0 && ext.certified === ext.tables;
                    return (
                      <button
                        key={d.document_id}
                        type="button"
                        onClick={() => setSelectedDoc(d.document_id)}
                        className="flex items-center gap-3 border-t px-5 py-2.5 text-left transition-colors first:border-t-0 hover:bg-white/[.03]"
                        style={{ borderColor: PT.line }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12.5px] font-semibold" style={{ color: PT.text }}>
                              {d.normalized_name ?? d.document_id}
                            </span>
                            {complete && (
                              <ShieldCheck className="h-3.5 w-3.5 shrink-0" style={{ color: "#34d399" }} aria-label="all tables certified" />
                            )}
                          </div>
                          <div className="truncate text-[10px]" style={{ color: PT.textGhost }}>{d.document_id}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[8px] font-bold uppercase tracking-[.08em]">
                          {method && (
                            <span style={{ color: METHOD_COLOR[method] ?? PT.textGhost }}>{method}</span>
                          )}
                          {scanned && (
                            <span style={{ color: PT.amberText }} title="no text layer — scanned print">scanned</span>
                          )}
                          <span
                            style={{ color: complete ? "#34d399" : ext ? PT.cyanText : PT.textGhost }}
                            title={ext ? `${ext.tables} table(s), ${ext.certified} certified` : "no extraction tables yet"}
                          >
                            {ext ? `${ext.certified}/${ext.tables} certified` : "not started"}
                          </span>
                        </div>
                        <span className="text-[13px]" style={{ color: PT.textGhost }}>→</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {arcOpen ? (
        <ExperimentalV2CopilotPanel
          open
          onClose={() => setArcOpen(false)}
          seat={{
            area: "extraction-picker",
            context: () => ({ project_slug: params.projectSlug, documents: libraryForArc }),
          }}
          title="Arc · Find a document"
          composerPlaceholder="Ask Arc which documents you have — by type, name, or keyword…"
          kickoff="Extraction landing opened — the whole document library is loaded in your context."
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
  );
}
