"use client";

// Element inspector — Midnight Gallery skin (v4 port, restyle only: every
// handler and data path is unchanged from the pre-reskin inspector).
// Bottom-left per the mockup, clearing the HUD hint bar; frost chassis and
// micro-header match the copilot rail and composers.

import React from "react";
import { Trash2, Box, CircleDot, Paperclip, Spline, CornerUpRight } from "lucide-react";
import { type V2Attachment, type V2Graph, type V2ComponentIdentity, type V2CableRegistry } from "./experimental-v2-types";
import { findAttachment } from "./v2-attachments";
import { stripsTouchingBox } from "./v2-strip";
import { InfoTip } from "./smart-canvas-infotip";
import { MG, MG_PANEL_FROST } from "./smart-canvas-theme";

type SelectedKind = "component" | "terminal" | "wire" | "continuation" | "attachment" | "cable";

type Selection =
  | {
      kind: "component";
      label: string;
      identity: V2ComponentIdentity | null;
      attachments: V2Attachment[];
      terminals: { label: string; type: string }[];
      rows?: StripRowView[] | null;
    }
  | { kind: "terminal" | "wire"; label: string }
  | { kind: "cable"; label: string; cableId: string; adoptCandidates: { id: string; label: string }[] }
  | { kind: "continuation"; sheet: string; zone: string }
  | { kind: "attachment"; attachment: V2Attachment; parentLabel: string };

type StripRowView = { pin: string; name: string; net: string | null };

function describe(graph: V2Graph, id: string | null): Selection | null {
  if (!id) return null;
  const node = graph.nodes.find((n) => n.id === id);
  if (node)
    return {
      kind: "component",
      label: node.label,
      identity: node.identity ?? null,
      attachments: node.attachments ?? [],
      terminals: graph.ports
        .filter((p) => p.parentId === node.id)
        .map((p) => ({ label: p.label, type: p.type })),
      // Terminal strip rows (2026-07-10): pin | name | the wired net, read
      // from the row's attached port. The strip's defining view.
      rows:
        node.kind === "strip" && node.rows
          ? node.rows.map((r) => ({
              pin: r.pin,
              name: r.name ?? "",
              net:
                r.portIds
                  .map((pid) => graph.ports.find((p) => p.id === pid)?.label)
                  .filter(Boolean)
                  .map((l) => l!.split("~").pop())
                  .join(" · ") || null,
            }))
          : null,
    };
  const port = graph.ports.find((p) => p.id === id);
  if (port) return { kind: "terminal", label: port.label };
  const edge = graph.edges.find((e) => e.id === id);
  if (edge) return { kind: "wire", label: edge.label ?? "" };
  const cont = graph.continuations.find((c) => c.id === id);
  if (cont) return { kind: "continuation", sheet: cont.sheet ?? "", zone: cont.zone ?? "" };
  const cable = graph.cables?.find((c) => c.id === id);
  if (cable) {
    // Touching strips auto-link; nearby-but-not-touching ones still offer
    // the one-tap adopt button.
    const adoptCandidates = stripsTouchingBox(graph.nodes, cable.bbox, 80)
      .map((n) => ({ id: n.id, label: n.label }));
    return { kind: "cable", label: cable.label, cableId: cable.id, adoptCandidates };
  }
  const att = findAttachment(graph, id);
  if (att) return { kind: "attachment", attachment: att.attachment, parentLabel: att.node.label };
  return null;
}

const KIND_ICON: Record<SelectedKind, React.ReactNode> = {
  attachment: <Paperclip className="h-3.5 w-3.5" />,
  cable: <Spline className="h-3.5 w-3.5" />,
  component: <Box className="h-3.5 w-3.5" />,
  terminal: <CircleDot className="h-3.5 w-3.5" />,
  wire: <Spline className="h-3.5 w-3.5" />,
  continuation: <CornerUpRight className="h-3.5 w-3.5" />,
};

const LABEL_HINT: Record<"component" | "terminal" | "wire" | "cable", string> = {
  component: "Reference designator",
  terminal: "Terminal label",
  wire: "Wire number",
  cable: "Cable name (registry key)",
};

const RENAME_TIP: Record<"component" | "terminal" | "wire" | "cable", { title: string; body: string }> = {
  cable: { title: "Cable name", body: "The printed cable identity (CAB21) — the document-wide registry key. Renaming onto an existing cable name MERGES their rosters: same name IS the same cable." },
  component: { title: "Reference designator", body: "The name the print gives this part. Rename cascades to its terminals' owner slots. Identity (part number, family) DERIVES from parts-list evidence — never asserted by hand." },
  terminal: { title: "Terminal label", body: "T~<owner>~[<pin>~]<net> — owner slot first, pin only where printed, net from the wire number." },
  wire: { title: "Wire number", body: "The printed net name. Wires sharing a number are one electrical net." },
};

