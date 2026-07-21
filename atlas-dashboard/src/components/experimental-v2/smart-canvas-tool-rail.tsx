"use client";

// Smart Canvas tool rail — Midnight Gallery reskin (design target: "Smart
// Canvas v4"). The mockup splits the rail into GRAPH tools (select / component
// / wire / terminal / continuation) and a labeled MARK group. The full v4 mark
// family (pen / arrow / lasso / box / text) is Phase 2 — the rail here shows
// only tools that actually work (ask / bless under the Mark label), so the
// interface never offers a dead control.

import React from "react";
import {
  MousePointer,
  Square,
  CircleDashed,
  Spline,
  CircleDot,
  CornerUpRight,
  MessageCircleQuestion,
  ThumbsUp,
  Lasso,
  PenLine,
  MoveUpRight,
  SquareDashed,
  Type,
  Undo2,
  Redo2,
} from "lucide-react";
import { InfoTip } from "./smart-canvas-infotip";
import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";
import type { V2Tool } from "./experimental-v2-types";

type ToolDef = {
  id: V2Tool;
  icon: React.ReactNode;
  title: string;
  body: string;
  /** mark-group tools take the amber-ish accent + cyan hover */
  mark?: boolean;
};

// The IEC earth/ground glyph: a stem into three decreasing horizontal bars.
// Lucide has no electrical-ground symbol, so it's drawn inline for authenticity.
function GroundGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
      <line x1="8" y1="2" x2="8" y2="8" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="5" y1="11" x2="11" y2="11" />
      <line x1="6.5" y1="14" x2="9.5" y2="14" />
    </svg>
  );
}

// A mating connector: two half-boxes meeting at a shared face — drawn inline
// (no lucide equivalent) to mirror how the manufacturer prints CON/CN pairs.
function ConnectorGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
      <rect x="2" y="4" width="6" height="8" rx="1" />
      <rect x="8" y="4" width="6" height="8" rx="1" />
      <line x1="0.5" y1="6.5" x2="2" y2="6.5" />
      <line x1="0.5" y1="9.5" x2="2" y2="9.5" />
      <circle cx="8" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="9.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

// A cable bundle: a slanted bar with hatch ticks (the print's own vocabulary).
function CableGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M2 11 L14 5" />
      <path d="M5 12.2 L6.8 8.6 M8 10.7 L9.8 7.1 M11 9.2 L12.8 5.6" strokeWidth="1.1" />
    </svg>
  );
}

// v4 tooltip copy, verbatim where a control matches.
const GRAPH_TOOLS: ToolDef[] = [
  { id: "select", icon: <MousePointer className="h-4 w-4" />, title: "Select — V", body: "Click an element to rename or delete it. With a component selected, Ctrl-click its printed part number/spec to attach evidence — identity derives from the parts list, never asserted by hand." },
  { id: "component", icon: <Square className="h-4 w-4" />, title: "Component · drag box — C", body: "Drag a box around a part — the rect you drag is exactly the box you get; it labels itself from the print. Enclose a printed pin table (like TB30) and it auto-classifies as a TERMINAL STRIP: rows parse, and each terminal takes its row's pin number." },
  { id: "freehand", icon: <CircleDashed className="h-4 w-4" />, title: "Freehand · encircle — F", body: "Draw a loop around a part — it snaps tight to the artwork and labels itself." },
  { id: "wire", icon: <Spline className="h-4 w-4" />, title: "Wire · trace — W", body: "Trace along a wire — it straightens to the real line and captures the wire number." },
  { id: "terminal", icon: <CircleDot className="h-4 w-4" />, title: "Terminal · tap — T", body: "Tap a connection circle to place a terminal." },
  { id: "continuation", icon: <CornerUpRight className="h-4 w-4" />, title: "Continuation · tap — X", body: "Tap a boxed cross-reference to mark an off-page continuation." },
  { id: "ground", icon: <GroundGlyph />, title: "Ground · tap — G", body: "Tap a ground/earth symbol — a snug box snaps to the glyph, the entering conductor gets a border terminal, and it's recorded as a first-class ground reference. Tap an existing ground to re-snap it to the print." },
  { id: "connector", icon: <ConnectorGlyph />, title: "Connector · drag box, Ctrl+click pins — N", body: "Drag to place the connector's box. Then Ctrl+click each INPUT pin on its border — the pair mints across: input terminal, an out-side mate on the opposite border (adopting an aligned existing terminal when one is there), and the internal conduction segment." },
  { id: "cable", icon: <CableGlyph />, title: "Cable · trace — D", body: "Trace along a printed cable bundle (the hatched bar) — it names itself from the print (CAB21) and joins the document-wide cable registry: the same name on any page IS the same cable, sharing one conductor roster. Cables never conduct; the roster is evidence of what rides inside." },
];

