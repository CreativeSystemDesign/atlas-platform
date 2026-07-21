import type { AnnotationBox, SymbolBankEntry } from "./studio-types.ts";

export type ComponentPartsTag = {
  symbol: string;
  description: string;
  partNumber: string;
  location: string;
  sourcePage: string;
  label: string;
};

type ComponentIdentityLike = Partial<{
  full_symbol: string;
  symbol: string;
  description: string;
  part_number: string;
  partNumber: string;
  location: string;
  source_page: string;
  sourcePage: string;
}>;

export function componentPartsTagForBox(box: AnnotationBox): ComponentPartsTag | null {
  const symbol = componentIdentityFromMetadata(box) ?? activeSymbolCandidate(box);
  if (!symbol) return null;

  const description = cleanTagText(symbol.description);
  const partNumber = cleanTagText(symbol.part_number);
  const location = cleanTagText(symbol.location);
  const sourcePage = cleanTagText(symbol.source_page);
  const symbolText = cleanTagText(symbol.symbol);
  if (!description && !partNumber && !symbolText) return null;

  const labelParts = [
    symbolText,
    description,
    partNumber,
  ].filter(Boolean);

  return {
    symbol: symbolText,
    description,
    partNumber,
    location,
    sourcePage,
    label: labelParts.join(" · "),
  };
}

export function componentIdentityMetadataFromSymbol(
  symbol: SymbolBankEntry | undefined
) {
  if (!symbol) return null;
  return {
    full_symbol: symbol.symbol,
    class_family: symbol.family,
    description: symbol.description,
    part_number: symbol.part_number,
    location: symbol.location,
    source_page: symbol.source_page,
    source: "parts_symbol_match",
    match_status: "symbol_match",
  };
}

function activeSymbolCandidate(box: AnnotationBox): SymbolBankEntry | null {
  const index = box.labelCandidateIndex >= 0 ? box.labelCandidateIndex : 0;
  const activeCandidate = box.labelCandidates[index];
  if (activeCandidate?.symbol && symbolMatchesBoxEvidence(box, activeCandidate)) {
    return activeCandidate.symbol;
  }
  return (
    box.labelCandidates.find(
      (candidate) =>
        candidate.symbol && symbolMatchesBoxEvidence(box, candidate)
    )?.symbol ?? null
  );
}

function symbolMatchesBoxEvidence(
  box: AnnotationBox,
  candidate: AnnotationBox["labelCandidates"][number]
) {
  const symbol = candidate.symbol;
  if (!symbol) return false;
  const componentFamily = normalizeSymbolFamily(box.label);
  const candidateFamily = normalizeSymbolFamily(candidate.normalizedText);
  const symbolFamily = normalizeSymbolFamily(symbol.symbol);
  if (
    componentFamily &&
    (componentFamily === candidateFamily || componentFamily === symbolFamily)
  ) {
    return true;
  }

  const attachments = Array.isArray(box.metadata.attachments)
    ? box.metadata.attachments
    : [];
  const symbolText = normalizeSymbolText(symbol.symbol);
  const partNumber = normalizePartText(symbol.part_number);
  return attachments.some((attachment) => {
    const attachmentText = normalizeSymbolText(attachment.text);
    const attachmentPart = normalizePartText(attachment.text);
    return (
      (symbolText && attachmentText === symbolText) ||
      (partNumber && attachmentPart === partNumber)
    );
  });
}

function normalizeSymbolFamily(value: unknown) {
  return normalizeSymbolText(value).match(/^[A-Z]+/)?.[0] ?? "";
}

function normalizeSymbolText(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizePartText(value: unknown) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function componentIdentityFromMetadata(box: AnnotationBox): SymbolBankEntry | null {
  const raw = box.metadata.componentIdentity;
  if (!raw || typeof raw !== "object") return null;
  const identity = raw as ComponentIdentityLike;
  const symbol = cleanTagText(identity.full_symbol ?? identity.symbol);
  const description = cleanTagText(identity.description);
  const partNumber = cleanTagText(identity.part_number ?? identity.partNumber);
  const location = cleanTagText(identity.location);
  const sourcePage = cleanTagText(identity.source_page ?? identity.sourcePage);
  if (!symbol && !description && !partNumber) return null;
  return {
    symbol,
    family: symbol.match(/^[A-Z]+/)?.[0] ?? symbol,
    suffix: "",
    suffix_semantics: "opaque_identifier",
    description,
    part_number: partNumber,
    location,
    source_page: sourcePage,
  };
}

function cleanTagText(value: unknown) {
  return String(value ?? "").trim();
}
