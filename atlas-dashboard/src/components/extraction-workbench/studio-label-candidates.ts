import {
  normalizeSymbolText,
  normalizeWireLabelText,
} from "./annotation-labeling.ts";
import {
  boxesIntersect,
  centerOfBox,
  distanceBetween,
  expandBox,
  intersectionArea,
  pdfBboxToPx,
  type BBoxPx,
} from "./studio-geometry.ts";
import { compareCandidatesByProximity } from "./studio-selection-helpers.ts";
import {
  mergeAdjacentTextFragmentsAroundPrimary,
  mergeTextFragmentsInReadingOrder,
} from "./studio-text-fragments.ts";
import type {
  LabelCandidate,
  PageMetadata,
  SymbolBankEntry,
  WireLabelBankEntry,
} from "./studio-types.ts";

export function componentLabelCandidates({
  componentBox,
  pageMetadata,
  symbolBank,
  datasetClassLabels = false,
  visiblePageBox,
  includeInsideTextCandidates = false,
}: {
  componentBox: BBoxPx;
  pageMetadata: PageMetadata | null;
  symbolBank: SymbolBankEntry[];
  datasetClassLabels?: boolean;
  visiblePageBox: BBoxPx | null;
  includeInsideTextCandidates?: boolean;
}): LabelCandidate[] {
  const scale = pageMetadata?.scale;
  const textBlocks = pageMetadata?.text_blocks ?? [];
  if (!scale || textBlocks.length === 0) return [];

  const symbolEntries = symbolBank
    .map((entry) => ({
      entry,
      normalizedSymbol: normalizeSymbolText(entry.symbol),
      labelPrefix: symbolLabelPrefix(entry.symbol),
    }))
    .filter((entry) => entry.normalizedSymbol && entry.labelPrefix);
  const symbolMap = new Map(
    symbolEntries.map((entry) => [entry.normalizedSymbol, entry.entry])
  );
  const componentCenter = centerOfBox(componentBox);
  const expandedSearch = expandBox(componentBox, 420);
  const textBlockCandidates = textBlocks.map((block) => {
    const bbox = pdfBboxToPx(block.bbox, scale);
    return {
      text: block.text.trim(),
      normalizedText: normalizeSymbolText(block.text),
      bbox,
    };
  });
  const candidates: LabelCandidate[] = [];

  for (const block of textBlockCandidates) {
    const { bbox, normalizedText } = block;
    if (!normalizedText) continue;
    if (/^\d+$/.test(normalizedText)) continue;
    const prefixSymbol = datasetClassLabels
      ? symbolPrefixMatch(normalizedText, symbolEntries)
      : undefined;
    const adjacentSymbol = adjacentDigitExpandedSymbol({
      block,
      textBlocks: textBlockCandidates,
      symbolMap,
    });
    const symbol = prefixSymbol?.entry ?? symbolMap.get(normalizedText) ?? adjacentSymbol;
    const labelText = prefixSymbol?.labelPrefix ?? block.text;
    const labelNormalizedText = prefixSymbol?.labelPrefix ?? normalizedText;
    const labelBbox = prefixSymbol
      ? leadingNormalizedBbox(bbox, {
          leadingLength: prefixSymbol.labelPrefix.length,
          totalLength: normalizedText.length,
        })
      : bbox;
    const candidateCenter = centerOfBox(bbox);
    const distance = distanceBetween(componentCenter, candidateCenter);
    const insideSearch = boxesIntersect(expandedSearch, bbox);

    if (!insideSearch) continue;
    if (visiblePageBox && !boxesIntersect(visiblePageBox, bbox)) continue;

    candidates.push({
      text: labelText,
      normalizedText: labelNormalizedText,
      bbox: labelBbox,
      textFragments: [{ text: labelText, normalizedText: labelNormalizedText, bbox: labelBbox }],
      score: distance,
      distance,
      source: symbol ? "parts_symbol_match" : "text_proximity",
      reason: symbol
        ? prefixSymbol
          ? "known_parts_list_symbol_prefix_nearby"
          : adjacentSymbol
          ? "known_parts_list_symbol_from_adjacent_digits"
          : "known_parts_list_symbol_nearby"
        : "nearby_text",
      symbol,
    });
  }

  if (!includeInsideTextCandidates) {
    return candidates.sort(compareCandidatesByProximity);
  }

  return [
    ...insideTextLabelCandidates({
      componentBox,
      textBlocks: textBlockCandidates,
      symbolMap,
    }),
    ...candidates.sort(compareCandidatesByProximity),
  ].filter(uniqueLabelCandidate);
}

