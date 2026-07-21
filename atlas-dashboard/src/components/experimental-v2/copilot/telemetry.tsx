"use client";

// Panel telemetry strip: real context meter (per-category, from the SDK's
// /context reading), rate-limit banner, active background tasks, queued
// messages. All were invisible before 2026-07-07.

import React from "react";
import { AlertOctagon, Clock, Square, X } from "lucide-react";
import type { ContextInfo, QueueItem, RateLimitInfo, TaskInfo } from "./copilot-types";

function fmtTokens(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
}

export function ContextMeter({ context }: { context: ContextInfo | null }) {
  if (!context || !context.max) return null;
  const pct = Math.min(100, context.pct || (100 * context.total) / context.max);
  const cats = (context.categories ?? []).filter((c) => c.tokens > 0);
  return (
    <div className="px-3 pb-1" title={cats.map((c) => `${c.name}: ${fmtTokens(c.tokens)}`).join("\n") || "context usage"}>
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted/40">
        {cats.length > 0 ? (
          cats.map((c, i) => (
            <div key={i} style={{ width: `${(100 * c.tokens) / context.max}%`, backgroundColor: c.color || "#64748b" }} />
          ))
        ) : (
          <div className={`${pct > 76 ? "bg-red-400" : pct > 60 ? "bg-amber-400" : "bg-primary/70"}`} style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className={`mt-0.5 text-right font-mono text-[9px] ${pct > 76 ? "text-red-400" : "text-muted-foreground/70"}`}>
        ctx {fmtTokens(context.total)}/{fmtTokens(context.max)} ({pct.toFixed(0)}%)
      </div>
    </div>
  );
}

export function RateLimitBanner({ info }: { info: RateLimitInfo | null }) {
  if (!info) return null;
  const rejected = info.status === "rejected";
  const resets = info.resets_at ? new Date(info.resets_at * 1000).toLocaleTimeString() : null;
  return (
    <div className={`mx-3 mb-1 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${rejected ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-amber-500/50 bg-amber-500/10 text-amber-300"}`}>
      <AlertOctagon className="h-3 w-3 shrink-0" />
      <span>
        {rejected ? "Rate limit HIT" : "Approaching rate limit"}
        {info.rate_limit_type ? ` (${info.rate_limit_type.replace(/_/g, " ")})` : ""}
        {typeof info.utilization === "number" ? ` — ${(info.utilization * 100).toFixed(0)}%` : ""}
        {resets ? ` · resets ${resets}` : ""}
      </span>
    </div>
  );
}

export function TaskStrip({ tasks, onStop }: { tasks: TaskInfo[]; onStop: (taskId: string) => void }) {
  if (tasks.length === 0) return null;
  return (
    <div className="mx-3 mb-1 space-y-1">
      {tasks.map((t) => (
        <div key={t.taskId} className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">
          <Clock className="h-3 w-3 shrink-0 animate-pulse" />
          <span className="min-w-0 flex-1 truncate" title={t.description}>
            {t.description || t.taskId}
            {t.lastTool ? <span className="ml-1 font-mono text-violet-300/70">· {t.lastTool}</span> : null}
            {t.usage?.total_tokens ? <span className="ml-1 font-mono text-violet-300/70">· {fmtTokens(t.usage.total_tokens)}tk</span> : null}
          </span>
          <button type="button" className="shrink-0 rounded p-0.5 hover:bg-violet-500/20" title="Stop this background task" onClick={() => onStop(t.taskId)}>
            <Square className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function QueueStrip({ queue, onRemove }: { queue: QueueItem[]; onRemove: (index: number) => void }) {
  if (queue.length === 0) return null;
  return (
    <div className="mx-3 mb-1 space-y-0.5">
      <div className="text-[9px] uppercase text-muted-foreground/70">{queue.length} queued — injects at the next boundary</div>
      {queue.map((q, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{q.text}</span>
          {q.images ? <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">{q.images} img</span> : null}
          <button type="button" className="shrink-0 rounded p-0.5 hover:bg-red-500/20 hover:text-red-300" title="Cancel this queued message" onClick={() => onRemove(i)}>
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
