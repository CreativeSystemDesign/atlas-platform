"use client";

// Edge inspector — the floating card for one selected contract: endpoints,
// semantics, the live badge, the proposal basis, notes, and the verbs.
// Delete works on EVERY status now (the dismissed-contract pile-up was a
// real bug behind the remodel); the survey badge reads live tables.

import React, { useState } from "react";
import { RefreshCw, X } from "lucide-react";

import { PT, PT_PANEL_FROST } from "@/lib/platform-theme";

import { SEMANTICS_LABEL, type Relation } from "./data-map-types";

export function DataMapInspector({
  relation,
  onPatch,
  onDelete,
  onSurvey,
  onClose,
}: {
  relation: Relation;
  onPatch: (patch: Partial<Pick<Relation, "semantics" | "status" | "notes">>) => void;
  onDelete: () => void;
  onSurvey: () => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(relation.notes ?? "");
  const backed = relation.from_bound && relation.to_bound;
  const badge = relation.match_den != null && relation.match_num != null
    ? `${relation.match_num} / ${relation.match_den}`
    : !backed ? "unbacked" : "not surveyed";

  return (
    <div
      // data-board-menu: the board host's pointerdown guard exempts this
      // subtree — without it, clicking any verb pans the board and clears
      // the selection first, unmounting the inspector (review 2026-07-20)
      data-board-menu
      className="absolute right-4 top-4 z-30 w-[300px] rounded-xl border p-3 shadow-2xl backdrop-blur-xl"
      style={{ borderColor: PT.lineStrong, background: PT_PANEL_FROST }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: PT.textFaint }}>
          {relation.status === "proposed" ? "proposal" : relation.status === "dismissed" ? "dismissed proposal" : "join contract"}
        </div>
        <button type="button" onClick={onClose} className="cursor-pointer rounded border-0 bg-transparent p-0.5">
          <X className="h-3.5 w-3.5" style={{ color: PT.textGhost }} />
        </button>
      </div>

      <div className="mt-1 text-[11.5px] font-semibold leading-snug" style={{ color: PT.text }}>
        {relation.from_table}.{relation.from_field}
        <span style={{ color: PT.textGhost }}> → </span>
        {relation.to_table}.{relation.to_field}
      </div>
      {!backed && (
        <div className="mt-0.5 text-[9px]" style={{ color: "#fbbf24" }}>
          {!relation.from_bound
            ? `${relation.from_table}.${relation.from_field} no longer exists`
            : `${relation.to_table}.${relation.to_field} no longer exists`}
          {" — the contract outlived its column"}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span
          className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold"
          style={{ borderColor: PT.lineStrong, color: relation.match_den != null ? "#22d3ee" : PT.textGhost }}
          title="matched / total distinct values, surveyed live against the real tables"
        >
          {badge}
        </span>
        <button
          type="button"
          onClick={onSurvey}
          disabled={!backed}
          className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[9.5px] font-semibold"
          style={{ borderColor: PT.lineStrong, color: PT.textDim, background: "transparent",
                   opacity: backed ? 1 : 0.45 }}
          title={backed ? "re-run the match survey" : "an endpoint's table or column no longer exists"}
        >
          <RefreshCw className="h-2.5 w-2.5" /> survey
        </button>
      </div>

      <div className="mt-2">
        <div className="text-[9px] font-bold uppercase tracking-[.1em]" style={{ color: PT.textFaint }}>semantics</div>
        <select
          value={relation.semantics}
          onChange={(e) => onPatch({ semantics: e.target.value as Relation["semantics"] })}
          className="mt-0.5 w-full cursor-pointer rounded-md border px-1.5 py-1 text-[10.5px] outline-none"
          style={{ borderColor: PT.lineStrong, background: "rgba(3,8,18,.6)", color: PT.text }}
        >
          {(Object.keys(SEMANTICS_LABEL) as Relation["semantics"][]).map((s) => (
            <option key={s} value={s}>{SEMANTICS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {relation.basis && (
        <div className="mt-2 rounded-md border px-2 py-1.5 text-[9.5px] leading-snug"
             style={{ borderColor: "rgba(245,158,11,.35)", background: "rgba(245,158,11,.06)", color: "#fbbf24" }}>
          {relation.basis}
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => { if ((relation.notes ?? "") !== notes) onPatch({ notes }); }}
        placeholder="notes on this contract…"
        rows={2}
        className="mt-2 w-full resize-none rounded-md border px-2 py-1 text-[10.5px] outline-none"
        style={{ borderColor: PT.lineStrong, background: "rgba(3,8,18,.6)", color: PT.textDim }}
      />

      <div className="mt-2 flex items-center gap-1.5">
        {relation.status === "proposed" && (
          <>
            <button
              type="button"
              onClick={() => onPatch({ status: "drawn" })}
              className="cursor-pointer rounded-md border-0 px-2.5 py-1 text-[10.5px] font-bold"
              style={{ background: "linear-gradient(180deg, #22d3ee, #0e7490)", color: "#062430" }}
            >
              accept — draw it
            </button>
            <button
              type="button"
              onClick={() => onPatch({ status: "dismissed" })}
              className="cursor-pointer rounded-md border px-2 py-1 text-[10.5px] font-semibold"
              style={{ borderColor: PT.lineStrong, color: PT.textDim, background: "transparent" }}
            >
              dismiss
            </button>
          </>
        )}
        {relation.status === "dismissed" && (
          <button
            type="button"
            onClick={() => onPatch({ status: "proposed" })}
            className="cursor-pointer rounded-md border px-2 py-1 text-[10.5px] font-semibold"
            style={{ borderColor: PT.lineStrong, color: PT.textDim, background: "transparent" }}
          >
            restore proposal
          </button>
        )}
        {/* delete is available on EVERY status — a contract you can't remove
            is a bug, not a feature (Shane, 2026-07-19) */}
        <button
          type="button"
          onClick={onDelete}
          className="cursor-pointer rounded-md border px-2 py-1 text-[10.5px] font-semibold"
          style={{ borderColor: "rgba(248,113,113,.45)", color: "#f87171", background: "transparent" }}
        >
          delete contract
        </button>
      </div>
    </div>
  );
}