function insideTextLabelCandidates({
  componentBox,
  textBlocks,
  symbolMap,
}: {
  componentBox: BBoxPx;
  textBlocks: Array<{ text: string; normalizedText: string; bbox: BBoxPx }>;
  symbolMap: Map<string, SymbolBankEntry>;
}): LabelCandidate[] {
  const componentCenter = centerOfBox(componentBox);
  return textBlocks
    .map((block) => {
      const overlap = intersectionArea(componentBox, block.bbox);
      const blockCenter = centerOfBox(block.bbox);
      const insideCenter =
        blockCenter.x >= componentBox.x &&
        blockCenter.x <= componentBox.x + componentBox.width &&
        blockCenter.y >= componentBox.y &&
        blockCenter.y <= componentBox.y + componentBox.height;
      return {
        block,
        overlap,
        insideCenter,
        distance: distanceBetween(componentCenter, blockCenter),
      };
    })
    .filter(({ block }) => block.normalizedText && !/^\d+$/.test(block.normalizedText))
    .filter(({ overlap, insideCenter }) => overlap > 0 || insideCenter)
    .sort((left, right) => {
      if (left.insideCenter !== right.insideCenter) {
        return left.insideCenter ? -1 : 1;
      }
      if (Math.abs(left.overlap - right.overlap) > 0.001) {
        return right.overlap - left.overlap;
      }
      return left.distance - right.distance;
    })
    .map(({ block, distance }) => ({
      text: block.text,
      normalizedText: block.normalizedText,
      bbox: block.bbox,
      textFragments: [
        {
          text: block.text,
          normalizedText: block.normalizedText,
          bbox: block.bbox,
        },
      ],
      score: distance,
      distance,
      source: "bbox_text" as const,
      reason: "text_inside_component_bbox",
      symbol: symbolMap.get(block.normalizedText),
    }));
}

function uniqueLabelCandidate(candidate: LabelCandidate, index: number, candidates: LabelCandidate[]) {
  return (
    candidates.findIndex(
      (item) =>
        item.normalizedText === candidate.normalizedText &&
        Math.abs(item.bbox.x - candidate.bbox.x) < 0.001 &&
        Math.abs(item.bbox.y - candidate.bbox.y) < 0.001 &&
        Math.abs(item.bbox.width - candidate.bbox.width) < 0.001 &&
        Math.abs(item.bbox.height - candidate.bbox.height) < 0.001
    ) === index
  );
}

function symbolPrefixMatch(
  normalizedText: string,
  symbolEntries: Array<{
    entry: SymbolBankEntry;
    normalizedSymbol: string;
    labelPrefix: string;
  }>
) {
  return symbolEntries
    .filter((entry) => normalizedText.startsWith(entry.normalizedSymbol))
    .sort((left, right) => right.normalizedSymbol.length - left.normalizedSymbol.length)[0];
}

function symbolLabelPrefix(symbolText: string) {
  return normalizeSymbolText(symbolText).match(/^[A-Z]+/)?.[0] ?? "";
}

function leadingNormalizedBbox(
  bbox: BBoxPx,
  {
    leadingLength,
    totalLength,
  }: {
    leadingLength: number;
    totalLength: number;
  }
): BBoxPx {
  if (leadingLength <= 0 || totalLength <= 0 || leadingLength >= totalLength) {
    return bbox;
  }
  return {
    ...bbox,
    width: Math.max(8, bbox.width * (leadingLength / totalLength)),
  };
}

function adjacentDigitExpandedSymbol({
  block,
  textBlocks,
  symbolMap,
}: {
  block: { text: string; normalizedText: string; bbox: BBoxPx };
  textBlocks: Array<{ text: string; normalizedText: string; bbox: BBoxPx }>;
  symbolMap: Map<string, SymbolBankEntry>;
}) {
  if (!/^[A-Z]+$/.test(block.normalizedText)) return undefined;
  const rightEdge = block.bbox.x + block.bbox.width;
  const centerY = block.bbox.y + block.bbox.height / 2;
  const lineTolerance = Math.max(8, block.bbox.height * 0.8);
  const maxGap = Math.max(18, block.bbox.height * 1.25);

  const digitBlocks = textBlocks
    .filter((candidate) => {
      if (!/^\d+$/.test(candidate.normalizedText)) return false;
      const candidateCenterY = candidate.bbox.y + candidate.bbox.height / 2;
      const gap = candidate.bbox.x - rightEdge;
      return (
        gap >= -2 &&
        gap <= maxGap &&
        Math.abs(candidateCenterY - centerY) <= lineTolerance
      );
    })
    .sort((left, right) => left.bbox.x - right.bbox.x);

  let cursorRight = rightEdge;
  let suffix = "";
  for (const digitBlock of digitBlocks) {
    const gap = digitBlock.bbox.x - cursorRight;
    if (gap > maxGap) break;
    suffix += digitBlock.normalizedText;
    cursorRight = digitBlock.bbox.x + digitBlock.bbox.width;
    const symbol = symbolMap.get(`${block.normalizedText}${suffix}`);
    if (symbol) return symbol;
  }

  return undefined;
}

