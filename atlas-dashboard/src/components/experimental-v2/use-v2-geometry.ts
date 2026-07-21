"use client";

import { useEffect, useMemo, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { DOCUMENT_ID } from "../extraction-workbench/studio-types";
import {
  type PageGeometry,
  type RawPageMetadata,
  buildPageGeometry,
} from "./v2-snapping";
import { type DetectOptions } from "./v2-detect";
import {
  v2GeometryKey,
  loadCachedMetadata,
  saveCachedMetadata,
} from "./use-v2-persistence";

// PDF vector geometry. Source of truth is Neon (served via /metadata); we cache
// the raw payload locally for offline use. Detection (terminals/components) is
// rebuilt from the cached raw metadata whenever the detection settings change —
// no refetch — so tuning is instant.

const rawCache = new Map<number, { meta: RawPageMetadata; derivedAt: string }>();

function metadataUrl(page: number): string {
  return `${agentBaseUrl()}/workbench/documents/${DOCUMENT_ID}/pages/${page}/metadata`;
}

function isRawMetadata(value: unknown): value is RawPageMetadata {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.scale === "number" && Array.isArray(v.shapes) && Array.isArray(v.text_blocks);
}

export type GeometrySource = "live" | "cache" | null;

export type GeometryState = {
  geometry: PageGeometry | null;
  rawMeta: RawPageMetadata | null;
  loading: boolean;
  error: string | null;
  source: GeometrySource;
  derivedAt: string | null;
};

export function useV2Geometry(
  page: number,
  enabled: boolean,
  detect: DetectOptions
): GeometryState {
  const [raw, setRaw] = useState<{
    meta: RawPageMetadata | null;
    loading: boolean;
    error: string | null;
    source: GeometrySource;
    derivedAt: string | null;
  }>({ meta: null, loading: false, error: null, source: null, derivedAt: null });

  useEffect(() => {
    if (!enabled) {
      setRaw({ meta: null, loading: false, error: null, source: null, derivedAt: null });
      return;
    }
    const cached = rawCache.get(page);
    if (cached) {
      setRaw({ meta: cached.meta, loading: false, error: null, source: "live", derivedAt: cached.derivedAt });
      return;
    }

    let cancelled = false;
    setRaw((r) => ({ ...r, loading: true, error: null }));
    const storageKey = v2GeometryKey(DOCUMENT_ID, page);

    const fallbackToCache = (reason: string) => {
      const disk = loadCachedMetadata(storageKey);
      if (disk) {
        rawCache.set(page, { meta: disk.meta, derivedAt: disk.derivedAt });
        if (!cancelled) setRaw({ meta: disk.meta, loading: false, error: null, source: "cache", derivedAt: disk.derivedAt });
      } else if (!cancelled) {
        setRaw({ meta: null, loading: false, error: reason, source: null, derivedAt: null });
      }
    };

    (async () => {
      try {
        const res = await fetch(metadataUrl(page));
        if (!res.ok) throw new Error(`metadata ${res.status}`);
        const json: unknown = await res.json();
        if (!isRawMetadata(json)) throw new Error("unexpected metadata shape");
        const derivedAt = saveCachedMetadata(storageKey, json);
        rawCache.set(page, { meta: json, derivedAt });
        if (!cancelled) setRaw({ meta: json, loading: false, error: null, source: "live", derivedAt });
      } catch (err) {
        fallbackToCache(err instanceof Error ? err.message : "failed to load geometry");
      }
    })();

    return () => { cancelled = true; };
  }, [page, enabled]);

  // Rebuild geometry whenever the raw payload or the detection settings change.
  const geometry = useMemo(
    () => (raw.meta && enabled ? buildPageGeometry(raw.meta, detect) : null),
    [raw.meta, enabled, detect]
  );

  return {
    geometry,
    rawMeta: raw.meta,
    loading: raw.loading,
    error: raw.error,
    source: raw.source,
    derivedAt: raw.derivedAt,
  };
}
