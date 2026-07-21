"use client";

// Canvas status footer — the glanceable truth strip (the working-instrument
// grammar: document · page · graph tally · data state · bridge). This is the
// same live picture the copilot reads in its context block; the operator
// deserves it too, in one quiet line that never wraps.

import React from "react";
import { InfoTip } from "./smart-canvas-infotip";
import { MG } from "./smart-canvas-theme";
import { type V2Graph } from "./experimental-v2-types";

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background: on ? MG.ok : "#f87171",
        animation: on ? "sc-breath 2.4s ease-in-out infinite" : "none",
      }}
    />
  );
}

export function SmartCanvasStatusBar({
  pageNum,
  pageCount,
  graph,
  bridgeConnected,
  offlineCache,
  seededFromLegacy,
  sealed,
}: {
  pageNum: number;
  pageCount: number;
  graph: V2Graph;
  bridgeConnected: boolean;
  offlineCache?: boolean;
  seededFromLegacy?: boolean;
  sealed?: boolean;
}) {
  const tally = `${graph.nodes.length}c · ${graph.ports.length}t · ${graph.edges.length}w · ${graph.continuations.length}x · ${(graph.grounds ?? []).length}g`;
  return (
    <div
      className="z-20 flex h-8 w-full shrink-0 items-center gap-4 whitespace-nowrap border-t px-3 font-mono text-[10px]"
      style={{ borderColor: MG.line, background: "rgba(6,11,22,.55)", color: MG.textMute }}
    >
      <span style={{ color: MG.textFaint }}>reference schematic · <drawing-no></span>
      <span>Page {pageNum} / {pageCount}{sealed ? " · 🛡 certified" : ""}</span>
      <InfoTip
        title="Graph tally"
        body="What this page's logic graph holds right now: components · terminals · wires · continuations · grounds. The same numbers Arc reads in its context."
      >
        <span className="cursor-default" style={{ color: MG.textDim }}>{tally}</span>
      </InfoTip>
      <div className="flex-1" />
      {seededFromLegacy && (
        <span className="uppercase tracking-wider" style={{ color: "#7dd3fc" }}>seeded from legacy</span>
      )}
      <InfoTip
        title={offlineCache ? "Offline cache" : "Neon synced"}
        body={offlineCache
          ? "Working from the local offline cache — changes persist locally and reconcile when the Neon connection returns."
          : "The graph persists to Neon (source of truth) with a local offline cache riding along."}
      >
        <span className="flex cursor-default items-center gap-1.5 uppercase tracking-wider" style={{ color: offlineCache ? MG.amberText : MG.textMute }}>
          <Dot on={!offlineCache} />
          {offlineCache ? "offline cache" : "neon"}
        </span>
      </InfoTip>
      <InfoTip
        title={bridgeConnected ? "Live bridge connected" : "Live bridge down"}
        body="The canvas ↔ Arc bridge: state up, commands down. Green means Arc sees this canvas live."
      >
        <span className="flex cursor-default items-center gap-1.5 uppercase tracking-wider">
          <Dot on={bridgeConnected} />
          bridge
        </span>
      </InfoTip>
    </div>
  );
}
