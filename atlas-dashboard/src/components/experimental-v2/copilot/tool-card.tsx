"use client";

// One tool call as a card: family icon, name + params, then the RESULT the
// relay carries (status, preview, image count) — collapsed by default.
// Polish bar: icon per tool family, animated reveal, copyable output,
// keyboard-focusable, subagent rows visually nested.

import React, { useState } from "react";
import {
  CheckCircle2, ChevronRight, FileSearch, Globe, Layers, Loader2,
  PenTool, Terminal, Wrench, XCircle,
} from "lucide-react";
import { CopyButton } from "./copy-button";
import type { FeedItem } from "./copilot-types";

function prettyToolName(tool: string): string {
  return tool.replace(/^mcp__canvas__/, "canvas:").replace(/^mcp__/, "");
}

function familyIcon(tool: string, server?: boolean): React.ReactNode {
  const cls = "h-3 w-3 shrink-0 text-muted-foreground/80";
  if (server || /web_search|web_fetch/i.test(tool)) return <Globe className={cls} aria-hidden />;
  if (tool.startsWith("mcp__canvas__")) return <PenTool className={cls} aria-hidden />;
  if (/^(Bash|KillShell|BashOutput)/.test(tool)) return <Terminal className={cls} aria-hidden />;
  if (/^(Read|Grep|Glob|Edit|Write|NotebookEdit)/.test(tool)) return <FileSearch className={cls} aria-hidden />;
  if (/^Task/.test(tool)) return <Layers className={cls} aria-hidden />;
  return <Wrench className={cls} aria-hidden />;
}

function previewInput(input: unknown): string {
  if (input == null) return "";
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.length > 70 ? s.slice(0, 70) + "…" : s;
}

export function ToolCard({ item, working }: { item: Extract<FeedItem, { kind: "tool" }>; working: boolean }) {
  const [openDetail, setOpenDetail] = useState(false);
  const res = item.result;
  const status = res ? (res.isError ? "error" : "ok") : working ? "running" : "pending";

  return (
    <div
      className={`animate-in fade-in slide-in-from-bottom-1 rounded-lg border px-2 py-1 text-[10px] transition-colors duration-300 ${
        item.parent
          ? "ml-4 border-violet-500/30 bg-violet-500/5"
          : status === "error"
            ? "border-red-500/30 bg-red-500/5"
            : "border-border/40 bg-muted/20 hover:border-border/70"
      }`}
      title={item.ts ? new Date(item.ts).toLocaleTimeString() : undefined}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 rounded"
        onClick={() => setOpenDetail((o) => !o)}
        aria-expanded={openDetail}
        aria-label={`${prettyToolName(item.tool)} — ${status}. ${openDetail ? "Collapse" : "Expand"} details`}
        title={openDetail ? "Collapse" : "Expand params + result"}
      >
        <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ${openDetail ? "rotate-90" : ""}`} />
        {status === "ok" && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />}
        {status === "error" && <XCircle className="h-3 w-3 shrink-0 text-red-400" aria-hidden />}
        {status === "running" && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-400" aria-hidden />}
        {status === "pending" && <span className="h-3 w-3 shrink-0" aria-hidden />}
        {familyIcon(item.tool, item.server)}
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono">{prettyToolName(item.tool)}</span>
        <span className="min-w-0 truncate font-mono text-muted-foreground/70">{previewInput(item.input)}</span>
        {res?.images ? (
          <span className="ml-auto shrink-0 rounded bg-sky-500/15 px-1 text-sky-300">{res.images}img</span>
        ) : null}
      </button>
      {openDetail && (
        <div className="mt-1 space-y-1 border-t border-border/30 pt-1 animate-in fade-in duration-200">
          {item.input != null && (
            <div className="group relative">
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/50 p-1.5 font-mono text-[9px] text-muted-foreground">
                {typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 1)}
              </pre>
              <CopyButton
                text={typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2)}
                className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 bg-background/80"
              />
            </div>
          )}
          {res?.preview && (
            <div className="group relative">
              <pre className={`max-h-40 overflow-auto whitespace-pre-wrap break-all rounded p-1.5 font-mono text-[9px] ${res.isError ? "bg-red-500/10 text-red-300" : "bg-background/50 text-foreground/80"}`}>
                {res.preview}
              </pre>
              <CopyButton text={res.preview} className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 bg-background/80" />
            </div>
          )}
          {res?.previewPath && (
            <div className="font-mono text-[9px] text-muted-foreground/60" title="Full output spilled server-side">
              full output: {res.previewPath}
            </div>
          )}
          {!res && !working && <div className="text-[9px] italic text-muted-foreground/60">no result recorded</div>}
        </div>
      )}
    </div>
  );
}
