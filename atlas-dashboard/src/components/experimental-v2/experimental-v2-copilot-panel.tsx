"use client";

// Copilot chat panel — full-SDK shell (2026-07-07). Composition over copilot/
// (strict modularity): feed reducer + WS hook, markdown transcript with paired
// tool results and subagent nesting, rich approvals, live permission modes,
// task/queue/context/rate-limit telemetry, image-capable composer.
// Polish bar (market-bound): stick-to-bottom scrolling with a jump pill,
// animated rows, designed empty state, resizable rail with a visible grip.

import React, { useCallback, useEffect, useState } from "react";
import { ArrowDown, Bot, CircleHelp, CircleStop, GripVertical, Settings2, X } from "lucide-react";
import { useStickToBottom } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activeTasks } from "./copilot/copilot-feed";
import { MODELS, SettingsDrawer } from "./copilot/settings-drawer";
import { ApprovalCard } from "./copilot/approval-card";
import { Composer, type ComposerInjection } from "./copilot/composer";
import { EmptyState, type EmptyStateCopy } from "./copilot/empty-state";
import { IssuesDrawer } from "./copilot/issues-drawer";
import { MessageRow } from "./copilot/message-row";
import { MG_PANEL_FROST } from "./smart-canvas-theme";
import { ContextMeter, QueueStrip, RateLimitBanner, TaskStrip } from "./copilot/telemetry";
import { useCopilotWs, type CopilotSeat } from "./copilot/use-copilot-ws";

const WIDTH_KEY = "atlas.copilotPanel.width";
const MIN_W = 320;
const MAX_W = 760;

function modelShort(model: string | null | undefined): string {
  if (!model) return "default";
  return MODELS.find((m) => m.value === model)?.label ?? model.replace(/^claude-/, "");
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}

