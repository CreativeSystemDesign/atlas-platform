"use client";

// Feed item → row dispatcher. Small on purpose: each nontrivial row type has
// its own component (tool-card, task rows); the trivial ones live here.
// Polish bar: rows animate in, assistant prose is copyable, every row carries
// a time affordance (hover), machine bubbles read visually distinct.

import React from "react";
import { AlertTriangle, Scissors } from "lucide-react";
import { CopyButton } from "./copy-button";
import { Markdown } from "./markdown";
import { ToolCard } from "./tool-card";
import type { FeedItem } from "./copilot-types";

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}

function atTime(ts?: number): string | undefined {
  return ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : undefined;
}

const ENTER = "animate-in fade-in slide-in-from-bottom-1 duration-300";

const SOURCE_LABEL: Record<string, string> = {
  handoff: "handoff note",
  gate: "done-gate",
  auto: "auto-continue",
  queue: "queued",
  "mid-turn": "mid-turn",
};

export function MessageRow({
  m,
  working,
  onImage,
}: {
  m: FeedItem;
  working: boolean;
  onImage?: (b64: string, label: string) => void;
}) {
  switch (m.kind) {
    case "user": {
      const label = m.source ? SOURCE_LABEL[m.source] : undefined;
      const machine = m.source && m.source !== "panel";
      return (
        <div
          title={atTime(m.ts)}
          className={`${ENTER} ml-6 rounded-2xl rounded-br-md px-3 py-2 text-[12px] leading-relaxed shadow-sm ${machine ? "border border-border/40 bg-muted/20 text-muted-foreground" : "bg-primary/15 ring-1 ring-primary/20"}`}
        >
          {label && <span className="mr-1.5 rounded bg-muted/60 px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>}
          <span className="whitespace-pre-wrap">{machine && m.text.length > 400 ? m.text.slice(0, 400) + "…" : m.text}</span>
          {m.images ? <span className="ml-1.5 rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">{m.images} img</span> : null}
        </div>
      );
    }
    case "assistant_text":
      return (
        <div
          title={atTime(m.ts)}
          className={`${ENTER} group relative mr-2 rounded-2xl rounded-bl-md bg-muted/40 px-3 py-2 shadow-sm ${m.parent ? "ml-4 border-l-2 border-violet-500/50" : ""}`}
        >
          {m.parent && (
            <div className="mb-0.5 text-[9px] uppercase tracking-wide text-violet-300/80">
              subagent{m.model ? ` · ${m.model.replace(/^claude-/, "")}` : ""}
            </div>
          )}
          <Markdown text={m.text} />
          <CopyButton
            text={m.text}
            className="absolute -right-1 -top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 bg-background/80 shadow-sm"
          />
        </div>
      );
    case "thinking":
      return (
        <details className={`${ENTER} rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1 ${m.parent ? "ml-4" : ""}`}>
          <summary className="cursor-pointer text-[10px] italic text-muted-foreground transition-colors hover:text-foreground/80">thought…</summary>
          <p className="whitespace-pre-wrap pt-1 text-[10px] italic leading-relaxed text-muted-foreground">{m.text}</p>
        </details>
      );
    case "tool":
      return <ToolCard item={m} working={working} />;
    case "tool_image":
      if (!m.b64) {
        return <div className="px-1 text-[9px] italic text-muted-foreground/60">[older image not replayed] {m.label}</div>;
      }
      return (
        <button
          type="button"
          className={`${ENTER} group block w-fit max-w-[85%] cursor-zoom-in rounded-lg border border-border/60 bg-muted/20 p-1 text-left transition-colors hover:border-primary/50`}
          onClick={() => onImage?.(m.b64 as string, m.label)}
          title={`Tap to inspect full size — this is exactly what the copilot saw${m.ts ? ` · ${atTime(m.ts)}` : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${m.b64}`} alt={m.label} className="max-h-36 w-auto rounded border border-border/30 transition-transform group-hover:scale-[1.01]" />
          <div className="px-0.5 pt-0.5 text-[9px] font-mono text-muted-foreground/80">👁 {m.tool}: {m.label}</div>
        </button>
      );
    case "task_note":
      return (
        <div className={`${ENTER} flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground`} title={atTime(m.ts)}>
          <span className={`rounded px-1.5 py-0.5 font-mono ${m.status && ["failed", "killed"].includes(m.status) ? "bg-red-500/15 text-red-300" : "bg-violet-500/15 text-violet-300"}`}>
            task {m.status ?? "started"}
          </span>
          <span className="truncate">{m.summary || m.description}</span>
        </div>
      );
    case "system_event":
      return (
        <div className="flex items-center gap-1.5 px-1 text-[9px] text-muted-foreground/70" title={atTime(m.ts)}>
          <Scissors className="h-2.5 w-2.5" />
          <span className="font-mono">{m.subtype}</span>
          {m.subtype.includes("compact") && <span className="italic">— conversation compacted</span>}
        </div>
      );
    case "result": {
      const u = m.usage ?? {};
      return (
        <div className="px-1 text-right text-[9px] text-muted-foreground/70" title={atTime(m.ts)}>
          {m.ok ? "done" : <span className="text-red-400">{m.subtype}{m.apiErrorStatus ? ` (HTTP ${m.apiErrorStatus})` : ""}</span>}
          {m.stopReason && m.stopReason !== "end_turn" ? ` · ${m.stopReason}` : ""}
          {u.output_tokens ? ` · ${fmtTokens(u.output_tokens)} out` : ""}
          {u.duration_ms ? ` · ${(u.duration_ms / 1000).toFixed(1)}s` : ""}
          {m.costUsd !== null ? ` · $${m.costUsd.toFixed(2)} total` : ""}
          {m.errors?.length ? (
            <div className={`${ENTER} mt-0.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-left text-[10px] text-red-300`}>
              {m.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          ) : null}
        </div>
      );
    }
    case "error":
      return (
        <div className={`${ENTER} flex items-start gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300`} title={atTime(m.ts)}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{m.code ? <span className="mr-1 rounded bg-red-500/20 px-1 font-mono text-[9px]">{m.code}</span> : null}{m.message}</span>
        </div>
      );
  }
}
