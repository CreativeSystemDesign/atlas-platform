"use client";

// Designed empty state (polish bar): what this thing is + three real example
// prompts as one-click chips. Clicking sends immediately — zero-friction demo.

import React from "react";
import { Bot, Sparkles } from "lucide-react";

const EXAMPLES = [
  "Audit this page and walk me through the flags",
  "What's on this page? Give me the component roster",
  "Box the detected components, then stop for my review",
];

/** Seat-specific copy for panels off the canvas (defaults = canvas seat). */
export interface EmptyStateCopy {
  headline: string;
  blurb: React.ReactNode;
  examples: string[];
}

export function EmptyState({ onPrompt, copy }: {
  onPrompt: (text: string) => void;
  copy?: EmptyStateCopy;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 pb-10 text-center animate-in fade-in duration-500">
      <div className="relative">
        <Bot className="h-8 w-8 text-primary/80" aria-hidden />
        <Sparkles className="absolute -right-2 -top-1 h-3.5 w-3.5 text-amber-400/90" aria-hidden />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-foreground">
          {copy?.headline ?? "Arc is on this canvas"}
        </p>
        <p className="mt-0.5 max-w-[260px] text-[11px] leading-relaxed text-muted-foreground">
          {copy?.blurb ?? (
            <>
              It sees the page, the detector evidence, and your marks. Point with the
              Ask tool <kbd className="rounded bg-muted/70 px-1 text-[9px]">A</kbd>, paste an
              image, or start with one of these:
            </>
          )}
        </p>
      </div>
      <div className="flex w-full max-w-[280px] flex-col gap-1.5">
        {(copy?.examples ?? EXAMPLES).map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPrompt(ex)}
            className="rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
