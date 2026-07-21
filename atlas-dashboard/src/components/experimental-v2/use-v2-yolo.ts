"use client";

// Detector-evidence feed for the YOLO layer pill (v4 port). Fetches the
// precomputed page-scan detections (never fresh inference) when the layer is
// on; cached per page for the session so toggling is instant.

import { useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";

export type YoloDetection = {
  id: string;
  class_name: string;
  confidence: number;
  tier?: string;
  bbox: { x: number; y: number; width: number; height: number };
};

export function useV2Yolo(page: number, enabled: boolean): YoloDetection[] {
  const [dets, setDets] = useState<YoloDetection[]>([]);
  const cacheRef = useRef(new Map<number, YoloDetection[]>());

  useEffect(() => {
    if (!enabled) return;
    const cached = cacheRef.current.get(page);
    if (cached) {
      setDets(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${agentBaseUrl()}/experimental-v2/yolo?page=${page}`);
        const body = await res.json();
        const items: YoloDetection[] = (body?.detections ?? []).filter(
          (d: YoloDetection) => d?.bbox && typeof d.bbox.x === "number"
        );
        cacheRef.current.set(page, items);
        if (!cancelled) setDets(items);
      } catch {
        if (!cancelled) setDets([]); // offline / no sidecar — layer just stays empty
      }
    })();
    return () => { cancelled = true; };
  }, [page, enabled]);

  return enabled ? dets : [];
}
