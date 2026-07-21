import { normalizeSymbolText } from "./annotation-labeling.ts";
import {
  boxesIntersect,
  centerOfBox,
  distanceBetween,
  enclosingBox,
  expandBox,
  intersectionArea,
  pdfBboxToPx,
  MIN_BOX_SIZE,
  type BBoxPx,
} from "./studio-geometry.ts";
import { mergeAdjacentTextFragmentsAroundPrimary } from "./studio-text-fragments.ts";
import type { LabelTextFragment, PageMetadata } from "./studio-types.ts";

type VectorTextCandidate = {
  text: string;
  bbox: BBoxPx;
  textFragments?: LabelTextFragment[];
  score?: number;
  overlap?: number;
  insideCenter?: boolean;
};

export function bboxForEditedVectorText({
  currentBbox,
  currentText,
  nextText,
  pageMetadata,
}: {
  currentBbox: BBoxPx | null | undefined;
  currentText: string;
  nextText: string;
  pageMetadata: PageMetadata | null;
}): BBoxPx | null {
  const scale = pageMetadata?.scale;
  const textBlocks = pageMetadata?.text_blocks ?? [];
  const nextNormalized = normalizeSymbolText(nextText);
  if (!scale || !currentBbox || !nextNormalized || textBlocks.length === 0) {
    return null;
  }

  const currentNormalized = normalizeSymbolText(currentText);
  const currentCenter = centerOfBox(currentBbox);
  const searchPadding = Math.max(18, currentBbox.height * 2.4);
  const searchBox = expandBox(currentBbox, searchPadding);
  const sameLineSearchPx = Math.max(140, currentBbox.width * 3);

  const fragments = textBlocks
    .map((block): VectorTextCandidate | null => {
      const text = block.text.trim();
      if (!text) return null;
      const bbox = pdfBboxToPx(block.bbox, scale);
      const center = centerOfBox(bbox);
      const overlap = intersectionArea(currentBbox, bbox);
      const insideCenter =
        center.x >= currentBbox.x &&
        center.x <= currentBbox.x + currentBbox.width &&
        center.y >= currentBbox.y &&
        center.y <= currentBbox.y + currentBbox.height;
      return {
        text,
        bbox,
        textFragments: [{ text, normalizedText: normalizeSymbolText(text), bbox }],
        overlap,
        insideCenter,
        score: distanceBetween(currentCenter, center) - overlap,
      };
    })
    .filter((fragment): fragment is VectorTextCandidate => Boolean(fragment));

  const nearby = fragments.filter((fragment) => {
    const center = centerOfBox(fragment.bbox);
    const sameLine =
      Math.abs(center.y - currentCenter.y) <=
      Math.max(10, currentBbox.height * 1.25, fragment.bbox.height * 1.25);
    const closeHorizontally =
      Math.abs(center.x - currentCenter.x) <= sameLineSearchPx;
    return (
      boxesIntersect(searchBox, fragment.bbox) ||
      (sameLine && closeHorizontally)
    );
  });
  if (nearby.length === 0) return null;

  const primaries = nearby
    .filter((fragment) => {
      const normalized = normalizeSymbolText(fragment.text);
      return (
        boxesIntersect(searchBox, fragment.bbox) ||
        fragment.overlap ||
        fragment.insideCenter ||
        (currentNormalized &&
          (normalized.includes(currentNormalized) ||
            currentNormalized.includes(normalized)))
      );
    })
    .sort(compareVectorTextCandidates);

  const matches: Array<{ bbox: BBoxPx; score: number }> = [];
  const primaryCandidates = primaries.length > 0 ? primaries : nearby;
  for (const primary of primaryCandidates.slice(0, 8)) {
    for (const candidate of [
      primary,
      mergeAdjacentTextFragmentsAroundPrimary(nearby, primary, {
        mergeScale: 0.55,
      }),
    ]) {
      const bbox = bboxForNormalizedText(candidate, nextNormalized);
      if (!bbox) continue;
      const normalizedCandidate = normalizeSymbolText(candidate.text);
      const startsWithCurrent =
        currentNormalized && normalizedCandidate.startsWith(currentNormalized);
      const startsWithNext = normalizedCandidate.startsWith(nextNormalized);
      matches.push({
        bbox,
        score:
          distanceBetween(currentCenter, centerOfBox(bbox)) -
          (startsWithNext ? 50 : 0) -
          (startsWithCurrent ? 25 : 0),
      });
    }
  }

  return matches.sort((left, right) => left.score - right.score)[0]?.bbox ?? null;
}

function compareVectorTextCandidates(
  left: VectorTextCandidate,
  right: VectorTextCandidate
) {
  const leftOverlap = left.overlap ?? 0;
  const rightOverlap = right.overlap ?? 0;
  if (Math.abs(leftOverlap - rightOverlap) > 0.001) {
    return rightOverlap - leftOverlap;
  }
  if (left.insideCenter !== right.insideCenter) {
    return left.insideCenter ? -1 : 1;
  }
  return (left.score ?? 0) - (right.score ?? 0);
}

function bboxForNormalizedText(
  candidate: VectorTextCandidate,
  nextNormalized: string
): BBoxPx | null {
  const normalized = normalizeSymbolText(candidate.text);
  if (!normalized) return null;
  if (normalized === nextNormalized) return candidate.bbox;
  if (normalized.startsWith(nextNormalized)) {
    return leadingNormalizedBbox(candidate, nextNormalized.length);
  }
  if (normalized.includes(nextNormalized)) return candidate.bbox;
  return null;
}

function leadingNormalizedBbox(
  candidate: VectorTextCandidate,
  leadingLength: number
): BBoxPx {
  const fragments = candidate.textFragments ?? [];
  if (fragments.length <= 1) {
    return leadingTextBbox(candidate.bbox, {
      leadingLength,
      totalLength: normalizeSymbolText(candidate.text).length,
    });
  }

  let remaining = leadingLength;
  const boxes: BBoxPx[] = [];
  for (const fragment of [...fragments].sort((left, right) => left.bbox.x - right.bbox.x)) {
    const normalized = normalizeSymbolText(fragment.normalizedText || fragment.text);
    if (!normalized) continue;
    if (remaining >= normalized.length) {
      boxes.push(fragment.bbox);
      remaining -= normalized.length;
      if (remaining === 0) break;
      continue;
    }
    boxes.push(
      leadingTextBbox(fragment.bbox, {
        leadingLength: remaining,
        totalLength: normalized.length,
      })
    );
    remaining = 0;
    break;
  }

  return boxes.length > 0 ? enclosingBox(boxes) : candidate.bbox;
}

function leadingTextBbox(
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
  const ratio = leadingLength / totalLength;
  if (bbox.width >= bbox.height) {
    return {
      ...bbox,
      width: Math.max(MIN_BOX_SIZE, bbox.width * ratio),
    };
  }
  return {
    ...bbox,
    height: Math.max(MIN_BOX_SIZE, bbox.height * ratio),
  };
}
