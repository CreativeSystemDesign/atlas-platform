"use client";

// Page seal (Shane, 2026-07-08): "this page is now gold — how can I seal it?"
// The server's gold-master page-lock (Slate 4.6b) refuses every copilot
// mutation; this hook powers the header's Seal button and the screen's local
// edit gate so a sealed page is truly read-only until Shane unseals it.
// Status refreshes on page change and after every seal/unseal action.

import { useCallback, useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";

export type PageSealState = {
  loading: boolean;
  sealed: boolean;
  provenance: string | null;
  /** Audit clean (post-disposition)? null = unknown (canvas not on this page). */
  clean: boolean | null;
  tableOpen: number;
  /** Clean + Table empty + not already sealed. */
  sealable: boolean;
  /** Latest gold snapshot version in Neon (null = never sealed). */
  goldVersion: number | null;
  /** Drift tripwire: true = the live graph differs from the gold snapshot. */
  drift: boolean | null;
};

const IDLE: PageSealState = {
  loading: true, sealed: false, provenance: null, clean: null, tableOpen: 0,
  sealable: false, goldVersion: null, drift: null,
};

export function useV2PageSeal(page: number, pollMs = 20_000) {
  const [state, setState] = useState<PageSealState>(IDLE);
  const pageRef = useRef(page);
  pageRef.current = page;

  const refresh = useCallback(async () => {
    const p = pageRef.current;
    try {
      const res = await fetch(`${agentBaseUrl()}/experimental-v2/copilot/page-lock?page=${p}`);
      if (!res.ok) return;
      const d = await res.json();
      if (pageRef.current !== p) return; // page flipped mid-flight
      setState({
        loading: false,
        sealed: Boolean(d.locked),
        provenance: d.provenance ?? null,
        clean: d.clean ?? null,
        tableOpen: Number(d.table_open ?? 0),
        sealable: Boolean(d.sealable),
        goldVersion: d.gold?.version ?? null,
        drift: d.drift ?? null,
      });
    } catch {
      /* offline — keep last state */
    }
  }, []);

  useEffect(() => {
    setState(IDLE);
    void refresh();
    const t = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(t);
  }, [page, refresh, pollMs]);

  const setSealed = useCallback(
    async (locked: boolean, reason: string): Promise<{ ok: boolean; gold?: { version: number } | null; error?: string } | null> => {
      try {
        const res = await fetch(`${agentBaseUrl()}/experimental-v2/copilot/page-lock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page: pageRef.current, locked, reason }),
        });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      } finally {
        void refresh();
      }
    },
    [refresh]
  );

  return { ...state, refresh, setSealed };
}
