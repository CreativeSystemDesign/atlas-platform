"use client";

// Settings drawer, extracted from the monolith panel + the full-SDK addition:
// a PERMISSION MODE picker (live switch — works mid-turn, incl. "plan" for
// observe-only sessions).

import React from "react";
import { RotateCcw, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PERMISSION_MODES, type CopilotSettings, type CopilotState } from "./copilot-types";

// Model ids per the current Claude API catalog (2026-07). The server passes
// any id through, so this list is purely the picker.
export const MODELS: { value: string; label: string }[] = [
  { value: "", label: "Default (inherit)" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-opus-4-5", label: "Opus 4.5" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-sonnet-4-5", label: "Sonnet 4.5" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;

function ToggleSwitch({ on, onToggle, title }: { on: boolean; onToggle: () => void; title?: string }) {
  return (
    <button onClick={onToggle} title={title}
      className={cn("h-4 w-8 rounded-full transition-colors", on ? "bg-primary" : "bg-muted")}>
      <span className={cn("block h-3 w-3 rounded-full bg-white transition-transform", on ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function SettingsDrawer({
  settings,
  state,
  sessionId,
  onPatch,
  onPermissionMode,
  onNewSession,
}: {
  settings: CopilotSettings;
  state: CopilotState;
  sessionId: string | null;
  onPatch: (patch: Partial<CopilotSettings>) => void;
  onPermissionMode: (mode: string) => void;
  onNewSession: () => void;
}) {
  const working = state === "working";
  const [confirmingReset, setConfirmingReset] = React.useState(false);
  return (
    <div className="shrink-0 space-y-2.5 border-b border-border/60 bg-background/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground">Model</label>
        <select value={settings.model ?? ""} onChange={(e) => onPatch({ model: e.target.value || null })}
          disabled={working}
          className="w-44 rounded-md border border-border/70 bg-background/70 px-1.5 py-1 text-[11px] outline-none focus:border-primary/60">
          {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground" title="Reasoning effort">Thought</label>
        <div className="flex overflow-hidden rounded-md border border-border/70">
          {EFFORTS.map((e) => {
            const active = (settings.effort ?? "default") === e;
            return (
              <button key={e} onClick={() => onPatch({ effort: e === "default" ? null : e })} disabled={working}
                className={cn("px-1.5 py-1 text-[9px] font-semibold uppercase transition-colors",
                  active ? "bg-primary text-primary-foreground" : "bg-background/60 text-muted-foreground hover:text-foreground")}
                title={e === "default" ? "Inherit default effort" : `Effort: ${e}`}>
                {e === "default" ? "auto" : e}
              </button>
            );
          })}
        </div>
      </div>

      {/* Permission mode — live switch, works mid-turn (full-SDK, 2026-07-07) */}
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground"
          title="Trust tier for tool execution. Switches LIVE — even mid-turn. 'plan' = observe-only.">
          Permissions
        </label>
        <div className="flex overflow-hidden rounded-md border border-border/70">
          {PERMISSION_MODES.map((m) => {
            const active = (settings.permission_mode ?? "acceptEdits") === m.value;
            return (
              <button key={m.value} onClick={() => onPermissionMode(m.value)} title={m.hint}
                className={cn("px-1.5 py-1 text-[9px] font-semibold transition-colors",
                  active ? (m.value === "bypassPermissions" ? "bg-red-500 text-white" : "bg-primary text-primary-foreground")
                    : "bg-background/60 text-muted-foreground hover:text-foreground")}>
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground"
          title="Extended reasoning: auto = model default, off = disabled entirely">Reasoning</label>
        <div className="flex overflow-hidden rounded-md border border-border/70">
          {(["auto", "off"] as const).map((t) => {
            const active = (settings.thinking ?? "auto") === (t === "auto" ? "auto" : "off");
            return (
              <button key={t} onClick={() => onPatch({ thinking: t === "off" ? "off" : null })} disabled={working}
                className={cn("px-1.5 py-1 text-[9px] font-semibold uppercase transition-colors",
                  active ? "bg-primary text-primary-foreground" : "bg-background/60 text-muted-foreground hover:text-foreground")}>
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
          <BrainCircuit className="h-3 w-3" /> Show thinking
        </label>
        <ToggleSwitch on={settings.show_thinking} onToggle={() => onPatch({ show_thinking: !settings.show_thinking })}
          title="Stream Arc's reasoning summaries" />
      </div>

      {/* One mode selector (Shane, 2026-07-08): Collaborative (turn-by-turn,
          like a normal conversation) vs Autonomous (chains to completion).
          Mutually exclusive — no more redundant two-toggle combos. */}
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground"
          title="Collaborative = turn-by-turn: Arc does this turn's work, then waits for you. Autonomous = it keeps working turn after turn until done. (A drawn mark always pauses for your confirmation in either mode.)">
          Mode
        </label>
        <div className="flex overflow-hidden rounded-md border border-border/70">
          {([["collaborative", false], ["autonomous", true]] as const).map(([label, auto]) => {
            const active = Boolean(settings.autonomous) === auto;
            return (
              <button key={label} onClick={() => onPatch({ autonomous: auto })} disabled={working}
                title={auto
                  ? "Chains turn after turn until the work is done"
                  : "Turn-by-turn — does this turn's work, then waits for you"}
                className={cn("px-2 py-1 text-[9px] font-semibold uppercase tracking-wide transition-colors",
                  active
                    ? (auto ? "bg-amber-500/80 text-slate-950" : "bg-primary text-primary-foreground")
                    : "bg-background/60 text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground"
          title="~2.5x output speed at ~2x usage burn. Opus 4.8 sessions only. Flip BEFORE starting a session.">
          Fast mode <span className="font-normal normal-case text-muted-foreground/60">(Opus · 2×)</span>
        </label>
        <ToggleSwitch on={Boolean(settings.fast_mode)} onToggle={() => onPatch({ fast_mode: !settings.fast_mode })} />
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="truncate font-mono text-[9px] text-muted-foreground/70" title={sessionId ?? undefined}>
          {sessionId ? `session ${sessionId.slice(0, 8)}…` : "no session yet"}
        </span>
        {/* In-UI confirm — native window.confirm() wedges the embedded
            preview browser (invisible modal, blocked main thread). */}
        {confirmingReset ? (
          <span className="flex items-center gap-1">
            <span className="text-[9px] font-semibold text-red-400">reset the conversation?</span>
            <Button variant="outline" size="sm" disabled={working}
              className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300"
              onClick={() => { setConfirmingReset(false); onNewSession(); }}>
              reset
            </Button>
            <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]"
              onClick={() => setConfirmingReset(false)}>
              keep
            </Button>
          </span>
        ) : (
          <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10px]" disabled={working}
            title="Context resets; transcripts stay on disk"
            onClick={() => setConfirmingReset(true)}>
            <RotateCcw className="h-3 w-3" /> New session
          </Button>
        )}
      </div>
    </div>
  );
}
