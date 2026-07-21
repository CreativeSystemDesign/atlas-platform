"use client";

// Bless composer (Shane, 2026-07-08): tapping the Bless tool on excellent work
// pops this in-app input for the WHY — replacing the native window.prompt(),
// which isn't supported in the editor's internal browser and read as generic.
// Amber = the work/praise accent (Midnight Gallery). Isolated from the pen/lasso
// mark composer on purpose: blessing must never risk the mark flow. Send mints
// the playbook card server-side; Cancel/Esc discards with nothing saved.

import React, { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Sparkles, X } from "lucide-react";
import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";

export type PendingBless = {
  /** Human label for the blessed element/area, shown in the header. */
  subject: string;
};

export function SmartCanvasBlessComposer({
  pending,
  onSend,
  onCancel,
}: {
  pending: PendingBless | null;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus on mount only (DOM sync — no setState in effect). The parent keys this
  // component by bless identity so each tap REMOUNTS with empty text.
  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  if (!pending) return null;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
  };

  return (
    <div
      className="absolute left-1/2 top-4 z-40 w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border shadow-2xl backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in slide-in-from-top-2 duration-200"
      style={{ borderColor: MG.amberDeep, background: MG_PANEL_FROST }}
      role="dialog"
      aria-label={`Bless ${pending.subject}`}
    >
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: MG.amber, color: "#0f172a" }}
          >
            <Sparkles className="h-3 w-3" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: MG.amberText }}>
            Bless
          </span>
          <span className="truncate text-[11px]" style={{ color: MG.textMute }}>
            · {pending.subject}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel bless"
          className="rounded p-0.5 transition-colors hover:text-amber-200"
          style={{ color: MG.textFaint }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-3 pb-3">
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }}
          rows={2}
          placeholder="What makes this excellent? (your words become the play)"
          className="w-full resize-none rounded-lg border px-2.5 py-2 text-[12px] leading-snug outline-none transition-colors"
          style={{ borderColor: MG.line, background: MG.well, color: MG.text }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: MG.textFaint }}>
            Enter to bless · Esc to cancel
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: text.trim() ? "linear-gradient(180deg, rgba(217,119,6,.9), rgba(180,83,9,.9))" : "rgba(148,163,184,.12)",
              color: text.trim() ? "#fff7ed" : MG.textFaint,
              border: `1px solid ${text.trim() ? "rgba(245,158,11,.55)" : "transparent"}`,
            }}
          >
            Bless it <CornerDownLeft className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