export function textForLabelBox({
  labelBox,
  pageMetadata,
  mergeLines = false,
  mergeScale = 1,
  includeAdjacentOutsideBox = false,
}: {
  labelBox: BBoxPx;
  pageMetadata: PageMetadata | null;
  mergeLines?: boolean;
  mergeScale?: number;
  includeAdjacentOutsideBox?: boolean;
}) {
  const scale = pageMetadata?.scale;
  const textBlocks = pageMetadata?.text_blocks ?? [];
  if (!scale || textBlocks.length === 0) return null;

  const candidates = textBlocks
    .map((block) => {
      const bbox = pdfBboxToPx(block.bbox, scale);
      const overlap = intersectionArea(labelBox, bbox);
      const labelCenter = centerOfBox(labelBox);
      const textCenter = centerOfBox(bbox);
      const centerDistance = distanceBetween(labelCenter, textCenter);
      const insideCenter =
        textCenter.x >= labelBox.x &&
        textCenter.x <= labelBox.x + labelBox.width &&
        textCenter.y >= labelBox.y &&
        textCenter.y <= labelBox.y + labelBox.height;
      return {
        text: block.text.trim(),
        normalizedText: normalizeSymbolText(block.text),
        bbox,
        textFragments: [
          {
            text: block.text.trim(),
            normalizedText: normalizeSymbolText(block.text),
            bbox,
          },
        ],
        score: overlap > 0 || insideCenter ? centerDistance - overlap : 10000,
        overlap,
        insideCenter,
      };
    })
    .filter((candidate) => candidate.text);

  const hitCandidates = candidates
    .filter((candidate) => candidate.overlap > 0 || candidate.insideCenter)
    .sort((left, right) => left.score - right.score);

  const primary = hitCandidates[0] ?? null;
  if (!primary) return null;

  const merged =
    mergeLines
      ? mergeTextFragmentsInReadingOrder(hitCandidates) ?? primary
      : mergeAdjacentTextFragmentsAroundPrimary(
          includeAdjacentOutsideBox ? candidates : hitCandidates,
          primary,
          {
            mergeScale,
          }
        );
  const mergedText = merged.text.trim();
  return {
    ...merged,
    text: mergedText,
    normalizedText: normalizeSymbolText(mergedText),
  };
}

export function wireLabelCandidatesForSegment({
  wireBox,
  pageMetadata,
  wireLabelBank,
  visiblePageBox,
}: {
  wireBox: BBoxPx;
  pageMetadata: PageMetadata | null;
  wireLabelBank: WireLabelBankEntry[];
  visiblePageBox: BBoxPx | null;
}): LabelCandidate[] {
  const scale = pageMetadata?.scale;
  const textBlocks = pageMetadata?.text_blocks ?? [];
  if (!scale || textBlocks.length === 0) return [];

  const wireLabelMap = new Map(
    wireLabelBank.map((entry) => [
      normalizeWireLabelText(entry.wire_label),
      entry,
    ])
  );
  const wireCenter = centerOfBox(wireBox);
  const expandedSearch = expandBox(wireBox, 360);
  const candidates: LabelCandidate[] = [];

  for (const block of textBlocks) {
    const bbox = pdfBboxToPx(block.bbox, scale);
    const normalizedText = normalizeWireLabelText(block.text);
    if (!normalizedText) continue;
    const bankMatch = wireLabelMap.get(normalizedText);
    const candidateCenter = centerOfBox(bbox);
    const distance = distanceBetween(wireCenter, candidateCenter);
    const insideSearch = boxesIntersect(expandedSearch, bbox);

    if (!insideSearch) continue;
    if (visiblePageBox && !boxesIntersect(visiblePageBox, bbox)) continue;

    candidates.push({
      text: block.text.trim(),
      normalizedText,
      bbox,
      textFragments: [{ text: block.text.trim(), normalizedText, bbox }],
      score: distance,
      distance,
      source: bankMatch ? "wire_label_bank_match" : "text_proximity",
      reason: bankMatch ? "known_dcm_wire_label_nearby" : "nearby_text",
    });
  }

  return candidates.sort(compareCandidatesByProximity);
}
