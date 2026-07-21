"use client";

// Schema-Builder mark rail — the Smart Canvas rail's sibling, built from the
// SAME parts (ToolButton, InfoTip, Midnight Gallery frost) so the two benches
// read as one product. Only the mark family lives here: this bench points and
// scopes for Arc; it never draws a graph.

import React from "react";
import { Camera, Eraser, MessageCircleQuestion, MousePointer, SquareDashed } from "lucide-react";
import { InfoTip } from "./smart-canvas-infotip";
import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";
import { ToolButton } from "./smart-canvas-tool-rail";

export type SchemaMarkTool = "none" | "point" | "region" | "capture";

const TOOLS: { id: SchemaMarkTool; icon: React.ReactNode; title: string; body: string; mark?: boolean }[] = [
  {
    id: "none",
    icon: <MousePointer className="h-4 w-4" />,
    title: "Select",
    body: "Plain reading mode — clicks do nothing to the page.",
  },
  {
    id: "point",
    icon: <MessageCircleQuestion className="h-4 w-4" />,
    title: "Ask · tap — A",
    body: "Tap anything to place a numbered pin for Arc — it rides the conversation context, and Arc can view the page with your pins drawn on it.",
    mark: true,
  },
  {
    id: "region",
    icon: <SquareDashed className="h-4 w-4" />,
    title: "Box · drag a region — O",
    body: "Drag a rectangle over content to scope Arc's attention — a table, a header row, a legend block. Arc can view it drawn on the page or crop straight into it for a close read.",
    mark: true,
  },
  {
    id: "capture",
    icon: <Camera className="h-4 w-4" />,
    title: "Capture · drag to snip — C",
    body: "Drag a rectangle to snip that area of the page straight into Arc's message box as an image — add a line (\"extract this header\") and hit Enter. The crop carries its page position, so Arc knows exactly where it came from.",
    mark: true,
  },
];

export function SchemaMarkRail({
  tool,
  onToolChange,
  markCount,
  onClear,
  captureEnabled = false,
}: {
  tool: SchemaMarkTool;
  onToolChange: (t: SchemaMarkTool) => void;
  markCount: number;
  onClear: () => void;
  /** Show the Capture tool (snip → Arc's composer) — only where a handler is wired. */
  captureEnabled?: boolean;
}) {
  const tools = TOOLS.filter((d) => d.id !== "capture" || captureEnabled);
  return (
    <div
      className="z-20 flex w-[60px] shrink-0 flex-col items-center gap-1 border-r py-3 backdrop-blur-2xl backdrop-saturate-150"
      style={{ borderColor: MG.line, background: MG_PANEL_FROST }}
    >
      <div className="mb-[3px] text-[7.5px] font-bold uppercase tracking-[.18em] opacity-80" style={{ color: MG.cyan }}>
        Mark
      </div>
      {tools.map((d) => (
        <ToolButton key={d.id} def={d} active={tool === d.id} onSelect={() => onToolChange(d.id)} />
      ))}

      <div className="flex-1" />

      {markCount > 0 && (
        <InfoTip title="Clear marks" body="Remove every pin and region on this document — Arc stops seeing them on the next message." side="right">
          <button
            type="button"
            onClick={onClear}
            className="flex h-[30px] w-9 cursor-pointer flex-col items-center justify-center rounded-[9px] border-0 bg-transparent transition-colors"
            style={{ color: MG.textFaint }}
          >
            <Eraser className="h-3.5 w-3.5" />
            <span className="text-[8px] font-bold">{markCount}</span>
          </button>
        </InfoTip>
      )}
    </div>
  );
}
