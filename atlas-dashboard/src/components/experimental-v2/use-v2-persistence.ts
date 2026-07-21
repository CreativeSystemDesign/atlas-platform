"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { type V2Cable, type V2Graph, EMPTY_V2_GRAPH } from "./experimental-v2-types";
import { type RawPageMetadata } from "./v2-snapping";

// Per-page autosave for the Experimental v2 overlay. localStorage is the first
// backing store; Phase 3+ can swap loadV2Graph/saveV2Graph for the workbench
// annotation endpoints without touching the screen.

const STORAGE_PREFIX = "atlas.v2graph";

export function v2StorageKey(
  projectId: string,
  documentId: string,
  page: number
): string {
  return `${STORAGE_PREFIX}:${projectId}:${documentId}:${page}`;
}

function isGraph(value: unknown): value is V2Graph {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.nodes) && Array.isArray(v.ports) && Array.isArray(v.edges);
}

export function loadV2Graph(key: string): V2Graph | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isGraph(parsed)) return null;
    // Back-compat: graphs saved before continuations existed.
    if (!Array.isArray(parsed.continuations)) parsed.continuations = [];
    return parsed;
  } catch {
    return null;
  }
}

export function saveV2Graph(key: string, graph: V2Graph): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(graph));
  } catch {
    // Quota/serialization failures are non-fatal for drafting.
  }
}

// Debounced autosave. Skips the very first run for a given key so loading a page
// doesn't immediately rewrite what we just read.
export function useV2Autosave(key: string, graph: V2Graph, delayMs = 600): void {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    // On key change (page switch), don't save until the next real edit.
    if (lastKey.current !== key) {
      lastKey.current = key;
      return;
    }
    const handle = setTimeout(() => saveV2Graph(key, graph), delayMs);
    return () => clearTimeout(handle);
  }, [key, graph, delayMs]);
}

export { EMPTY_V2_GRAPH };

// --- Neon-backed graph sync (source of truth) ---------------------------------
// The v2 graph lives in Neon (schematic_v2_graph, a sibling to the other
// annotation workspaces). The localStorage store above is only an offline cache.
// On page load we show the cache instantly, then reconcile with Neon — which
// seeds from the legacy digital-twin annotations when a page has no v2 graph yet.
// Edits autosave to BOTH the cache and Neon.


// Cables briefly shipped as traced polylines before Shane's bbox ruling
// (YOLO training data is bboxes) — normalize legacy instances on load.
function normalizeCable(c: unknown): V2Cable {
  const cab = c as { bbox?: unknown; path?: { x: number; y: number }[] };
  if (cab && !cab.bbox && Array.isArray(cab.path) && cab.path.length > 0) {
    const xs = cab.path.map((p) => p.x), ys = cab.path.map((p) => p.y);
    const x = Math.min(...xs) - 8, y = Math.min(...ys) - 8;
    return { ...cab, path: undefined, bbox: { x, y, width: Math.max(...xs) - x + 16, height: Math.max(...ys) - y + 16 } } as unknown as V2Cable;
  }
  return c as V2Cable;
}

function pickGraph(raw: unknown): V2Graph {
  const g = (raw ?? {}) as Partial<V2Graph>;
  return {
    nodes: Array.isArray(g.nodes) ? g.nodes : [],
    ports: Array.isArray(g.ports) ? g.ports : [],
    edges: Array.isArray(g.edges) ? g.edges : [],
    continuations: Array.isArray(g.continuations) ? g.continuations : [],
    grounds: Array.isArray(g.grounds) ? g.grounds : [],
    cables: Array.isArray(g.cables) ? g.cables.map(normalizeCable) : [],
  };
}

