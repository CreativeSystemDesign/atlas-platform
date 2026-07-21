"use client";

// Flag-pill triage for the Experimental v2 screen (extracted from
// experimental-v2-screen in the 2026-07-11 modularity pass): hide (mute) is
// a per-page VIEW preference — legitimately localStorage (not annotation
// truth, which lives in Neon; see the offline-first contract). Check
// (dispose) rules a flag a false positive: the highlight is removed directly
// and the disposition persists server-side (shane-panel provenance) so the
// server's next push stays the sole source of truth. Logic is verbatim from
// the screen.

import { useCallback, useEffect, useMemo, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import type { BridgeHighlight } from "./v2-bridge-types";

// A flag's stable identity across audits: its rule + the element it stands on
// (matches the server's ticket key rule|element_id).
const flagKey = (h: BridgeHighlight) => `${h.rule ?? "?"}|${h.elementId ?? "?"}`;
// Hidden flags are a per-page VIEW preference — legitimately localStorage (not
// annotation truth, which lives in Neon; see the offline-first contract).
const hiddenFlagsStorageKey = (documentId: string, page: number) => `v2-hidden-flags:${documentId}:${page}`;
function loadHiddenFlags(documentId: string, page: number): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(hiddenFlagsStorageKey(documentId, page));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveHiddenFlags(documentId: string, page: number, keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(hiddenFlagsStorageKey(documentId, page), JSON.stringify([...keys]));
  } catch {
    /* quota / storage disabled — a lost view-pref is harmless */
  }
}

export function useV2FlagTriage({
  documentId,
  pageNum,
  highlights,
  showToast,
  addHighlight,
  removeHighlight,
}: {
  documentId: string;
  pageNum: number;
  highlights: BridgeHighlight[];
  showToast: (msg: string) => void;
  addHighlight: (h: Omit<BridgeHighlight, "key">) => void;
  removeHighlight: (key: number) => void;
}) {
  // Flag triage state: hiddenFlags = per-page view mutes (persisted). Dismissed
  // (checked-off) flags are NOT tracked in a session set — disposeFlag removes the
  // highlight directly, so the server's next push is the sole source of truth (a
  // stale set would otherwise re-hide a flag the server legitimately RESURRECTS
  // when its element moves).
  const [hiddenFlags, setHiddenFlags] = useState<Set<string>>(new Set());
  useEffect(() => { setHiddenFlags(loadHiddenFlags(documentId, pageNum)); }, [documentId, pageNum]);

  // --- Flag pill actions: hide (mute) + check (false positive) ---------------
  // Hide: mute this flag from the canvas but leave it live for the copilot's
  // audit. Reversible via the "hidden" chip.
  const hideFlag = useCallback((h: BridgeHighlight) => {
    setHiddenFlags((prev) => {
      const next = new Set(prev);
      next.add(flagKey(h));
      saveHiddenFlags(documentId, pageNum, next);
      return next;
    });
  }, [documentId, pageNum]);
  const unhideAllFlags = useCallback(() => {
    setHiddenFlags(() => { saveHiddenFlags(documentId, pageNum, new Set()); return new Set(); });
  }, [documentId, pageNum]);
  // Check: rule this flag a false positive. Remove the highlight directly (the
  // server's next push, minus this disposed flag, is authoritative), then persist
  // the disposition server-side (shane-panel provenance) so it never gates or
  // re-paints and lands in the calibration corpus. On failure, put the flag back
  // — never silently swallow a real defect.
  const disposeFlag = useCallback((h: BridgeHighlight) => {
    if (!h.rule || !h.elementId) return;
    removeHighlight(h.key);
    void fetch(`${agentBaseUrl()}/experimental-v2/bridge/dispose-flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule: h.rule, element_id: h.elementId, note: h.note ?? null, page: pageNum }),
    })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .catch(() => {
        showToast("Couldn't save that false-positive — putting the flag back");
        addHighlight(h); // addHighlight assigns a fresh key; the stale one is ignored
      });
  }, [pageNum, showToast, removeHighlight, addHighlight]);
  // Only hidden (muted) flags are filtered here; a dismissed flag is already gone
  // from `highlights` (removed directly), so the server push stays authoritative.
  const visibleHighlights = useMemo(
    () => highlights.filter((h) => h.kind !== "flag" || !hiddenFlags.has(flagKey(h))),
    [highlights, hiddenFlags]
  );
  const hiddenFlagCount = useMemo(
    () => highlights.reduce((n, h) => (h.kind === "flag" && hiddenFlags.has(flagKey(h)) ? n + 1 : n), 0),
    [highlights, hiddenFlags]
  );

  return { visibleHighlights, hiddenFlagCount, hideFlag, unhideAllFlags, disposeFlag };
}
