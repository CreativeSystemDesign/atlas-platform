"use client";

// The shared document-reading pane — page viewer + zoom + selectable text
// layer + the mark/region/selection pointing grammar Arc reads. Extracted
// from the Schema-Builder bench (2026-07-15) so the Data › Extraction
// workbench mounts the SAME left pane (strict-modularity law). Every guard
// here — inline-size containment, cached-image dims healing, drag page-lock,
// document-level selection capture, Esc-clears-all — predates the extraction
// and is documented in place.
//
// The host owns Arc's panel and the bottom strip; this component owns the
// rail + pages pane and exposes an imperative handle so the host can (a)
// sample the pointing context for the seat and (b) drive the viewer when Arc
// sends bench commands (goto_page / mark / region / clear_marks / toast).

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import { PT } from "@/lib/platform-theme";
import { useWheelPageFlip } from "@/lib/use-wheel-page-flip";
import { SchemaMarkRail, type SchemaMarkTool } from "./schema-mark-rail";

// Local copy of the bench's input styling — avoids a cross-layer import from
// the app-dir table editor for one three-property object.
const INPUT_STYLE = {
  background: PT.well,
  border: `1px solid ${PT.lineStrong}`,
  color: PT.text,
} as const;

type Mark = { n: number; page: number; x: number; y: number };
type Region = { n: number; page: number; x: number; y: number; w: number; h: number };
type ArcMark = Mark & { label?: string };
type ArcRegion = Region & { label?: string };
type Selection = { page: number; text: string; x: number; y: number; w: number; h: number };

/** The pointing keys both seats read (schema-builder + data-extraction).
    The host spreads this into the seat context and adds its domain fields. */
export type PointerContext = {
  viewing_page: number;
  marks: Mark[];
  marks_total: number;
  regions: Region[];
  regions_total: number;
  selection?: Selection;
  arc_marks?: ArcMark[];
  arc_regions?: ArcRegion[];
};

export type ViewerCommand = Record<string, unknown>;

/** A crop the capture tool hands the host (→ the copilot composer). */
export type CapturedCrop = { media_type: string; data: string; name: string };

async function blobToB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export type DocumentViewerHandle = {
  /** Sampled at send time for the seat context — the pointing block. */
  getPointerContext: () => PointerContext;
  /** Arc driving the viewer (bench_command): goto_page/mark/region/clear/toast. */
  handleCommand: (cmd: ViewerCommand) => void;
  /** Fire a transient amber toast (also used by the host, e.g. save receipts). */
  showToast: (text: string) => void;
  page: number;
};

