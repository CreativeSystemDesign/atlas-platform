"use client";

// Manufactured print fragments — phase-1 stand-ins for real doc_crop renders.
// Drawn as line art on a white "paper" field so the side-by-side reads as
// print + analysis from day one. Every sketch is generic vocabulary only
// (no proving-corpus identifiers). Replaced wholesale by the real render
// machinery in phase 2.

import type { DocCrop } from "./answer-grammar";

const INK = "#1c2430";
const PAPER = "#f5f3ee";

function Label({ x, y, text, size = 9, anchor = "middle" }: {
  x: number; y: number; text: string; size?: number; anchor?: "start" | "middle" | "end";
}) {
  return (
    <text x={x} y={y} fontSize={size} textAnchor={anchor} fill={INK}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight={600}>
      {text}
    </text>
  );
}

/** Amber find-marker around the anchor text — "here is your row". */
function Marker({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <rect x={x} y={y} width={w} height={h} rx={3} fill="rgba(245,158,11,.16)"
      stroke="#d97706" strokeWidth={1.4} strokeDasharray="4 2" />
  );
}

function CoilSketch({ highlight }: { highlight?: string }) {
  return (
    <svg viewBox="0 0 300 120" className="block w-full">
      {/* feed wire in from the left, coil, return to common */}
      <line x1={8} y1={52} x2={118} y2={52} stroke={INK} strokeWidth={1.6} />
      <Label x={56} y={44} text={highlight ?? "Y034"} size={10} />
      {highlight && <Marker x={34} y={33} w={46} h={16} />}
      <rect x={118} y={36} width={64} height={32} fill="none" stroke={INK} strokeWidth={1.6} />
      <line x1={118} y1={68} x2={182} y2={36} stroke={INK} strokeWidth={1.2} />
      <Label x={150} y={30} text="SV-104" size={10} />
      <Label x={110} y={80} text="A1" size={8} anchor="end" />
      <Label x={190} y={80} text="A2" size={8} anchor="start" />
      <line x1={182} y1={52} x2={268} y2={52} stroke={INK} strokeWidth={1.6} />
      <Label x={236} y={44} text="0V" size={9} />
      <line x1={268} y1={52} x2={268} y2={84} stroke={INK} strokeWidth={1.6} />
      <line x1={256} y1={84} x2={280} y2={84} stroke={INK} strokeWidth={1.6} />
      <line x1={260} y1={89} x2={276} y2={89} stroke={INK} strokeWidth={1.3} />
      <line x1={264} y1={94} x2={272} y2={94} stroke={INK} strokeWidth={1} />
      <Label x={150} y={108} text="HYD VALVE STAND — SHEET 12" size={7.5} />
    </svg>
  );
}

function CableRunSketch({ highlight }: { highlight?: string }) {
  return (
    <svg viewBox="0 0 300 120" className="block w-full">
      <rect x={14} y={34} width={70} height={44} fill="none" stroke={INK} strokeWidth={1.6} />
      <Label x={49} y={58} text="CP1" size={10} />
      <Label x={49} y={90} text="CONTROL PANEL" size={7} />
      <rect x={216} y={34} width={70} height={44} fill="none" stroke={INK} strokeWidth={1.6} />
      <Label x={251} y={58} text="JB-3" size={10} />
      <Label x={251} y={90} text="JUNCTION BOX" size={7} />
      {/* the cable — three conductors bundled */}
      <line x1={84} y1={50} x2={216} y2={50} stroke={INK} strokeWidth={1.2} />
      <line x1={84} y1={56} x2={216} y2={56} stroke={INK} strokeWidth={1.2} />
      <line x1={84} y1={62} x2={216} y2={62} stroke={INK} strokeWidth={1.2} />
      <ellipse cx={150} cy={56} rx={10} ry={14} fill="none" stroke={INK} strokeWidth={1.3} />
      <Label x={150} y={30} text={highlight ?? "C-12"} size={10} />
      {highlight && <Marker x={128} y={19} w={44} h={16} />}
      <Label x={150} y={110} text="CABLE ROUTE — CABLE LIST P.4" size={7.5} />
    </svg>
  );
}

