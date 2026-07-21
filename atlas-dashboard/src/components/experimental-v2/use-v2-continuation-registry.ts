"use client";

// The document-level continuation registry (Shane's green-chip design,
// 2026-07-11): page -> {sheet, sightings}. The exact machinery of the cable
// registry — Neon store of record, localStorage offline cache — but keyed by
// PAGE, so a canvas only ever writes its own entry and concurrent canvases
// cannot clobber each other. Resolution (the green) is derived in
// v2-continuation-links, never stored.

import { useCallback, useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import type { ContRegistry, ContSighting } from "./v2-continuation-links";

const KEY_PREFIX = "atlas.v2conts";

function cacheKey(projectId: string, documentId: string): string {
  return `${KEY_PREFIX}:${projectId}:${documentId}`;
}

function loadCache(key: string): ContRegistry {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as ContRegistry) : {};
  } catch {
    return {};
  }
}

export function useV2ContinuationRegistry(projectId: string, documentId: string): {
  registry: ContRegistry;
  ready: boolean;
  pushPage: (pageNum: number, sheet: string | null, sightings: ContSighting[], labels: string[]) => void;
} {
  const key = cacheKey(projectId, documentId);
  const [registry, setRegistry] = useState<ContRegistry>(() => loadCache(key));
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushed = useRef<string | null>(null);

  // Cache-first, then reconcile with Neon (the store of record).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${agentBaseUrl()}/experimental-v2/continuations?project_id=${encodeURIComponent(projectId)}&document_id=${encodeURIComponent(documentId)}`
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.pages && typeof data.pages === "object") {
            setRegistry(data.pages as ContRegistry);
            try { window.localStorage.setItem(key, JSON.stringify(data.pages)); } catch { /* quota */ }
          }
        }
      } catch {
        /* offline — the cache holds until the next sync */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, documentId, key]);

  const pushPage = useCallback(
    (pageNum: number, sheet: string | null, sightings: ContSighting[], labels: string[]) => {
      const entry = { sheet, sightings, labels };
      const fingerprint = `${pageNum}:${JSON.stringify(entry)}`;
      if (fingerprint === lastPushed.current) return; // unchanged — no write
      lastPushed.current = fingerprint;
      setRegistry((prev) => {
        const next: ContRegistry = { ...prev, [String(pageNum)]: entry };
        try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
        return next;
      });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        fetch(`${agentBaseUrl()}/experimental-v2/continuations/page`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, documentId, pageNum, entry }),
        }).catch(() => { /* offline — cache holds */ });
      }, 800);
    },
    [key, projectId, documentId]
  );

  return { registry, ready, pushPage };
}