export function ExperimentalV2CopilotPanel({
  open,
  onClose,
  currentPage,
  onFocusElement,
  onIssuesBadge,
  issuesOpenSignal,
  seat,
  title,
  composerPlaceholder,
  emptyStateCopy,
  kickoff,
  injectedAttachment,
}: {
  open: boolean;
  onClose: () => void;
  currentPage?: number;
  onFocusElement?: (elementId: string, page?: number | null) => void;
  /** Reports the awaiting-shane count so the viewport edge tab stays live. */
  onIssuesBadge?: (openCount: number) => void;
  /** Increment to force the Table open (the viewport edge tab's click). */
  issuesOpenSignal?: number;
  /** Which bench this panel speaks from (omit = canvas). Same Arc either way. */
  seat?: CopilotSeat;
  title?: string;
  composerPlaceholder?: string;
  /** Seat-specific empty-state copy (omit = canvas seat's default). */
  emptyStateCopy?: EmptyStateCopy;
  /** Auto-sent once when the socket is ready — the seat's opening message. */
  kickoff?: string;
  /** A crop pushed in from the viewer's capture tool (seq-bumped). */
  injectedAttachment?: ComposerInjection;
}) {
  const { feed, sendMessage, answerApproval, answerIssue, patchSettings, setPermissionMode,
          interrupt, newSession, stopTask, removeQueued } = useCopilotWs(open, currentPage, seat);
  // Seat kickoff: announce the bench once per (session, kickoff text) — a
  // reload mid-conversation stays quiet, but a NEW session or a document
  // switch announces again (audit 2026-07-13: the old global key fired once
  // per document EVER, leaving later sessions ungrounded).
  const kickedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!kickoff || feed.state !== "ready") return;
    const key = "atlas.seatKickoff." + (feed.sessionId ?? "presession") + "." + kickoff;
    const preKey = "atlas.seatKickoff.presession." + kickoff;
    if (kickedRef.current === key) return;
    try {
      if (window.localStorage.getItem(key)) { kickedRef.current = key; return; }
      // A kickoff that fired before the session id arrived is the SAME
      // conversation materializing — bridge it to the real key instead of
      // re-announcing (the parts-list double-fire). Consume the presession
      // marker so a REAL new-session later still re-announces.
      if (feed.sessionId && window.localStorage.getItem(preKey)) {
        window.localStorage.setItem(key, "1");
        window.localStorage.removeItem(preKey);
        kickedRef.current = key;
        return;
      }
      window.localStorage.setItem(key, "1");
    } catch { /* still send */ }
    kickedRef.current = key;
    sendMessage(kickoff, []);
  }, [kickoff, feed.state, feed.sessionId, sendMessage]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Issues drawer: null = auto (open while issues exist); explicit user
  // toggles override until the list empties again.
  const [issuesPref, setIssuesPref] = useState<boolean | null>(null);
  // Viewport edge tab wiring (v4 port): badge count up, open-signal down.
  const awaitingCount = feed.issues.filter((i) => i.state === "awaiting-shane").length;
  useEffect(() => { onIssuesBadge?.(awaitingCount); }, [awaitingCount, onIssuesBadge]);
  // Open-signal consumes via the derived-state-during-render pattern (the
  // React Compiler-sanctioned replacement for setState-in-effect).
  const [seenSignal, setSeenSignal] = useState(issuesOpenSignal ?? 0);
  if (issuesOpenSignal !== undefined && issuesOpenSignal !== seenSignal) {
    setSeenSignal(issuesOpenSignal);
    setIssuesPref(true);
  }
  const [lightbox, setLightbox] = useState<{ b64: string; label: string } | null>(null);
  // Start at the deterministic default so the server render and the first
  // client render agree; the saved width is restored post-mount. A lazy
  // initializer reading localStorage here is an SSR *hydration mismatch*,
  // not just a crash risk (same bug as the schema bench's stripHeight).
  const [width, setWidth] = useState(380);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    if (saved >= MIN_W && saved <= MAX_W) setWidth(saved);
  }, []);
  const dragRef = React.useRef<{ startX: number; startW: number } | null>(null);
  // Scroll that respects the reader: follows new content only while at the
  // bottom; scrolling up pauses it and a jump pill appears.
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "smooth",
  });

  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
  }, [width]);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(Math.min(MAX_W, Math.max(MIN_W, d.startW + (d.startX - e.clientX))));
  }, []);
  const onDragEnd = useCallback(() => {
    if (dragRef.current) window.localStorage.setItem(WIDTH_KEY, String(width));
    dragRef.current = null;
  }, [width]);

  if (!open) return null;

  const working = feed.state === "working";
  const u = feed.lastUsage;
  const ctxTokens = feed.context?.total ??
    ((u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0));
  const mode = feed.settings.permission_mode ?? "acceptEdits";
  const empty = feed.items.length === 0 && !feed.streamText && feed.approvals.length === 0;
  const openIssues = feed.issues.filter((i) => i.state === "awaiting-shane").length;
  const issuesOpen = issuesPref ?? feed.issues.length > 0;

  return (
    <div
      className="relative z-30 flex h-full shrink-0 flex-col border-l border-border/70 backdrop-blur-2xl backdrop-saturate-150"
      style={{ width, background: MG_PANEL_FROST }}
      suppressHydrationWarning
    >
      {/* The Table: slides out from the panel's left edge — only the issues
          the copilot genuinely couldn't resolve itself. */}
      <IssuesDrawer
        open={issuesOpen}
        onClose={() => setIssuesPref(false)}
        issues={feed.issues}
        currentPage={currentPage}
        onAnswer={(rule, eid, answer, note) => void answerIssue(rule, eid, answer, note)}
        onFocusElement={onFocusElement}
      />
      {!issuesOpen && feed.issues.length > 0 && (
        <button
          type="button"
          onClick={() => setIssuesPref(true)}
          aria-label={`Open the Table (${openIssues} awaiting your verdict)`}
          className="absolute -left-7 top-14 z-20 flex flex-col items-center gap-1 rounded-l-lg border border-r-0 border-amber-500/50 bg-card/95 px-1 py-2 shadow-lg backdrop-blur transition-colors hover:bg-amber-500/10 animate-in slide-in-from-right-2 fade-in duration-300"
          title={`The Table: ${openIssues} issue(s) awaiting your verdict`}
        >
          <CircleHelp className={cn("h-4 w-4 text-amber-400", openIssues > 0 && "animate-pulse")} />
          {openIssues > 0 && (
            <span className="rounded-full bg-amber-500/25 px-1 font-mono text-[9px] font-bold text-amber-300">{openIssues}</span>
          )}
        </button>
      )}
      {/* Resize handle with a visible grip on hover */}
      <div
        className="group absolute -left-1 top-0 z-40 flex h-full w-2 cursor-col-resize items-center justify-center hover:bg-primary/20 active:bg-primary/30 transition-colors"
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        role="separator" aria-orientation="vertical" aria-label="Resize Arc panel" title="Drag to resize"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
      </div>

      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wider">{title ?? "Arc · Smart Canvas"}</span>
          <span className={cn("h-2 w-2 shrink-0 rounded-full transition-colors",
            feed.state === "ready" && "bg-emerald-400",
            feed.state === "working" && "animate-pulse bg-amber-400",
            feed.state === "connecting" && "animate-pulse bg-sky-400",
            feed.state === "disconnected" && "bg-red-400")}
            role="status" aria-label={`Arc ${feed.state}`}
            title={feed.statusNote ?? feed.state} />
          {mode !== "acceptEdits" && (
            <span className={cn("rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide",
              mode === "plan" ? "bg-sky-500/20 text-sky-300" : mode === "bypassPermissions" ? "bg-red-500/20 text-red-300" : "bg-muted/60 text-muted-foreground")}>
              {mode === "bypassPermissions" ? "bypass" : mode}
            </span>
          )}
          {feed.settings.autonomous ? (
            <span className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-300/90"
              title="Autonomous mode: Arc keeps working turn after turn until done">
              auto
            </span>
          ) : (
            <span className="rounded bg-cyan-500/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-cyan-300"
              title="Collaborative mode: turn-by-turn — does this turn's work, then waits for you">
              collab
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {feed.totalCost !== null && (
            <span className="rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground" title="Session cost">
              ${feed.totalCost.toFixed(2)}
            </span>
          )}
          {working && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={interrupt} title="Stop" aria-label="Stop Arc">
              <CircleStop className="h-3.5 w-3.5 text-red-400" />
            </Button>
          )}
          <Button variant={settingsOpen ? "secondary" : "ghost"} size="icon" className="h-6 w-6"
            onClick={() => setSettingsOpen((o) => !o)} title="Arc settings" aria-label="Arc settings">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close panel" aria-label="Close Arc's panel">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {settingsOpen && (
        <SettingsDrawer settings={feed.settings} state={feed.state} sessionId={feed.sessionId}
          onPatch={patchSettings} onPermissionMode={setPermissionMode} onNewSession={newSession} />
      )}

      {/* Transcript */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-2">
          {empty ? (
            <EmptyState onPrompt={(text) => sendMessage(text, [])} copy={emptyStateCopy} />
          ) : (
            <div ref={contentRef} className="space-y-2">
              {feed.items.map((m, i) => (
                <MessageRow key={i} m={m} working={working} onImage={(b64, label) => setLightbox({ b64, label })} />
              ))}
              {feed.settings.show_thinking && feed.thinkStream && (
                <div className="rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[10px] italic leading-relaxed text-muted-foreground">
                  {feed.thinkStream}
                </div>
              )}
              {feed.streamText && (
                <div className="mr-2 whitespace-pre-wrap rounded-2xl rounded-bl-md bg-muted/40 px-3 py-2 text-[12px] leading-relaxed shadow-sm">
                  {feed.streamText}
                  <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-primary/70 align-baseline" />
                </div>
              )}
              {feed.approvals.map((a) => (
                <div key={a.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <ApprovalCard approval={a} onAnswer={answerApproval} />
                </div>
              ))}
              {working && !feed.streamText && (
                <p className="animate-pulse text-[10px] italic text-muted-foreground">
                  {feed.statusNote || "working…"}
                </p>
              )}
            </div>
          )}
        </div>
        {!isAtBottom && !empty && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            aria-label="Jump to latest"
            className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/60 bg-background/95 px-2.5 py-1 text-[10px] text-muted-foreground shadow-lg transition-colors hover:border-primary/50 hover:text-foreground animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <ArrowDown className="h-3 w-3" /> latest
          </button>
        )}
      </div>

      {/* Telemetry: rate limit, background tasks, queue, context meter */}
      <div className="shrink-0">
        <RateLimitBanner info={feed.rateLimit} />
        <TaskStrip tasks={activeTasks(feed)} onStop={stopTask} />
        <QueueStrip queue={feed.queue} onRemove={removeQueued} />
        <ContextMeter context={feed.context} />
      </div>

      {/* Composer + status strip */}
      <div className="shrink-0 border-t border-border/60 p-2">
        <Composer
          disabled={feed.state === "disconnected"}
          placeholder={feed.state === "disconnected" ? "reconnecting…"
            : working ? "queued — injects at the next boundary…"
            : composerPlaceholder ?? "Ask Arc about the canvas, paste an image, or /command…"}
          slashCommands={feed.initInfo?.slash_commands ?? []}
          onSend={sendMessage}
          injected={injectedAttachment}
        />
        <div className="mt-1.5 flex items-center justify-between px-0.5 font-mono text-[9px] text-muted-foreground/70">
          <span>
            {modelShort(feed.settings.model ?? feed.initInfo?.model)} · {feed.settings.effort ?? "auto"}
            {feed.settings.fast_mode ? " · fast" : ""}
            {feed.settings.thinking === "off" ? " · think:off" : ""}
            {feed.settings.autonomous ? " · AUTO" : ""}
          </span>
          <span title="Context in the window (server-measured when available)">
            {ctxTokens > 0 ? `ctx ${fmtTokens(ctxTokens)}` : "ctx —"}
            {u?.duration_ms ? ` · ${(u.duration_ms / 1000).toFixed(1)}s` : ""}
          </span>
        </div>
      </div>

      {/* Copilot-vision inspector: full-size view of an image a tool fed the model */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-2 bg-black/85 p-4 animate-in fade-in duration-150" onClick={() => setLightbox(null)}>
          <div className="max-h-[90vh] max-w-[95vw] overflow-auto rounded-lg" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/png;base64,${lightbox.b64}`} alt={lightbox.label} className="h-auto w-auto max-w-none" />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-white/80">
            <span className="font-mono">{lightbox.label}</span>
            <span className="rounded bg-white/10 px-2 py-0.5">tap outside to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
