"use client";

// The document-level cable registry (Shane's design, ratified 2026-07-10):
// cable NAME -> conductor roster + pages drawn on. Same name on any page IS
// the same physical cable, so the roster can't live in the per-page graphs —
// this is its own Neon-backed store (schematic_v2_cable_registry), with
// localStorage as the offline cache, exactly like the page graphs.

import { useCallback, useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import type { V2CableRegistry } from "./experimental-v2-types";

const KEY_PREFIX = "atlas.v2cables";

function cacheKey(projectId: string, documentId: string): string {
  return `${KEY_PREFIX}:${projectId}:${documentId}`;
}

function loadCache(key: string): V2CableRegistry {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as V2CableRegistry) : {};
  } catch {
    return {};
  }
}

export function useV2CableRegistry(projectId: string, documentId: string): {
  registry: V2CableRegistry;
  ready: boolean;
  updateRegistry: (updater: (draft: V2CableRegistry) => void) => void;
} {
  const key = cacheKey(projectId, documentId);
  const [registry, setRegistry] = useState<V2CableRegistry>(() => loadCache(key));
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache-first, then reconcile with Neon (the store of record).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${agentBaseUrl()}/experimental-v2/cables?project_id=${encodeURIComponent(projectId)}&document_id=${encodeURIComponent(documentId)}`
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.cables && typeof data.cables === "object") {
            setRegistry(data.cables as V2CableRegistry);
            try { window.localStorage.setItem(key, JSON.stringify(data.cables)); } catch { /* quota */ }
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

  const updateRegistry = useCallback(
    (updater: (draft: V2CableRegistry) => void) => {
      setRegistry((prev) => {
        const next: V2CableRegistry = JSON.parse(JSON.stringify(prev));
        updater(next);
        try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          fetch(`${agentBaseUrl()}/experimental-v2/cables`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, documentId, cables: next }),
          }).catch(() => { /* offline — cache holds */ });
        }, 800);
        return next;
      });
    },
    [key, projectId, documentId]
  );

  return { registry, ready, updateRegistry };
}
