"use client";

// Smart Canvas workspace bar — the Midnight Gallery chrome (design target of
// record: docs/vault/Smart Canvas v2 Design Target.md; artifact "Smart Canvas
// v4"), reorganized 2026-07-09 per Shane's containment ruling: this bar keeps
// ONLY workspace concerns — brand/exit, mode, settings, copilot. Everything
// page- and view-scoped (page nav, seal, palm guard, layer pills, zoom, ⌘K)
// lives on the canvas card's own toolbar (smart-canvas-canvas-bar.tsx).
//
// Fingerprint mode is GATED here (disabled + honest "coming online" tip) until
// the phase-3 backend exists — the interface never promises what the backend
// can't yet honor.

import React from "react";
import { Bot, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "./smart-canvas-infotip";
import { MG } from "./smart-canvas-theme";

export type SmartCanvasMode = "annotate" | "fingerprint";

export function SmartCanvasHeader({
  mode,
  onModeChange,
  fingerprintEnabled = false,
  onExitWorkspace,
  settingsOpen,
  onToggleSettings,
  copilotOpen,
  onToggleCopilot,
  bridgeConnected,
}: {
  mode: SmartCanvasMode;
  onModeChange: (m: SmartCanvasMode) => void;
  fingerprintEnabled?: boolean;
  onExitWorkspace?: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  copilotOpen: boolean;
  onToggleCopilot: () => void;
  bridgeConnected: boolean;
}) {
  const isA = mode === "annotate";

  return (
    <div
      className="z-20 flex h-14 w-full shrink-0 items-center gap-3.5 border-b px-[18px] backdrop-blur-[14px]"
      style={{
        borderColor: MG.line,
        background: "linear-gradient(180deg, rgba(20,30,50,.85), rgba(13,20,35,.85))",
        boxShadow: "0 1px 0 rgba(255,255,255,.04) inset",
      }}
    >
      {/* ── Wordmark (doubles as the workspace switcher — full-bleed means this
          is the only way back to the platform) ── */}
      <InfoTip
        title={onExitWorkspace ? "Atlas Extraction Studio — back to platform" : "Smart Canvas"}
        body={
          onExitWorkspace
            ? "You're in the Smart Canvas workspace. Click the mark to return to the Atlas platform (agent console, other workspaces)."
            : "The Smart Canvas annotation + fingerprint workspace."
        }
      >
        <button
          type="button"
          onClick={onExitWorkspace}
          disabled={!onExitWorkspace}
          className={cn("flex items-center gap-2.5 rounded-lg border-0 bg-transparent p-0 text-left", onExitWorkspace ? "cursor-pointer" : "cursor-default")}
        >
          <div
            className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[12px] font-extrabold"
            style={{
              background: "linear-gradient(140deg, #22d3ee 0%, #0e7490 80%)",
              color: "#062430",
              boxShadow: "0 2px 8px rgba(34,211,238,.35), 0 1px 0 rgba(255,255,255,.25) inset",
            }}
          >
            ◆
          </div>
          <div className="leading-tight">
            <div className="text-[12.5px] font-bold tracking-[.02em]" style={{ color: MG.text }}>
              Smart Canvas
            </div>
            <div className="text-[9px] uppercase tracking-[.14em]" style={{ color: "#64748b" }}>
              Atlas Extraction Studio
            </div>
          </div>
        </button>
      </InfoTip>

      {/* ── Mode toggle: sliding thumb ── */}
      <div
        className="relative ml-3.5 flex rounded-[11px] p-[3px]"
        style={{
          background: "rgba(3,8,18,.8)",
          border: `1px solid ${MG.lineStrong}`,
          boxShadow: "0 1px 3px rgba(0,0,0,.4) inset",
        }}
      >
        <div
          className="absolute rounded-lg transition-[left] duration-300"
          style={{
            top: 3,
            bottom: 3,
            left: isA ? 3 : "calc(50% - 1px)",
            width: "calc(50% - 2px)",
            background: "linear-gradient(180deg, #38dcf5, #0e94b4)",
            boxShadow: "0 2px 8px rgba(34,211,238,.4), 0 1px 0 rgba(255,255,255,.35) inset",
            transitionTimingFunction: "cubic-bezier(.4,0,.2,1)",
          }}
        />
        <InfoTip
          title="Annotate mode"
          body="Draft and discuss the schematic: place components, wires, terminals and continuations, and mark up the page for Arc. This is the day-to-day authoring surface."
        >
          <button
            type="button"
            onClick={() => onModeChange("annotate")}
            className="relative z-[1] cursor-pointer rounded-lg border-0 bg-transparent px-[18px] py-1.5 text-[12px] font-bold tracking-[.01em] transition-colors duration-200"
            style={{ color: isA ? "#062430" : MG.textMute }}
          >
            Annotate
          </button>
        </InfoTip>
        <InfoTip
          title={fingerprintEnabled ? "Fingerprint mode" : "Fingerprint mode · coming online"}
          body={
            fingerprintEnabled
              ? "Build the symbol library: mask a component's exact pixels, mint its signature, and scan the drawing for every other instance. Drives the class-coverage goal."
              : "The symbol-library workspace — mask a component, mint its signature, and scan for matches. Comes online with the fingerprint backend (phase 3); the mockup shows where it lands."
          }
        >
          <button
            type="button"
            onClick={() => fingerprintEnabled && onModeChange("fingerprint")}
            disabled={!fingerprintEnabled}
            className={cn(
              "relative z-[1] rounded-lg border-0 bg-transparent px-[18px] py-1.5 text-[12px] font-bold tracking-[.01em] transition-colors duration-200",
              fingerprintEnabled ? "cursor-pointer" : "cursor-not-allowed"
            )}
            style={{ color: !isA ? "#062430" : fingerprintEnabled ? MG.textMute : MG.textGhost }}
          >
            Fingerprint
          </button>
        </InfoTip>
      </div>

      <div className="flex-1" />

      {/* ── Settings ── */}
      <InfoTip
        title="Smart Canvas settings"
        body="Tune the engine: snap radius and snap targets, wire-trace tolerance, auto-labeling, per-document detection thresholds, net-color and grid overlays. Everything that changes how the canvas assists you."
      >
        <button
          type="button"
          onClick={onToggleSettings}
          className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] text-[13px] transition-colors"
          style={{
            border: `1px solid ${settingsOpen ? "rgba(34,211,238,.45)" : MG.lineStrong}`,
            background: settingsOpen ? "linear-gradient(180deg, rgba(14,116,144,.4), rgba(10,80,100,.4))" : "rgba(148,163,184,.05)",
            color: settingsOpen ? MG.text : MG.textMute,
          }}
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </InfoTip>

      {/* ── Copilot toggle ── */}
      <InfoTip
        title="Arc"
        body="Show or hide Arc. It sees the same canvas you do, answers questions about your marks, proposes edits you approve, and its green dot means the live bridge is connected."
      >
        <button
          type="button"
          onClick={onToggleCopilot}
          className="relative flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] text-[13px] transition-all"
          style={{
            border: `1px solid ${copilotOpen ? "rgba(34,211,238,.45)" : MG.lineStrong}`,
            background: copilotOpen ? "linear-gradient(180deg, rgba(14,116,144,.4), rgba(10,80,100,.4))" : "rgba(148,163,184,.05)",
            color: MG.text,
          }}
        >
          <Bot className="h-3.5 w-3.5" />
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2"
            style={{
              background: bridgeConnected ? MG.ok : "#f87171",
              borderColor: MG.panelSolid,
              animation: bridgeConnected ? "sc-breath 2.4s ease-in-out infinite" : "none",
            }}
          />
        </button>
      </InfoTip>
    </div>
  );
}