export const DocumentViewer = forwardRef<DocumentViewerHandle, {
  docBase: string | null;
  documentId: string;
  /** Reports the live page + count so the host can label / kickoff / filter. */
  onPageChange?: (page: number, pageCount: number | null) => void;
  /** Enables the Capture tool: a snipped region → this crop (host attaches it
      to the composer). Absent = no Capture tool on the rail. */
  onCapture?: (crop: CapturedCrop) => void;
}>(function DocumentViewer({ docBase, documentId, onPageChange, onCapture }, ref) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // Region drag state lives up here so go() can cancel an in-flight drag: a
  // page change from ANY source (nav, wheel-flip, Arc's goto_page) must never
  // complete a box against the new page.
  const [dragBox, setDragBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; page: number } | null>(null);

  const go = useCallback((n: number) => {
    dragRef.current = null;
    setDragBox(null);
    setPage((prev) => {
      if (pageCount == null) return prev;
      return Math.min(Math.max(1, n), pageCount);
    });
  }, [pageCount]);

  useEffect(() => {
    onPageChange?.(page, pageCount);
  }, [page, pageCount, onPageChange]);

  useEffect(() => {
    if (!docBase) return;
    let cancelled = false;
    fetch(`${docBase}/pages`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setPageCount(d.pages ?? 0); })
      .catch(() => { if (!cancelled) setPageCount(0); });
    return () => { cancelled = true; };
  }, [docBase]);

  const pageScrollRef = useRef<HTMLDivElement>(null);
  const onPageWheel = useWheelPageFlip(pageScrollRef, { page, pageCount, onFlip: go });

  // Zoom (Shane's ask, 2026-07-13): Ctrl/Cmd+scroll (and trackpad pinch,
  // which fires wheel with ctrlKey) scales the page container's WIDTH —
  // every overlay is %-anchored to it, so marks, text layer, and selection
  // scale in lockstep. 1 = fit width; anchored at the cursor. Native
  // non-passive listener because React registers wheel passively at the
  // root, so preventDefault (blocking browser page-zoom) needs this.
  const [zoom, setZoom] = useState(1);
  const clampZoom = (z: number) => Math.min(5, Math.max(1, z));
  useEffect(() => {
    const el = pageScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom((z) => {
        const next = clampZoom(z * factor);
        if (next === z) return z;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const px = cx + el.scrollLeft, py = cy + el.scrollTop;
        const ratio = next / z;
        requestAnimationFrame(() => {
          el.scrollLeft = px * ratio - cx;
          el.scrollTop = py * ratio - cy;
        });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const zoomStep = (dir: 1 | -1) => setZoom((z) => clampZoom(dir > 0 ? z * 1.25 : z / 1.25));

  // The pointer tool: click to pin a spot in page-px; pins ride the seat
  // context so Arc sees "#1 p3@(x,y)". Same grammar as the Smart Canvas mark
  // tools — monotonic n (never reused after a delete), ask-tap toggles a mark
  // off within 28 page-px, caps match (12 marks / 6 regions). One divergence,
  // deliberate: marks carry a page and persist across page flips.
  const [tool, setTool] = useState<SchemaMarkTool>("none");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  // Text blocks are stamped with the page they belong to so the render can
  // DERIVE the current page's blocks (no synchronous reset-in-effect — a stale
  // page's text simply doesn't match and isn't shown).
  const [textData, setTextData] = useState<{ page: number; blocks: { text: string; x: number; y: number; w: number; h: number }[] }>({ page: 0, blocks: [] });

  // Arc's side of the pointing conversation: amber marks/regions it drops via
  // schema_bench, its toast line, and Shane's text selection.
  const [arcMarks, setArcMarks] = useState<ArcMark[]>([]);
  const [arcRegions, setArcRegions] = useState<ArcRegion[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!docBase) return;
    let cancelled = false;
    fetch(`${docBase}/pages/${page}/text`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setTextData({ page, blocks: d.blocks ?? [] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [docBase, page]);

  // Esc clears every mark — Shane's AND Arc's — plus the selection, and
  // cancels an in-flight drag. Guarded so Esc inside a field stays a field
  // escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      dragRef.current = null;
      setDragBox(null);
      setMarks([]);
      setRegions([]);
      setArcMarks([]);
      setArcRegions([]);
      setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Shane highlights text on the page (Select tool) — capture what + where in
  // page px so it rides the seat context as shane_selection. Document-level
  // mouseup: a drag released past the image edge or over the panel still
  // captures. Clicks elsewhere leave the capture alone; a plain click back in
  // the layer clears it.
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onUp = () => {
      const layer = textLayerRef.current;
      if (!layer || !imgDims) return;
      const sel = window.getSelection();
      const anchorInside = !!sel?.anchorNode && layer.contains(sel.anchorNode);
      if (!sel || sel.isCollapsed) {
        if (anchorInside) setSelection(null);
        return;
      }
      if (!anchorInside) return;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (!text) {
        setSelection(null);
        return;
      }
      const rr = sel.getRangeAt(0).getBoundingClientRect();
      const lr = layer.getBoundingClientRect();
      const sx = imgDims.w / lr.width, sy = imgDims.h / lr.height;
      const x0 = Math.max(0, (rr.left - lr.left) * sx);
      const y0 = Math.max(0, (rr.top - lr.top) * sy);
      const x1 = Math.min(imgDims.w, (rr.right - lr.left) * sx);
      const y1 = Math.min(imgDims.h, (rr.bottom - lr.top) * sy);
      if (x1 <= x0 || y1 <= y0) return;
      setSelection({
        page,
        text: text.slice(0, 500),
        x: Math.round(x0), y: Math.round(y0),
        w: Math.round(x1 - x0), h: Math.round(y1 - y0),
      });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [imgDims, page]);

  // (drag-cancel on page change is handled inside go() — see above.)

  // imgDims normally arrives via the img's onLoad — but a cached image can
  // complete before React attaches the listener, and every tool guards on
  // imgDims. Read the natural size straight off the element and heal on the
  // spot.
  const ensureImgDims = (el: HTMLImageElement): { w: number; h: number } | null => {
    if (imgDims) return imgDims;
    if (el.naturalWidth > 0) {
      const d = { w: el.naturalWidth, h: el.naturalHeight };
      setImgDims(d);
      return d;
    }
    return null;
  };
  const imgRefCallback = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0 && !imgDims)
      setImgDims({ w: el.naturalWidth, h: el.naturalHeight });
  };
  const toImage = (e: React.MouseEvent, el: HTMLElement, dims: { w: number; h: number }) => {
    const rect = el.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * dims.w,
      y: ((e.clientY - rect.top) / rect.height) * dims.h,
    };
  };
  const placeMark = (e: React.MouseEvent<HTMLImageElement>) => {
    const dims = ensureImgDims(e.currentTarget);
    if (tool !== "point" || !dims) return;
    const pt = toImage(e, e.currentTarget, dims);
    const near = marks.find((m) => m.page === page && Math.hypot(m.x - pt.x, m.y - pt.y) <= 28);
    if (near) {
      setMarks((prev) => prev.filter((m) => m.n !== near.n));
      return;
    }
    const n = (marks[marks.length - 1]?.n ?? 0) + 1;
    setMarks((prev) => [...prev.slice(-11), { n, page, x: Math.round(pt.x), y: Math.round(pt.y) }]);
  };
  const regionDown = (e: React.MouseEvent<HTMLImageElement>) => {
    const dims = ensureImgDims(e.currentTarget);
    if ((tool !== "region" && tool !== "capture") || !dims) return;
    e.preventDefault();
    const pt = toImage(e, e.currentTarget, dims);
    dragRef.current = { x0: pt.x, y0: pt.y, page };
    setDragBox({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
  };
  const regionMove = (e: React.MouseEvent<HTMLImageElement>) => {
    const dims = dragRef.current && ensureImgDims(e.currentTarget);
    if (!dragRef.current || !dims) return;
    const pt = toImage(e, e.currentTarget, dims);
    setDragBox({ ...dragRef.current, x1: pt.x, y1: pt.y });
  };
  const regionUp = () => {
    const d = dragRef.current;
    const b = dragBox;
    dragRef.current = null;
    setDragBox(null);
    if (!d || !b) return;
    const x = Math.round(Math.min(b.x0, b.x1)), y = Math.round(Math.min(b.y0, b.y1));
    const w = Math.round(Math.abs(b.x1 - b.x0)), h = Math.round(Math.abs(b.y1 - b.y0));
    if (w < 20 || h < 20) return; // a click, not a box
    const n = (regions[regions.length - 1]?.n ?? 0) + 1;
    setRegions((prev) => [...prev.slice(-5), { n, page: d.page, x, y, w, h }]);
    // Capture tool: also snip the region server-side and hand the crop to the
    // host (→ the composer). The box stays as provenance in the context.
    if (tool === "capture" && onCapture && docBase) {
      const pg = d.page;
      void (async () => {
        try {
          const res = await fetch(`${docBase}/pages/${pg}/crop?x=${x}&y=${y}&w=${w}&h=${h}`);
          if (!res.ok) return;
          const data = await blobToB64(await res.blob());
          onCapture({ media_type: "image/png", data, name: `p${pg} capture` });
        } catch { /* offline — skip */ }
      })();
    }
  };

  // Imperative handle: sampled for the seat context, driven by Arc's
  // bench_command. Re-created every render so it always closes over fresh
  // state (the context() sampler runs at message-send time).
  useImperativeHandle(ref, () => ({
    page,
    getPointerContext: (): PointerContext => ({
      viewing_page: page,
      marks: marks.slice(-6).map((m) => ({ n: m.n, page: m.page, x: m.x, y: m.y })),
      marks_total: marks.length,
      regions: regions.slice(-4).map((r) => ({ n: r.n, page: r.page, x: r.x, y: r.y, w: r.w, h: r.h })),
      regions_total: regions.length,
      ...(selection ? { selection: { ...selection, text: selection.text.slice(0, 300) } } : {}),
      ...(arcMarks.length ? {
        arc_marks: arcMarks.slice(-6).map((m) => ({
          n: m.n, page: m.page, x: m.x, y: m.y, ...(m.label ? { label: m.label } : {}),
        })),
      } : {}),
      ...(arcRegions.length ? {
        arc_regions: arcRegions.slice(-4).map((r) => ({
          n: r.n, page: r.page, x: r.x, y: r.y, w: r.w, h: r.h, ...(r.label ? { label: r.label } : {}),
        })),
      } : {}),
    }),
    handleCommand: (cmd: ViewerCommand) => {
      // Commands are stamped with the document they were aimed at — a second
      // bench tab on another document must ignore them. A board_id stamp
      // means the command is the DATA MAP's (its toast/refresh actions ride
      // the same channel) — never this viewer's (review 2026-07-20).
      if (typeof (cmd as { board_id?: unknown }).board_id === "string") return;
      if (typeof cmd.document_id === "string" && cmd.document_id !== documentId) return;
      const a = cmd.action;
      if (a === "goto_page" && typeof cmd.page === "number") {
        go(cmd.page);
      } else if (a === "mark" || a === "region") {
        const b = {
          page: Number(cmd.page), x: Number(cmd.x), y: Number(cmd.y),
          label: typeof cmd.label === "string" ? cmd.label : undefined,
        };
        if (a === "mark") {
          setArcMarks((prev) => [...prev.slice(-11), { n: (prev[prev.length - 1]?.n ?? 0) + 1, ...b }]);
        } else {
          setArcRegions((prev) => [...prev.slice(-5),
            { n: (prev[prev.length - 1]?.n ?? 0) + 1, ...b, w: Number(cmd.w), h: Number(cmd.h) }]);
        }
      } else if (a === "clear_marks") {
        setArcMarks([]);
        setArcRegions([]);
      } else if (a === "toast" && typeof cmd.text === "string") {
        showToast(cmd.text);
      }
    },
    showToast,
  }));

  // Derived: only THIS page's text blocks (textData is page-stamped).
  const textBlocks = textData.page === page ? textData.blocks : [];

  return (
    <>
      <SchemaMarkRail
        tool={tool}
        onToolChange={setTool}
        markCount={marks.length + regions.length}
        onClear={() => { setMarks([]); setRegions([]); }}
        captureEnabled={!!onCapture}
      />

      {/* pages — the evidence */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {toast && (
          <div
            className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold"
            style={{ borderColor: "rgba(245,158,11,.45)", background: "rgba(24,16,4,.88)", color: "#fbbf24" }}
          >
            {toast}
          </div>
        )}
        <div className="flex shrink-0 items-center justify-center gap-2 py-1.5">
          <button type="button" disabled={page <= 1} onClick={() => go(page - 1)}
            className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-bold"
            style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: page <= 1 ? 0.4 : 1 }}>
            ←
          </button>
          <input
            value={page}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) go(n); }}
            className="w-[48px] rounded px-1 py-0.5 text-center text-[11px] outline-none"
            style={INPUT_STYLE}
          />
          <span className="text-[11px] tabular-nums" style={{ color: PT.textGhost }}>/ {pageCount ?? "…"}</span>
          <button type="button" disabled={pageCount !== null && page >= pageCount} onClick={() => go(page + 1)}
            className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-bold"
            style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: pageCount !== null && page >= pageCount ? 0.4 : 1 }}>
            →
          </button>
          <span className="ml-3 inline-flex items-center gap-1" title="Zoom — or Ctrl/Cmd + scroll on the page">
            <button type="button" disabled={zoom <= 1} onClick={() => zoomStep(-1)}
              className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-bold"
              style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: zoom <= 1 ? 0.4 : 1 }}>
              −
            </button>
            <span className="w-[44px] text-center text-[10.5px] tabular-nums" style={{ color: PT.textGhost }}>
              {Math.round(zoom * 100)}%
            </span>
            <button type="button" disabled={zoom >= 5} onClick={() => zoomStep(1)}
              className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-bold"
              style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textDim, background: "transparent", opacity: zoom >= 5 ? 0.4 : 1 }}>
              +
            </button>
            {zoom > 1 && (
              <button type="button" onClick={() => setZoom(1)}
                className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ border: `1px solid ${PT.lineStrong}`, color: PT.textGhost, background: "transparent" }}>
                fit
              </button>
            )}
          </span>
        </div>
        <div
          ref={pageScrollRef}
          onWheel={(e) => { if (e.ctrlKey || e.metaKey) return; onPageWheel(e); }}
          className="min-h-0 flex-1 overflow-auto px-3 pb-3"
        >
          {/* containerType must be inline-size, never size: size containment
              computes the box as if empty (height 0), which collapsed every
              percentage-top overlay to the top edge. inline-size contains
              width only; height keeps deriving from the img, so %-tops are
              real. */}
          {docBase && pageCount !== 0 && (
            <div
              className="relative mx-auto"
              style={{
                width: `${zoom * 100}%`,
                maxWidth: `${Math.round(1100 * zoom)}px`,
                cursor: tool !== "none" ? "crosshair" : "default",
                containerType: "inline-size",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRefCallback}
                src={`${docBase}/pages/${page}/image`}
                alt={`page ${page}`}
                className="h-auto w-full rounded-md"
                style={{ background: "#fff" }}
                onLoad={(e) => setImgDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onClick={placeMark}
                onMouseDown={regionDown}
                onMouseMove={regionMove}
                onMouseUp={regionUp}
                draggable={false}
              />
              {imgDims && textBlocks.length > 0 && (
                <div
                  ref={textLayerRef}
                  className="pdf-text-layer absolute inset-0"
                  style={{ pointerEvents: tool === "none" ? "auto" : "none", userSelect: "text" }}
                >
                  {textBlocks.map((b, i) => (
                    <span
                      key={i}
                      className="absolute overflow-hidden whitespace-pre"
                      style={{
                        left: `${(b.x / imgDims.w) * 100}%`,
                        top: `${(b.y / imgDims.h) * 100}%`,
                        width: `${(b.w / imgDims.w) * 100}%`,
                        height: `${(b.h / imgDims.h) * 100}%`,
                        fontSize: `${(b.h / imgDims.w) * 78}cqw`,
                        lineHeight: 1.05,
                        color: "transparent",
                        cursor: "text",
                      }}
                    >
                      {b.text}
                    </span>
                  ))}
                </div>
              )}
              {/* Marks render EXACTLY as on the Smart Canvas — same SVG
                  page-space approach, same shapes/colors/sizes. */}
              {imgDims && (
                <svg
                  className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                  viewBox={`0 0 ${imgDims.w} ${imgDims.h}`}
                >
                  {dragBox && (
                    <rect
                      x={Math.min(dragBox.x0, dragBox.x1)}
                      y={Math.min(dragBox.y0, dragBox.y1)}
                      width={Math.abs(dragBox.x1 - dragBox.x0)}
                      height={Math.abs(dragBox.y1 - dragBox.y0)}
                      rx={5}
                      fill="rgba(217,119,6,.05)"
                      stroke="#d97706"
                      strokeWidth={2}
                      strokeDasharray="6 5"
                      opacity={0.85}
                    />
                  )}
                  {regions
                    .filter((r) => r.page === page)
                    .map((r) => (
                      <g key={`box-${r.n}`}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5}
                          fill="rgba(217,119,6,.05)" stroke="#d97706" strokeWidth={2} strokeDasharray="6 5" />
                        <circle cx={r.x + r.w} cy={r.y} r={12} fill="#d97706" />
                        <text x={r.x + r.w} y={r.y} fontSize={13} fontWeight={700} fontFamily="ui-monospace, monospace"
                          fill="#1c1917" textAnchor="middle" dominantBaseline="central">{r.n}</text>
                      </g>
                    ))}
                  {marks
                    .filter((m) => m.page === page)
                    .map((m) => (
                      <g key={`ask-${m.n}`}>
                        <circle cx={m.x} cy={m.y} r={22} fill="none" stroke="#22d3ee" strokeWidth={4} opacity={0.9}>
                          <animate attributeName="r" values="18;28;18" dur="1.6s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={m.x + 24} cy={m.y - 24} r={14} fill="#22d3ee" />
                        <text x={m.x + 24} y={m.y - 24} fontSize={18} fontWeight={700} fontFamily="ui-monospace, monospace"
                          fill="#0f172a" textAnchor="middle" dominantBaseline="central">{m.n}</text>
                      </g>
                    ))}
                  {/* Arc's counterpart marks — amber, solid stroke vs Shane's
                      dashed boxes. */}
                  {arcRegions
                    .filter((r) => r.page === page)
                    .map((r) => (
                      <g key={`arc-box-${r.n}`}>
                        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5}
                          fill="rgba(245,158,11,.06)" stroke="#f59e0b" strokeWidth={2.5} />
                        <circle cx={r.x + r.w} cy={r.y} r={12} fill="#f59e0b" />
                        <text x={r.x + r.w} y={r.y} fontSize={13} fontWeight={700} fontFamily="ui-monospace, monospace"
                          fill="#1c1917" textAnchor="middle" dominantBaseline="central">{r.label ?? r.n}</text>
                      </g>
                    ))}
                  {arcMarks
                    .filter((m) => m.page === page)
                    .map((m) => (
                      <g key={`arc-ask-${m.n}`}>
                        <circle cx={m.x} cy={m.y} r={22} fill="none" stroke="#f59e0b" strokeWidth={4} opacity={0.9}>
                          <animate attributeName="r" values="18;28;18" dur="1.6s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={m.x + 24} cy={m.y - 24} r={14} fill="#f59e0b" />
                        <text x={m.x + 24} y={m.y - 24} fontSize={18} fontWeight={700} fontFamily="ui-monospace, monospace"
                          fill="#1c1917" textAnchor="middle" dominantBaseline="central">{m.label ?? m.n}</text>
                      </g>
                    ))}
                  {/* The captured selection — what Arc sees as shane_selection. */}
                  {selection && selection.page === page && (
                    <rect x={selection.x} y={selection.y} width={selection.w} height={selection.h}
                      fill="rgba(34,211,238,.16)" stroke="#22d3ee" strokeWidth={1} rx={2} />
                  )}
                </svg>
              )}
            </div>
          )}
          {pageCount === 0 && (
            <div className="pt-8 text-center text-[12px]" style={{ color: PT.textMute }}>
              no renders for this document
            </div>
          )}
        </div>
      </div>
    </>
  );
});
