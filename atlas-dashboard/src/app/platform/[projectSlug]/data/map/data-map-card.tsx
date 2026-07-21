"use client";

// One derived card — the board's atom. The header carries the table's
// FAMILY identity (kind color bar), its live row count, and its status
// chip; column rows come straight from the catalog. Click a column to put
// it on the Proving Bench; drag its dot to draw a contract; right-click to
// peek real values. A card cannot disagree with its table — there is
// nothing stored to disagree with.

import React from "react";
import { ChevronDown, ChevronUp, ShieldCheck, X } from "lucide-react";

import { PT } from "@/lib/platform-theme";

import {
  CARD_W, FIELDS_PAD, HEADER_H, KIND_LABEL, ROW_H, kindColor, type Card,
} from "./data-map-types";

function fmtRows(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function DataMapCard({
  card,
  pos,
  collapsed,
  highlightField,
  benchPicked,
  onHeaderPointerDown,
  onToggleCollapse,
  onRemove,
  onFieldDotDown,
  onFieldDrop,
  onFieldClick,
  onFieldContextMenu,
}: {
  card: Card;
  pos: { x: number; y: number };
  collapsed: boolean;
  highlightField: string | null;
  /** columns of THIS card currently on the Proving Bench */
  benchPicked: Set<string>;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
  onToggleCollapse: () => void;
  onRemove: () => void;
  onFieldDotDown: (field: string, side: "left" | "right", e: React.PointerEvent) => void;
  onFieldDrop: (field: string) => void;
  /** click a column row → toggle it onto the Proving Bench */
  onFieldClick: (field: string) => void;
  /** right-click a column row → preview its real values */
  onFieldContextMenu: (field: string, e: React.MouseEvent) => void;
}) {
  const color = kindColor(card.kind);
  const certified = card.status === "certified";
  return (
    <div
      className="absolute select-none rounded-lg border shadow-lg"
      style={{
        left: pos.x,
        top: pos.y,
        width: CARD_W,
        borderColor: card.missing ? "rgba(248,113,113,.55)" : PT.lineStrong,
        background: "rgba(6,12,24,.92)",
        boxShadow: `0 4px 18px rgba(0,0,0,.45), inset 3px 0 0 ${color}`,
      }}
    >
      <div
        className="flex cursor-grab items-center gap-1.5 rounded-t-lg border-b px-2"
        style={{ height: HEADER_H, borderColor: PT.line, background: "rgba(10,18,34,.9)", touchAction: "none" }}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-bold leading-tight" style={{ color: PT.text }}>
              {card.table_name}
            </span>
            {certified && (
              <ShieldCheck className="h-3 w-3 shrink-0" style={{ color: "#34d399" }} aria-label="certified" />
            )}
          </div>
          <div className="truncate text-[8.5px] leading-tight" style={{ color }}
               title={card.provenance ?? undefined}>
            {KIND_LABEL[card.kind ?? "table"]}
            {" · "}
            {card.missing
              ? "TABLE MISSING"
              : `${fmtRows(card.row_count)} rows${card.status ? ` · ${card.status}` : ""}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer rounded border-0 bg-transparent p-0.5"
          title={collapsed ? "expand columns" : "collapse to title"}
        >
          {collapsed
            ? <ChevronDown className="h-3.5 w-3.5" style={{ color: PT.textGhost }} />
            : <ChevronUp className="h-3.5 w-3.5" style={{ color: PT.textGhost }} />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          onPointerDown={(e) => e.stopPropagation()}
          className="cursor-pointer rounded border-0 bg-transparent p-0.5"
          title="remove from board (the table is untouched)"
        >
          <X className="h-3.5 w-3.5" style={{ color: PT.textGhost }} />
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: `${FIELDS_PAD}px 0` }}>
          {card.columns.map((name) => {
            const hot = highlightField === name;
            const picked = benchPicked.has(name);
            const note = card.field_notes[name];
            return (
              <div
                key={name}
                className="relative flex cursor-pointer items-center gap-1.5 px-3"
                style={{
                  height: ROW_H,
                  background: hot
                    ? "rgba(34,211,238,.12)"
                    : picked ? "rgba(34,211,238,.07)" : "transparent",
                }}
                onPointerUp={() => onFieldDrop(name)}
                onClick={() => onFieldClick(name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFieldContextMenu(name, e);
                }}
                title={`${name}${note ? ` — ${note}` : ""}\nclick: put on the Proving Bench · right-click: peek values · drag dot: draw a join`}
              >
                <span
                  className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border"
                  style={{ borderColor: PT.lineStrong, background: "rgba(10,18,34,1)", touchAction: "none" }}
                  onPointerDown={(e) => onFieldDotDown(name, "left", e)}
                  title={`draw a relation from ${name}`}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[10.5px]"
                  style={{ color: picked ? PT.text : PT.textDim }}
                >
                  {name}
                </span>
                {picked && (
                  <span className="shrink-0 rounded-full text-[7.5px] font-bold uppercase tracking-wide"
                        style={{ color: "#22d3ee" }}>
                    bench
                  </span>
                )}
                <span
                  className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 cursor-crosshair rounded-full border"
                  style={{ borderColor: PT.lineStrong, background: "rgba(10,18,34,1)", touchAction: "none" }}
                  onPointerDown={(e) => onFieldDotDown(name, "right", e)}
                  title={`draw a relation from ${name}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
