"use client";

// The Table (Shane's design 2026-07-08, refining the 2026-07-07 drawer): slides
// out from the chat panel's LEFT edge, carrying ONLY the issues the copilot
// genuinely could not resolve with its own resources (lessons, playbook, YOLO,
// vault, captures) — the collaboration surface, not an audit mirror. Each card
// = a crop of the disputed region + the copilot's yes/no question + what each
// answer will do + a note field. An answered card shows "applying…" until the
// agent resolves it, then clears. Page-scoped to the page on the canvas.

import React, { useState } from "react";
import { CheckCircle2, ChevronsRight, CircleHelp, Crosshair, Loader2, MapPin } from "lucide-react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MG_PANEL_FROST } from "../smart-canvas-theme";
import type { IssueItem } from "./copilot-types";

function cropUrl(it: IssueItem): string {
  return `${agentBaseUrl()}/experimental-v2/copilot/issue-crop?rule=${encodeURIComponent(it.rule)}&element_id=${encodeURIComponent(it.element_id)}`;
}

function IssueCard({
  issue,
  currentPage,
  onAnswer,
  onFocusElement,
}: {
  issue: IssueItem;
  currentPage?: number;
  onAnswer: (rule: string, elementId: string, answer: "yes" | "no" | "custom", note: string) => void;
  onFocusElement?: (elementId: string, page?: number | null) => void;
}) {
  const [note, setNote] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const [changing, setChanging] = useState(false);
  const answered = issue.state === "shane-answered" && !changing;
  const otherPage = issue.page != null && currentPage !== undefined && issue.page !== currentPage;

  return (
    <div className={cn(
      "overflow-hidden rounded-xl border shadow-sm transition-colors animate-in fade-in slide-in-from-left-2 duration-300",
      answered ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-card/80"
    )}>
      {/* Crop — the evidence, front and center */}
      {issue.has_crop && (
        <button
          type="button"
          className="block w-full cursor-zoom-in border-b border-border/40 bg-white/95"
          onClick={() => setZoomed((z) => !z)}
          title={zoomed ? "Shrink" : "Enlarge"}
          aria-label="Toggle crop zoom"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cropUrl(issue)}
            alt={`Region around ${issue.element_label ?? issue.element_id}`}
            className={cn("mx-auto w-full object-contain transition-all duration-200", zoomed ? "max-h-80" : "max-h-36")}
          />
        </button>
      )}

      <div className="space-y-2 p-2.5">
        {/* Click-to-locate (Shane, 2026-07-07): the header + question light the
            element up on the schematic and pan to it. Orphans (element exists
            in NO saved graph) get no locate affordance at all — a dead click
            that toasts an error reads as a bug (his report, and he was right). */}
        {issue.orphan ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/90">
                {issue.element_label ?? issue.element_id.slice(0, 14)}
              </span>
              <span className="truncate rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">{issue.rule}</span>
              <span className="ml-auto flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-0.5 text-[9px] text-red-300">
                <MapPin className="h-2.5 w-2.5" /> gone
              </span>
            </div>
            <p className="text-[12px] font-medium leading-snug text-foreground">{issue.question}</p>
          </div>
        ) : (
          <button
            type="button"
            className="group/locate block w-full space-y-2 rounded-md text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60"
            onClick={() => onFocusElement?.(issue.element_id, issue.page)}
            title={otherPage
              ? `Click to flip to page ${issue.page} and light this up`
              : "Click to light this up on the schematic"}
            aria-label={`Locate ${issue.element_label ?? issue.element_id} on the schematic`}
          >
            <div className="flex items-center gap-1.5">
              <Crosshair className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover/locate:text-amber-400" aria-hidden />
              <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/90">
                {issue.element_label ?? issue.element_id.slice(0, 14)}
              </span>
              <span className="truncate rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">{issue.rule}</span>
              {issue.page != null ? (
                <span className={cn("ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9px]",
                  otherPage ? "bg-sky-500/15 text-sky-300" : "bg-muted/40 text-muted-foreground")}
                  title={otherPage ? `On page ${issue.page} — click the card to flip there` : `On this page (${issue.page})`}>
                  <MapPin className="h-2.5 w-2.5" /> p{issue.page}
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-0.5 rounded bg-muted/40 px-1 py-0.5 text-[9px] text-muted-foreground" title="Page not resolved yet">
                  <MapPin className="h-2.5 w-2.5" /> page?
                </span>
              )}
            </div>
            <p className="text-[12px] font-medium leading-snug text-foreground">{issue.question}</p>
          </button>
        )}

        {answered ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className={cn("font-semibold uppercase", issue.answer?.answer === "custom" ? "text-sky-300" : "text-emerald-300")}>
                {issue.answer?.answer === "custom" ? "something else" : issue.answer?.answer}
              </span>
              {issue.answer?.note && <span className="truncate text-muted-foreground" title={issue.answer.note}>— {issue.answer.note}</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] italic text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-amber-400" /> copilot applying…
              </span>
              <button type="button" className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setChanging(true)}>
                change answer
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                className="h-auto min-h-7 flex-col gap-0 bg-emerald-600 py-1 text-white hover:bg-emerald-500"
                onClick={() => { onAnswer(issue.rule, issue.element_id, "yes", note); setChanging(false); setNote(""); }}
              >
                <span className="text-[12px] font-bold leading-none">Yes</span>
                {issue.yes_means && <span className="mt-0.5 whitespace-normal text-[9px] font-normal leading-tight opacity-85">{issue.yes_means}</span>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-auto min-h-7 flex-col gap-0 border-red-500/50 py-1 text-red-300 hover:bg-red-500/10"
                onClick={() => { onAnswer(issue.rule, issue.element_id, "no", note); setChanging(false); setNote(""); }}
              >
                <span className="text-[12px] font-bold leading-none">No</span>
                {issue.no_means && <span className="mt-0.5 whitespace-normal text-[9px] font-normal leading-tight opacity-85">{issue.no_means}</span>}
              </Button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional note — or write your own instruction and use Something else…"
              aria-label="Note or custom instruction for this issue"
              className="w-full resize-none rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/60"
            />
            {/* Something Else (Shane, 2026-07-09): neither offered path matches
                the instruction he needs to give — his note IS the ruling. */}
            <Button
              size="sm"
              variant="outline"
              disabled={!note.trim()}
              className="h-auto min-h-7 w-full flex-col gap-0 border-sky-500/50 py-1 text-sky-300 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-45"
              title={note.trim() ? "Answer with your own instruction — the note above becomes the ruling" : "Write your instruction in the note first — it becomes the ruling"}
              onClick={() => { onAnswer(issue.rule, issue.element_id, "custom", note); setChanging(false); setNote(""); }}
            >
              <span className="text-[12px] font-bold leading-none">Something else</span>
              <span className="mt-0.5 whitespace-normal text-[9px] font-normal leading-tight opacity-85">
                neither fits — my note is the instruction
              </span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function IssuesDrawer({
  open,
  onClose,
  issues,
  currentPage,
  onAnswer,
  onFocusElement,
}: {
  open: boolean;
  onClose: () => void;
  issues: IssueItem[];
  currentPage?: number;
  onAnswer: (rule: string, elementId: string, answer: "yes" | "no" | "custom", note: string) => void;
  onFocusElement?: (elementId: string) => void;
}) {
  if (!open) return null;
  const openCount = issues.filter((i) => i.state === "awaiting-shane").length;

  return (
    <div
      className="absolute right-full top-0 z-20 flex h-full w-[340px] flex-col border-l border-r border-border/70 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 animate-in slide-in-from-right-4 fade-in duration-300"
      style={{ background: MG_PANEL_FROST }}
      role="complementary"
      aria-label="The Table — issues awaiting your verdict"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <CircleHelp className="h-4 w-4 text-amber-400" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wider">The Table</span>
          {currentPage !== undefined && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">page {currentPage}</span>
          )}
          {openCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300" title="Awaiting your verdict">{openCount}</span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Collapse the Table" aria-label="Collapse the Table">
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {issues.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-8 text-center animate-in fade-in duration-300">
            <CheckCircle2 className="h-7 w-7 text-emerald-400/80" />
            <p className="text-[12px] font-medium text-foreground">The Table is clear</p>
            <p className="max-w-[220px] text-[10px] leading-relaxed text-muted-foreground">
              The copilot resolves the page&apos;s issues itself — lessons, bless
              cards, detector evidence, the print. Only what it genuinely
              can&apos;t settle lands here, as a yes/no card for your verdict.
            </p>
          </div>
        ) : (
          <>
            {issues.filter((i) => !i.orphan).map((it) => (
              <IssueCard key={`${it.rule}|${it.element_id}`} issue={it} currentPage={currentPage}
                onAnswer={onAnswer} onFocusElement={onFocusElement} />
            ))}
            {issues.some((i) => i.orphan) && (
              <div className="pt-1">
                {/* Orphans are NOT this page's issues — separate them hard so the
                    page header above never appears to claim them (Shane's report). */}
                <div className="mb-1.5 flex items-center gap-1.5 border-t border-border/40 pt-2">
                  <MapPin className="h-3 w-3 text-red-300/80" aria-hidden />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Unplaced — elements from wiped experiment graphs
                  </span>
                </div>
                <p className="mb-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
                  These were raised in graphs that were later wiped and rebuilt; the
                  elements no longer exist on any page, so there is nothing to locate.
                  Answer each to have the copilot clear it.
                </p>
                <div className="space-y-2">
                  {issues.filter((i) => i.orphan).map((it) => (
                    <IssueCard key={`${it.rule}|${it.element_id}`} issue={it} currentPage={currentPage}
                      onAnswer={onAnswer} onFocusElement={onFocusElement} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 px-3 py-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
        Your answer is recorded instantly and delivered to the copilot; the card
        clears when it has applied your ruling. Elements stay locked until then.
      </div>
    </div>
  );
}
