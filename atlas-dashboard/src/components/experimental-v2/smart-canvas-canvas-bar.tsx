"use client";

// Canvas toolbar — the canvas card owns its own controls (Shane's containment
// ruling, 2026-07-09: "mode/workspace changer mixed with pdf navigation mixed
// with annotation controls" — the workspace bar keeps workspace concerns; the
// page cluster, seal, palm guard, layer pills and zoom live HERE, on the
// artifact they describe). One purpose per pill cluster; nothing ever wraps.

import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Hand } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InfoTip } from "./smart-canvas-infotip";
import { MG } from "./smart-canvas-theme";
import { SmartCanvasSealButton } from "./smart-canvas-seal-button";
import { SmartCanvasLayerPills, type LayerKey } from "./smart-canvas-layer-pills";
import type { PageSealState } from "./use-v2-page-seal";
import { type SheetIndex, sheetTitleOf } from "./use-v2-sheet-index";

const PAGE_COUNT = 129; // reference schematic set — total sheets

/** ⌘K jump — by page number OR sheet title (the canonical sheet index is the
 *  search corpus). Designator/wire search is still FUTURE scope (needs a graph
 *  index) — we ship the honest subset: number + title. */
function JumpPalette({
  open,
  onOpenChange,
  onJump,
  currentPage,
  sheetIndex,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onJump: (page: number) => void;
  currentPage: number;
  sheetIndex: SheetIndex | null;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1).map((p) => {
      const rec = sheetIndex?.byPage.get(p);
      return { page: p, title: sheetTitleOf(rec), ja: rec?.title.ja ?? "" };
    });
    if (!term) return all;
    const asNum = parseInt(term, 10);
    return all.filter(
      (r) =>
        (!Number.isNaN(asNum) && String(r.page).includes(term)) ||
        r.title.toLowerCase().includes(term) ||
        r.ja.includes(q.trim())
    );
  }, [q, sheetIndex]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* cmdk requires a <Command> to own the store; CommandInput/List/Item
          read it via context — without this wrapper they throw on 'subscribe'. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Jump by page number or sheet title…  (designator & wire search coming soon)"
          value={q}
          onValueChange={setQ}
        />
        <CommandList>
          <CommandEmpty>No matching sheet.</CommandEmpty>
          <CommandGroup heading="Sheets">
            {results.slice(0, 80).map((r) => (
              <CommandItem
                key={r.page}
                value={`page ${r.page} ${r.title} ${r.ja}`}
                onSelect={() => {
                  onJump(r.page);
                  onOpenChange(false);
                  setQ("");
                }}
              >
                <span className="font-mono text-xs tabular-nums">{String(r.page).padStart(3, " ")}</span>
                <span className="ml-2 truncate text-xs">{r.title || <span className="text-muted-foreground">—</span>}</span>
                {r.page === currentPage && (
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">current</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function SmartCanvasCanvasBar({
  pageNum,
  sheetIndex,
  onPageChange,
  seal,
  onSeal,
  onUnseal,
  palmGuard,
  onTogglePalmGuard,
  zoom,
  fitZoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  layerValues,
  onToggleLayer,
}: {
  pageNum: number;
  sheetIndex: SheetIndex | null;
  onPageChange: (p: number) => void;
  seal?: PageSealState;
  onSeal?: () => void;
  onUnseal?: () => void;
  palmGuard: boolean;
  onTogglePalmGuard: () => void;
  zoom: number;
  fitZoom?: number | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  layerValues: Record<LayerKey, boolean>;
  onToggleLayer: (key: LayerKey, next: boolean) => void;
}) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const title = sheetTitleOf(sheetIndex?.byPage.get(pageNum)).trim();

  // ⌘K / Ctrl-K opens the jump palette from anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJumpOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="z-20 flex h-11 w-full shrink-0 items-center gap-2.5 border-b px-2.5"
      style={{ borderColor: MG.line, background: "rgba(6,11,22,.55)" }}
    >
      {/* ── Page cluster: prev / picker / next / ⌘K — document navigation ── */}
      <div className="flex items-center gap-[7px]">
        <InfoTip
          title="Previous page"
          body="Step back one sheet in the 129-page drawing set. Your marks and masks stay pinned to each page; nothing is lost when you leave."
        >
          <button
            type="button"
            disabled={pageNum <= 1}
            onClick={() => onPageChange(Math.max(1, pageNum - 1))}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: `1px solid ${MG.lineStrong}`, background: "rgba(148,163,184,.05)", color: MG.textMute }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </InfoTip>
        <InfoTip
          title="Page picker — ⌘K"
          body="Jump to any sheet by number or title. The label is read from the drawing's title block so you navigate by meaning, not just page number."
        >
          <button
            type="button"
            onClick={() => setJumpOpen(true)}
            className="flex cursor-pointer items-baseline gap-[7px] whitespace-nowrap rounded-[9px] px-3 py-[5px] transition-colors"
            style={{ border: `1px solid ${MG.lineStrong}`, background: "rgba(3,8,18,.6)", boxShadow: "0 1px 0 rgba(255,255,255,.04) inset" }}
          >
            {/* Fixed slots — number right-aligned in a widest-case ("129 / 129")
                column, title always 180px with CSS truncation. The picker keeps
                one footprint on every page so the next-page chevron never
                shifts under a longer, shorter, or missing sheet title. */}
            <span
              className="inline-block text-right font-mono text-[12.5px] font-bold"
              style={{ color: MG.text, minWidth: `${String(PAGE_COUNT).length * 2 + 3}ch` }}
            >
              {pageNum}
              <span className="font-medium" style={{ color: MG.textGhost }}> / {PAGE_COUNT}</span>
            </span>
            <span className="w-[180px] truncate text-left text-[10px] uppercase tracking-[.03em]" style={{ color: "#64748b" }}>
              {title || <span style={{ color: MG.textGhost }}>—</span>}
            </span>
            <span className="text-[8px]" style={{ color: MG.textGhost }}>▼</span>
          </button>
        </InfoTip>
        <InfoTip
          title="Next page"
          body="Advance one sheet in the 129-page drawing set. Your marks and masks stay pinned to each page; nothing is lost when you leave."
        >
          <button
            type="button"
            disabled={pageNum >= PAGE_COUNT}
            onClick={() => onPageChange(Math.min(PAGE_COUNT, pageNum + 1))}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: `1px solid ${MG.lineStrong}`, background: "rgba(148,163,184,.05)", color: MG.textMute }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </InfoTip>
        <InfoTip
          title="Command jump — ⌘K"
          body="Open the command palette to jump fast by page number. Search by component designator and wire number is coming as the graph index lands."
        >
          <button
            type="button"
            onClick={() => setJumpOpen(true)}
            className="ml-0.5 flex cursor-pointer items-center gap-1 whitespace-nowrap text-[9.5px]"
            style={{ color: MG.textGhost }}
          >
            <span className="rounded border-b-2 px-[5px] py-px font-mono" style={{ border: `1px solid ${MG.lineStrong}`, background: "rgba(148,163,184,.06)" }}>
              ⌘K
            </span>
            <span>jump</span>
          </button>
        </InfoTip>
      </div>

      {/* ── Seal: page metadata, docked beside the page number ── */}
      {seal && onSeal && onUnseal && (
        <SmartCanvasSealButton seal={seal} onSeal={onSeal} onUnseal={onUnseal} />
      )}

      <div className="flex-1" />

      {/* ── Layer pills (YOLO / Nets / Vectors) ── */}
      <SmartCanvasLayerPills values={layerValues} onToggle={onToggleLayer} />

      {/* ── Palm guard: icon-only toggle (state in the tooltip + glow) ── */}
      <InfoTip
        title={palmGuard ? "Palm guard ON — pen only" : "Palm guard OFF — finger touch allowed"}
        body="When ON, the touchscreen accepts only the pen: resting your hand or tapping with a finger does nothing, so you can lean on the glass while inking. Trackpad and mouse always keep every action, either way. Tap to toggle."
      >
        <button
          type="button"
          onClick={onTogglePalmGuard}
          aria-pressed={palmGuard}
          className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] transition-colors"
          style={{
            border: `1px solid ${palmGuard ? "rgba(34,211,238,.4)" : MG.lineStrong}`,
            background: palmGuard ? "linear-gradient(180deg, rgba(12,42,64,.7), rgba(8,30,48,.7))" : "rgba(148,163,184,.05)",
            color: palmGuard ? "#7dd8ea" : MG.textFaint,
            animation: palmGuard ? "sc-glow 3s ease-in-out infinite" : "none",
          }}
        >
          <Hand className="h-3.5 w-3.5" />
        </button>
      </InfoTip>

      {/* ── Zoom cluster ── */}
      <div
        className="flex items-center gap-0.5 rounded-[9px] p-0.5"
        style={{ border: `1px solid ${MG.lineStrong}`, background: "rgba(3,8,18,.6)", boxShadow: "0 1px 0 rgba(255,255,255,.04) inset" }}
      >
        <InfoTip title="Zoom out" body="Pull back toward the whole sheet — 100% is the page framed to your screen. Two-finger-swipe or scroll also zooms toward the cursor.">
          <button type="button" onClick={onZoomOut} className="h-[26px] w-[26px] cursor-pointer rounded-[7px] border-0 bg-transparent text-[14px] transition-colors" style={{ color: MG.textMute }}>−</button>
        </InfoTip>
        <span className="w-11 text-center font-mono text-[11px] font-semibold" style={{ color: MG.textDim }}>
          {Math.round((zoom / (fitZoom || zoom)) * 100)}%
        </span>
        <InfoTip title="Zoom in" body="Push in for pixel-level work, up to 600% — deep enough for the densest sheets. Two-finger-swipe or scroll also zooms toward the cursor.">
          <button type="button" onClick={onZoomIn} className="h-[26px] w-[26px] cursor-pointer rounded-[7px] border-0 bg-transparent text-[14px] transition-colors" style={{ color: MG.textMute }}>+</button>
        </InfoTip>
        <div className="mx-0.5 h-4 w-px" style={{ background: MG.lineStrong }} />
        <InfoTip title="Fit page" body="Reset the view to frame the whole sheet and re-center it. Quickest way to get un-lost after zooming deep into a corner.">
          <button type="button" onClick={onZoomReset} className="h-[26px] cursor-pointer rounded-[7px] border-0 bg-transparent px-2 text-[10px] transition-colors" style={{ color: MG.textMute }}>Fit</button>
        </InfoTip>
      </div>

      <JumpPalette
        open={jumpOpen}
        onOpenChange={setJumpOpen}
        onJump={onPageChange}
        currentPage={pageNum}
        sheetIndex={sheetIndex}
      />
    </div>
  );
}