// Inset field look shared by every input in the panel.
const FIELD: React.CSSProperties = {
  background: MG.well,
  border: `1px solid ${MG.line}`,
  color: MG.text,
};

type Props = {
  graph: V2Graph;
  selectedId: string | null;
  onRename: (id: string, label: string) => void;
  onUpdateContinuation?: (id: string, patch: { sheet?: string; zone?: string }) => void;
  // Cross-page status (Shane, 2026-07-11): connected — or WHY NOT, in words.
  contStatus?: {
    state: "resolved" | "waiting" | "mismatch" | "unanchored" | "unlabeled" | "device" | "symbol" | "orphan";
    detail: string;
    link?: { page: number; contId: string; net: string; sheet: string };
    destPage?: number;
  } | null;
  onJumpToCounterpart?: (link: { page: number; contId: string; net: string; sheet: string }) => void;
  onJumpToPage?: (page: number) => void;
  onDelete: (id: string) => void;
  cableRegistry?: V2CableRegistry;
  onAdoptStrip?: (cableId: string, stripId: string) => void;
  onRemoveConductor?: (cableLabel: string, index: number) => void;
};

export function ExperimentalV2Inspector({ graph, selectedId, onRename, onUpdateContinuation, onDelete, cableRegistry, onAdoptStrip, onRemoveConductor, contStatus, onJumpToCounterpart, onJumpToPage }: Props) {
  const sel = describe(graph, selectedId);
  if (!sel || !selectedId) return null;

  return (
    <div
      className="absolute left-5 bottom-[70px] z-20 w-[248px] rounded-[14px] p-3 backdrop-blur-2xl backdrop-saturate-150 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{ background: MG_PANEL_FROST, border: `1px solid ${MG.lineStrong}` }}
    >
      {/* micro-header — ▣ COMPONENT style, cyan lead */}
      <div className="mb-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: MG.cyanText }}>
        {KIND_ICON[sel.kind]}
        {sel.kind}
      </div>

      {sel.kind === "attachment" ? (
        <div className="space-y-1 rounded-[9px] px-2 py-1.5 text-[10px]" style={{ ...FIELD, color: MG.textMute }}>
          <div className="font-mono text-[11px]" style={{ color: MG.textDim }}>{sel.attachment.text}</div>
          <div>
            <span className="uppercase">{sel.attachment.kind.replace(/_/g, " ")}</span> evidence on{" "}
            <span className="font-semibold" style={{ color: MG.textDim }}>{sel.parentLabel}</span>
          </div>
          <div className="text-[9px] opacity-70">Del removes it; identity re-derives from remaining evidence.</div>
        </div>
      ) : sel.kind === "continuation" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-wider" style={{ color: MG.textMute }}>Sheet</span>
            <input value={sel.sheet} onChange={(e) => onUpdateContinuation?.(selectedId, { sheet: e.target.value })}
              className="w-full rounded-[8px] px-2 py-1 font-mono text-xs outline-none focus:border-cyan-400/60" style={FIELD} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-wider" style={{ color: MG.textMute }}>Zone</span>
            <input value={sel.zone} onChange={(e) => onUpdateContinuation?.(selectedId, { zone: e.target.value })}
              className="w-full rounded-[8px] px-2 py-1 font-mono text-xs outline-none focus:border-cyan-400/60" style={FIELD} />
          </label>
          {contStatus ? (() => {
            const TONE: Record<string, { bg: string; border: string; fg: string; label: string }> = {
              resolved: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.35)", fg: "#4ade80", label: "LINKED" },
              waiting: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", fg: "#fbbf24", label: "WAITING" },
              mismatch: { bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.4)", fg: "#a78bfa", label: "MISMATCH" },
              unanchored: { bg: "rgba(244,63,94,0.1)", border: "rgba(244,63,94,0.4)", fg: "#fb7185", label: "UNANCHORED" },
              unlabeled: { bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.35)", fg: "#94a3b8", label: "NO WIRE #" },
              device: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", fg: "#fbbf24", label: "DEVICE REF" },
              symbol: { bg: "rgba(161,98,7,0.1)", border: "rgba(161,98,7,0.3)", fg: "#fbbf24", label: "SYMBOL" },
              orphan: { bg: "rgba(225,29,72,0.14)", border: "rgba(225,29,72,0.5)", fg: "#fda4af", label: "SEVERED" },
            };
            const t = TONE[contStatus.state] ?? TONE.waiting;
            return (
              <div className="col-span-2 space-y-1.5">
                <div className="rounded-[8px] px-2 py-1.5 text-[10px] leading-snug"
                  style={{ background: t.bg, border: `1px solid ${t.border}`, color: MG.textMute }}>
                  <span className="mr-1.5 font-semibold tracking-wider" style={{ color: t.fg }}>{t.label}</span>
                  {contStatus.detail}
                </div>
                {contStatus.state === "resolved" && contStatus.link && (
                  <button
                    onClick={() => onJumpToCounterpart?.(contStatus.link!)}
                    className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-xs transition-colors hover:brightness-125"
                    style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.fg }}
                    title="Open the counterpart page with its chip selected"
                  >
                    <span className="font-mono">{contStatus.link.net} ↔ sheet {contStatus.link.sheet}</span>
                    <span style={{ color: MG.textMute }}>page {contStatus.link.page} →</span>
                  </button>
                )}
                {contStatus.state === "resolved" && !contStatus.link && contStatus.destPage != null && (
                  <button
                    onClick={() => onJumpToPage?.(contStatus.destPage!)}
                    className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-xs transition-colors hover:brightness-125"
                    style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.fg }}
                    title="Open the page where this cable continues"
                  >
                    <span>see the cable&apos;s other sighting</span>
                    <span style={{ color: MG.textMute }}>page {contStatus.destPage} →</span>
                  </button>
                )}
                {contStatus.state === "mismatch" && contStatus.destPage != null && (
                  <button
                    onClick={() => onJumpToPage?.(contStatus.destPage!)}
                    className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-xs transition-colors hover:brightness-125"
                    style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.fg }}
                    title="Open the destination page to investigate"
                  >
                    <span>investigate the other side</span>
                    <span style={{ color: MG.textMute }}>page {contStatus.destPage} →</span>
                  </button>
                )}
              </div>
            );
          })() : null}
        </div>
      ) : (
        <InfoTip title={RENAME_TIP[sel.kind].title} body={RENAME_TIP[sel.kind].body}>
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider" style={{ color: MG.textMute }}>
              {LABEL_HINT[sel.kind]}
              <span className="normal-case tracking-normal" style={{ color: MG.textFaint }}>✎ rename</span>
            </span>
            <input value={sel.label} onChange={(e) => onRename(selectedId, e.target.value)}
              className="w-full rounded-[8px] px-2 py-1 font-mono text-[13px] font-bold outline-none focus:border-cyan-400/60" style={FIELD} autoFocus />
          </label>
        </InfoTip>
      )}

      {sel.kind === "component" && sel.identity && (sel.identity.partNumber || sel.identity.description) && (
        <div className="mt-2 space-y-0.5 rounded-[9px] px-2 py-1.5 text-[10px]" style={{ ...FIELD, color: MG.textMute }}>
          <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: sel.identity.matchStatus === "part_number_attachment_match" ? MG.ok : MG.cyanText }}>
            {sel.identity.matchStatus === "part_number_attachment_match" ? "Parts-list identity ✓" : "Bank identity"}
          </div>
          {sel.identity.description && <div style={{ color: MG.textDim }}>{sel.identity.description}</div>}
          {sel.identity.partNumber && (
            <div className="font-mono">
              {sel.identity.matchStatus === "no_parts_list_match_schematic_attachments" ? "Evidence " : "P/N "}
              {sel.identity.partNumber}
            </div>
          )}
          {sel.identity.family && <div>Family {sel.identity.family}</div>}
          {sel.identity.location && <div>Location {sel.identity.location}</div>}
          {sel.identity.sourcePage && <div>Parts list p.{sel.identity.sourcePage}</div>}
        </div>
      )}

      {sel.kind === "component" && sel.attachments.length > 0 && (
        <div className="mt-2 space-y-1 rounded-[9px] px-2 py-1.5 text-[10px]" style={FIELD}>
          <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: MG.cyanText }}>Evidence ({sel.attachments.length})</div>
          {sel.attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5">
              <span
                className="rounded px-1 py-px text-[8px] font-semibold uppercase"
                style={{
                  color:
                    a.kind === "part_number" ? "#8b5cf6" :
                    a.kind === "spec" ? "#14b8a6" :
                    a.kind === "wire_label" ? "#0ea5e9" :
                    a.kind === "location" ? MG.amber :
                    a.kind === "ground_label" ? "#22c55e" :
                    a.kind === "terminal" || a.kind === "terminal_label" ? "#ec4899" :
                    MG.textMute,
                  backgroundColor: "rgba(148,163,184,0.12)",
                }}
              >
                {a.kind.replace(/_/g, " ")}
              </span>
              <span className="truncate font-mono" style={{ color: MG.textMute }}>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {sel.kind === "cable" && (() => {
        const entry = cableRegistry?.[sel.label];
        return (
          <div className="mt-2 rounded-[9px] px-2 py-1.5 text-[10px]" style={{ ...FIELD, color: MG.textMute }}>
            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: MG.cyanText }}>
              Conductors ({entry?.conductors.length ?? 0})
            </div>
            {entry?.partNumber && (
              <div className="mt-0.5 font-mono text-[10px]" style={{ color: MG.textDim }}>P/N {entry.partNumber}</div>
            )}
            {entry && entry.conductors.length > 0 ? (
              <div className="mt-1 max-h-44 space-y-px overflow-y-auto">
                {entry.conductors.map((c, i) => (
                  <div key={i} className="group flex items-baseline gap-1.5 font-mono text-[9px]">
                    <span className="w-9 shrink-0 text-right font-bold" style={{ color: MG.textDim }}>{c.core ?? "·"}</span>
                    <span className="min-w-0 flex-1 truncate" style={{ color: MG.textMute }}>{c.signal || "—"}</span>
                    <span className="shrink-0" style={{ color: c.net && c.net !== "SPARE" ? MG.ok : MG.textFaint }}>{c.net ?? "?"}</span>
                    {onRemoveConductor && (
                      <button
                        type="button"
                        onClick={() => onRemoveConductor(sel.label, i)}
                        className="shrink-0 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ color: "#f43f5e" }}
                        title="Remove this conductor from the roster"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-[9px]" style={{ color: MG.textFaint }}>
                Empty roster — Ctrl-click printed wire numbers, or adopt a strip below.
              </div>
            )}
            {entry && entry.pages.length > 0 && (
              <div className="mt-1 text-[9px]" style={{ color: MG.textFaint }}>
                Drawn on page{entry.pages.length > 1 ? "s" : ""} {[...entry.pages].sort((a, b) => a - b).join(", ")} — same name, same cable.
              </div>
            )}
            {sel.adoptCandidates.map((cand) => (
              <button
                key={cand.id}
                type="button"
                onClick={() => onAdoptStrip?.(sel.cableId, cand.id)}
                className="mt-1.5 w-full cursor-pointer rounded-[8px] px-2 py-1 text-left text-[10px] font-semibold transition-colors"
                style={{ border: `1px solid rgba(34,211,238,.4)`, background: "rgba(12,42,64,.5)", color: "#7dd8ea" }}
              >
                Adopt rows from {cand.label} →
              </button>
            ))}
          </div>
        );
      })()}

      {sel.kind === "component" && sel.rows && sel.rows.length > 0 && (
        <div className="mt-2 rounded-[9px] px-2 py-1.5 text-[10px]" style={{ ...FIELD, color: MG.textMute }}>
          <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: MG.cyanText }}>
            Terminal strip · {sel.rows.length} rows
          </div>
          <div className="mt-1 space-y-px">
            {sel.rows.map((r, i) => (
              <div key={i} className="flex items-baseline gap-1.5 font-mono text-[9px]">
                <span className="w-9 shrink-0 text-right font-bold" style={{ color: MG.textDim }}>{r.pin}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: MG.textMute }}>{r.name || "—"}</span>
                <span className="shrink-0" style={{ color: r.net ? MG.ok : MG.textFaint }}>{r.net ?? "unwired"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sel.kind === "component" && sel.terminals.length > 0 && (
        <div className="mt-2 rounded-[9px] px-2 py-1.5 text-[10px]" style={{ ...FIELD, color: MG.textMute }}>
          <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: MG.cyanText }}>
            Terminals ({sel.terminals.filter((t) => t.type === "terminal").length})
            {sel.terminals.some((t) => t.type === "junction") &&
              ` · junctions (${sel.terminals.filter((t) => t.type === "junction").length})`}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {sel.terminals.map((t, i) => (
              <span key={i} className={`rounded px-1 py-px font-mono text-[9px] ${t.type === "junction" ? "opacity-60" : ""}`}
                style={{ background: "rgba(148,163,184,0.10)", color: MG.textDim }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {sel.kind === "component" && (
        <div className="mt-2 text-[9px] leading-relaxed" style={{ color: MG.textFaint }}>
          Ctrl-click printed text on the sheet to attach evidence — identity derives from the parts-list join.
        </div>
      )}

      <InfoTip title="Delete" body="Removes the element (terminals cascade with their component). One Ctrl+Z away — nothing is precious.">
        <button
          type="button"
          onClick={() => onDelete(selectedId)}
          className="mt-3 flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-[11px] font-semibold transition-colors"
          style={{ border: `1px solid rgba(248,113,113,.35)`, color: MG.gapRed, background: "rgba(248,113,113,.06)" }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete (Del)
        </button>
      </InfoTip>
    </div>
  );
}
