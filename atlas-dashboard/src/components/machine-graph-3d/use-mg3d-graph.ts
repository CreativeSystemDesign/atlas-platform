"use client";

import { useEffect, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";

// Local structural types — intentionally decoupled from experimental-v2 canvas types.
export type Mg3dNode = {
  id: string;
  label: string;
  family: string; // label engine's identity.family; "" when absent
  bbox: { x: number; y: number; width: number; height: number };
};

export type Mg3dPort = {
  id: string;
  label: string;
  type: string;
  point: { x: number; y: number };
  parentId: string | null;
};

export type Mg3dEdge = {
  id: string;
  label: string;
  path: { x: number; y: number }[];
  sourcePortId: string | null;
  targetPortId: string | null;
};

export type Mg3dContinuation = {
  id: string;
  rawRef: string;
  sheet: string | null;
  zone: string | null;
  point: { x: number; y: number };
  target: { id: string } | null;
};

export type Mg3dGround = {
  id: string;
  label: string;
  bbox: { x: number; y: number; width: number; height: number };
};

export type Mg3dGraph = {
  nodes: Mg3dNode[];
  ports: Mg3dPort[];
  edges: Mg3dEdge[];
  continuations: Mg3dContinuation[];
  grounds: Mg3dGround[];
};

type Raw = Record<string, unknown>;

function asArray(value: unknown): Raw[] {
  return Array.isArray(value) ? (value as Raw[]) : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asPoint(value: unknown): { x: number; y: number } {
  const raw = (value ?? {}) as Raw;
  return { x: asNumber(raw.x), y: asNumber(raw.y) };
}

function asBbox(value: unknown): { x: number; y: number; width: number; height: number } {
  const raw = (value ?? {}) as Raw;
  return {
    x: asNumber(raw.x),
    y: asNumber(raw.y),
    width: asNumber(raw.width),
    height: asNumber(raw.height),
  };
}

export type Mg3dBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Page-space extent of everything drawable (bboxes, wire paths, chips). */
export function graphBounds(graph: Mg3dGraph): Mg3dBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of graph.nodes) {
    eat(n.bbox.x, n.bbox.y);
    eat(n.bbox.x + n.bbox.width, n.bbox.y + n.bbox.height);
  }
  for (const g of graph.grounds) {
    eat(g.bbox.x, g.bbox.y);
    eat(g.bbox.x + g.bbox.width, g.bbox.y + g.bbox.height);
  }
  for (const e of graph.edges) for (const p of e.path) eat(p.x, p.y);
  for (const c of graph.continuations) eat(c.point.x, c.point.y);
  if (minX > maxX || minY > maxY) return { minX: 0, minY: 0, maxX: 2400, maxY: 3300 };
  return { minX, minY, maxX, maxY };
}

export type Mg3dEnvelope = {
  graph: Mg3dGraph;
  rawGraph: unknown; // untouched server graph — for reuse of canvas-side pure logic
  sheetRef: string | null;
};

export async function fetchPageEnvelope(pageNum: number, signal?: AbortSignal): Promise<Mg3dEnvelope> {
  const res = await fetch(`${agentBaseUrl()}/experimental-v2/graph?page_num=${pageNum}`, { signal });
  if (!res.ok) throw new Error(`Graph fetch failed: HTTP ${res.status}`);
  const envelope = (await res.json()) as Raw;
  return {
    graph: normalizeGraph(envelope.graph),
    rawGraph: envelope.graph,
    sheetRef: asStringOrNull(envelope.sheetRef),
  };
}

export function normalizeGraph(rawGraph: unknown): Mg3dGraph {
  const g = (rawGraph ?? {}) as Raw;
  const nodes: Mg3dNode[] = asArray(g.nodes).map((n) => ({
    id: asString(n.id),
    label: asString(n.label),
    family: asString(((n.identity ?? {}) as Raw).family),
    bbox: asBbox(n.bbox),
  }));
  const ports: Mg3dPort[] = asArray(g.ports).map((p) => ({
    id: asString(p.id),
    label: asString(p.label),
    type: asString(p.type),
    point: asPoint(p.point),
    parentId: asStringOrNull(p.parentId),
  }));
  const edges: Mg3dEdge[] = asArray(g.edges).map((e) => ({
    id: asString(e.id),
    label: asString(e.label),
    path: Array.isArray(e.path) ? (e.path as unknown[]).map(asPoint) : [],
    sourcePortId: asStringOrNull(e.sourcePortId),
    targetPortId: asStringOrNull(e.targetPortId),
  }));
  const continuations: Mg3dContinuation[] = asArray(g.continuations).map((c) => {
    const target = (c.target ?? null) as Raw | null;
    const targetId = target ? asString(target.id) : "";
    return {
      id: asString(c.id),
      rawRef: asString(c.rawRef),
      sheet: asStringOrNull(c.sheet),
      zone: asStringOrNull(c.zone),
      point: asPoint(c.point),
      target: targetId ? { id: targetId } : null,
    };
  });
  const grounds: Mg3dGround[] = asArray(g.grounds).map((gr) => ({
    id: asString(gr.id),
    label: asString(gr.label),
    bbox: asBbox(gr.bbox),
  }));
  return { nodes, ports, edges, continuations, grounds };
}

/** Read-only fetch of the logic graph for one page. No caching by design — the 3D view is a viewer. */
export function useMg3dGraph(pageNum: number): {
  graph: Mg3dGraph | null;
  sheetRef: string | null;
  loading: boolean;
  error: string | null;
} {
  const [graph, setGraph] = useState<Mg3dGraph | null>(null);
  const [sheetRef, setSheetRef] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setGraph(null);
    setSheetRef(null);

    (async () => {
      try {
        const envelope = await fetchPageEnvelope(pageNum, controller.signal);
        if (controller.signal.aborted) return;
        setGraph(envelope.graph);
        setSheetRef(envelope.sheetRef);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setGraph(null);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [pageNum]);

  return { graph, sheetRef, loading, error };
}
