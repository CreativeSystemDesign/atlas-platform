"use client";

import React, { useEffect, useRef, useState } from "react";
import { type V2Graph, type V2Tool } from "./experimental-v2-types";
import { type PageGeometry, type SnapResult, type SnapKind } from "./v2-snapping";
import { pickForTool, pickAnyElement } from "./v2-picking";
import { constrainTerminalPoint, movedEdgePath, resizedPortPoint } from "./v2-graph-ops";
import { detectBorderCrossings, cableLabelNear } from "./v2-intent";
import { extractStripRows, rowForY, stripTitleAbove, stripsTouchingBox, portsTouchingBox, touchPoint, STRIP_MIN_ROWS } from "./v2-strip";
import { type V2Settings } from "./v2-settings";
import { type NetColoring } from "./v2-nets";
import { PAGE_WIDTH_PX, PAGE_HEIGHT_PX } from "../extraction-workbench/studio-types";
import { ExperimentalV2MetaLayer } from "./experimental-v2-meta-layer";

type Pt = { x: number; y: number };
type Bbox = { x: number; y: number; width: number; height: number };

// --- Handle-resize (Shane's pinned resizable bboxes, 2026-07-09) ------------

// The 8 grips: corner keys resize both axes, mid-edge keys one.
const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

function handlePoint(b: Bbox, h: ResizeHandle): Pt {
  return {
    x: h.includes("w") ? b.x : h.includes("e") ? b.x + b.width : b.x + b.width / 2,
    y: h.includes("n") ? b.y : h.includes("s") ? b.y + b.height : b.y + b.height / 2,
  };
}

// Rubber-band a bbox by one grip; opposite edges stay pinned. The 12px floor
// keeps the box grabbable and the port-riding clamp's 4px insets sane.
function resizeBboxByHandle(orig: Bbox, h: ResizeHandle, dx: number, dy: number): Bbox {
  const MIN = 12;
  let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.width, y1 = orig.y + orig.height;
  if (h.includes("w")) x0 = Math.min(x1 - MIN, x0 + dx);
  if (h.includes("e")) x1 = Math.max(x0 + MIN, x1 + dx);
  if (h.includes("n")) y0 = Math.min(y1 - MIN, y0 + dy);
  if (h.includes("s")) y1 = Math.max(y0 + MIN, y1 + dy);
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(PAGE_WIDTH_PX, x1); y1 = Math.min(PAGE_HEIGHT_PX, y1);
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}

