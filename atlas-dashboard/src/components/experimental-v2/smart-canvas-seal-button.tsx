"use client";

// Seal button (Shane, 2026-07-08): "this page is now gold — how can I seal it?"
// Lives in the header beside the palm guard. Enabled ONLY when the audit reads
// clean (post-disposition) and the Table is empty; sealing arms the server's
// gold-master page-lock (copilot mutations refused) and the screen's local
// edit gate (Shane's own tools refused too). Unsealing is deliberate: first
// click arms, second click within 3.5s confirms — no native dialogs.

import React, { useEffect, useRef, useState } from "react";
import { ShieldCheck, Shield } from "lucide-react";
import { InfoTip } from "./smart-canvas-infotip";
import { MG } from "./smart-canvas-theme";
import type { PageSealState } from "./use-v2-page-seal";

const GOLD = "#fbbf24";
const GOLD_DEEP = "rgba(217,119,6,.55)";

export function SmartCanvasSealButton({
  seal,
  onSeal,
  onUnseal,
}: {
  seal: PageSealState;
  onSeal: () => void;
  onUnseal: () => void;
}) {
  const [arming, setArming] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  if (seal.sealed) {
    const drifted = seal.drift === true;
    return (
      <InfoTip
        title={drifted ? "DRIFT — live graph differs from the certified snapshot" : arming ? "Click again to unseal" : "Sealed — certified"}
        body={
          drifted
            ? `The live graph no longer matches certified snapshot v${seal.goldVersion ?? "?"} — something changed after you certified it. Investigate before trusting this page.`
            : arming
              ? "Second click unseals the page — annotations become editable again and Arc may propose changes. The certified snapshot stays archived either way."
              : `This page is sealed: the audit read clean, the Table was empty, and you locked it. Certified snapshot v${seal.goldVersion ?? "?"} is archived in Neon (append-only, checksummed). Every edit — yours and Arc's — is refused until you unseal. Click twice to unseal.`
        }
      >
        <button
          type="button"
          onClick={() => {
            if (arming) {
              setArming(false);
              if (timerRef.current) window.clearTimeout(timerRef.current);
              onUnseal();
            } else {
              setArming(true);
              timerRef.current = window.setTimeout(() => setArming(false), 3500);
            }
          }}
          className="flex select-none items-center gap-[7px] rounded-[9px] px-3 py-[5px] text-[9px] font-bold uppercase tracking-[.12em]"
          style={{
            cursor: "pointer",
            border: `1px solid ${drifted ? "rgba(248,113,113,.7)" : arming ? "rgba(248,113,113,.55)" : GOLD_DEEP}`,
            background: arming || drifted
              ? "linear-gradient(180deg, rgba(69,16,16,.65), rgba(48,12,12,.65))"
              : "linear-gradient(180deg, rgba(64,44,8,.7), rgba(46,30,6,.7))",
            color: drifted ? "#fca5a5" : arming ? "#fca5a5" : GOLD,
            animation: arming || drifted ? "none" : "sc-glow 3s ease-in-out infinite",
          }}
        >
          <ShieldCheck className="h-3 w-3" />
          {drifted ? "Sealed · drift!" : arming ? "Unseal page?" : `Sealed · certified${seal.goldVersion ? ` v${seal.goldVersion}` : ""}`}
        </button>
      </InfoTip>
    );
  }

  const why =
    seal.loading ? "Checking the page's audit state…"
    : seal.clean === null ? "Seal state unknown — the audit runs against the page open on the canvas."
    : seal.tableOpen > 0 ? `${seal.tableOpen} Table card(s) still await your verdict.`
    : seal.clean === false ? "The audit still reports open issues — resolve or rule on them first."
    : "The audit reads clean and the Table is empty — one click locks this page as Certified.";

  return (
    <InfoTip
      title={seal.sealable ? "Seal this page — Certified" : "Seal unavailable"}
      body={
        seal.sealable
          ? "Locks the page: Arc's mutations are refused server-side and your own canvas tools are gated until you unseal. The seal is journaled and reversible."
          : `${why} The button enables itself when no issues are detected anywhere.`
      }
    >
      <button
        type="button"
        onClick={seal.sealable ? onSeal : undefined}
        aria-disabled={!seal.sealable}
        className="flex select-none items-center gap-[7px] rounded-[9px] px-3 py-[5px] text-[9px] font-bold uppercase tracking-[.12em]"
        style={{
          cursor: seal.sealable ? "pointer" : "not-allowed",
          border: `1px solid ${seal.sealable ? GOLD_DEEP : MG.lineStrong}`,
          background: seal.sealable
            ? "linear-gradient(180deg, rgba(64,44,8,.55), rgba(46,30,6,.55))"
            : "transparent",
          color: seal.sealable ? GOLD : MG.textFaint,
          animation: seal.sealable ? "sc-glow 3s ease-in-out infinite" : "none",
          opacity: seal.sealable ? 1 : 0.75,
        }}
      >
        <Shield className="h-3 w-3" />
        {seal.sealable ? "Seal page" : "Seal"}
      </button>
    </InfoTip>
  );
}
