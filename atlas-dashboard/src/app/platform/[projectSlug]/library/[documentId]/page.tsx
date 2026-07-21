"use client";

// Document viewer — the feature that makes `available` TRUE (Shane's
// 2026-07-13 probe: "available to whom?"). Renders the workspace-tier pages
// intake produced; read-only, no content interpretation (R18). Thumbnail
// rail + main page + arrow-key paging.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { PT, PT_PANEL_FROST, PT_STATUS } from "@/lib/platform-theme";
import { useProject } from "../../layout";
import { useWheelPageFlip } from "@/lib/use-wheel-page-flip";

type RoutingRange = { start: number; end: number; lane: string; source: string | null };
type DocMeta = {
  document_id: string;
  normalized_name: string | null;
  original_name: string | null;
  content_sha256: string | null;
  status: string;
  description: string | null;
  skim_state: string | null;
  skim_detail: { confidence?: number; model?: string; mode?: string; escalated?: boolean } | null;
  source_path: string | null;
  source_label: string | null;
  routing: RoutingRange[];
};

function Chip({ kind, children }: { kind: keyof typeof PT_STATUS; children: React.ReactNode }) {
  const s = PT_STATUS[kind];
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10.5px] font-semibold tracking-[.02em]"
      style={{ color: s.fg, background: s.bg }}
    >
      {children}
    </span>
  );
}

