"use client";

// Linked continuations for the 3D machine graph (Shane, 2026-07-11: "look at
// the continuations on this page that have links and bring that onto the
// scene, one page at a time"). Resolution REUSES the canvas's pure logic
// (v2-continuation-links) against the same registry — never a second
// implementation of the green-chip rules.

import { useEffect, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import {
  continuationStatuses,
  sheetNumberOf,
  type ContRegistry,
} from "../experimental-v2/v2-continuation-links";
import {
  fetchPageEnvelope,
  graphBounds,
  type Mg3dGraph,
} from "./use-mg3d-graph";

export type LinkedSheet = {
  pageNum: number;
  sheetRef: string | null;
  graph: Mg3dGraph;
  offsetX: number; // page-space x shift placing this sheet beside the primary
};

export type ContArc = {
  // Raw page-space endpoints; the scene applies each sheet's live offset so
  // arcs stay glued to their chips while Shane drags pages around.
  from: { x: number; y: number };
  fromPage: number;
  to: { x: number; y: number };
  toPage: number;
  net: string;
  ref: string;
  destSheet: string;
};

type StatusGraph = Parameters<typeof continuationStatuses>[3];

/** Resolved cross-sheet links for the primary page: the counterpart sheets
 * (placed side by side, sheet order) and the chip-to-chip arcs. */
export function useMg3dLinkedSheets(
  pageNum: number,
  primary: Mg3dGraph | null,
  primarySheetRef: string | null
): { sheets: LinkedSheet[]; arcs: ContArc[]; loading: boolean } {
  const [sheets, setSheets] = useState<LinkedSheet[]>([]);
  const [arcs, setArcs] = useState<ContArc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSheets([]);
    setArcs([]);
    if (!primary) return;
    const controller = new AbortController();
    setLoading(true);

    (async () => {
      try {
        const regRes = await fetch(`${agentBaseUrl()}/experimental-v2/continuations`, {
          signal: controller.signal,
        });
        if (!regRes.ok) throw new Error(`registry HTTP ${regRes.status}`);
        const registry = ((await regRes.json()).pages ?? {}) as ContRegistry;

        const myEnvelope = await fetchPageEnvelope(pageNum, controller.signal);
        const statuses = continuationStatuses(
          registry,
          pageNum,
          primarySheetRef,
          myEnvelope.rawGraph as StatusGraph
        );

        const resolved = myEnvelope.graph.continuations
          .map((c) => ({ c, status: statuses.get(c.id) }))
          .filter(
            (r) =>
              r.status?.state === "resolved" &&
              r.status.link &&
              r.status.link.page !== pageNum
          );

        const destPages = [...new Set(resolved.map((r) => r.status!.link!.page))].sort(
          (a, b) => {
            const sa = Number(sheetNumberOf(registry[String(a)]?.sheet ?? null) ?? a);
            const sb = Number(sheetNumberOf(registry[String(b)]?.sheet ?? null) ?? b);
            return sa - sb;
          }
        );
        if (destPages.length === 0) {
          setLoading(false);
          return;
        }

        const primaryBounds = graphBounds(primary);
        const gap = (primaryBounds.maxX - primaryBounds.minX) * 0.18;
        let cursorX = primaryBounds.maxX + gap;

        const loaded: LinkedSheet[] = [];
        for (const dest of destPages) {
          const envelope = await fetchPageEnvelope(dest, controller.signal);
          const b = graphBounds(envelope.graph);
          const offsetX = cursorX - b.minX;
          cursorX += b.maxX - b.minX + gap;
          loaded.push({
            pageNum: dest,
            sheetRef: envelope.sheetRef,
            graph: envelope.graph,
            offsetX,
          });
        }
        if (controller.signal.aborted) return;

        const nextArcs: ContArc[] = [];
        for (const { c, status } of resolved) {
          const link = status!.link!;
          const sheet = loaded.find((s) => s.pageNum === link.page);
          const counterpart = sheet?.graph.continuations.find((k) => k.id === link.contId);
          if (!sheet || !counterpart) continue; // registry ahead of the saved graph — skip honestly
          nextArcs.push({
            from: { x: c.point.x, y: c.point.y },
            fromPage: pageNum,
            to: { x: counterpart.point.x, y: counterpart.point.y },
            toPage: link.page,
            net: link.net,
            ref: c.rawRef || `${c.sheet ?? "?"}/${c.zone ?? "?"}`,
            destSheet: link.sheet,
          });
        }

        setSheets(loaded);
        setArcs(nextArcs);
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setSheets([]);
        setArcs([]);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [pageNum, primary, primarySheetRef]);

  return { sheets, arcs, loading };
}
