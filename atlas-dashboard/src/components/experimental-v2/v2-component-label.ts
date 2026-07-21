// Resolve a component's MARK and full identity from the symbol bank.
//
// Salvaged from the Extraction Studio / YOLO workspace:
//  - componentLabelCandidates(): nearby (fragment-merged) text matched against
//    the symbol bank, with full-width folding.
//  - yoloComponentLabelCandidates(): the "seldom fails" zone-based spatial
//    ranker (inside > above-top-overlapping > above-top-near > above > ...),
//    which also filters out terminal-like tokens (P1, R1, PE, ...) and digits.
//  - componentIdentityMetadataFromSymbol(): full parts-list identity for the
//    matched mark (digital-twin depth).

import { componentLabelCandidates } from "../extraction-workbench/studio-label-candidates";
import { yoloComponentLabelCandidates } from "../extraction-workbench/yolo-label-candidates";
import { componentIdentityMetadataFromSymbol } from "../extraction-workbench/component-parts-tag";
import { type BBoxPx } from "../extraction-workbench/studio-geometry";
import type { PageMetadata, SymbolBankEntry, LabelCandidate } from "../extraction-workbench/studio-types";
import { type V2ComponentIdentity } from "./experimental-v2-types";

export type ResolvedComponent = {
  label: string | null;
  identity: V2ComponentIdentity | null;
};

const EMPTY: ResolvedComponent = { label: null, identity: null };

function identityFrom(symbol: SymbolBankEntry | undefined): V2ComponentIdentity | null {
  const meta = componentIdentityMetadataFromSymbol(symbol);
  if (!meta) return null;
  return {
    fullSymbol: meta.full_symbol ?? "",
    family: meta.class_family ?? "",
    description: meta.description ?? "",
    partNumber: meta.part_number ?? "",
    location: meta.location ?? "",
    sourcePage: meta.source_page ?? "",
  };
}

const markOf = (c: LabelCandidate) => (c.normalizedText || c.text || "").trim() || null;

export function resolveComponent(
  box: BBoxPx,
  pageMetadata: PageMetadata | null,
  symbolBank: SymbolBankEntry[]
): ResolvedComponent {
  if (!pageMetadata) return EMPTY;

  const candidates = componentLabelCandidates({
    componentBox: box,
    pageMetadata,
    symbolBank,
    visiblePageBox: null,
    includeInsideTextCandidates: true,
  });
  if (candidates.length === 0) return EMPTY;

  // Rank with the YOLO zone-ranker (the proven, near-perfect picker).
  const ranked = yoloComponentLabelCandidates(candidates, box);
  const best =
    ranked[0] ??
    // Fallback: if the strict YOLO filter dropped everything, take the best
    // bank match, else the nearest candidate.
    candidates.find((c) => c.source === "parts_symbol_match") ??
    candidates[0];

  return { label: best ? markOf(best) : null, identity: identityFrom(best?.symbol) };
}