// Name & description editor (capability #1, auto-approve ruling 2026-07-13):
// skim results are accepted the moment they land; this panel is a permanent
// EDITOR, not a gate. Saving records shane-confirmed provenance and
// re-stamps the working copy from the Neon truth.
function SkimReview({
  meta,
  confirmUrl,
  onConfirmed,
}: {
  meta: DocMeta;
  confirmUrl: string;
  onConfirmed: () => void;
}) {
  const [name, setName] = useState(meta.normalized_name ?? "");
  const [description, setDescription] = useState(meta.description ?? "");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [drafted, setDrafted] = useState<string | null>(null); // provenance of an unsaved draft
  const [error, setError] = useState<string | null>(null);
  const needsShane = meta.skim_state === "needs-shane";
  const conf = meta.skim_detail?.confidence;

  // Generate = Arc drafts INTO the fields; nothing persists until Save
  // (the never-overwrite-confirmed guards stay absolute — this is how the
  // schematic gets a description on demand).
  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(confirmUrl.replace(/confirm-skim$/, "generate-skim"), { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body?.detail === "string" ? body.detail : `generate failed (HTTP ${res.status})`);
      } else {
        if (body.normalized_name) setName(body.normalized_name);
        if (body.description) setDescription(body.description);
        setDrafted(`drafted by Arc · ${Math.round((body.confidence ?? 0) * 100)}% · ${String(body.model ?? "").includes("haiku") ? "haiku" : "sonnet"} — unsaved`);
      }
    } catch {
      setError("generate failed — backend unreachable");
    }
    setGenerating(false);
  }
  const provenance =
    meta.skim_state === "shane-confirmed"
      ? "your words"
      : meta.skim_state
        ? `skimmed by Arc${typeof conf === "number" ? ` · ${Math.round(conf * 100)}%` : ""}${meta.skim_detail?.model?.includes("haiku") ? " · haiku" : meta.skim_detail?.model?.includes("sonnet") ? " · sonnet" : ""}${needsShane ? " · LOW CONFIDENCE — worth a check" : ""}`
        : "no skim recorded — write your own";

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(confirmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ normalized_name: name, description }),
      });
      if (!res.ok) {
        setError(`confirm failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      onConfirmed();
    } catch {
      setError("backend unreachable");
      setBusy(false);
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-start gap-3 border-b px-5 py-3"
      style={{
        borderColor: needsShane ? "rgba(245,158,11,.4)" : "rgba(34,211,238,.3)",
        background: needsShane ? "rgba(245,158,11,.06)" : "rgba(34,211,238,.05)",
      }}
    >
      <div className="min-w-[260px] flex-1">
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[.12em]" style={{ color: needsShane ? PT.amberText : PT.cyanText }}>
          {drafted ?? provenance}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-1.5 w-full rounded-lg px-3 py-1.5 text-[12.5px] font-semibold outline-none"
          style={{ background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.text }}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-lg px-3 py-1.5 text-[11.5px] outline-none"
          style={{ background: PT.well, border: `1px solid ${PT.lineStrong}`, color: PT.textDim }}
        />
        {error && (
          <div className="mt-1 text-[11px] font-semibold" style={{ color: PT.gapRed }}>
            {error}
          </div>
        )}
      </div>
      <div className="mt-4 flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={busy || generating}
          onClick={() => void generate()}
          title="Arc reads the first pages and drafts a name + description into these fields — nothing saves until you hit Save"
          className="cursor-pointer rounded-lg px-4 py-2 text-[12px] font-bold"
          style={{
            background: "transparent",
            border: `1px solid ${PT.lineStrong}`,
            color: PT.textDim,
            opacity: busy || generating ? 0.5 : 1,
          }}
        >
          {generating ? "Generating…" : "Generate"}
        </button>
        <button
          type="button"
          disabled={busy || generating || !name.trim()}
          onClick={() => void confirm()}
          className="cursor-pointer rounded-lg border-0 px-4 py-2 text-[12px] font-bold"
          style={{
            background: `linear-gradient(180deg, ${PT.cyanBright}, ${PT.cyanDeep})`,
            color: "#062430",
            boxShadow: "rgba(34,211,238,0.4) 0px 2px 8px",
            opacity: busy || generating || !name.trim() ? 0.5 : 1,
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function DocumentViewer() {
  const project = useProject();
  const params = useParams<{ projectSlug: string; documentId: string }>();
  const documentId = decodeURIComponent(params.documentId);
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [metaVersion, setMetaVersion] = useState(0); // bump to refetch after save
  const [editOpen, setEditOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const base = useMemo(
    () => (project ? `${agentBaseUrl()}/projects/${project.project_id}/documents/${encodeURIComponent(documentId)}` : null),
    [project, documentId]
  );

  useEffect(() => {
    if (!project || !base) return;
    fetch(`${agentBaseUrl()}/projects/${project.project_id}/documents`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMeta((d.documents ?? []).find((x: DocMeta) => x.document_id === documentId) ?? null))
      .catch(() => setMeta(null));
    fetch(`${base}/pages`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPageCount(d.pages ?? 0))
      .catch(() => setPageCount(0));
  }, [project, base, documentId, metaVersion]);

  const go = useCallback(
    (n: number) => {
      if (!pageCount) return;
      const clamped = Math.min(Math.max(1, n), pageCount);
      setPage(clamped);
      railRef.current
        ?.querySelector(`[data-page="${clamped}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [pageCount]
  );

  const pageScrollRef = useRef<HTMLDivElement>(null);
  const onPageWheel = useWheelPageFlip(pageScrollRef, { page, pageCount, onFlip: go });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, page]);

  const confirmed = meta?.routing.filter((r) => r.source === "shane-confirmed") ?? [];

  return (
    // Fixed-height viewer frame: only the shell header (56px) sits above
    // (the second nav bar is gone — Shane's ruling); the rail and page pane
    // scroll internally, never the page.
    <div className="flex min-h-0 flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div
        className="flex shrink-0 items-center gap-3 border-b px-5 py-2.5"
        style={{ borderColor: PT.line, background: PT_PANEL_FROST }}
      >
        <Link href={`/platform/${params.projectSlug}/library`} className="text-[11.5px] font-semibold" style={{ color: PT.textMute }}>
          ← Library
        </Link>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold" style={{ color: PT.text }}>
            {meta?.normalized_name ?? documentId}
          </div>
          <div className="truncate text-[9.5px]" style={{ color: PT.textGhost }}>
            {documentId}
            {meta?.content_sha256 ? ` · sha ${meta.content_sha256.slice(0, 12)}…` : ""}
            {" · workspace 300dpi (masters archived at 600)"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {confirmed.map((r) => (
            <Chip key={`${r.start}`} kind="ok">
              {r.start === r.end ? `p${r.start}` : `p${r.start}–${r.end}`} {r.lane}
            </Chip>
          ))}
          {meta && <Chip kind={meta.status === "available" ? "ok" : "pending"}>{meta.status}</Chip>}
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            className="cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-bold"
            style={{
              border: `1px solid ${PT.lineStrong}`,
              background: editOpen ? "rgba(34,211,238,.10)" : "transparent",
              color: editOpen ? PT.cyanText : PT.textDim,
            }}
          >
            {editOpen ? "close" : "edit"}
          </button>
        </div>
      </div>

      {meta && base && editOpen && (
        <SkimReview
          // remount (resetting the editable fields) if a refetch lands
          // fresh values while the panel is open
          key={`${meta.skim_state}:${meta.normalized_name}`}
          meta={meta}
          confirmUrl={`${base}/confirm-skim`}
          onConfirmed={() => {
            setMetaVersion((v) => v + 1);
            setEditOpen(false);
          }}
        />
      )}

      {pageCount === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[12.5px]" style={{ color: PT.textMute }}>
          No workspace renders exist for this document yet.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            ref={railRef}
            className="flex w-[132px] shrink-0 flex-col gap-2 overflow-y-auto border-r p-2.5"
            style={{ borderColor: PT.line, background: "rgba(3,8,18,.5)" }}
          >
            {base &&
              Array.from({ length: pageCount ?? 0 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  data-page={n}
                  onClick={() => go(n)}
                  className="cursor-pointer rounded-lg border p-1"
                  style={{
                    borderColor: n === page ? PT.cyanBright : PT.line,
                    background: n === page ? "rgba(34,211,238,.10)" : "transparent",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${base}/pages/${n}/image`}
                    alt={`page ${n}`}
                    loading="lazy"
                    className="w-full rounded-md"
                    style={{ background: "#fff" }}
                  />
                  <div className="mt-0.5 text-center text-[9.5px] font-semibold" style={{ color: n === page ? PT.cyanText : PT.textGhost }}>
                    {n}
                  </div>
                </button>
              ))}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-center gap-3 py-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => go(page - 1)}
                className="cursor-pointer rounded-md px-3 py-1 text-[12px] font-bold"
                style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: page <= 1 ? 0.4 : 1 }}
              >
                ← prev
              </button>
              <span className="text-[12px] font-semibold tabular-nums" style={{ color: PT.textDim }}>
                page {page} / {pageCount ?? "…"}
              </span>
              <button
                type="button"
                disabled={pageCount !== null && page >= pageCount}
                onClick={() => go(page + 1)}
                className="cursor-pointer rounded-md px-3 py-1 text-[12px] font-bold"
                style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: pageCount !== null && page >= pageCount ? 0.4 : 1 }}
              >
                next →
              </button>
              <span className="text-[10px]" style={{ color: PT.textGhost }}>
                ← → keys work
              </span>
            </div>
            <div ref={pageScrollRef} onWheel={onPageWheel} className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {base && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`${base}/pages/${page}/image`}
                  alt={`page ${page}`}
                  className="mx-auto h-auto w-full max-w-[1400px] rounded-lg"
                  style={{ background: "#fff", boxShadow: "rgba(0,0,0,.5) 0 12px 40px" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
