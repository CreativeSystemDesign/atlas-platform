"use client";

// Copilot overlay: renders agent-issued highlights on top of the canvas.
// Pointer-transparent page-space SVG, mounted beside ExperimentalV2Svg.

import React from "react";
import { PAGE_WIDTH_PX, PAGE_HEIGHT_PX } from "../extraction-workbench/studio-types";
import { type PageGeometry } from "./v2-snapping";
import { type NetColoring } from "./v2-nets";
import { type V2Graph } from "./experimental-v2-types";
import { type ArrowMark, type AskMark, type BoxMark, type BridgeHighlight, type LassoRegion, type PenMark, type TextCallout, type Point } from "./v2-bridge-types";

const ASK_COLOR = "#22d3ee"; // cyan — Shane's marks; amber is the copilot's

// Catmull-Rom → cubic Bézier: turn a raw point list into a fluid, closed curve.
// The freehand loop must read as an intentional object, not a jittery polygon —
// this is the difference between "premium" and "corny" (Shane's bar).
function smoothClosedPath(pts: Point[]): string {
  if (pts.length < 2) return "";
  const p = pts;
  const n = p.length;
  let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n];
    const p1 = p[i];
    const p2 = p[(i + 1) % n];
    const p3 = p[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + " Z";
}

// Catmull-Rom → cubic Bézier for an OPEN stroke (pen ink): same fluid curve as
// the lasso, but the ends stay open (endpoints are their own control anchors).
function smoothOpenPath(pts: Point[]): string {
  if (pts.length < 2) return "";
  const p = pts;
  const n = p.length;
  let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

type Props = {
  highlights: BridgeHighlight[];
  askMarks: AskMark[];
  lassoRegions?: LassoRegion[];
  lassoStroke?: Point[] | null;
  penMarks?: PenMark[];
  penStroke?: Point[] | null;
  arrowMarks?: ArrowMark[];
  arrowStroke?: { tail: Point; head: Point } | null;
  boxMarks?: BoxMark[];
  boxStroke?: { a: Point; b: Point } | null;
  textCallouts?: TextCallout[];
  geometry: PageGeometry | null;
  netColoring: NetColoring | null;
  graph: V2Graph;
  // Flag-pill triage (kind:"flag" highlights only): check = "this flag is wrong"
  // (disposed false-positive, saved for calibration); hide = mute from view but
  // keep it live for the copilot's audit. See experimental-v2-screen.
  onDisposeFlag?: (h: BridgeHighlight) => void;
  onHideFlag?: (h: BridgeHighlight) => void;
};

export function ExperimentalV2BridgeOverlay({ highlights, askMarks, lassoRegions = [], lassoStroke, penMarks = [], penStroke, arrowMarks = [], arrowStroke, boxMarks = [], boxStroke, textCallouts = [], geometry, netColoring, graph, onDisposeFlag, onHideFlag }: Props) {
  if (highlights.length === 0 && askMarks.length === 0 && lassoRegions.length === 0 && !lassoStroke && penMarks.length === 0 && !penStroke
      && arrowMarks.length === 0 && !arrowStroke && boxMarks.length === 0 && !boxStroke && textCallouts.length === 0) return null;
  return (
    <svg
      className="absolute inset-0 z-20 h-full w-full pointer-events-none"
      viewBox={`0 0 ${PAGE_WIDTH_PX} ${PAGE_HEIGHT_PX}`}
    >
      <defs>
        {/* Soft outer glow for the lasso stroke — the luminous, premium feel. */}
        <filter id="lasso-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Committed lasso regions — smoothed cyan loop, faint interior wash, tag. */}
      {lassoRegions.map((r) => {
        const d = smoothClosedPath(r.points);
        const tagX = r.bbox.x + r.bbox.width;
        const tagY = r.bbox.y;
        return (
          <g key={`lasso-${r.n}`} style={{ animation: "sc-breath 3.2s ease-in-out infinite" }}>
            <path d={d} fill={ASK_COLOR} fillOpacity={0.06} stroke="none" />
            <path d={d} fill="none" stroke={ASK_COLOR} strokeWidth={3.5} strokeLinejoin="round" opacity={0.95} filter="url(#lasso-glow)" />
            <circle cx={tagX} cy={tagY} r={15} fill={ASK_COLOR} />
            <text x={tagX} y={tagY} fontSize={17} fontWeight={700} fontFamily="ui-monospace, monospace" fill="#0f172a" textAnchor="middle" dominantBaseline="central">
              {r.n}
            </text>
          </g>
        );
      })}

      {/* In-progress stroke while the pointer is down — a live raw polyline so
          drawing feels immediate; it resolves to the smoothed loop on release. */}
      {lassoStroke && lassoStroke.length > 1 && (
        <polyline
          points={lassoStroke.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={ASK_COLOR}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
          strokeDasharray="2 8"
        />
      )}

      {/* Committed pen ink — smoothed open cyan stroke, glow, numbered tag. The
          element-anchored sibling of the lasso; it stays as the visible anchor. */}
      {penMarks.map((m) => {
        const d = smoothOpenPath(m.points);
        const tag = m.points[m.points.length - 1] ?? { x: m.bbox.x, y: m.bbox.y };
        return (
          <g key={`pen-${m.n}`} style={{ animation: "sc-breath 3.2s ease-in-out infinite" }}>
            <path d={d} fill="none" stroke={ASK_COLOR} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} filter="url(#lasso-glow)" />
            <circle cx={tag.x + 16} cy={tag.y - 16} r={13} fill={ASK_COLOR} />
            <text x={tag.x + 16} y={tag.y - 16} fontSize={15} fontWeight={700} fontFamily="ui-monospace, monospace" fill="#0f172a" textAnchor="middle" dominantBaseline="central">
              {m.n}
            </text>
          </g>
        );
      })}

      {/* In-progress ink while the pointer is down — live raw polyline. */}
      {penStroke && penStroke.length > 1 && (
        <polyline
          points={penStroke.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={ASK_COLOR}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      )}

      {/* Arrowhead marker for arrow marks (user-ink cyan). */}
      <defs>
        <marker id="mark-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#0891b2" />
        </marker>
      </defs>

      {/* Committed arrow marks — cyan vector + numbered badge at the tail. */}
      {arrowMarks.map((m) => (
        <g key={`arrow-${m.n}`}>
          <line x1={m.tail.x} y1={m.tail.y} x2={m.head.x} y2={m.head.y}
            stroke="#0891b2" strokeWidth={2.5} strokeLinecap="round" markerEnd="url(#mark-arrowhead)" />
          <circle cx={m.tail.x} cy={m.tail.y} r={11} fill="#0891b2" />
          <text x={m.tail.x} y={m.tail.y} fontSize={13} fontWeight={700} fontFamily="ui-monospace, monospace"
            fill="#f0fdff" textAnchor="middle" dominantBaseline="central">{m.n}</text>
        </g>
      ))}
      {/* Live arrow preview. */}
      {arrowStroke && (
        <line x1={arrowStroke.tail.x} y1={arrowStroke.tail.y} x2={arrowStroke.head.x} y2={arrowStroke.head.y}
          stroke="#0891b2" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="7 5" markerEnd="url(#mark-arrowhead)" opacity={0.8} />
      )}

      {/* Committed box marks — amber region rectangles (the lasso's sibling). */}
      {boxMarks.map((m) => (
        <g key={`box-${m.n}`}>
          <rect x={m.bbox.x} y={m.bbox.y} width={m.bbox.width} height={m.bbox.height} rx={5}
            fill="rgba(217,119,6,.05)" stroke="#d97706" strokeWidth={2} strokeDasharray="6 5" />
          <circle cx={m.bbox.x + m.bbox.width} cy={m.bbox.y} r={12} fill="#d97706" />
          <text x={m.bbox.x + m.bbox.width} y={m.bbox.y} fontSize={13} fontWeight={700} fontFamily="ui-monospace, monospace"
            fill="#1c1917" textAnchor="middle" dominantBaseline="central">{m.n}</text>
        </g>
      ))}
      {/* Live box preview. */}
      {boxStroke && (
        <rect
          x={Math.min(boxStroke.a.x, boxStroke.b.x)} y={Math.min(boxStroke.a.y, boxStroke.b.y)}
          width={Math.abs(boxStroke.b.x - boxStroke.a.x)} height={Math.abs(boxStroke.b.y - boxStroke.a.y)} rx={5}
          fill="rgba(217,119,6,.05)" stroke="#d97706" strokeWidth={2} strokeDasharray="6 5" opacity={0.85} />
      )}

      {/* Text callouts — pinned label chips in the user-ink family. */}
      {textCallouts.map((m) => {
        const w = Math.min(300, m.text.length * 7.2 + 34);
        return (
          <g key={`note-${m.n}`}>
            <line x1={m.x} y1={m.y} x2={m.x + 14} y2={m.y - 14} stroke="#0891b2" strokeWidth={1.5} />
            <circle cx={m.x} cy={m.y} r={4} fill="#0891b2" />
            <rect x={m.x + 14} y={m.y - 30} width={w} height={22} rx={6}
              fill="rgba(8,35,48,.92)" stroke="#0891b2" strokeWidth={1.2} />
            <text x={m.x + 22} y={m.y - 19} fontSize={12} fontFamily="ui-monospace, monospace" fill="#a5f3fc" dominantBaseline="central">
              {m.text.length > 38 ? m.text.slice(0, 37) + "…" : m.text}
            </text>
            <circle cx={m.x + 14} cy={m.y - 30} r={9} fill="#0891b2" />
            <text x={m.x + 14} y={m.y - 30} fontSize={11} fontWeight={700} fontFamily="ui-monospace, monospace"
              fill="#f0fdff" textAnchor="middle" dominantBaseline="central">{m.n}</text>
          </g>
        );
      })}

      {highlights.map((h) => (
        <Highlight key={h.key} h={h} geometry={geometry} netColoring={netColoring} graph={graph} onDispose={onDisposeFlag} onHide={onHideFlag} />
      ))}
      {askMarks.map((m) => (
        <g key={`ask-${m.n}`}>
          <circle cx={m.x} cy={m.y} r={22} fill="none" stroke={ASK_COLOR} strokeWidth={4} opacity={0.9}>
            <animate attributeName="r" values="18;28;18" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={m.x + 24} cy={m.y - 24} r={14} fill={ASK_COLOR} />
          <text
            x={m.x + 24}
            y={m.y - 24}
            fontSize={18}
            fontWeight={700}
            fontFamily="ui-monospace, monospace"
            fill="#0f172a"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {m.n}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Highlight({
  h,
  geometry,
  netColoring,
  graph,
  onDispose,
  onHide,
}: {
  h: BridgeHighlight;
  geometry: PageGeometry | null;
  netColoring: NetColoring | null;
  graph: V2Graph;
  onDispose?: (h: BridgeHighlight) => void;
  onHide?: (h: BridgeHighlight) => void;
}) {
  const parts: React.ReactNode[] = [];
  let notePoint = h.point ?? null;

  // Resolve segment indices: explicit list, or every segment of a net.
  let segmentIndices = h.segments ?? null;
  if (h.netId !== undefined && netColoring) {
    const net = netColoring.nets.find((n) => n.id === h.netId);
    if (net) segmentIndices = net.segmentIndices;
  }
  if (segmentIndices && geometry) {
    for (const idx of segmentIndices) {
      const s = geometry.segments[idx];
      if (!s) continue;
      parts.push(
        <line
          key={`s${idx}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={h.color}
          strokeWidth={10}
          strokeLinecap="round"
          opacity={0.45}
        >
          <animate attributeName="opacity" values="0.45;0.15;0.45" dur="1.2s" repeatCount="indefinite" />
        </line>
      );
      notePoint = notePoint ?? { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    }
  }

  if (h.elementId) {
    const node = graph.nodes.find((n) => n.id === h.elementId);
    const edge = graph.edges.find((e) => e.id === h.elementId);
    const port = graph.ports.find((p) => p.id === h.elementId);
    if (node) {
      parts.push(
        <rect
          key="n"
          x={node.bbox.x - 6}
          y={node.bbox.y - 6}
          width={node.bbox.width + 12}
          height={node.bbox.height + 12}
          fill="none"
          stroke={h.color}
          strokeWidth={5}
          rx={8}
          opacity={0.85}
        />
      );
      notePoint = notePoint ?? { x: node.bbox.x + node.bbox.width / 2, y: node.bbox.y - 14 };
    } else if (edge) {
      parts.push(
        <polyline
          key="e"
          points={edge.path.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={h.color}
          strokeWidth={10}
          strokeLinecap="round"
          opacity={0.45}
        />
      );
      notePoint = notePoint ?? edge.path[Math.floor(edge.path.length / 2)];
    } else if (port) {
      parts.push(
        <circle key="p" cx={port.point.x} cy={port.point.y} r={20} fill="none" stroke={h.color} strokeWidth={5} opacity={0.85} />
      );
      notePoint = notePoint ?? port.point;
    }
  }

  if (h.point) {
    parts.push(
      <circle key="pt" cx={h.point.x} cy={h.point.y} r={16} fill="none" stroke={h.color} strokeWidth={5}>
        <animate attributeName="r" values="10;26;10" dur="1.4s" repeatCount="indefinite" />
      </circle>
    );
  }

  if (h.note && notePoint) {
    // Flag pills carry two triage actions on the right end: check = "this flag
    // is a false positive" (disposed + saved for calibration), hide = "mute it
    // from my view but keep it live for the copilot's audit". Both opt back into
    // pointer events (the overlay svg is pointer-transparent).
    const isFlag = h.kind === "flag" && !!(onDispose || onHide);
    const noteW = h.note.length * 11;
    const pillW = noteW + 16 + (isFlag ? 60 : 0);
    const hideCx = pillW - 25;
    const checkCx = pillW - 53;
    const iconY = -7;
    // Clamp the pill inside the page so it can't run off the edge (Shane hit a
    // bottom-right flag whose check icon was unreachable). The rect spans
    // x:[tx-6, tx-6+pillW], y:[ty-22, ty+8] — keep both fully on the page.
    const tx = Math.max(6, Math.min(notePoint.x + 18, PAGE_WIDTH_PX - pillW + 2));
    const ty = Math.max(26, Math.min(notePoint.y - 18, PAGE_HEIGHT_PX - 12));
    parts.push(
      <g key="note" transform={`translate(${tx}, ${ty})`}>
        <rect x={-6} y={-22} width={pillW} height={30} rx={6} fill="rgba(15,23,42,0.9)" stroke={h.color} strokeWidth={1.5} />
        <text x={2} y={0} fontSize={18} fontFamily="ui-monospace, monospace" fill="#f8fafc">
          {h.note}
        </text>
        {isFlag && onDispose && (
          <g
            transform={`translate(${checkCx}, ${iconY})`}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDispose(h); }}
          >
            <title>Mark as false positive — dismisses it and saves it for calibration</title>
            <circle r={11} fill="#16a34a" />
            <polyline points="-4,0 -1.5,3.5 5,-4.5" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
        {isFlag && onHide && (
          <g
            transform={`translate(${hideCx}, ${iconY})`}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onHide(h); }}
          >
            <title>Hide from view — stays live for Arc&apos;s audit</title>
            <circle r={11} fill="#475569" />
            <path d="M -6.5 0 Q 0 -5 6.5 0 Q 0 5 -6.5 0 Z" fill="none" stroke="#fff" strokeWidth={1.3} />
            <circle r={1.7} fill="#fff" />
            <line x1={-7.5} y1={-6.5} x2={7.5} y2={6.5} stroke="#475569" strokeWidth={3.2} strokeLinecap="round" />
            <line x1={-7.5} y1={-6.5} x2={7.5} y2={6.5} stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
          </g>
        )}
      </g>
    );
  }

  return <g>{parts}</g>;
}
