"use client";

// Issues queue edge tab (v4 mockup port): a slim amber tab pinned to the
// viewport's right edge — the standing signal that blocked issues await
// Shane's verdict, visible even when the copilot rail or its Table is closed.
// Clicking opens the rail + the Table; the tab renders only while count > 0.

import React from "react";
import { InfoTip } from "./smart-canvas-infotip";
import { MG } from "./smart-canvas-theme";

export function SmartCanvasIssuesTab({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <InfoTip
      title={`Blocked issues · ${count} awaiting you`}
      body="Arc parked these for your verdict — each blocks a done claim until you rule. Click to open the Table; clicking an issue lights its element on the sheet."
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the Table (${count} issue${count === 1 ? "" : "s"} awaiting your verdict)`}
        className="absolute right-0 top-[110px] z-30 flex cursor-pointer flex-col items-center gap-1 px-1.5 py-2.5 transition-transform hover:-translate-x-0.5 animate-in fade-in slide-in-from-right-2 duration-300"
        style={{
          borderRadius: "10px 0 0 10px",
          border: "1px solid rgba(245,158,11,.5)",
          borderRight: "none",
          background: "rgba(69,26,3,.92)",
        }}
      >
        <span className="text-[12px] leading-none" style={{ color: MG.amberText }}>⚠</span>
        <span
          className="rounded px-1 py-px font-mono text-[9px] font-extrabold leading-tight"
          style={{ color: MG.amberText, background: "rgba(245,158,11,.2)" }}
        >
          {count}
        </span>
      </button>
    </InfoTip>
  );
}
