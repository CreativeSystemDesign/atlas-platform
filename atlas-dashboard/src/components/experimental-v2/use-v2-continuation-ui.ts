"use client";

// Continuation UI for the Experimental v2 screen (extracted from
// experimental-v2-screen in the 2026-07-11 modularity pass): the registry
// sightings push, cross-page status derivation (symbol-chip detection +
// continuationStatuses), the wormhole jump handlers, and the chip
// copy/move/edit graph handlers. Logic is verbatim from the screen.
//
// ORDER CONTRACT: call this hook where the old block sat — after
// useV2NeonGraph, BEFORE the page-change reset effect. graphReady is keyed
// to the page (ready = readyKey === storageKey, derived at render), so the
// pending-select effect can only fire in a commit where the destination
// graph has actually landed — never the flip commit where the reset effect
// nulls selection. Keep the placement anyway: it's the documented home for
// this block, and same-commit effect ordering is observable here if the
// readiness contract ever regresses.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useV2ContinuationRegistry } from "./use-v2-continuation-registry";
import { continuationStatuses, pageLabels, pageSightings, type ContStatus, type ResolvedLink } from "./v2-continuation-links";
import { copyContinuationTo, moveContinuation, updateContinuation } from "./v2-graph-ops";
import type { V2Graph, V2CableRegistry } from "./experimental-v2-types";
import type { PageGeometry } from "./v2-snapping";
import type { V2Settings } from "./v2-settings";
import type { Point } from "./v2-bridge-types";

export function useV2ContinuationUi({
  projectId,
  documentId,
  graph,
  graphReady,
  sheetRef,
  pageNum,
  setPageNum,
  setSelectedId,
  geometry,
  cableRegistry,
  updateGraph,
  contSnapPx,
  settingsRef,
  graphRef,
  showToastRef,
}: {
  projectId: string;
  documentId: string;
  graph: V2Graph;
  graphReady: boolean;
  sheetRef: string | null;
  pageNum: number;
  setPageNum: (page: number) => void;
  setSelectedId: (id: string) => void;
  geometry: PageGeometry | null;
  cableRegistry: V2CableRegistry;
  updateGraph: (updater: (draft: V2Graph) => void) => void;
  contSnapPx: number;
  settingsRef: { current: V2Settings };
  graphRef: { current: V2Graph };
  showToastRef: { current: ((msg: string) => void) | null };
}) {
  // Continuation registry (Shane's green-chip design, 2026-07-11): this page
  // pushes its anchored-continuation SIGHTINGS; reciprocal sightings across
  // pages pair into RESOLVED links (derived, never stored — can't go stale).
  const { registry: contRegistry, ready: contRegistryReady, pushPage: pushContSightings } =
    useV2ContinuationRegistry(projectId, documentId);
  useEffect(() => {
    // Only a settled, Neon-loaded graph may speak for the page (a cold
    // localStorage cache pushing over a fresher entry was the cable
    // registry's stale-canvas lesson). graphReady is keyed to the page, so
    // the flip commit — old graph/sheetRef under the new pageNum — is gated
    // out too (stale-flip bug, 2026-07-11).
    if (!graphReady || !contRegistryReady) return;
    pushContSightings(pageNum, sheetRef, pageSightings(graph), pageLabels(graph));
  }, [graph, graphReady, contRegistryReady, pageNum, sheetRef, pushContSightings]);
  // Click-through (the wormhole): jump to the counterpart page and select its
  // chip once that page's graph lands.
  const pendingSelectRef = useRef<{ page: number; id: string } | null>(null);
  const jumpToCounterpart = useCallback((link: ResolvedLink) => {
    pendingSelectRef.current = { page: link.page, id: link.contId };
    setPageNum(link.page);
  }, [setPageNum]);
  // Mismatch investigation: jump to the annotated destination page even
  // without a counterpart to select — the fix lives over there (or here).
  const jumpToPage = useCallback((page: number) => {
    pendingSelectRef.current = null;
    setPageNum(page);
  }, [setPageNum]);
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (graphReady && pending && pending.page === pageNum) {
      pendingSelectRef.current = null;
      setSelectedId(pending.id);
    }
  }, [graphReady, pageNum, setSelectedId]);

  // Chips sitting ON a printed ref token are SYMBOL annotations (Shane,
  // 2026-07-11): they document the print (training data) and make no
  // electrical claim — no status color, no alarm.
  const symbolChipIds = useMemo(() => {
    const out = new Set<string>();
    if (!geometry) return out;
    const REFISH = /^(?:\d{1,3}|\d{1,3}\s*[/-]\s*\d{1,3})$/;
    for (const c of graph.continuations) {
      if (c.target) continue;
      for (const t of geometry.texts) {
        const token = t.text.trim();
        if (!REFISH.test(token)) continue;
        const dx = t.center.x - c.point.x;
        const dy = t.center.y - c.point.y;
        if (dx * dx + dy * dy <= 28 * 28) { out.add(c.id); break; }
      }
    }
    return out;
  }, [graph.continuations, geometry]);
  const contStatuses: Map<string, ContStatus> = useMemo(() => {
    if (!contRegistryReady) return new Map();
    return continuationStatuses(contRegistry, pageNum, sheetRef, graph, cableRegistry, symbolChipIds);
  }, [contRegistry, contRegistryReady, pageNum, sheetRef, graph, cableRegistry, symbolChipIds]);

  // Drag-a-continuation: the graph op snaps to the nearest wire endpoint and
  // target-binds there (or clears a stale binding on an open-space drop).
  // Shift+drag copy commit (Shane, 2026-07-11): mint a bound copy of the
  // dragged chip at the drop point (wire end > cable > component) and select
  // the copy — it's the link chip he'll want to inspect next.
  const onContinuationCopy = useCallback(
    (sourceId: string, point: Point) => {
      const src = graphRef.current.continuations.find((c) => c.id === sourceId);
      if (!src) return;
      const id = `cont-${crypto.randomUUID()}`;
      updateGraph((draft) => { copyContinuationTo(draft, sourceId, point, id, settingsRef.current.contSnapPx); });
      setSelectedId(id);
      const ref = src.rawRef ?? `${src.sheet ?? "?"}/${src.zone ?? "?"}`;
      showToastRef.current?.(`${ref} copy placed — bound by what it touches`);
    },
    [updateGraph, setSelectedId, graphRef, settingsRef, showToastRef]
  );
  const onContinuationMove = useCallback(
    (contId: string, point: Point) => {
      updateGraph((draft) => { moveContinuation(draft, contId, point, contSnapPx); });
    },
    [updateGraph, contSnapPx]
  );

  const updateContinuationRef = useCallback(
    (id: string, patch: { sheet?: string; zone?: string }) =>
      updateGraph((draft) => updateContinuation(draft, id, patch)),
    [updateGraph]
  );

  return { contStatuses, jumpToCounterpart, jumpToPage, onContinuationCopy, onContinuationMove, updateContinuationRef };
}
