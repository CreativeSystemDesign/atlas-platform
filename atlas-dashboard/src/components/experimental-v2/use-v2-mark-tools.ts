"use client";

// Mark-tool state + gestures for the Experimental v2 screen (extracted from
// experimental-v2-screen in the 2026-07-11 modularity pass, logic verbatim):
// the conversational marks Shane draws for the copilot — ask points, lasso
// regions, pen ink, arrows, boxes, text callouts — plus the pending-mark
// composer flow (the turn only fires on send, carrying his words — Shane,
// 2026-07-08) and the bless flow (tap excellent work, say why, mint a
// playbook exemplar).
//
// Mounted ABOVE the live bridge (the snapshot consumes askMarks/lassoRegions/
// penMarks), so reportEvent/showToast ride refs the screen syncs once the
// bridge exists — every call site here fires on user interaction, long after
// that sync (same contract as the cable/continuation hooks' showToastRef).
//
// The screen's pointer handlers stay thin dispatchers: handleMarkPointerDown/
// Move/Up return true when the gesture belonged to a mark tool (the branch
// consumed it), false to fall through to pen-reporting + the drawing engine.

import { useCallback, useEffect, useState } from "react";
import type { PageGeometry } from "./v2-snapping";
import type { NetColoring } from "./v2-nets";
import { type V2Graph, type V2Tool } from "./experimental-v2-types";
import {
  type ArrowMark,
  type AskMark,
  type BoxMark,
  type BridgeEvent,
  type LassoRegion,
  type PenMark,
  type TextCallout,
  type Point as BridgePoint,
} from "./v2-bridge-types";
import { resolvePenTarget } from "./v2-bridge-target";
import { pickAnyElement, type PickedElement } from "./v2-picking";

// Reduce a raw freehand lasso stroke to a clean region: drop near-duplicate
// points (premium feel — raw pointer jitter reads as cheap), then compute the
// bounding box the backend frames its capture around. Smoothing for DISPLAY is
// done in the overlay (Catmull-Rom); this keeps the stored geometry honest.
function finalizeLasso(stroke: BridgePoint[]): { points: BridgePoint[]; bbox: { x: number; y: number; width: number; height: number } } | null {
  if (stroke.length < 3) return null;
  const pts: BridgePoint[] = [];
  for (const p of stroke) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 6) pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const bbox = { x: minX, y: minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
  // Ignore accidental micro-loops (a stray click-drag) — a real scoping lasso
  // has meaningful area.
  if (bbox.width < 24 || bbox.height < 24) return null;
  return { points: pts, bbox };
}

// Reduce a raw freehand pen stroke to a clean OPEN ink path + its bbox. Same
// jitter-drop as the lasso, but no closure and no min-area gate — a short
// underline is a legitimate pen mark. Drops only true taps (no travel).
function finalizePen(stroke: BridgePoint[]): { points: BridgePoint[]; bbox: { x: number; y: number; width: number; height: number } } | null {
  if (stroke.length < 2) return null;
  const pts: BridgePoint[] = [];
  for (const p of stroke) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 5) pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const bbox = { x: minX, y: minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
  // A real ink gesture travels; a dead tap (both dims tiny) is not a pen mark.
  if (bbox.width < 10 && bbox.height < 10) return null;
  return { points: pts, bbox };
}

const MARK_NOUN: Record<string, string> = { pen: "ink", lasso: "area", arrow: "arrow", box: "area", text: "note" };

