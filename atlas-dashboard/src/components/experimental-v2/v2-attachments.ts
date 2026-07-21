// Evidence attachments for the smart canvas — Shane's digital-twin pattern
// carried into v2: Ctrl-click printed text on the drawing -> a TYPED attachment
// (part_number / spec / text) on the selected component, then identity is
// DERIVED by joining the evidence against the parts-list symbol bank, with an
// explicit matchStatus. Identity is never asserted — it's evidence + join.
// Mirrors agent_server _component_identity_from_attachments semantics.

import { classifyAttachmentText } from "../extraction-workbench/annotation-labeling.ts";
import type { SymbolBankEntry, WireLabelBankEntry } from "../extraction-workbench/studio-types";
import type { V2Attachment, V2AttachmentKind, V2ComponentIdentity, V2Graph } from "./experimental-v2-types";

const newId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

/** EXACT mirror of the server's _normalize_part_number: NFKC -> upper -> A-Z0-9 only. */
export function normalizePartNumber(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Studio labeling is canonical: classification IS classifyAttachmentText from
 * the digital-twin workspace — part_number only on a parts-list match,
 * wire_label via the cable-list bank, location/(PP), ground/terminal labels,
 * letters+digits => spec, else text. No shape-guessing. */
export function classifyAttachmentKind(
  text: string,
  bank: SymbolBankEntry[],
  wireBank: WireLabelBankEntry[] = []
): V2AttachmentKind {
  return classifyAttachmentText(text, bank, wireBank);
}

const familyOf = (label: string): string => (label.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();

/** Server-parity identity derivation. Returns how identity was (or wasn't) set. */
export function deriveIdentityFromAttachments(
  node: { label: string; identity?: V2ComponentIdentity | null; attachments?: V2Attachment[] },
  bank: SymbolBankEntry[]
): "kept_existing" | "parts_match" | "schematic_only" | "none" {
  if (node.identity) return "kept_existing";
  const atts = node.attachments ?? [];
  const partTexts = atts.filter((a) => a.kind === "part_number" || a.kind === "spec");
  const partNorms = new Set(partTexts.map((a) => normalizePartNumber(a.text)).filter(Boolean));
  if (partNorms.size === 0) return "none";
  for (const e of bank) {
    const pn = normalizePartNumber(e.part_number);
    if (pn && partNorms.has(pn)) {
      node.identity = {
        fullSymbol: e.symbol,
        family: e.family,
        description: e.description,
        partNumber: e.part_number,
        location: e.location,
        sourcePage: e.source_page,
        matchStatus: "part_number_attachment_match",
      };
      return "parts_match";
    }
  }
  const firstPart = atts.find((a) => a.kind === "part_number")?.text ?? atts.find((a) => a.kind === "spec")?.text ?? "";
  const context = atts.find((a) => a.kind === "text")?.text ?? "";
  node.identity = {
    fullSymbol: node.label,
    family: familyOf(node.label),
    description: (context || node.label).normalize("NFKC").trim(),
    partNumber: firstPart.normalize("NFKC").trim(),
    location: "",
    sourcePage: "",
    matchStatus: "no_parts_list_match_schematic_attachments",
  };
  return "schematic_only";
}

/** Remove an attachment by id (Del on a selected anchor). If the node's
 * identity was DERIVED from evidence, re-derive it from what remains —
 * deleting bad evidence un-poisons the identity. Hand-set identities
 * (no matchStatus) are never touched. */
export function removeAttachment(
  draft: V2Graph,
  attachmentId: string,
  bank: SymbolBankEntry[]
): { ok: boolean; note: string } {
  for (const node of draft.nodes) {
    const atts = node.attachments ?? [];
    const idx = atts.findIndex((a) => a.id === attachmentId);
    if (idx === -1) continue;
    const [gone] = atts.splice(idx, 1);
    node.attachments = [...atts];
    if (node.identity?.matchStatus) {
      node.identity = null;
      deriveIdentityFromAttachments(node, bank);
    }
    return { ok: true, note: `removed ${gone.kind} "${gone.text}" from ${node.label}` };
  }
  return { ok: false, note: "attachment not found" };
}

export function findAttachment(
  graph: V2Graph,
  attachmentId: string
): { node: V2Graph["nodes"][number]; attachment: V2Attachment } | null {
  for (const node of graph.nodes) {
    const attachment = (node.attachments ?? []).find((a) => a.id === attachmentId);
    if (attachment) return { node, attachment };
  }
  return null;
}

export type AttachResult = {
  ok: boolean;
  note: string;
  kind?: V2AttachmentKind;
  identity?: "kept_existing" | "parts_match" | "schematic_only" | "none";
};

/** Attach a clicked text block to a component and re-derive identity.
 * Dedupes identical evidence. Mutates the draft (runs inside updateGraph). */
export function attachTextToComponent(
  draft: V2Graph,
  componentId: string,
  block: { text: string; bbox: { x: number; y: number; width: number; height: number } },
  bank: SymbolBankEntry[],
  kindOverride?: V2AttachmentKind,
  wireBank: WireLabelBankEntry[] = []
): AttachResult {
  const node = draft.nodes.find((n) => n.id === componentId);
  if (!node) return { ok: false, note: `no component ${componentId}` };
  const text = block.text.trim();
  if (!text) return { ok: false, note: "empty text" };
  const norm = normalizePartNumber(text) || text.normalize("NFKC");
  const dup = (node.attachments ?? []).some(
    (a) => (normalizePartNumber(a.text) || a.text.normalize("NFKC")) === norm
  );
  if (dup) return { ok: false, note: `already attached to ${node.label}` };
  const kind = kindOverride ?? classifyAttachmentKind(text, bank, wireBank);
  const att: V2Attachment = {
    id: newId("att"),
    kind,
    text,
    bbox: block.bbox,
    source: "ctrl_click",
    snapped: true,
    createdAt: new Date().toISOString(),
  };
  node.attachments = [...(node.attachments ?? []), att];
  const identity = deriveIdentityFromAttachments(node, bank);
  return { ok: true, note: `${node.label} ⇐ ${kind}: "${text}"`, kind, identity };
}