export async function fetchV2GraphFromNeon(
  projectId: string,
  documentId: string,
  page: number,
  opts: { seedFromLegacy?: boolean } = {}
): Promise<{ graph: V2Graph; seededFromLegacy: boolean; sheetRef: string | null } | null> {
  const seed = opts.seedFromLegacy === false ? "false" : "true";
  const url =
    `${agentBaseUrl()}/experimental-v2/graph` +
    `?page_num=${page}` +
    `&project_id=${encodeURIComponent(projectId)}` +
    `&document_id=${encodeURIComponent(documentId)}` +
    `&seed_from_legacy=${seed}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      graph: pickGraph(data.graph),
      seededFromLegacy: Boolean(data.seededFromLegacy),
      // The page's printed sheet fraction ("5/207") from the sheet index —
      // sheet != page; continuation resolution keys on this.
      sheetRef: typeof data.sheetRef === "string" ? data.sheetRef : null,
    };
  } catch {
    return null; // offline — caller keeps the localStorage cache
  }
}

export async function pushV2GraphToNeon(
  projectId: string,
  documentId: string,
  page: number,
  graph: V2Graph
): Promise<boolean> {
  try {
    const res = await fetch(`${agentBaseUrl()}/experimental-v2/graph`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        documentId,
        pageNum: page,
        nodes: graph.nodes,
        ports: graph.ports,
        edges: graph.edges,
        continuations: graph.continuations,
        grounds: graph.grounds ?? [],
        cables: graph.cables ?? [],
        source: "human",
      }),
    });
    return res.ok;
  } catch {
    return false; // offline — the localStorage cache holds until the next sync
  }
}

// Best-effort flush on page hide / refresh / close: sendBeacon survives an
// unloading document where a normal fetch would be cancelled. The route accepts
// POST as well as PUT precisely so the beacon (POST-only) can reach it.
export function beaconV2GraphToNeon(
  projectId: string,
  documentId: string,
  page: number,
  graph: V2Graph
): void {
  try {
    if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
    const body = JSON.stringify({
      projectId,
      documentId,
      pageNum: page,
      nodes: graph.nodes,
      ports: graph.ports,
      edges: graph.edges,
      continuations: graph.continuations,
      grounds: graph.grounds ?? [],
      cables: graph.cables ?? [],
      source: "human",
    });
    navigator.sendBeacon(
      `${agentBaseUrl()}/experimental-v2/graph`,
      new Blob([body], { type: "application/json" })
    );
  } catch {
    /* unloading — nothing more we can do */
  }
}

// Load-from-Neon + debounced save-to-Neon for one page, offline-first. Owns the
// graph read/write; the screen keeps undo/redo. Returns whether the page was
// seeded from the legacy digital-twin annotations (nothing saved in v2 yet),
// plus `ready`: true once the authoritative load settled FOR THIS PAGE —
// callers must queue programmatic graph mutations until then (the load
// REPLACES the whole graph, clobbering anything applied mid-flight).
// `ready` is derived at render time from a key comparison, never reset in an
// effect: a boolean flipped inside this hook's own effect lands one commit too
// late, and the page-flip commit then runs consumer effects with the OLD
// page's graph under the NEW page number (stale-flip bug, 2026-07-11 — it hit
// the continuation sightings push, the wormhole pending-select, and the cable
// auto-link).
export function useV2NeonGraph(params: {
  projectId: string;
  documentId: string;
  page: number;
  storageKey: string;
  graph: V2Graph;
  setGraph: (graph: V2Graph) => void;
}): { seededFromLegacy: boolean; ready: boolean; sheetRef: string | null } {
  const { projectId, documentId, page, storageKey, graph, setGraph } = params;
  const readyRef = useRef(false);
  const lastSerialized = useRef<string>("");
  const [seededFromLegacy, setSeeded] = useState(false);
  // Readiness is keyed by the page's storage identity and compared at RENDER
  // time: on the commit where the page flips, readyKey still names the OLD
  // page, so every consumer sees ready=false in that same commit — no window
  // where a stale true pairs with the new pageNum.
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const ready = readyKey === storageKey;
  const [sheetRef, setSheetRef] = useState<string | null>(null);
  // Latest-wins retrying saver: the newest graph is always queued in
  // pendingSaveRef; the saver pushes it and RETRIES until Neon acks, so a
  // backend restart / network blip can never silently drop an edit (the bug
  // that lost Shane's grounds + the copilot's fixes on refresh, 2026-07-08).
  // The queued item carries its OWN page/project so a retry that outlives a page
  // flip still lands on the sheet it was authored for — never the current one.
  type QueuedSave = { graph: V2Graph; projectId: string; documentId: string; page: number };
  const pendingSaveRef = useRef<QueuedSave | null>(null);
  const savingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = useCallback(async () => {
    if (savingRef.current) return; // single-flight; the loop drains the latest
    savingRef.current = true;
    try {
      while (pendingSaveRef.current) {
        const q = pendingSaveRef.current;
        const ok = await pushV2GraphToNeon(q.projectId, q.documentId, q.page, q.graph);
        if (ok) {
          // Only clear if a newer edit didn't arrive mid-flight.
          if (pendingSaveRef.current === q) pendingSaveRef.current = null;
          continue;
        }
        // Failed (restart / offline): keep it queued and retry with backoff.
        savingRef.current = false;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => void flushSave(), 1500);
        return;
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  // Load on page/key change: instant cache, then authoritative Neon.
  useEffect(() => {
    readyRef.current = false;
    let cancelled = false;
    const cached = loadV2Graph(storageKey) ?? EMPTY_V2_GRAPH;
    setGraph(cached);
    lastSerialized.current = JSON.stringify(cached);
    setSeeded(false);
    // The old page's sheet fraction must never speak for this one — a failed
    // fetch (offline) would otherwise leave it paired with the new pageNum.
    setSheetRef(null);
    fetchV2GraphFromNeon(projectId, documentId, page)
      .then((result) => {
        if (cancelled || !result) return;
        setGraph(result.graph);
        lastSerialized.current = JSON.stringify(result.graph);
        setSeeded(result.seededFromLegacy);
        setSheetRef(result.sheetRef);
        saveV2Graph(storageKey, result.graph); // refresh offline cache
      })
      .finally(() => {
        if (!cancelled) {
          readyRef.current = true;
          setReadyKey(storageKey);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Save IMMEDIATELY on every real edit (Shane 2026-07-08: "any change needs to
  // save immediately") — no debounce. The offline cache is written synchronously
  // and the Neon push is queued to the retrying saver, so a failed write is
  // re-sent until it lands rather than silently lost. Gated on readyRef so the
  // initial load-reconcile never clobbers Neon with a stale cache.
  useEffect(() => {
    if (!readyRef.current) return;
    const serialized = JSON.stringify(graph);
    if (serialized === lastSerialized.current) return;
    lastSerialized.current = serialized;
    saveV2Graph(storageKey, graph); // offline cache — synchronous, never dropped
    pendingSaveRef.current = { graph, projectId, documentId, page }; // enqueue latest for Neon
    void flushSave(); // fire now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, storageKey]);

  // Flush the latest edit if the tab is hidden/refreshed/closed while a push is
  // still pending — sendBeacon survives an unloading document.
  useEffect(() => {
    const flushOnHide = () => {
      const q = pendingSaveRef.current;
      if (!q) return;
      beaconV2GraphToNeon(q.projectId, q.documentId, q.page, q.graph);
    };
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushOnHide();
    });
    return () => {
      window.removeEventListener("pagehide", flushOnHide);
    };
  }, []);

  return { seededFromLegacy, ready, sheetRef };
}

// --- Geometry cache (Neon-derived, persisted for offline use) -----------------
// The PDF vector geometry's source of truth is Neon (served via /metadata). We
// cache the raw payload locally so tracing keeps working offline / on fragile
// networks until the Neon connection is restored. The snap index is rebuilt
// from this raw payload on load (it isn't itself serializable).

const GEOMETRY_PREFIX = "atlas.v2geometry";

export type CachedMetadata = { meta: RawPageMetadata; derivedAt: string };

export function v2GeometryKey(documentId: string, page: number): string {
  return `${GEOMETRY_PREFIX}:${documentId}:${page}`;
}

export function loadCachedMetadata(key: string): CachedMetadata | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.meta &&
      typeof parsed.derivedAt === "string"
    ) {
      return parsed as CachedMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCachedMetadata(key: string, meta: RawPageMetadata): string {
  const derivedAt = new Date().toISOString();
  if (typeof window === "undefined") return derivedAt;
  try {
    window.localStorage.setItem(key, JSON.stringify({ meta, derivedAt }));
  } catch {
    // Quota failures are non-fatal — geometry just won't be available offline.
  }
  return derivedAt;
}