const MARK_TOOLS: ToolDef[] = [
  { id: "pen", icon: <PenLine className="h-4 w-4" />, title: "Pen · draw freehand — P", body: "Ink anywhere on the print — the stroke anchors to the nearest element and opens the conversation there. Circle or underline a component and say what's up; the ink stays as the visible anchor.", mark: true },
  { id: "arrow", icon: <MoveUpRight className="h-4 w-4" />, title: "Arrow · point — R", body: "Drag an arrow at something specific — the head anchors to the nearest element, so \"this one\" is unambiguous. Say what you need; the arrow stays as the visible anchor.", mark: true },
  { id: "lasso", icon: <Lasso className="h-4 w-4" />, title: "Lasso · draw a region — L", body: "Draw a freehand loop around an area to scope Arc's attention. The region enters the conversation as a captured area — then tell Arc what to do there (e.g. \"fix the annotation errors in the marked area, then stop\").", mark: true },
  { id: "box", icon: <SquareDashed className="h-4 w-4" />, title: "Box · drag a region — O", body: "Drag a rectangle over an area to scope Arc's attention — the lasso's right-angled sibling for when the region IS a box.", mark: true },
  { id: "text", icon: <Type className="h-4 w-4" />, title: "Text · tap a note — M", body: "Tap to pin a text callout to the page — your words become the visible note AND the message to Arc, anchored where you tapped.", mark: true },
  { id: "ask", icon: <MessageCircleQuestion className="h-4 w-4" />, title: "Ask · tap — A", body: "Tap anything to place a numbered mark for Arc — nothing is drawn or renamed.", mark: true },
  { id: "bless", icon: <ThumbsUp className="h-4 w-4" />, title: "Bless · tap — B", body: "Tap excellent work and say why — it becomes a playbook exemplar future sessions retrieve and imitate.", mark: true },
];

export function ToolButton({
  def,
  active,
  onSelect,
}: {
  def: Pick<ToolDef, "icon" | "title" | "body" | "mark">;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <InfoTip title={def.title} body={def.body} side="right">
      <button
        type="button"
        onClick={onSelect}
        className="flex h-[34px] w-[38px] cursor-pointer items-center justify-center rounded-[10px] text-[14px] font-bold transition-all"
        style={{
          border: active ? "1px solid rgba(34,211,238,.55)" : "1px solid transparent",
          background: active
            ? "linear-gradient(180deg, rgba(14,148,180,.55), rgba(10,90,115,.55))"
            : "transparent",
          color: active ? "#e0fbff" : def.mark ? "#4b9db4" : "#7484a0",
          boxShadow: active ? "0 3px 14px rgba(34,211,238,.3), 0 1px 0 rgba(255,255,255,.15) inset" : "none",
        }}
      >
        {def.icon}
      </button>
    </InfoTip>
  );
}

export function SmartCanvasToolRail({
  tool,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  tool: V2Tool;
  onToolChange: (t: V2Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  return (
    <div
      className="z-20 flex w-[60px] shrink-0 flex-col items-center gap-1 border-r py-3 backdrop-blur-2xl backdrop-saturate-150"
      style={{ borderColor: MG.line, background: MG_PANEL_FROST }}
    >
      {/* Zone eyebrow (containment grammar): every zone announces itself. */}
      <div className="mb-[3px] text-[7.5px] font-bold uppercase tracking-[.18em] opacity-80" style={{ color: MG.cyan }}>
        Tools
      </div>
      {GRAPH_TOOLS.map((d) => (
        <ToolButton key={d.id} def={d} active={tool === d.id} onSelect={() => onToolChange(d.id)} />
      ))}

      <div
        className="my-[7px] h-px w-[30px]"
        style={{ background: "linear-gradient(90deg, transparent, rgba(148,163,184,.25), transparent)" }}
      />
      <div className="mb-[3px] text-[7.5px] font-bold uppercase tracking-[.18em] opacity-80" style={{ color: MG.cyan }}>
        Mark
      </div>
      {MARK_TOOLS.map((d) => (
        <ToolButton key={d.id} def={d} active={tool === d.id} onSelect={() => onToolChange(d.id)} />
      ))}

      <div className="flex-1" />

      <InfoTip title="Undo — Ctrl+Z" body="Step backward through your edits. History is per page, so you can safely experiment and walk it back." side="right">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex h-[30px] w-9 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-transparent text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
          style={{ color: MG.textFaint }}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      </InfoTip>
      <InfoTip title="Redo — Ctrl+Y" body="Replay an edit you just undid. Redo clears once you make a new change, so the branch you abandon won't come back to surprise you." side="right">
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex h-[30px] w-9 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-transparent text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
          style={{ color: MG.textFaint }}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </InfoTip>
    </div>
  );
}