function TerminalStripSketch({ highlight }: { highlight?: string }) {
  const terms = [4, 5, 6, 7, 8, 9];
  return (
    <svg viewBox="0 0 300 120" className="block w-full">
      <rect x={22} y={40} width={256} height={36} fill="none" stroke={INK} strokeWidth={1.6} />
      {terms.map((n, i) => {
        const cx = 46 + i * 42;
        const hit = highlight === String(n);
        return (
          <g key={n}>
            {hit && <Marker x={cx - 17} y={41.5} w={34} h={33} />}
            <circle cx={cx} cy={58} r={9} fill="none" stroke={INK} strokeWidth={1.5} />
            <Label x={cx} y={61.5} text={String(n)} size={9} />
            <line x1={cx} y1={40} x2={cx} y2={26} stroke={INK} strokeWidth={1.1} />
            <line x1={cx} y1={76} x2={cx} y2={90} stroke={INK} strokeWidth={1.1} />
          </g>
        );
      })}
      <Label x={30} y={34} text="TB-A" size={9} anchor="start" />
      <Label x={150} y={110} text="JB-3 TERMINAL STRIP — WIRING DIAGRAM P.9" size={7.5} />
    </svg>
  );
}

function PartsRowSketch({ highlight }: { highlight?: string }) {
  const cols = [8, 66, 150, 236, 292];
  const header = ["SYM", "DESCRIPTION", "PART NO.", "QTY"];
  return (
    <svg viewBox="0 0 300 120" className="block w-full">
      {[24, 46, 72, 98].map((y) => (
        <line key={y} x1={8} y1={y} x2={292} y2={y} stroke={INK} strokeWidth={y === 24 || y === 98 ? 1.5 : 1} />
      ))}
      {cols.map((x) => (
        <line key={x} x1={x} y1={24} x2={x} y2={98} stroke={INK} strokeWidth={1} />
      ))}
      {header.map((h, i) => (
        <Label key={h} x={(cols[i] + cols[i + 1]) / 2} y={39} text={h} size={8} />
      ))}
      <Label x={37} y={62} text="SV-103" size={8.5} />
      <Label x={108} y={62} text="SOL VALVE 24VDC" size={7.5} />
      <Label x={193} y={62} text="4KA210-06" size={8} />
      <Label x={264} y={62} text="1" size={8.5} />
      {highlight && <Marker x={10} y={74} w={280} h={22} />}
      <Label x={37} y={89} text="SV-104" size={8.5} />
      <Label x={108} y={89} text="SOL VALVE 24VDC" size={7.5} />
      <Label x={193} y={89} text="4KA210-08" size={8} />
      <Label x={264} y={89} text="1" size={8.5} />
      <Label x={150} y={114} text="ELECTRICAL PARTS LIST P.3" size={7.5} />
    </svg>
  );
}

function PlcOutputSketch({ highlight }: { highlight?: string }) {
  const pins = ["Y030", "Y031", "Y032", "Y033", "Y034", "Y035"];
  return (
    <svg viewBox="0 0 300 120" className="block w-full">
      <rect x={90} y={14} width={120} height={92} fill="none" stroke={INK} strokeWidth={1.6} />
      <Label x={150} y={30} text="OUTPUT CARD" size={8.5} />
      <Label x={150} y={42} text="SLOT 4" size={7.5} />
      {pins.map((p, i) => {
        const y = 54 + i * 10;
        const hit = highlight === p;
        return (
          <g key={p}>
            <line x1={210} y1={y} x2={244} y2={y} stroke={INK} strokeWidth={1.2} />
            {hit && <Marker x={246} y={y - 8} w={40} h={15} />}
            <Label x={250} y={y + 3} text={p} size={8} anchor="start" />
          </g>
        );
      })}
      <Label x={150} y={117} text="PLC RACK — SHEET 8" size={7.5} />
    </svg>
  );
}

const SKETCHES: Record<DocCrop["sketch"], React.FC<{ highlight?: string }>> = {
  coil: CoilSketch,
  "cable-run": CableRunSketch,
  "terminal-strip": TerminalStripSketch,
  "parts-row": PartsRowSketch,
  "plc-output": PlcOutputSketch,
};

/** The paper field a sketch renders on. */
export function PrintSketch({ crop }: { crop: DocCrop }) {
  const Sketch = SKETCHES[crop.sketch];
  return (
    <div className="overflow-hidden rounded-[9px]" style={{ background: PAPER, boxShadow: "rgba(0,0,0,.4) 0px 2px 10px" }}>
      <Sketch highlight={crop.highlight} />
    </div>
  );
}
