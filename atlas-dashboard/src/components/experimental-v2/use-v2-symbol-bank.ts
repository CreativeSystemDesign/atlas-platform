"use client";

import { useEffect, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { DOCUMENT_ID } from "../extraction-workbench/studio-types";
import type { SymbolBankEntry } from "../extraction-workbench/studio-types";

// The document's symbol bank (known component marks). Neon-derived; cached
// locally for offline use, mirroring the geometry cache.

const CACHE_KEY = `atlas.v2symbolbank:${DOCUMENT_ID}`;
let memCache: SymbolBankEntry[] | null = null;

function loadCache(): SymbolBankEntry[] | null {
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

function saveCache(entries: SymbolBankEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* non-fatal */
  }
}

export function useV2SymbolBank(enabled: boolean): SymbolBankEntry[] {
  const [entries, setEntries] = useState<SymbolBankEntry[]>(memCache ?? []);

  useEffect(() => {
    if (!enabled) return;
    if (memCache) {
      setEntries(memCache);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${agentBaseUrl()}/workbench/documents/${DOCUMENT_ID}/symbol-bank`);
        if (!res.ok) throw new Error(`symbol-bank ${res.status}`);
        const json = await res.json();
        const symbols: SymbolBankEntry[] = Array.isArray(json?.symbols) ? json.symbols : [];
        memCache = symbols;
        saveCache(symbols);
        if (!cancelled) setEntries(symbols);
      } catch {
        // Offline: fall back to the last cached bank.
        const cached = loadCache();
        if (cached) {
          memCache = cached;
          if (!cancelled) setEntries(cached);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return entries;
}
