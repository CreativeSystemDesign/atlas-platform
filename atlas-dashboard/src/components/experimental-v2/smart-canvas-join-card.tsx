"use client";

// The hover join card — Shane's tooltip (2026-07-14): dwell on a component
// and the drawn join contracts answer with everything the documents hold
// on it. Schematic occurrences, parts-list row, landing wires, cables with
// printed endpoints — assembled by the read-only join-walk endpoint.
// Evidence, never a gate: empty sections are honest, nothing blocks.
//
// Self-contained: owns the dwell timer (450ms), a small TTL cache, abort
// on dismiss, and its own go-away rules (leave, click, wheel, Esc, tool
// change via hover=null). Styled to the Midnight Gallery inspector.

import { useEffect, useRef, useState } from "react";
import { Network } from "lucide-react";

import { agentBaseUrl } from "@/lib/agent-base-url";
import { DOCUMENT_ID, PROJECT_ID } from "@/components/extraction-workbench/studio-types";

import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";

export type JoinHover = { mark: string; clientX: number; clientY: number };

type JoinPayload = {
  mark: string;
  occurrences: { page: number; location: string | null; part_number: string | null }[];
  terminal_count: number;
  nets: string[];
  parts_rows: { location: string | null; symbol_text: string | null; description: string | null;
    part_number: string | null; quantity: string | null }[];
  cables: { cable_number: string | null; origination: string | null; termination: string | null }[];
};

const DWELL_MS = 450;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CARD_W = 320;

export function SmartCanvasJoinCard({ hover }: { hover: JoinHover | null }) {
  const [shown, setShown] = useState<JoinHover | null>(null);
  const [payload, setPayload] = useState<JoinPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, { t: number; data: JoinPayload }>());
  const abortRef = useRef<AbortController | null>(null);
  const suppressed = useRef(false); // clicked/scrolled away — quiet until next hover

  // hover gone → card gone, same render (derived state, not an effect)
  if (!hover && (shown || loading)) {
    setShown(null);
    setLoading(false);
  }

  // dwell: the card earns its place by the pointer settling, never by transit
  useEffect(() => {
    if (!hover) {
      abortRef.current?.abort();
      return;
    }
    suppressed.current = false;
    const t = window.setTimeout(() => {
      if (!suppressed.current) setShown(hover);
    }, DWELL_MS);
    return () => window.clearTimeout(t);
  }, [hover]);

  // fetch on show (cached for 5 min per mark)
  useEffect(() => {
    if (!shown) return;
    const hit = cache.current.get(shown.mark);
    if (hit && Date.now() - hit.t < CACHE_TTL_MS) {
      setPayload(hit.data);
      setLoading(false);
      return;
    }
    setPayload(null);
    setLoading(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    fetch(`${agentBaseUrl()}/projects/${PROJECT_ID}/joins/component`
      + `?document_id=${encodeURIComponent(DOCUMENT_ID)}&mark=${encodeURIComponent(shown.mark)}`,
      { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: JoinPayload) => {
        cache.current.set(shown.mark, { t: Date.now(), data: d });
        setPayload(d);
        setLoading(false);
      })
      .catch(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [shown]);

  // any decisive input dismisses — the card must never fight the tools
  useEffect(() => {
    if (!shown) return;
    const dismiss = () => { suppressed.current = true; setShown(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("wheel", dismiss, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [shown]);

  if (!shown) return null;
  const x = Math.max(12, Math.min(shown.clientX + 14, window.innerWidth - CARD_W - 12));
  const y = Math.min(shown.clientY + 14, window.innerHeight - 220);

  const p = payload;
  const empty = p && !p.occurrences.length && !p.parts_rows.length
    && !p.cables.length && p.terminal_count === 0;
  const nets = p ? (p.nets.length > 8
    ? `${p.nets.slice(0, 8).join(", ")} +${p.nets.length - 8}` : p.nets.join(", ")) : "";

  return (
    <div
      className="fixed z-[60] rounded-[14px] p-3 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 animate-in fade-in slide-in-from-bottom-1 pointer-events-none"
      style={{ left: x, top: Math.max(12, y), width: CARD_W,
        background: MG_PANEL_FROST, border: `1px solid ${MG.lineStrong}` }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Network className="h-3 w-3" style={{ color: MG.cyan }} />
        <span className="font-mono text-[12px] font-bold" style={{ color: MG.text }}>
          {shown.mark}
        </span>
        <span className="text-[8.5px] font-bold uppercase tracking-[.14em]" style={{ color: MG.cyanText }}>
          joined record
        </span>
      </div>

      {loading && (
        <div className="text-[10.5px]" style={{ color: MG.textMute }}>walking the joins…</div>
      )}

      {p && empty && (
        <div className="text-[10.5px]" style={{ color: MG.textMute }}>
          no joined data yet — the documents haven&apos;t been annotated or extracted here
        </div>
      )}

      {p && !empty && (
        <div className="flex flex-col gap-1.5 text-[10.5px]" style={{ color: MG.text }}>
          {p.occurrences.map((o, i) => (
            <div key={`o${i}`}>
              <span style={{ color: MG.textMute }}>schematic · </span>
              page {o.page}
              {o.location ? <> · <span style={{ color: MG.cyanText }}>({o.location})</span></> : null}
              {o.part_number ? <> · part {o.part_number}</> : null}
            </div>
          ))}
          {p.terminal_count > 0 && (
            <div>
              <span style={{ color: MG.textMute }}>wires · </span>
              {p.terminal_count} terminal{p.terminal_count === 1 ? "" : "s"}
              {nets ? <> — <span className="font-mono">{nets}</span></> : null}
            </div>
          )}
          {p.parts_rows.map((r, i) => (
            <div key={`p${i}`}>
              <span style={{ color: MG.textMute }}>parts list · </span>
              {r.description || r.symbol_text}
              {r.part_number ? <> — <span className="font-mono">{r.part_number}</span></> : null}
              {r.quantity ? <> · qty {r.quantity}</> : null}
              {r.location ? <> · [{r.location}]</> : null}
            </div>
          ))}
          {p.cables.map((c, i) => (
            <div key={`c${i}`}>
              <span style={{ color: MG.textMute }}>cable · </span>
              <span className="font-mono">{c.cable_number}</span>
              {c.origination || c.termination
                ? <> · {c.origination} → {c.termination}</> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
