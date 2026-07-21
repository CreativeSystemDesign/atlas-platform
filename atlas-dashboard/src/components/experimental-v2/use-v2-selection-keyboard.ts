"use client";

// Selection keyboard gestures for the Experimental v2 screen (extracted from
// experimental-v2-screen in the 2026-07-11 modularity pass): Delete,
// Ctrl+Z/Y undo-redo, the continuation clipboard (Ctrl+C/V — Shane,
// 2026-07-11), and the single-letter tool hotkeys. Owns the continuation
// clipboard ref; the cursor ref stays with the screen (the pointer-move
// handler writes it). Logic is verbatim from the screen.

import { useEffect, useRef } from "react";
import { pasteContinuationAt } from "./v2-graph-ops";
import type { V2Graph, V2Tool } from "./experimental-v2-types";
import type { V2Settings } from "./v2-settings";
import type { Point } from "./v2-bridge-types";

export function useV2SelectionKeyboard({
  selectedId,
  setSelectedId,
  setTool,
  deleteSelected,
  undo,
  redo,
  updateGraph,
  graphRef,
  settingsRef,
  cursorRef,
  showToastRef,
}: {
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  setTool: (tool: V2Tool) => void;
  deleteSelected: (id: string | null) => void;
  undo: () => void;
  redo: () => void;
  updateGraph: (updater: (draft: V2Graph) => void) => void;
  graphRef: { current: V2Graph };
  settingsRef: { current: V2Settings };
  cursorRef: { current: Point | null };
  showToastRef: { current: ((msg: string) => void) | null };
}): void {
  // Continuation clipboard (Shane, 2026-07-11): Ctrl+C on a selected chip
  // copies its ref; Ctrl+V stamps a copy at the cursor (25px wire-end snap
  // anchors it, same as a drag drop). cursorRef tracks the last canvas-space
  // pointer position for the paste site.
  const contClipRef = useRef<{ sheet: string | null; zone: string | null; rawRef: string | null } | null>(null);

  // Keyboard: delete / undo / redo / mode hotkeys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

      if (e.key === "Delete" || (e.ctrlKey && (e.key === "z" || e.key === "y"))) e.preventDefault();
      if (e.key === "Delete") return deleteSelected(selectedId);
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) return undo();
      if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "z")) return redo();
      // Continuation clipboard (Shane, 2026-07-11). Ctrl+C only claims the
      // gesture when a continuation is the active selection AND no text is
      // highlighted — real text copies stay the browser's.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !e.shiftKey && !e.altKey) {
        const sel = window.getSelection?.();
        if (!sel || sel.isCollapsed) {
          const cont = graphRef.current.continuations.find((c) => c.id === selectedId);
          if (cont) {
            contClipRef.current = { sheet: cont.sheet, zone: cont.zone, rawRef: cont.rawRef };
            const ref = cont.rawRef ?? `${cont.sheet ?? "?"}/${cont.zone ?? "?"}`;
            showToastRef.current?.(`copied ${ref} — hover a wire endpoint and Ctrl+V`);
            e.preventDefault();
            return;
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && !e.shiftKey && !e.altKey) {
        const clip = contClipRef.current;
        if (clip) {
          const at = cursorRef.current;
          if (!at) {
            showToastRef.current?.("move the cursor over the canvas, then Ctrl+V");
            return;
          }
          e.preventDefault();
          const id = `cont-${crypto.randomUUID()}`;
          const snapPx = settingsRef.current.contSnapPx;
          updateGraph((draft) => { pasteContinuationAt(draft, clip, at, id, snapPx); });
          setSelectedId(id);
          const ref = clip.rawRef ?? `${clip.sheet ?? "?"}/${clip.zone ?? "?"}`;
          const snapped = graphRef.current.edges.some((ed) => {
            const path = ed.path ?? [];
            return path.length >= 2 && [path[0], path[path.length - 1]].some(
              (pt) => Math.hypot(pt.x - at.x, pt.y - at.y) <= snapPx);
          });
          showToastRef.current?.(snapped
            ? `pasted ${ref} — anchored to the wire end`
            : `pasted ${ref} unanchored — drag it onto the endpoint`);
          return;
        }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const hot: Record<string, V2Tool> = { v: "select", c: "component", f: "freehand", w: "wire", t: "terminal", x: "continuation", g: "ground", n: "connector", d: "cable", a: "ask", b: "bless", l: "lasso", p: "pen", r: "arrow", o: "box", m: "text" };
      const m = hot[e.key.toLowerCase()];
      if (m) setTool(m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, deleteSelected, undo, redo, updateGraph, setSelectedId, setTool, graphRef, settingsRef, cursorRef, showToastRef]);
}
