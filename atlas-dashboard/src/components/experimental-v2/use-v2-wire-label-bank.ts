"use client";

import { useEffect, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { DOCUMENT_ID } from "../extraction-workbench/studio-types";
import type { WireLabelBankEntry } from "../extraction-workbench/studio-types";

// The document's wire-label bank (cable-list wire numbers with endpoints).
// Neon-derived; cached locally for offline use, mirroring the symbol bank.

const CACHE_KEY = `atlas.v2wirelabelbank:${DOCUMENT_ID}`;
let memCache: WireLabelBankEntry[] | null = null;

function loadCache(): WireLabelBankEntry[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCache(entries: WireLabelBankEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* non-fatal */
  }
}

export function useV2WireLabelBank(enabled: boolean): WireLabelBankEntry[] {
  const [entries, setEntries] = useState<WireLabelBankEntry[]>(() => memCache ?? loadCache() ?? []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${agentBaseUrl()}/workbench/documents/${DOCUMENT_ID}/wire-label-bank`);
        if (!res.ok) throw new Error(`wire-label-bank ${res.status}`);
        const data = await res.json();
        const fresh: WireLabelBankEntry[] = Array.isArray(data?.wire_labels) ? data.wire_labels : [];
        if (!cancelled && fresh.length > 0) {
          memCache = fresh;
          saveCache(fresh);
          setEntries(fresh);
        }
      } catch {
        /* offline: cached entries stand */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return entries;
}