// The chain-link ghost (Shane, 2026-07-10): two interlocked pills at the
// point where a dragged cable will auto-link a terminal strip's conductors.
function ChainLinkGhost({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g className="pointer-events-none">
      <circle cx={x} cy={y} r={16} fill="rgba(52,211,153,.12)">
        <animate attributeName="r" values="14;18;14" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <g transform={`translate(${x},${y}) rotate(-45)`} stroke="#34d399" strokeWidth={2.4} fill="none">
        <rect x={-13} y={-4.5} width={15} height={9} rx={4.5} />
        <rect x={-2} y={-4.5} width={15} height={9} rx={4.5} />
      </g>
      {label && (
        <text x={x} y={y + 30} fontSize={10} fontFamily="ui-monospace, monospace" fill="#34d399" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

type ExperimentalV2SvgProps = {
  graph: V2Graph;
  tool: V2Tool;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  stroke: Pt[] | null;
  geometrySnap: SnapResult | null;
  geometry: PageGeometry | null;
  settings: V2Settings;
  netColoring: NetColoring | null;
  onToggleJunction?: (key: string) => void;
  handlePointerDown: (coords: Pt) => void;
  handlePointerMove: (coords: Pt) => void;
  handlePointerUp: (coords: Pt) => void;
  onCtrlAttach?: (coords: Pt) => void;
  // Connector tool: Ctrl+click on a placed connector's border mints the pin
  // pair (input terminal + opposite-side mate + internal conduction).
  onConnectorPin?: (coords: Pt) => void;
  // Bless tool: pick the overlay element under the tap; additive (Ctrl) adds it
  // to the running bless selection. blessIds are the currently selected ids.
  onBlessPick?: (coords: Pt, additive: boolean) => void;
  blessIds?: Set<string>;
  // Terminal drag (Shane 2026-07-09): commit a border-constrained terminal move.
  onTerminalMove?: (portId: string, point: Pt) => void;
  onContinuationMove?: (contId: string, point: Pt) => void;
  // Shift+drag copy commit: mint a bound copy of the chip at the drop point.
  onContinuationCopy?: (sourceId: string, point: Pt) => void;
  // Continuation snap radius (settings-tuned): the drag preview ring uses the
  // same reach the commit will, so what you see is what binds.
  contSnapPx?: number;
  // Per-chip cross-page status (Shane, 2026-07-11): the color tells you not
  // just connected, but WHY NOT — resolved green, waiting amber, mismatch
  // violet, unanchored rose, unlabeled slate. Hover carries the reason.
  contStatuses?: Map<string, { state: string; detail: string }>;
  // Handle-resize (Shane's pinned resizable bboxes): commit a node/ground bbox;
  // the graph op makes border terminals ride and wires follow by port id.
  onBoxResize?: (id: string, bbox: Bbox) => void;
  /** Live designator resolve for the ghost-terminal preview: lets the rings
      read their full future names (T~<owner>~<net>) while the box is still
      being dragged. */
  resolveComponentLabel?: (bbox: { x: number; y: number; width: number; height: number }) => string | null;
  // Hover join card (Shane's tooltip, 2026-07-14): a settled pointer on a
  // component emits its mark + screen point; null on leave. Only fires in
  // select mode with no drag armed — the card must never fight the tools.
  onComponentHover?: (info: { mark: string; clientX: number; clientY: number } | null) => void;
};

const SNAP_KIND_COLOR: Record<SnapKind, string> = {
  terminal: "#10b981",
  junction: "#f59e0b",
  endpoint: "#22d3ee",
  segment: "#a78bfa",
};

function midpoint(path: Pt[]): Pt {
  if (path.length === 0) return { x: 0, y: 0 };
  const i = Math.max(0, Math.floor(path.length / 2) - 1);
  const a = path[i];
  const b = path[i + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function ExperimentalV2Svg({
  graph,
  tool,
  selectedId,
  setSelectedId,
  stroke,
  geometrySnap,
  geometry,
  settings,
  netColoring,
  onToggleJunction,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  onCtrlAttach,
  onConnectorPin,
  onBlessPick,
  blessIds,
  onTerminalMove,
  onContinuationMove,
  onContinuationCopy,
  contSnapPx = 25,
  contStatuses,
  onBoxResize,
  resolveComponentLabel,
  onComponentHover,
}: ExperimentalV2SvgProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // An arming drag must kill any pending/shown join card even though the
  // pointer never leaves the rect (no mouseleave fires mid-drag) — the
  // card must never hover over precision work (adversarial review,
  // 2026-07-14). Effect body below, after the drag states exist.
  // Hovered continuation chip (Shane, 2026-07-11): a designed, instant
  // tooltip card carries the status + the why — the native <title> was slow
  // and easy to miss.
  const [hoverCont, setHoverCont] = useState<string | null>(null);
  // Set when a pointer-down in a placement tool lands on an existing element of
  // that tool's type: we SELECT it instead of placing, and the matching
  // pointer-up must skip the placement commit.
  const selectingRef = useRef(false);
  // Terminal drag (Shane 2026-07-09): pressing a terminal/mate in (almost) any
  // mode ARMS a drag; 3px of movement activates it and the pin slides along
  // its parent's border. A click without movement falls through to the mode's
  // normal behavior. Exempt: wire (pressing a pin STARTS A WIRE), lasso/pen
  // (stroke tools), bless (pick tool).
  const dragArmRef = useRef<{ id: string; start: Pt } | null>(null);
  const [dragPort, setDragPort] = useState<{ id: string; point: Pt } | null>(null);
  // Continuation drag (Shane, 2026-07-09): grab a continuation glyph with
  // Select, drop it on a wire endpoint → it snaps + target-binds there.
  // snap carries the live endpoint candidate for the green ring preview.
  // copy: Shift+drag pulls a COPY off the chip (Shane, 2026-07-11) — the
  // symbol annotation stays on the print; the copy becomes the link chip.
  const [dragCont, setDragCont] = useState<{ id: string; point: Pt; snap: Pt | null; copy?: boolean } | null>(null);
  const contDragArmRef = React.useRef<{ id: string; start: Pt; copy?: boolean } | null>(null);
  // Handle-resize: pressing a grip on the selected node/ground arms a resize;
  // the drag rubber-bands the bbox live. `orig` rides IN STATE so the render
  // can preview riding terminals without reading a ref mid-render (React
  // Compiler law). Release commits one undo step through the screen.
  const resizeArmRef = useRef<{ id: string; handle: ResizeHandle; start: Pt; orig: Bbox } | null>(null);
  const [dragResize, setDragResize] = useState<{ id: string; orig: Bbox; bbox: Bbox } | null>(null);
  // (see note above) any armed drag ends the hover — pending dwell and
  // shown card alike — because no mouseleave fires while the pointer
  // stays inside the rect it started on.
  useEffect(() => {
    if (dragPort || dragCont || dragResize) onComponentHover?.(null);
  }, [dragPort, dragCont, dragResize, onComponentHover]);
  const contHit = (local: Pt): string | null => {
    for (const c of graph.continuations) {
      const ref = c.sheet && c.zone ? `${c.sheet}/${c.zone}` : c.rawRef ?? "?";
      const w = Math.max(22, ref.length * 7 + 8);
      if (Math.abs(local.x - c.point.x) <= w / 2 && Math.abs(local.y - c.point.y) <= 9) return c.id;
    }
    return null;
  };
  const nearestWireEnd = (local: Pt): Pt | null => {
    let best: { pt: Pt; d: number } | null = null;
    for (const e of graph.edges) {
      const path = e.path ?? [];
      if (path.length < 2) continue;
      for (const pt of [path[0], path[path.length - 1]]) {
        const d = Math.hypot(local.x - pt.x, local.y - pt.y);
        if (d <= contSnapPx && (!best || d < best.d)) best = { pt, d };
      }
    }
    return best?.pt ?? null;
  };
  const isSelect = tool === "select";
  const terminalDragEnabled = tool !== "wire" && tool !== "lasso" && tool !== "pen" && tool !== "bless";

  // Nearest draggable pin (terminal/mate — junctions are wire topology).
  const portHit = (p: Pt): string | null => {
    let best: string | null = null;
    let d = 12;
    for (const port of graph.ports) {
      if (port.type === "junction") continue;
      const dd = Math.hypot(port.point.x - p.x, port.point.y - p.y);
      if (dd <= d) { d = dd; best = port.id; }
    }
    return best;
  };

  // Pointer capture that tolerates synthetic pointers — tests/automation
  // drive the canvas with dispatched events whose ids name no active pointer,
  // and an unguarded call throws NotFoundError into the dev overlay. Real
  // pen/mouse input always captures. (Mirrors the guarded release calls.)
  const capturePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
  };

  // Client coords -> page render-pixel space (matches the viewBox + geometry).
  const toLocal = (e: React.PointerEvent<SVGSVGElement>): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * PAGE_WIDTH_PX),
      y: Math.round(((e.clientY - rect.top) / rect.height) * PAGE_HEIGHT_PX),
    };
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Fingers navigate (pan/zoom gestures live on the canvas container);
    // only pen and mouse draw. Touch falls through to the gesture layer.
    if (e.pointerType === "touch") return;
    if (e.button !== 0) return;
    selectingRef.current = false; // fresh gesture — never inherit a stale skip
    // Clear any stray text selection without preventDefault (which would break
    // the pointermove/up stream that drives stroke gestures).
    if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();
    // Terminal drag arms FIRST (before mode branches) so pins are grabbable
    // from any non-exempt mode. Plain press only — Ctrl keeps its meanings
    // (twin-attach in select, pin-mint in connector).
    if (terminalDragEnabled && !e.ctrlKey) {
      const hit = portHit(toLocal(e));
      if (hit) {
        dragArmRef.current = { id: hit, start: toLocal(e) };
        capturePointer(e);
        return;
      }
    }
    if (isSelect) {
      if (e.ctrlKey) {
        // Digital-twin gesture: Ctrl-click printed text -> attach evidence to
        // the actively selected component (kept selected).
        onCtrlAttach?.(toLocal(e));
        return;
      }
      // Continuation drag arms in Select: press on a glyph, move past 3px to
      // pick it up; a plain click still selects (the glyph's own handler ran).
      const cHit = contHit(toLocal(e));
      if (cHit) {
        contDragArmRef.current = { id: cHit, start: toLocal(e), copy: e.shiftKey };
        capturePointer(e);
        return;
      }
      setSelectedId(null); // click empty space clears selection
      return;
    }
    const local = toLocal(e);
    if (tool === "connector" && e.ctrlKey) {
      // Shane's connector interaction (2026-07-09): the drag places the box;
      // Ctrl+click is the pin gesture — mint the pair at this point. Handled
      // at pointer-DOWN (like bless) so the modifier key is known, and BEFORE
      // select-in-mode so Ctrl+clicking near an existing terminal adopts it
      // instead of selecting it.
      onConnectorPin?.(local);
      selectingRef.current = true; // consume the gesture — up must not place
      return;
    }
    if (tool === "bless") {
      // Bless selects the overlay element under the tap; Ctrl+click adds more
      // into one card. Handled at pointer-DOWN so the modifier key is known;
      // selectingRef makes the pointer-up skip the (nonexistent) placement.
      onBlessPick?.(local, e.ctrlKey);
      selectingRef.current = true;
      return;
    }
    // Select-in-mode: clicking an existing element of the active tool's type
    // selects it (Del to remove) instead of placing a new one — so the whole
    // place → fix → replace loop stays inside the tool (Shane's ground flow,
    // generalized to every placement tool). EXCEPT grounds (2026-07-10): a
    // Ground-mode tap on an existing ground flows through to the screen,
    // which RE-SNAPS it to the glyph under the tap (and selects it there) —
    // snap is a ground's geometry editor, so the tap must reach it.
    const hit = tool === "ground" ? null : pickForTool(graph, tool, local);
    if (hit) {
      setSelectedId(hit);
      selectingRef.current = true;
      return;
    }
    setSelectedId(null); // starting a fresh placement drops any prior selection
    handlePointerDown(local);
    capturePointer(e);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    const local = toLocal(e);
    const rArm = resizeArmRef.current;
    if (rArm) {
      // Armed grip owns the pointer — rubber-band from the ORIGINAL bbox so
      // accumulated deltas never drift.
      setDragResize({
        id: rArm.id,
        orig: rArm.orig,
        bbox: resizeBboxByHandle(rArm.orig, rArm.handle, local.x - rArm.start.x, local.y - rArm.start.y),
      });
      return;
    }
    const cArm = contDragArmRef.current;
    if (cArm) {
      // Armed continuation gesture: activate past 3px; glyph rides the cursor
      // with a live snap preview on the nearest wire endpoint within radius.
      if (dragCont || Math.hypot(local.x - cArm.start.x, local.y - cArm.start.y) >= 3) {
        setDragCont({ id: cArm.id, point: local, snap: nearestWireEnd(local), copy: cArm.copy });
      }
      return;
    }
    const arm = dragArmRef.current;
    if (arm) {
      // Armed pin gesture owns the pointer stream — activate past 3px and
      // slide the pin along its constrained track (parent border / free).
      if (dragPort || Math.hypot(local.x - arm.start.x, local.y - arm.start.y) >= 3) {
        const pt = constrainTerminalPoint(graph, arm.id, local);
        if (pt) setDragPort({ id: arm.id, point: pt });
      }
      return;
    }
    // Highlight the element the active tool would select, so hovering an
    // existing element previews the click before it happens.
    if (tool === "bless") setHoveredId(pickAnyElement(graph, local)?.id ?? null);
    else if (!isSelect) setHoveredId(pickForTool(graph, tool, local));
    handlePointerMove(local);
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    const rArm = resizeArmRef.current;
    if (rArm) {
      resizeArmRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (dragResize) {
        const { orig, bbox } = dragResize;
        const moved = bbox.x !== orig.x || bbox.y !== orig.y || bbox.width !== orig.width || bbox.height !== orig.height;
        // Real drag — commit ONE undo step through the screen (autosave/seal
        // gates ride along). A no-move click on a grip commits nothing.
        if (moved) onBoxResize?.(dragResize.id, bbox);
        setDragResize(null);
      }
      return;
    }
    const cArm = contDragArmRef.current;
    if (cArm) {
      contDragArmRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (dragCont) {
        // Real drag — commit through the screen (undo/autosave/seal gates);
        // the graph op re-derives the snap + target binding as truth.
        if (dragCont.copy) onContinuationCopy?.(dragCont.id, dragCont.point);
        else onContinuationMove?.(dragCont.id, dragCont.point);
        setDragCont(null);
      }
      // Click without movement: the glyph's own selectOnClick already ran.
      return;
    }
    const arm = dragArmRef.current;
    if (arm) {
      dragArmRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (dragPort) {
        // Real drag — commit through the screen (undo/autosave/seal gates).
        onTerminalMove?.(dragPort.id, dragPort.point);
        setDragPort(null);
        return;
      }
      // Click without movement — the mode's normal behavior: select-in-mode
      // for placement tools, otherwise the tool's tap action (ask marks etc.).
      // In select mode the element's own selectOnClick already ran at down.
      if (!isSelect) {
        const local = toLocal(e);
        const hit = pickForTool(graph, tool, local);
        if (hit) setSelectedId(hit);
        else handlePointerUp(local);
      }
      return;
    }
    if (selectingRef.current) {
      // This gesture selected an existing element — do NOT also place one.
      selectingRef.current = false;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      return;
    }
    handlePointerUp(toLocal(e));
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  const pe = isSelect ? "auto" : "none"; // graph elements only catch clicks in select mode
  const selectOnClick = (id: string) => (e: React.PointerEvent) => {
    if (!isSelect) return;
    if (e.ctrlKey) {
      // Ctrl-click over an element still means "attach the text under the
      // cursor" — don't steal the selection.
      e.stopPropagation();
      onCtrlAttach?.(toLocal(e as React.PointerEvent<SVGSVGElement>));
      return;
    }
    setSelectedId(id); e.stopPropagation();
  };
  // Continuation chips need their own down-handler (Shane, 2026-07-11: "im
  // still not able to click a continuation and move it"): the generic
  // selectOnClick stopPropagation'd the press, so the svg-level pointer-down
  // — the ONLY place the drag arms (contHit -> contDragArmRef + capture on
  // the svg) — never saw it. Select here, then LET IT BUBBLE; the svg's
  // contHit branch arms the drag and never clears the selection.
  const contPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (!isSelect) return;
    if (e.ctrlKey) {
      e.stopPropagation();
      onCtrlAttach?.(toLocal(e as React.PointerEvent<SVGSVGElement>));
      return;
    }
    setSelectedId(id);
  };

  // Live resize preview: where each riding pin will land — the SAME math the
  // commit runs (resizedPortPoint), so what you see on release is what you get.
  // With "Terminals ride resized borders" off, pins hold still here too.
  const resizePortPreview = new Map<string, Pt>();
  if (dragResize && settings.resizeRideTerminals) {
    for (const p of graph.ports) {
      if (p.parentId !== dragResize.id && p.parentId2 !== dragResize.id) continue;
      const rp = resizedPortPoint(dragResize.orig, dragResize.bbox, p.point);
      if (rp) resizePortPreview.set(p.id, rp);
    }
  }

  return (
    <svg
      ref={svgRef}
      className={`absolute inset-0 w-full h-full select-none z-10 ${isSelect ? "cursor-default" : hoveredId ? "cursor-pointer" : "cursor-crosshair"}`}
      style={{ touchAction: "none" }}
      viewBox={`0 0 ${PAGE_WIDTH_PX} ${PAGE_HEIGHT_PX}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {settings.showGrid && (
        <>
          <defs>
            <pattern id="cad-grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(89,129,255,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cad-grid)" pointerEvents="none" />
        </>
      )}

      {/* PDF vector artwork + detected terminals (tracing aids) */}
      {settings.showVectors && geometry && (
        <g pointerEvents="none">
          {geometry.segments.map((s, i) => (
            <line key={`seg-${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="rgba(34,211,238,0.28)" strokeWidth={1} />
          ))}
          {geometry.terminals.map((t, i) => (
            <circle key={`tm-${i}`} cx={t.point.x} cy={t.point.y} r={4} fill="none" stroke="rgba(16,185,129,0.6)" strokeWidth={1.2} />
          ))}
          {geometry.junctions.map((j, i) => (
            <circle key={`jx-${i}`} cx={j.x} cy={j.y} r={3} fill="rgba(245,158,11,0.6)" />
          ))}
        </g>
      )}

      {/* Recorded page metadata regions (title, dwg no., circuit descriptions) */}
      <ExperimentalV2MetaLayer meta={graph.meta} />

      {/* Wires */}
      <g>
        {graph.edges.map((edge) => {
          const isSel = selectedId === edge.id;
          const isHov = hoveredId === edge.id;
          // During a pin drag, wires attached to the dragged port preview the
          // SAME H/V-preserving path the commit will produce.
          let path = edge.path;
          if (dragPort && edge.sourcePortId === dragPort.id) path = movedEdgePath(path, "source", dragPort.point);
          if (dragPort && edge.targetPortId === dragPort.id) path = movedEdgePath(path, "target", dragPort.point);
          // During a handle-resize, wires attached to riding pins preview too.
          const rSrc = resizePortPreview.get(edge.sourcePortId);
          const rTgt = resizePortPreview.get(edge.targetPortId);
          if (rSrc) path = movedEdgePath(path, "source", rSrc);
          if (rTgt) path = movedEdgePath(path, "target", rTgt);
          const d = path.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          const mid = midpoint(path);
          return (
            <g key={edge.id}>
              <path
                d={d}
                fill="none"
                stroke={isSel ? "#ec4899" : isHov ? "#5981ff" : "#3b82f6"}
                strokeWidth={isSel ? 4 : 2.5}
                style={{ pointerEvents: pe }}
                onPointerDown={selectOnClick(edge.id)}
                onMouseEnter={() => setHoveredId(edge.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
              {edge.label && (
                <text
                  x={mid.x} y={mid.y - 7} textAnchor="middle"
                  fill="#1d4ed8" stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
                  className="text-[12px] font-mono font-bold pointer-events-none"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Components */}
      <g>
        {graph.nodes.map((node) => {
          const isSel = selectedId === node.id;
          const isHov = hoveredId === node.id;
          // Mid-resize the box (and its label chip) rides the rubber-band.
          const bbox = dragResize?.id === node.id ? dragResize.bbox : node.bbox;
          return (
            <g key={node.id}>
              <rect
                x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height}
                fill={isSel ? "rgba(219,39,119,0.12)" : "rgba(37,99,235,0.10)"}
                stroke={isSel ? "#db2777" : isHov ? "#1d4ed8" : "#2563eb"}
                strokeWidth={isSel ? 3 : 2}
                strokeDasharray="8 5"
                style={{ pointerEvents: pe }}
                onPointerDown={selectOnClick(node.id)}
                onMouseEnter={(e) => {
                  setHoveredId(node.id);
                  if (isSelect && !dragPort && !dragCont && !dragResize && node.label) {
                    onComponentHover?.({ mark: node.label, clientX: e.clientX, clientY: e.clientY });
                  }
                }}
                onMouseLeave={() => { setHoveredId(null); onComponentHover?.(null); }}
              />
              {/* Solid label chip — legible over the white page and dark artwork alike */}
              <g className="pointer-events-none">
                <rect
                  x={bbox.x} y={bbox.y - 19}
                  width={Math.max(16, node.label.length * 7.7 + 10)} height={17} rx={3}
                  fill={isSel ? "#db2777" : "#2563eb"}
                />
                <text x={bbox.x + 5} y={bbox.y - 6} fill="#ffffff" className="text-[12px] font-mono font-bold">
                  {node.label}
                </text>
              </g>
            </g>
          );
        })}
      </g>

      {/* Terminals */}
      <g>
        {graph.ports.map((port) => {
          const isSel = selectedId === port.id;
          const isHov = hoveredId === port.id;
          const pt = dragPort?.id === port.id ? dragPort.point : resizePortPreview.get(port.id) ?? port.point;
          if (port.type === "mate") {
            // Mate terminal (Shane, 2026-07-09): ONE point owned by TWO flush
            // parts — drawn as a two-tone diamond straddling the shared border
            // so mating reads differently from an ordinary terminal at a glance.
            const r = isHov || isSel ? 9 : 7;
            const { x, y } = pt;
            return (
              <g key={port.id}>
                <path d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} Z`}
                  fill={isSel ? "#ec4899" : "#22d3ee"} stroke="#fff" strokeWidth={1.2}
                  style={{ pointerEvents: pe }} onPointerDown={selectOnClick(port.id)}
                  onMouseEnter={() => setHoveredId(port.id)} onMouseLeave={() => setHoveredId(null)} />
                <path d={`M ${x} ${y - r} L ${x - r} ${y} L ${x} ${y + r} Z`}
                  fill={isSel ? "#ec4899" : "#10b981"} stroke="#fff" strokeWidth={1.2}
                  style={{ pointerEvents: pe }} onPointerDown={selectOnClick(port.id)}
                  onMouseEnter={() => setHoveredId(port.id)} onMouseLeave={() => setHoveredId(null)} />
                {(isHov || isSel) && (
                  <text x={x + r + 3} y={y + 4}
                    fill="#0e7490" stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
                    className="text-[11px] font-mono font-bold pointer-events-none">
                    {port.label} ⋈
                  </text>
                )}
              </g>
            );
          }
          return (
            <g key={port.id}>
              <circle
                cx={pt.x} cy={pt.y} r={isHov || isSel ? 7 : 5}
                fill={isSel ? "#ec4899" : isHov ? "#5981ff" : "#10b981"}
                stroke="#fff" strokeWidth={1.5}
                style={{ pointerEvents: pe }}
                onPointerDown={selectOnClick(port.id)}
                onMouseEnter={() => setHoveredId(port.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
              {(isHov || isSel) && (
                <text
                  x={pt.x + 9} y={pt.y + 4}
                  fill="#047857" stroke="#ffffff" strokeWidth={3.5} paintOrder="stroke" strokeLinejoin="round"
                  className="text-[11px] font-mono font-bold pointer-events-none"
                >
                  {port.label}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Continuations (off-page cross-references) */}
      <g>
        {graph.continuations.map((c) => {
          const isSel = selectedId === c.id;
          const ref = c.sheet && c.zone ? `${c.sheet}/${c.zone}` : c.rawRef ?? "?";
          // Mid-drag the glyph rides the cursor (or the snapped endpoint).
          const pt = dragCont?.id === c.id && !dragCont.copy ? (dragCont.snap ?? dragCont.point) : c.point;
          // Status colors (Shane, 2026-07-11): connected or WHY NOT, at a
          // glance — resolved green, waiting/device amber, mismatch violet
          // (the actionable alarm), unanchored rose, unlabeled slate.
          const st = contStatuses?.get(c.id);
          const CHIP: Record<string, { fill: string; stroke: string; text: string }> = {
            resolved: { fill: "#22c55e", stroke: "#15803d", text: "#052e16" },
            mismatch: { fill: "#8b5cf6", stroke: "#6d28d9", text: "#f5f3ff" },
            unanchored: { fill: "#f43f5e", stroke: "#be123c", text: "#fff1f2" },
            unlabeled: { fill: "#94a3b8", stroke: "#64748b", text: "#0f172a" },
            waiting: { fill: "#f59e0b", stroke: "#b45309", text: "#1c1917" },
            device: { fill: "#f59e0b", stroke: "#b45309", text: "#1c1917" },
            // Symbol annotations carry NO status: quiet outline, print-toned.
            symbol: { fill: "rgba(15,23,42,0.72)", stroke: "#a16207", text: "#fbbf24" },
            // Orphan symbol: the printed ref's electrical side is MISSING —
            // the machine graph is severed here. Loudest chip on the page.
            orphan: { fill: "#e11d48", stroke: "#fda4af", text: "#fff1f2" },
          };
          const chip = CHIP[st?.state ?? "waiting"] ?? CHIP.waiting;
          return (
            <g key={c.id}>
              {(() => { const w = Math.max(22, ref.length * 7 + 8); return (
                <>
                  <rect
                    x={pt.x - w / 2} y={pt.y - 9} width={w} height={18} rx={3}
                    fill={chip.fill}
                    stroke={isSel ? "#db2777" : chip.stroke}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    opacity={dragCont?.id === c.id ? 0.85 : 1}
                    style={{ pointerEvents: pe, cursor: isSelect ? "grab" : undefined }}
                    onPointerDown={contPointerDown(c.id)}
                    onPointerEnter={() => setHoverCont(c.id)}
                    onPointerLeave={() => setHoverCont((h) => (h === c.id ? null : h))}
                  />
                  <text x={pt.x} y={pt.y + 4} textAnchor="middle" fill={chip.text} className="text-[11px] font-mono font-bold pointer-events-none">
                    {ref}
                  </text>
                </>
              ); })()}
            </g>
          );
        })}
        {/* Shift+drag copy ghost: the original stays put; a dashed twin rides
            the cursor (or the snapped wire end) until release binds it. */}
        {dragCont?.copy && (() => {
          const src = graph.continuations.find((x) => x.id === dragCont.id);
          if (!src) return null;
          const ref = src.sheet && src.zone ? `${src.sheet}/${src.zone}` : src.rawRef ?? "?";
          const gp = dragCont.snap ?? dragCont.point;
          const w = Math.max(22, ref.length * 7 + 8);
          return (
            <g className="pointer-events-none" opacity={0.85}>
              <rect x={gp.x - w / 2} y={gp.y - 9} width={w} height={18} rx={3}
                fill="rgba(245,158,11,0.35)" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={gp.x} y={gp.y + 4} textAnchor="middle" fill="#fbbf24" className="text-[11px] font-mono font-bold">
                {ref}
              </text>
            </g>
          );
        })()}
        {/* Status tooltip (Shane, 2026-07-11): hover a chip -> an instant
            card with the state and the why, replacing the sluggish native
            <title>. Page-space like the chips; suppressed mid-drag. */}
        {hoverCont && !dragCont && (() => {
          const c = graph.continuations.find((x) => x.id === hoverCont);
          const st = contStatuses?.get(hoverCont);
          if (!c || !st) return null;
          const TONE: Record<string, { accent: string; label: string }> = {
            resolved: { accent: "#4ade80", label: "LINKED" },
            waiting: { accent: "#fbbf24", label: "WAITING" },
            mismatch: { accent: "#a78bfa", label: "MISMATCH" },
            unanchored: { accent: "#fb7185", label: "UNANCHORED" },
            unlabeled: { accent: "#cbd5e1", label: "NO WIRE #" },
            device: { accent: "#fbbf24", label: "DEVICE REF" },
            symbol: { accent: "#fbbf24", label: "SYMBOL" },
            orphan: { accent: "#fda4af", label: "SEVERED" },
          };
          const tone = TONE[st.state] ?? TONE.waiting;
          const ref = c.sheet && c.zone ? `${c.sheet}/${c.zone}` : c.rawRef ?? "?";
          // Wrap the detail into ~44-char lines (SVG text doesn't flow).
          const lines: string[] = [];
          let line = "";
          for (const word of st.detail.split(/\s+/)) {
            if ((line + " " + word).trim().length > 44) { lines.push(line.trim()); line = word; }
            else line += ` ${word}`;
          }
          if (line.trim()) lines.push(line.trim());
          const W = Math.max(230, Math.min(360, 8 * Math.max(...lines.map((l) => l.length), tone.label.length + ref.length + 4)));
          const H = 30 + lines.length * 17;
          const tx = Math.max(8, Math.min(2481 - W - 8, c.point.x - W / 2));
          const ty = c.point.y - 16 - H < 8 ? c.point.y + 16 : c.point.y - 16 - H;
          return (
            <g className="pointer-events-none">
              <rect x={tx} y={ty} width={W} height={H} rx={8}
                fill="rgba(10,15,28,0.94)" stroke={tone.accent} strokeOpacity={0.45} strokeWidth={1.2} />
              <text x={tx + 12} y={ty + 19} fill={tone.accent} className="text-[12px] font-semibold" style={{ letterSpacing: "0.08em" }}>
                {tone.label}
              </text>
              <text x={tx + W - 12} y={ty + 19} textAnchor="end" fill="#94a3b8" className="text-[12px] font-mono">
                {ref}
              </text>
              {lines.map((l, i) => (
                <text key={i} x={tx + 12} y={ty + 38 + i * 17} fill="#cbd5e1" className="text-[12.5px]">
                  {l}
                </text>
              ))}
            </g>
          );
        })()}
        {/* Ghost terminals (Shane's feature, 2026-07-09): while dragging the
            component box, rings appear live where printed conductors cross the
            rubber-band border — the pinout materializes as you size the box.
            Release mints them for real. */}
        {tool === "component" && stroke && stroke.length > 1 && (() => {
          const gb = {
            x: Math.min(stroke[0].x, stroke[stroke.length - 1].x),
            y: Math.min(stroke[0].y, stroke[stroke.length - 1].y),
            width: Math.abs(stroke[stroke.length - 1].x - stroke[0].x),
            height: Math.abs(stroke[stroke.length - 1].y - stroke[0].y),
          };
          // Strip preview (2026-07-10): when the drag encloses a printed pin
          // table, rows dictate the previewed pin slots — the SAME names the
          // commit will mint — and the designator reads from ABOVE the tight
          // box (the resolver's inside zone would pick the table's header).
          const ghostRows = extractStripRows(gb, geometry);
          const ghostIsStrip = ghostRows.length >= STRIP_MIN_ROWS;
          const owner = (ghostIsStrip ? stripTitleAbove(gb, geometry) : null) ?? resolveComponentLabel?.(gb) ?? null;
          const crossings = detectBorderCrossings(gb, geometry, 8, settings.netLabelWalkPx, owner);
          return (
            <>
              {/* The component's own future designator, previewed above the box. */}
              {owner && (
                <text x={gb.x + gb.width / 2} y={gb.y - 10} fontSize={13} fontWeight={700}
                  fontFamily="ui-monospace, monospace" fill="#3b82f6" textAnchor="middle" className="pointer-events-none">
                  {owner}{ghostIsStrip ? `  · strip · ${ghostRows.length} rows` : ""}
                </text>
              )}
              {crossings.map((c, i) => {
                const row = ghostIsStrip ? rowForY(ghostRows, c.point.y) : null;
                const pinSlot = row ? `${row.pin}~` : c.pinLabel ? `${c.pinLabel}~` : "";
                return (
                  <g key={`ghost-${i}`} className="pointer-events-none">
                    <circle cx={c.point.x} cy={c.point.y} r={9} fill="rgba(52,211,153,.15)" stroke="#34d399" strokeWidth={2.5} />
                    {c.netLabel && (
                      <text x={c.point.x + (c.side === "left" ? -12 : c.side === "right" ? 12 : 0)}
                        y={c.point.y + (c.side === "top" ? -12 : c.side === "bottom" ? 16 : 4)}
                        fontSize={10} fontFamily="ui-monospace, monospace" fill="#34d399"
                        textAnchor={c.side === "left" ? "end" : c.side === "right" ? "start" : "middle"}>
                        {owner ? `T~${owner}~${pinSlot}${c.netLabel}` : c.netLabel}
                      </text>
                    )}
                  </g>
                );
              })}
            </>
          );
        })()}

        {/* Continuation-drag snap preview: green ring on the wire endpoint the
            drop will attach to (the placement doctrine made visible). */}
        {dragCont?.snap && (
          <circle cx={dragCont.snap.x} cy={dragCont.snap.y} r={14} fill="none" stroke="#34d399" strokeWidth={3} className="pointer-events-none">
            <animate attributeName="r" values="11;17;11" dur="1s" repeatCount="indefinite" />
          </circle>
        )}
      </g>

      {/* Grounds (earth references) — first-class, kept visually distinct from
          components: green box hugging the glyph + a small earth mark + label. */}
      <g>
        {(graph.grounds ?? []).map((gnd) => {
          const isSel = selectedId === gnd.id;
          const isHov = hoveredId === gnd.id;
          // Mid-resize the ground box (and its label) rides the rubber-band.
          const bbox = dragResize?.id === gnd.id ? dragResize.bbox : gnd.bbox;
          const cx = bbox.x + bbox.width / 2;
          return (
            <g key={gnd.id}>
              <rect
                x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height} rx={3}
                fill={isSel ? "rgba(219,39,119,0.12)" : isHov ? "rgba(34,197,94,0.20)" : "rgba(22,163,74,0.12)"}
                stroke={isSel ? "#db2777" : isHov ? "#4ade80" : "#16a34a"}
                strokeWidth={isSel ? 3 : isHov ? 3 : 2}
                style={{ pointerEvents: pe }}
                onPointerDown={selectOnClick(gnd.id)}
                onMouseEnter={() => setHoveredId(gnd.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
              <g className="pointer-events-none">
                <rect
                  x={cx - Math.max(16, gnd.label.length * 7.7 + 10) / 2} y={bbox.y + bbox.height + 3}
                  width={Math.max(16, gnd.label.length * 7.7 + 10)} height={16} rx={3}
                  fill={isSel ? "#db2777" : "#16a34a"}
                />
                <text x={cx} y={bbox.y + bbox.height + 15} textAnchor="middle" fill="#ffffff" className="text-[11px] font-mono font-bold">
                  {gnd.label}
                </text>
              </g>
            </g>
          );
        })}
      </g>

      {/* Cables (Shane's design, 2026-07-10 v2): a BBOX around the printed
          bundle symbol — YOLO-honest like every element. Slate hatch echoes
          the print; the chip names the registry key. Never conducts. */}
      <g>
        {(graph.cables ?? []).map((cab) => {
          const isSel = selectedId === cab.id;
          const isHov = hoveredId === cab.id;
          const bbox = dragResize?.id === cab.id ? dragResize.bbox : cab.bbox;
          const color = isSel ? "#db2777" : isHov ? "#94a3b8" : "#64748b";
          // Diagonal hatch across the box, the print's own bundle vocabulary.
          const hatch: string[] = [];
          const step = 18;
          for (let o = step; o < bbox.width + bbox.height; o += step) {
            const x1 = Math.max(bbox.x, bbox.x + o - bbox.height);
            const y1 = Math.min(bbox.y + bbox.height, bbox.y + o);
            const x2 = Math.min(bbox.x + bbox.width, bbox.x + o);
            const y2 = Math.max(bbox.y, bbox.y + o - bbox.width);
            hatch.push(`M ${x1} ${y1} L ${x2} ${y2}`);
          }
          return (
            <g key={cab.id}>
              <rect
                x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height} rx={3}
                fill={isSel ? "rgba(219,39,119,0.10)" : "rgba(100,116,139,0.10)"}
                stroke={color} strokeWidth={isSel ? 3 : 2}
                style={{ pointerEvents: pe }}
                onPointerDown={selectOnClick(cab.id)}
                onMouseEnter={() => setHoveredId(cab.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
              <path d={hatch.join(" ")} stroke={color} strokeWidth={1} strokeOpacity={0.45} fill="none" className="pointer-events-none" />
              <g className="pointer-events-none">
                <rect x={bbox.x} y={bbox.y - 19}
                  width={Math.max(16, cab.label.length * 7.7 + 10)} height={17} rx={3}
                  fill={isSel ? "#db2777" : "#475569"} />
                <text x={bbox.x + 5} y={bbox.y - 6} fill="#ffffff" className="text-[12px] font-mono font-bold">
                  {cab.label}
                </text>
              </g>
              {/* Committed link ghosts: a resize drag previews the touch. */}
              {dragResize?.id === cab.id && stripsTouchingBox(graph.nodes, bbox).map((strip) => {
                const tp = touchPoint(bbox, strip.bbox);
                return <ChainLinkGhost key={strip.id} x={tp.x} y={tp.y} label={`links ${strip.label}`} />;
              })}
            </g>
          );
        })}
      </g>

      {/* Bless selection (2026-07-08): amber highlight on every element the
          in-progress bless will capture — a click plus Ctrl+clicks build the
          set, so a ground + its border terminals light up together. */}
      {blessIds && blessIds.size > 0 && (
        <g pointerEvents="none">
          {[...blessIds].map((id) => {
            const box =
              (graph.grounds ?? []).find((g) => g.id === id)?.bbox ??
              graph.nodes.find((n) => n.id === id)?.bbox;
            if (box) {
              return (
                <rect
                  key={`bl-${id}`}
                  x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6}
                  rx={4} fill="rgba(245,158,11,0.14)" stroke="#f59e0b" strokeWidth={3}
                />
              );
            }
            const port = graph.ports.find((p) => p.id === id);
            if (port) {
              return (
                <circle
                  key={`bl-${id}`}
                  cx={port.point.x} cy={port.point.y} r={11}
                  fill="rgba(245,158,11,0.18)" stroke="#f59e0b" strokeWidth={3}
                />
              );
            }
            const cont = graph.continuations.find((c) => c.id === id);
            if (cont) {
              return (
                <circle key={`bl-${id}`} cx={cont.point.x} cy={cont.point.y} r={16} fill="none" stroke="#f59e0b" strokeWidth={3} />
              );
            }
            const edge = graph.edges.find((ed) => ed.id === id);
            if (edge) {
              const d = edge.path.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
              return <path key={`bl-${id}`} d={d} fill="none" stroke="#f59e0b" strokeWidth={5} strokeOpacity={0.75} />;
            }
            return null;
          })}
        </g>
      )}

      {/* Evidence attachments: printed-text anchors on components (digital-twin
          pattern). Selectable in select mode so bad evidence can be Del'd. */}
      <g pointerEvents={pe}>
        {graph.nodes.flatMap((n) =>
          (n.attachments ?? []).map((a) => {
            const color =
              a.kind === "part_number" ? "#8b5cf6" :
              a.kind === "spec" ? "#14b8a6" :
              a.kind === "wire_label" ? "#0ea5e9" :
              a.kind === "location" ? "#f59e0b" :
              a.kind === "ground_label" ? "#22c55e" :
              a.kind === "terminal" || a.kind === "terminal_label" ? "#ec4899" :
              "#64748b";
            return (
              <rect
                key={a.id}
                x={a.bbox.x - 2}
                y={a.bbox.y - 2}
                width={a.bbox.width + 4}
                height={a.bbox.height + 4}
                fill={selectedId === a.id ? "rgba(244,63,94,0.14)" : "rgba(0,0,0,0.001)"}
                stroke={selectedId === a.id ? "#f43f5e" : color}
                strokeWidth={selectedId === a.id ? 2.5 : 1.5}
                strokeDasharray="4 3"
                rx={3}
                style={isSelect ? { cursor: "pointer" } : undefined}
                onPointerDown={selectOnClick(a.id)}
              />
            );
          })
        )}
      </g>

      {/* Live stroke — component + connector are rubber-band RECTS (anchor →
          cursor; Shane's interaction model, 2026-07-09); freehand + wire keep
          the raw polyline (encircle / trace gestures). */}
      {/* Cable drag: rubber-band rect + CHAIN-LINK GHOSTS (Shane, 2026-07-10:
          "when it's close enough to link, show a ghost preview of a chain
          link where it's going to link") — the same touch test the commit
          runs, so a visible link WILL adopt on release. */}
      {tool === "cable" && stroke && stroke.length > 1 && (() => {
        const gb = {
          x: Math.min(stroke[0].x, stroke[stroke.length - 1].x),
          y: Math.min(stroke[0].y, stroke[stroke.length - 1].y),
          width: Math.abs(stroke[stroke.length - 1].x - stroke[0].x),
          height: Math.abs(stroke[stroke.length - 1].y - stroke[0].y),
        };
        const name = cableLabelNear(gb, geometry);
        return (
          <g className="pointer-events-none">
            <rect x={gb.x} y={gb.y} width={gb.width} height={gb.height} rx={3}
              fill="rgba(100,116,139,0.08)" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 4" />
            {name && (
              <text x={gb.x + gb.width / 2} y={gb.y - 10} fontSize={13} fontWeight={700}
                fontFamily="ui-monospace, monospace" fill="#94a3b8" textAnchor="middle">
                {name}
              </text>
            )}
            {stripsTouchingBox(graph.nodes, gb).map((strip) => {
              const tp = touchPoint(gb, strip.bbox);
              return (
                <g key={strip.id}>
                  <rect x={strip.bbox.x - 3} y={strip.bbox.y - 3} width={strip.bbox.width + 6} height={strip.bbox.height + 6}
                    rx={4} fill="none" stroke="#34d399" strokeWidth={2} strokeDasharray="4 4" />
                  <ChainLinkGhost x={tp.x} y={tp.y} label={`links ${strip.label} · ${strip.rows?.length ?? 0} conductors`} />
                </g>
              );
            })}
            {/* Connector/component terminals inside the box link too (Shane:
                cables attach through the component's connector terminal). */}
            {(() => {
              const stripIds = new Set(graph.nodes.filter((n) => n.kind === "strip").map((n) => n.id));
              const touching = portsTouchingBox(graph.ports, gb).filter(
                (tp) => !stripIds.has(tp.parentId) && tp.net !== name
              );
              const byOwner = new Map<string, typeof touching>();
              for (const tp of touching) {
                const k = tp.parentId || tp.net;
                if (!byOwner.has(k)) byOwner.set(k, []);
                byOwner.get(k)!.push(tp);
              }
              return [...byOwner.entries()].map(([k, group]) => {
                const cx = group.reduce((a, t) => a + t.point.x, 0) / group.length;
                const cy = group.reduce((a, t) => a + t.point.y, 0) / group.length;
                const owner = graph.nodes.find((n) => n.id === k)?.label;
                const what = owner ?? group[0].net;
                return <ChainLinkGhost key={`plg-${k}`} x={cx} y={cy} label={`links ${what} · ${group.length} conductor${group.length > 1 ? "s" : ""}`} />;
              });
            })()}
          </g>
        );
      })()}

      {stroke && stroke.length > 1 && (tool === "connector" || tool === "component" ? (
        <rect
          x={Math.min(stroke[0].x, stroke[stroke.length - 1].x)}
          y={Math.min(stroke[0].y, stroke[stroke.length - 1].y)}
          width={Math.abs(stroke[stroke.length - 1].x - stroke[0].x)}
          height={Math.abs(stroke[stroke.length - 1].y - stroke[0].y)}
          fill={tool === "component" ? "rgba(59,130,246,0.06)" : "rgba(139,92,246,0.06)"}
          stroke={tool === "component" ? "#3b82f6" : "#8b5cf6"} strokeWidth={2} strokeDasharray="6 4"
          className="pointer-events-none"
        />
      ) : (
        <polyline
          points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={tool === "freehand" ? "rgba(139,92,246,0.06)" : "none"}
          stroke="#8b5cf6" strokeWidth={2} strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round"
          className="pointer-events-none"
        />
      ))}

      {/* Active snap marker */}
      {geometrySnap && (
        <g className="pointer-events-none">
          <circle cx={geometrySnap.point.x} cy={geometrySnap.point.y} r={8} fill="none" stroke={SNAP_KIND_COLOR[geometrySnap.kind]} strokeWidth={2} />
          <circle cx={geometrySnap.point.x} cy={geometrySnap.point.y} r={2} fill={SNAP_KIND_COLOR[geometrySnap.kind]} />
        </g>
      )}

      {/* Net color mode: continuity wash — ABOVE the drawn graph so colors read;
          glow + brightness tunable in settings. */}
      {settings.netColorMode && geometry && netColoring && (
        <g pointerEvents="none" style={{ filter: `brightness(${settings.netBrightness})` }}>
          {settings.netGlowPx > 0 && (
            <defs>
              <filter id="v2-net-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur in="SourceGraphic" stdDeviation={settings.netGlowPx / 2} result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
          )}
          <g filter={settings.netGlowPx > 0 ? "url(#v2-net-glow)" : undefined}>
            {geometry.segments.map((s, i) => (
              <line
                key={`net-${i}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke={netColoring.segmentColor(i)}
                strokeWidth={3.5}
                strokeLinecap="round"
              />
            ))}
          </g>
        </g>
      )}

      {/* Net color mode: clickable junction toggles — break/restore a merge (topmost so they always catch the click) */}
      {settings.netColorMode && geometry && netColoring && (
        <g>
          {netColoring.mergeNodes.map((n) => (
            <circle
              key={`mn-${n.key}`}
              cx={n.point.x}
              cy={n.point.y}
              r={5}
              fill={n.isolated ? "rgba(239,68,68,0.92)" : "rgba(255,255,255,0.35)"}
              stroke={n.isolated ? "#ef4444" : "rgba(100,116,139,0.85)"}
              strokeWidth={1.5}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onToggleJunction?.(n.key);
              }}
            >
              <title>{n.isolated ? "Isolated — click to reconnect" : `Junction — ${n.degree} wires meet · click to break`}</title>
            </circle>
          ))}
        </g>
      )}

      {/* Resize grips (Shane's pinned resizable bboxes): the selected
          COMPONENT grows 8 handles; drag one and border terminals RIDE the
          moved edge, previewed live with the exact commit math. Topmost so a
          grip always wins the press — EXCEPT mid-edge grips, which yield to a
          terminal sitting under them (the pin-drag gesture keeps right of way
          on its own border). GROUNDS get no grips (Shane, 2026-07-10): they
          snap snug to the printed glyph — on a ~26px box the grips blanketed
          the border and pen taps deformed it. Re-snap via the Ground tool is
          their geometry editor; the copilot resize op still covers grounds. */}
      {(() => {
        if (!onBoxResize || !selectedId) return null;
        // Grips appear wherever this element is selectable: select mode, or
        // its own placement tool's select-in-mode.
        const owner =
          graph.nodes.find((n) => n.id === selectedId) ??
          (graph.cables ?? []).find((c) => c.id === selectedId);
        if (!owner) return null;
        const isCable = "type" in owner && owner.type === "cable";
        const toolAllows = isSelect || (isCable ? tool === "cable" : tool === "component" || tool === "freehand");
        if (!toolAllows) return null;
        const origBox = owner.bbox;
        const b = dragResize?.id === selectedId ? dragResize.bbox : origBox;
        return (
          <g>
            {RESIZE_HANDLES.map((h) => {
              const pt = handlePoint(b, h);
              if (h.length === 1 && !dragResize) {
                const shadowed = graph.ports.some(
                  (p) => p.type !== "junction" && Math.hypot(p.point.x - pt.x, p.point.y - pt.y) <= 14
                );
                if (shadowed) return null;
              }
              return (
                <rect
                  key={`rh-${h}`}
                  x={pt.x - 4} y={pt.y - 4} width={8} height={8}
                  fill="#ffffff" stroke="#db2777" strokeWidth={1.8}
                  style={{ pointerEvents: "auto", cursor: HANDLE_CURSOR[h] }}
                  onPointerDown={(e) => {
                    if (e.pointerType === "touch" || e.button !== 0 || e.ctrlKey) return;
                    e.stopPropagation();
                    resizeArmRef.current = { id: selectedId, handle: h, start: toLocal(e as unknown as React.PointerEvent<SVGSVGElement>), orig: { ...origBox } };
                    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* synthetic pointers (tests) have no capture */ }
                  }}
                />
              );
            })}
          </g>
        );
      })()}
    </svg>
  );
}