export function useV2MarkTools({
  pageNum,
  tool,
  geometry,
  netColoring,
  graph,
  reportEventRef,
  showToastRef,
}: {
  pageNum: number;
  tool: V2Tool;
  geometry: PageGeometry | null;
  netColoring: NetColoring | null;
  graph: V2Graph;
  reportEventRef: { current: ((event: BridgeEvent) => void) | null };
  showToastRef: { current: ((msg: string) => void) | null };
}) {
  // Numbered points Shane places with the Ask tool. Visible on canvas, painted
  // into copilot captures, carried in the snapshot. Esc or page-change clears.
  const [askMarks, setAskMarks] = useState<AskMark[]>([]);
  // Lasso regions Shane draws to scope the copilot's attention (region-shaped
  // sibling of ask marks). Same lifecycle: cleared on page-change + Esc. The
  // in-progress stroke lives in lassoStroke while the pointer is down.
  const [lassoRegions, setLassoRegions] = useState<LassoRegion[]>([]);
  const [lassoStroke, setLassoStroke] = useState<BridgePoint[] | null>(null);
  const [penMarks, setPenMarks] = useState<PenMark[]>([]);
  const [penStroke, setPenStroke] = useState<BridgePoint[] | null>(null);
  // v4 mark family: arrow (tail→head vector), box (rectangular region — the
  // lasso's right-angled sibling, rides the same server contract), and text
  // callouts (pinned notes committed on composer send).
  const [arrowMarks, setArrowMarks] = useState<ArrowMark[]>([]);
  const [arrowStroke, setArrowStroke] = useState<{ tail: BridgePoint; head: BridgePoint } | null>(null);
  const [boxMarks, setBoxMarks] = useState<BoxMark[]>([]);
  const [boxStroke, setBoxStroke] = useState<{ a: BridgePoint; b: BridgePoint } | null>(null);
  const [textCallouts, setTextCallouts] = useState<TextCallout[]>([]);
  // A committed mark waiting for Shane's instruction (the mark composer is open).
  // The turn only fires on send — carrying his words — so the copilot never
  // acts on a mark with no instruction (Shane, 2026-07-08).
  const [pendingMark, setPendingMark] = useState<
    { kind: "pen" | "lasso" | "arrow" | "box" | "text"; n: number; subject: string; event: BridgeEvent } | null
  >(null);
  // Bless tool: tapping excellent work SELECTS the overlay element(s) under the
  // tap; Ctrl+click adds more into one card (2026-07-08). sessionId keys the
  // composer so it only remounts on a fresh bless, not on each Ctrl+click.
  const [pendingBless, setPendingBless] = useState<
    { sessionId: number; targets: PickedElement[]; point: { x: number; y: number } } | null
  >(null);
  // Page-change clears every mark family — derived during render (the
  // extraction-table seenName idiom), not an effect, so the stale marks never
  // paint a frame on the new page.
  const [seenPage, setSeenPage] = useState(pageNum);
  if (pageNum !== seenPage) {
    setSeenPage(pageNum);
    setAskMarks([]); setLassoRegions([]); setLassoStroke(null); setPenMarks([]); setPenStroke(null); setArrowMarks([]); setArrowStroke(null); setBoxMarks([]); setBoxStroke(null); setTextCallouts([]); setPendingMark(null); setPendingBless(null);
  }

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setAskMarks([]); setLassoRegions([]); setLassoStroke(null); setPenMarks([]); setPenStroke(null); setArrowMarks([]); setArrowStroke(null); setBoxMarks([]); setBoxStroke(null); setTextCallouts([]); setPendingMark(null); setPendingBless(null); }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  // Bridge dep: the copilot clears specific ask marks (or all of them) once
  // they're answered — moved verbatim from the screen's bridgeDepsRef sync.
  const clearAskMarks = useCallback((marks?: number[]) => {
    setAskMarks((prev) => (marks?.length ? prev.filter((m) => !marks.includes(m.n)) : []));
  }, []);

  const handleMarkPointerDown = useCallback((tool: V2Tool, coords: BridgePoint): boolean => {
    if (tool === "lasso") {
      // Freehand loop: begin capturing the stroke; nothing touches the graph.
      setLassoStroke([coords]);
      return true;
    }
    if (tool === "pen") {
      // Freehand ink: begin the open stroke; nothing touches the graph.
      setPenStroke([coords]);
      return true;
    }
    if (tool === "arrow") {
      // Arrow mark: anchor the tail; the head follows the drag.
      setArrowStroke({ tail: coords, head: coords });
      return true;
    }
    if (tool === "box") {
      // Box mark: rubber-band region (the lasso's right-angled sibling).
      setBoxStroke({ a: coords, b: coords });
      return true;
    }
    return false;
  }, []);

  const handleMarkPointerMove = useCallback((coords: BridgePoint): boolean => {
    if (lassoStroke) {
      setLassoStroke((prev) => (prev ? [...prev, coords] : prev));
      return true;
    }
    if (penStroke) {
      setPenStroke((prev) => (prev ? [...prev, coords] : prev));
      return true;
    }
    if (arrowStroke) {
      setArrowStroke((prev) => (prev ? { ...prev, head: coords } : prev));
      return true;
    }
    if (boxStroke) {
      setBoxStroke((prev) => (prev ? { ...prev, b: coords } : prev));
      return true;
    }
    return false;
  }, [lassoStroke, penStroke, arrowStroke, boxStroke]);

  const handleMarkPointerUp = useCallback((tool: V2Tool, coords: BridgePoint): boolean => {
    if (tool === "lasso") {
      // Commit the freehand loop into a scoping region. Drawing a lasso is a
      // CONVERSATIONAL turn (Shane): the region enters the active conversation
      // as a captured area — the bridge event carries it to the copilot the
      // same way an ask mark does; the message text then acts on it.
      const stroke = lassoStroke ? [...lassoStroke, coords] : null;
      setLassoStroke(null);
      const fin = stroke ? finalizeLasso(stroke) : null;
      if (!fin) return true;
      const n = (lassoRegions[lassoRegions.length - 1]?.n ?? 0) + 1;
      setLassoRegions((prev) => [...prev.slice(-5), { n, points: fin.points, bbox: fin.bbox }]);
      // Open the mark composer — the turn fires on send, carrying his words.
      setPendingMark({
        kind: "lasso", n, subject: "the marked area",
        event: { kind: "lasso", page: pageNum, n, bbox: fin.bbox, points: fin.points },
      });
      return true;
    }
    if (tool === "pen") {
      // Commit freehand ink. Like the lasso it's a CONVERSATIONAL turn — but
      // the ink anchors to the nearest element (resolved at the stroke's
      // centroid) so "this" is a concrete graph/artwork target, and the ink
      // stays on the page as the visible anchor.
      const stroke = penStroke ? [...penStroke, coords] : null;
      setPenStroke(null);
      const fin = stroke ? finalizePen(stroke) : null;
      if (!fin) return true;
      const cx = fin.bbox.x + fin.bbox.width / 2;
      const cy = fin.bbox.y + fin.bbox.height / 2;
      const anchor = resolvePenTarget({ x: cx, y: cy }, geometry, netColoring, graph);
      const n = (penMarks[penMarks.length - 1]?.n ?? 0) + 1;
      setPenMarks((prev) => [...prev.slice(-5), { n, points: fin.points, bbox: fin.bbox, anchor }]);
      const what =
        anchor?.component_label ??
        anchor?.element_label ??
        (anchor?.net_id !== undefined ? `net ${anchor.net_id}` : undefined) ??
        (anchor?.segment_index !== undefined ? `segment ${anchor.segment_index}` : undefined) ??
        "open area";
      // Open the mark composer — the turn fires on send, carrying his words.
      setPendingMark({
        kind: "pen", n, subject: what,
        event: { kind: "pen_mark", page: pageNum, n, bbox: fin.bbox, points: fin.points, anchor },
      });
      return true;
    }
    if (tool === "arrow") {
      // Commit the arrow: the HEAD is the subject — it anchors to the nearest
      // element, and the composer turn carries tail→head so the copilot knows
      // both what is pointed AT and pointed FROM.
      const stroke = arrowStroke ? { ...arrowStroke, head: coords } : null;
      setArrowStroke(null);
      if (!stroke || Math.hypot(stroke.head.x - stroke.tail.x, stroke.head.y - stroke.tail.y) < 12) return true;
      const anchor = resolvePenTarget(stroke.head, geometry, netColoring, graph);
      const n = (arrowMarks[arrowMarks.length - 1]?.n ?? 0) + 1;
      const tail = { x: Math.round(stroke.tail.x), y: Math.round(stroke.tail.y) };
      const head = { x: Math.round(stroke.head.x), y: Math.round(stroke.head.y) };
      setArrowMarks((prev) => [...prev.slice(-5), { n, tail, head, anchor }]);
      const what =
        anchor?.component_label ?? anchor?.element_label ??
        (anchor?.net_id !== undefined ? `net ${anchor.net_id}` : undefined) ??
        (anchor?.segment_index !== undefined ? `segment ${anchor.segment_index}` : undefined) ??
        "the pointed-at spot";
      setPendingMark({ kind: "arrow", n, subject: what, event: { kind: "arrow", page: pageNum, n, tail, head, anchor } });
      return true;
    }
    if (tool === "box") {
      // Commit the box region — semantically a lasso with right angles, so it
      // rides the SAME server contract (kind:"lasso", region bbox + corners).
      const stroke = boxStroke ? { ...boxStroke, b: coords } : null;
      setBoxStroke(null);
      if (!stroke) return true;
      const bbox = {
        x: Math.round(Math.min(stroke.a.x, stroke.b.x)),
        y: Math.round(Math.min(stroke.a.y, stroke.b.y)),
        width: Math.round(Math.abs(stroke.b.x - stroke.a.x)),
        height: Math.round(Math.abs(stroke.b.y - stroke.a.y)),
      };
      if (bbox.width < 12 || bbox.height < 12) return true;
      // Boxes share the lasso's numbering space: both arrive as "area N".
      const n = Math.max(lassoRegions[lassoRegions.length - 1]?.n ?? 0, boxMarks[boxMarks.length - 1]?.n ?? 0) + 1;
      setBoxMarks((prev) => [...prev.slice(-5), { n, bbox }]);
      const corners = [
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
        { x: bbox.x, y: bbox.y + bbox.height },
      ];
      setPendingMark({ kind: "box", n, subject: "the boxed region", event: { kind: "lasso", page: pageNum, n, bbox, points: corners } });
      return true;
    }
    if (tool === "text") {
      // Tap places a callout anchor and opens the composer; the typed text IS
      // the note — committed (and pinned to the page) on send, never on tap.
      const anchor = resolvePenTarget(coords, geometry, netColoring, graph);
      const n = (textCallouts[textCallouts.length - 1]?.n ?? 0) + 1;
      const what =
        anchor?.component_label ?? anchor?.element_label ??
        (anchor?.net_id !== undefined ? `net ${anchor.net_id}` : undefined) ??
        "this spot";
      setPendingMark({
        kind: "text", n, subject: what,
        event: { kind: "note", page: pageNum, n, x: Math.round(coords.x), y: Math.round(coords.y), anchor },
      });
      return true;
    }
    if (tool === "ask") {
      // Point-and-ask: nothing is drawn — the tap places/removes a numbered
      // mark the copilot can see (overlay now, captures + snapshot metadata).
      const near = askMarks.find((m) => Math.hypot(m.x - coords.x, m.y - coords.y) <= 28);
      if (near) {
        setAskMarks((prev) => prev.filter((m) => m.n !== near.n));
        showToastRef.current?.(`Removed mark ${near.n}`);
        return true;
      }
      const target = resolvePenTarget(coords, geometry, netColoring, graph);
      const n = (askMarks[askMarks.length - 1]?.n ?? 0) + 1;
      setAskMarks((prev) => [...prev.slice(-11), { n, x: Math.round(coords.x), y: Math.round(coords.y), target }]);
      reportEventRef.current?.({
        kind: "ask",
        page: pageNum,
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        target: { ...target, mark: n } as never,
      });
      const what =
        target?.component_label ??
        (target?.net_id !== undefined ? `net ${target.net_id}` : undefined) ??
        (target?.segment_index !== undefined ? `segment ${target.segment_index}` : undefined) ??
        `(${Math.round(coords.x)}, ${Math.round(coords.y)})`;
      showToastRef.current?.(`Mark ${n}: ${what} (Esc clears all)`);
      return true;
    }
    return false;
  }, [pageNum, geometry, netColoring, graph, askMarks, lassoStroke, lassoRegions, penStroke, penMarks, arrowStroke, arrowMarks, boxStroke, boxMarks, textCallouts, reportEventRef, showToastRef]);

  const sendPendingMark = useCallback(
    (text: string) => {
      if (!pendingMark) return;
      // Text callouts commit on SEND: the typed words become the pinned chip.
      if (pendingMark.kind === "text" && pendingMark.event.kind === "note") {
        const ev = pendingMark.event;
        setTextCallouts((prev) => [...prev.slice(-7), { n: ev.n, x: ev.x, y: ev.y, text }]);
      }
      reportEventRef.current?.({ ...pendingMark.event, instruction: text } as BridgeEvent);
      showToastRef.current?.(`Sent ${MARK_NOUN[pendingMark.kind] ?? "mark"} ${pendingMark.n} — Arc will confirm before acting`);
      setPendingMark(null);
    },
    [pendingMark, reportEventRef, showToastRef]
  );
  const cancelPendingMark = useCallback(() => {
    if (!pendingMark) return;
    if (pendingMark.kind === "pen") setPenMarks((prev) => prev.filter((m) => m.n !== pendingMark.n));
    else if (pendingMark.kind === "arrow") setArrowMarks((prev) => prev.filter((m) => m.n !== pendingMark.n));
    else if (pendingMark.kind === "box") setBoxMarks((prev) => prev.filter((m) => m.n !== pendingMark.n));
    else if (pendingMark.kind === "text") { /* nothing committed until send */ }
    else setLassoRegions((prev) => prev.filter((r) => r.n !== pendingMark.n));
    setPendingMark(null);
  }, [pendingMark]);

  // Bless multi-select (2026-07-08): a plain click starts a bless on the overlay
  // element under the tap; Ctrl+click adds/removes more into ONE card (a ground
  // + its border terminals bless together). Driven by the SVG's onBlessPick.
  const blessSubject = useCallback((targets: PickedElement[]): string => {
    if (targets.length === 0) return "this spot";
    const head = targets[0];
    const name = `${head.kind}${head.label ? ` ${head.label}` : ""}`;
    return targets.length === 1 ? name : `${name} + ${targets.length - 1} more`;
  }, []);
  const onBlessPick = useCallback(
    (coords: { x: number; y: number }, additive: boolean) => {
      const hit = pickAnyElement(graph, coords);
      setPendingBless((prev) => {
        if (additive) {
          if (!hit) return prev; // Ctrl+click on empty space: ignore
          if (!prev) return { sessionId: Date.now(), targets: [hit], point: hit.point };
          const exists = prev.targets.some((t) => t.id === hit.id);
          return { ...prev, targets: exists ? prev.targets.filter((t) => t.id !== hit.id) : [...prev.targets, hit] };
        }
        // Plain click starts a fresh bless: the element under the tap, or the
        // bare point on open canvas.
        return { sessionId: Date.now(), targets: hit ? [hit] : [], point: hit?.point ?? coords };
      });
    },
    [graph]
  );
  const sendPendingBless = useCallback(
    (text: string) => {
      if (!pendingBless) return;
      const { targets, point } = pendingBless;
      const anchor = targets[0]?.point ?? point;
      reportEventRef.current?.({
        kind: "bless",
        page: pageNum,
        x: Math.round(anchor.x),
        y: Math.round(anchor.y),
        text: text.trim(),
        targets: targets.map((t) => ({
          element_id: t.id,
          element_kind: t.kind,
          element_label: t.label,
          x: Math.round(t.point.x),
          y: Math.round(t.point.y),
          ...(t.bbox ? { bbox: t.bbox } : {}),
        })),
      } as BridgeEvent);
      showToastRef.current?.(
        targets.length > 1
          ? `Blessed ${targets.length} elements — playbook card minting`
          : `Blessed ${blessSubject(targets)} — playbook card minting`
      );
      setPendingBless(null);
    },
    [pendingBless, pageNum, blessSubject, reportEventRef, showToastRef]
  );
  const cancelPendingBless = useCallback(() => setPendingBless(null), []);

  // Leaving the Bless tool closes the composer (abandons an in-progress bless).
  // Derived during render — conditional on pendingBless so it can't loop.
  if (tool !== "bless" && pendingBless) setPendingBless(null);

  return {
    askMarks, lassoRegions, lassoStroke, penMarks, penStroke,
    arrowMarks, arrowStroke, boxMarks, boxStroke, textCallouts,
    pendingMark, sendPendingMark, cancelPendingMark,
    pendingBless, blessSubject, onBlessPick, sendPendingBless, cancelPendingBless,
    clearAskMarks, handleMarkPointerDown, handleMarkPointerMove, handleMarkPointerUp,
  };
}
