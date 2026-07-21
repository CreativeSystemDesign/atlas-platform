"use client";

// Deterministic renderer for answer-grammar v0. Every claim-bearing
// primitive renders its provenance anchor; a step with no anchor would not
// compile (the grammar makes it structurally impossible, per design §5).

import { ArrowRight, FileText, TriangleAlert, Wrench } from "lucide-react";
import { PT } from "@/lib/platform-theme";
import type {
  Anchor,
  AnswerLayout,
  AnswerNode,
  Callout,
  ContentNode,
  DataTable,
  DocCrop,
  Endpoint,
  GapNotice,
  KeyValue,
  RouteRibbon,
  StepList,
  TraceStep,
} from "./answer-grammar";
import { PrintSketch } from "./print-sketches";

/** Provenance chip — document · page. No trust badge: certification is the
    room's precondition, not per-claim chrome (Shane, 2026-07-17). */
function AnchorChip({ anchor }: { anchor: Anchor }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[10px] font-semibold"
      style={{ background: "rgba(34,211,238,.1)", color: PT.cyanText }}
    >
      <FileText size={10} strokeWidth={2.4} />
      {anchor.document} · p.{anchor.page}
    </span>
  );
}

/** The route at a glance — every system the circuit crosses, in path order. */
function RouteRibbonBlock({ node }: { node: RouteRibbon }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-2.5 rounded-[12px] border px-4 py-3"
      style={{ borderColor: PT.line, background: PT.panel }}
    >
      {node.stops.map((stop, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && (
            <span className="flex flex-col items-center px-0.5">
              {node.vias?.[i - 1] && (
                <span className="text-[8.5px] font-semibold uppercase tracking-[.06em]" style={{ color: PT.textFaint }}>
                  {node.vias[i - 1]}
                </span>
              )}
              <ArrowRight size={13} style={{ color: PT.cyanText }} />
            </span>
          )}
          <span
            className="flex flex-col rounded-[9px] border px-2.5 py-1.5"
            style={{ borderColor: PT.lineStrong, background: PT.well }}
          >
            <span className="text-[11px] font-bold leading-tight" style={{ color: PT.text }}>
              {stop.label}
            </span>
            {stop.sublabel && (
              <span className="text-[8.5px] uppercase tracking-[.07em]" style={{ color: PT.textFaint }}>
                {stop.sublabel}
              </span>
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

/** from → to header of a connection step. */
function ConnectionRow({ from, to, via }: { from: Endpoint; to: Endpoint; via?: string }) {
  const chip = (ep: Endpoint) => (
    <span
      className="flex min-w-0 flex-col rounded-[9px] border px-2.5 py-1.5"
      style={{ borderColor: PT.lineStrong, background: PT.well }}
    >
      <span className="font-mono text-[11.5px] font-bold leading-tight" style={{ color: PT.text }}>
        {ep.point}
      </span>
      <span className="text-[8.5px] uppercase tracking-[.07em]" style={{ color: PT.textFaint }}>
        {ep.enclosure}
      </span>
    </span>
  );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {chip(from)}
      <span className="flex flex-col items-center px-0.5">
        {via && (
          <span className="text-[8.5px] font-semibold uppercase tracking-[.06em]" style={{ color: PT.amberText }}>
            {via}
          </span>
        )}
        <ArrowRight size={14} style={{ color: PT.cyanText }} />
      </span>
      {chip(to)}
    </div>
  );
}

function NarrativeBlock({ text }: { text: string }) {
  return (
    <p className="text-[13px] leading-[1.65]" style={{ color: PT.textDim }}>
      {text}
    </p>
  );
}

function KeyValueBlock({ node }: { node: KeyValue }) {
  return (
    <div className="rounded-[9px] border" style={{ borderColor: PT.line, background: PT.well }}>
      {node.rows.map((r, i) => (
        <div
          key={r.key}
          className="flex items-baseline justify-between gap-4 px-3 py-[7px]"
          style={i > 0 ? { borderTop: `1px solid ${PT.line}` } : undefined}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[.08em]" style={{ color: PT.textFaint }}>
            {r.key}
          </span>
          <span className="text-[12px] font-semibold" style={{ color: PT.text }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function TableBlock({ node }: { node: DataTable }) {
  return (
    <div>
      <div className="overflow-hidden rounded-[9px] border" style={{ borderColor: PT.line }}>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr style={{ background: "rgba(34,211,238,.06)" }}>
              {node.columns.map((c) => (
                <th
                  key={c}
                  className="px-3 py-[6px] text-left text-[9.5px] font-bold uppercase tracking-[.08em]"
                  style={{ color: PT.textMute }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${PT.line}`, background: PT.well }}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-[7px] font-mono text-[11.5px]" style={{ color: PT.textDim }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {node.caption && (
        <div className="mt-1 text-[10px]" style={{ color: PT.textFaint }}>
          {node.caption}
        </div>
      )}
    </div>
  );
}

function DocCropBlock({ node }: { node: DocCrop }) {
  return (
    <figure className="m-0">
      <PrintSketch crop={node} />
      <figcaption className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px]" style={{ color: PT.textFaint }}>
          {node.caption ?? "Print region"}
        </span>
        <AnchorChip anchor={node.anchor} />
      </figcaption>
    </figure>
  );
}

function CalloutBlock({ node }: { node: Callout }) {
  const caution = node.tone === "caution";
  return (
    <div
      className="flex items-start gap-2.5 rounded-[9px] border px-3 py-2.5 text-[12px] leading-[1.55]"
      style={{
        borderColor: caution ? "rgba(245,158,11,.35)" : PT.line,
        background: caution ? "rgba(245,158,11,.07)" : "rgba(34,211,238,.05)",
        color: PT.textDim,
      }}
    >
      {caution ? (
        <TriangleAlert size={14} className="mt-[2px] shrink-0" style={{ color: PT.amberText }} />
      ) : (
        <Wrench size={14} className="mt-[2px] shrink-0" style={{ color: PT.cyanText }} />
      )}
      <span>{node.text}</span>
    </div>
  );
}

/** A hop the data doesn't cover yet — quiet honesty, no alarm chrome. */
function GapCard({ node }: { node: GapNotice }) {
  return (
    <div
      className="rounded-[12px] border border-dashed px-4 py-3"
      style={{ borderColor: PT.lineStrong, background: PT.well }}
    >
      <span className="text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: PT.textFaint }}>
        Not in the data yet
      </span>
      <p className="mt-1 mb-0 text-[12.5px] leading-[1.6]" style={{ color: PT.textMute }}>
        {node.reason}
      </p>
      {node.closes_with && (
        <div className="mt-1.5 text-[10.5px]" style={{ color: PT.textFaint }}>
          Arrives with: {node.closes_with}
        </div>
      )}
    </div>
  );
}

function StepCard({ step, index }: { step: TraceStep; index: number }) {
  const crop = step.body?.find((b): b is DocCrop => b.kind === "doc_crop");
  const rest = (step.body ?? []).filter((b) => b.kind !== "doc_crop");
  return (
    <div
      className="rounded-[12px] border px-4 py-3.5 backdrop-blur-xl"
      style={{ borderColor: PT.line, background: PT.panel }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold"
          style={{
            background: `linear-gradient(140deg, ${PT.cyan}, ${PT.cyanDeep})`,
            color: "#062430",
            boxShadow: "rgba(34,211,238,.35) 0px 2px 8px",
          }}
        >
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="text-[12.5px] font-bold tracking-[.01em]" style={{ color: PT.text }}>
              {step.title}
            </span>
            <AnchorChip anchor={step.anchor} />
          </div>
          {step.from && step.to && <ConnectionRow from={step.from} to={step.to} via={step.via} />}
          <p className="mt-2 mb-0 text-[13px] leading-[1.6]" style={{ color: PT.textDim }}>
            {step.claim}
          </p>
          {(crop || rest.length > 0) && (
            <div className={`mt-3 grid gap-3 ${crop && rest.length > 0 ? "md:grid-cols-2" : ""}`}>
              {/* A lone crop stays print-sized — full-bleed sketches dwarf the claim. */}
              {crop && (
                <div className={rest.length === 0 ? "max-w-[440px]" : undefined}>
                  <DocCropBlock node={crop} />
                </div>
              )}
              {rest.length > 0 && (
                <div className="flex min-w-0 flex-col gap-3">
                  {rest.map((n, i) => (
                    <ContentBlock key={i} node={n} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepListBlock({ node }: { node: StepList }) {
  let n = 0;
  return (
    <div className="flex flex-col gap-2.5">
      {node.steps.map((s, i) =>
        s.kind === "gap" ? <GapCard key={i} node={s} /> : <StepCard key={s.id} step={s} index={++n} />,
      )}
    </div>
  );
}

function ContentBlock({ node }: { node: ContentNode }) {
  switch (node.kind) {
    case "narrative":
      return <NarrativeBlock text={node.text} />;
    case "route":
      return <RouteRibbonBlock node={node} />;
    case "key_value":
      return <KeyValueBlock node={node} />;
    case "table":
      return <TableBlock node={node} />;
    case "doc_crop":
      return <DocCropBlock node={node} />;
    case "gap":
      return <GapCard node={node} />;
    case "callout":
      return <CalloutBlock node={node} />;
  }
}

function RenderNode({ node }: { node: AnswerNode }) {
  switch (node.kind) {
    case "stack":
      return (
        <div className="flex flex-col gap-4">
          {node.children.map((c, i) => (
            <RenderNode key={i} node={c} />
          ))}
        </div>
      );
    case "columns":
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {node.children.map((c, i) => (
            <RenderNode key={i} node={c} />
          ))}
        </div>
      );
    case "card":
      return (
        <div className="rounded-[12px] border px-4 py-3.5" style={{ borderColor: PT.line, background: PT.panel }}>
          {node.title && (
            <div className="mb-2 text-[12px] font-bold" style={{ color: PT.text }}>
              {node.title}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {node.children.map((c, i) => (
              <RenderNode key={i} node={c} />
            ))}
          </div>
        </div>
      );
    case "step_list":
      return <StepListBlock node={node} />;
    default:
      return <ContentBlock node={node} />;
  }
}

/** The presentation canvas's document: headline + composed answer. */
export function AnswerView({ layout }: { layout: AnswerLayout }) {
  return (
    <article className="mx-auto w-full max-w-[860px]">
      <header className="mb-4">
        <h1 className="m-0 text-[19px] font-bold tracking-[.01em]" style={{ color: PT.text }}>
          {layout.title}
        </h1>
        {layout.subtitle && (
          <div className="mt-1 text-[11.5px]" style={{ color: PT.textMute }}>
            {layout.subtitle}
          </div>
        )}
      </header>
      <RenderNode node={layout.root} />
    </article>
  );
}
