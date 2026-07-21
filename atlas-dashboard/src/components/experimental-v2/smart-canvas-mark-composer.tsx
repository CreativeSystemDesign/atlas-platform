"use client";

// Mark composer (Shane, 2026-07-08): drawing a pen/lasso mark pops this input
// so he types exactly what he needs done in the marked area. Send delivers the
// mark + instruction to the copilot as one scoped-ask turn; Cancel/Esc removes
// the un-sent mark. It is the seed of the Phase-2 thread composer — a mark
// opens a conversation, and this is where the first words go.
//
// The scoped-ask contract (enforced server-side): the copilot gathers context
// read-only, restates the plan, and WAITS for confirmation before editing —
// so a marked instruction never makes it "take off using tool after tool".

import React, { useEffect, useRef, useState } from "react";
import { CornerDownLeft, X } from "lucide-react";
import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";

export type PendingMark = {
  kind: "pen" | "lasso" | "arrow" | "box" | "text";
  n: number;
  /** Human label for the anchor/area, shown in the header. */
  subject: string;
};

const KIND_LABEL: Record<PendingMark["kind"], string> = {
  pen: "Ink mark",
  lasso: "Lassoed area",
  arrow: "Arrow mark",
  box: "Boxed area",
  text: "Text callout",
};

export function SmartCanvasMarkComposer({
  pending,
  onSend,
  onCancel,
}: {
  pending: PendingMark | null;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus on mount only (DOM sync — no setState in effect). The parent keys
  // this component by mark identity, so each new mark REMOUNTS with empty text
  // and re-runs this focus — no reset-in-effect needed.
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
      style={{ borderColor: MG.lineStrong, background: MG_PANEL_FROST }}
      role="dialog"
      aria-label={`Instruction for ${pending.kind} mark ${pending.n}`}
    >
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] font-bold"
            style={{ background: MG.cyan, color: "#0f172a" }}
          >
            {pending.n}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: MG.cyanText }}>
            {KIND_LABEL[pending.kind]}
          </span>
          <span className="truncate text-[11px]" style={{ color: MG.textMute }}>
            · {pending.subject}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel mark"
          className="rounded p-0.5 transition-colors hover:text-cyan-200"
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
          placeholder="What do you need here? (e.g. fix the terminal names in this area)"
          className="w-full resize-none rounded-lg border px-2.5 py-2 text-[12px] leading-snug outline-none transition-colors"
          style={{ borderColor: MG.line, background: MG.well, color: MG.text }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px]" style={{ color: MG.textFaint }}>
            Enter to send · Esc to cancel
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: text.trim() ? "linear-gradient(180deg, rgba(14,148,180,.85), rgba(10,90,115,.85))" : "rgba(148,163,184,.12)",
              color: text.trim() ? "#e0fbff" : MG.textFaint,
              border: `1px solid ${text.trim() ? "rgba(34,211,238,.5)" : "transparent"}`,
            }}
          >
            Send to copilot <CornerDownLeft className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
