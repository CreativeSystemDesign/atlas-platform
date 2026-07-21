import {
  centerOfBox,
  enclosingBox,
  type BBoxPx,
} from "./studio-geometry.ts";

export type TextFragmentCandidate = {
  text: string;
  bbox: BBoxPx;
  textFragments?: Array<{
    text: string;
    normalizedText?: string;
    bbox: BBoxPx;
  }>;
  score?: number;
  overlap?: number;
  insideCenter?: boolean;
};

export function mergeAdjacentTextFragmentsAroundPrimary<
  Candidate extends TextFragmentCandidate,
>(
  candidates: Candidate[],
  primary: Candidate,
  options: { mergeScale?: number } = {}
): Candidate {
  const mergeScale = options.mergeScale ?? 1;
  if (mergeScale <= 0) return primary;

  const primaryCenter = centerOfBox(primary.bbox);
  const sameLineCandidates = candidates
    .filter((candidate) => {
      const candidateCenter = centerOfBox(candidate.bbox);
      const lineTolerance = Math.max(
        6,
        Math.max(primary.bbox.height, candidate.bbox.height) * 0.75
      ) * mergeScale;
      return Math.abs(candidateCenter.y - primaryCenter.y) <= lineTolerance;
    })
    .sort((left, right) => left.bbox.x - right.bbox.x);

  const primaryIndex = sameLineCandidates.indexOf(primary);
  if (primaryIndex < 0) return primary;

  const maxGap = Math.max(6, primary.bbox.height * 1.25) * mergeScale;
  let firstIndex = primaryIndex;
  let lastIndex = primaryIndex;

  while (
    firstIndex > 0 &&
    horizontalGap(sameLineCandidates[firstIndex - 1], sameLineCandidates[firstIndex]) <=
      maxGap
  ) {
    firstIndex -= 1;
  }

  while (
    lastIndex < sameLineCandidates.length - 1 &&
    horizontalGap(sameLineCandidates[lastIndex], sameLineCandidates[lastIndex + 1]) <=
      maxGap
  ) {
    lastIndex += 1;
  }

  const fragments = sameLineCandidates.slice(firstIndex, lastIndex + 1);
  if (fragments.length <= 1) return primary;

  const text = joinTextFragments(fragments);
  return {
    ...primary,
    text,
    bbox: enclosingBox(fragments.map((fragment) => fragment.bbox)),
    textFragments: fragments.flatMap(textFragmentsOf),
    score: Math.min(...fragments.map((fragment) => fragment.score ?? 0)),
    overlap: fragments.reduce(
      (total, fragment) => total + (fragment.overlap ?? 0),
      0
    ),
    insideCenter: fragments.some((fragment) => fragment.insideCenter),
  };
}

export function mergeTextFragmentsInReadingOrder<
  Candidate extends TextFragmentCandidate,
>(candidates: Candidate[]): Candidate | null {
  const fragments = candidates.filter((candidate) => candidate.text.trim());
  if (fragments.length === 0) return null;
  if (fragments.length === 1) return fragments[0];

  const lines: Candidate[][] = [];
  for (const fragment of [...fragments].sort(compareByTopThenLeft)) {
    const fragmentCenter = centerOfBox(fragment.bbox);
    const matchingLine = lines.find((line) => {
      const lineCenterY =
        line.reduce((total, item) => total + centerOfBox(item.bbox).y, 0) /
        line.length;
      const lineHeight = Math.max(...line.map((item) => item.bbox.height));
      const lineTolerance = Math.max(6, Math.max(lineHeight, fragment.bbox.height) * 0.75);
      return Math.abs(fragmentCenter.y - lineCenterY) <= lineTolerance;
    });

    if (matchingLine) {
      matchingLine.push(fragment);
    } else {
      lines.push([fragment]);
    }
  }

  const orderedLines = lines
    .map((line) => [...line].sort((left, right) => left.bbox.x - right.bbox.x))
    .sort((left, right) => centerOfBox(left[0].bbox).y - centerOfBox(right[0].bbox).y);
  const orderedFragments = orderedLines.flat();

  return {
    ...orderedFragments[0],
    text: orderedLines.map(joinTextFragments).join(" "),
    bbox: enclosingBox(orderedFragments.map((fragment) => fragment.bbox)),
    textFragments: orderedFragments.flatMap(textFragmentsOf),
    score: Math.min(...orderedFragments.map((fragment) => fragment.score ?? 0)),
    overlap: orderedFragments.reduce(
      (total, fragment) => total + (fragment.overlap ?? 0),
      0
    ),
    insideCenter: orderedFragments.some((fragment) => fragment.insideCenter),
  };
}

function compareByTopThenLeft(
  left: TextFragmentCandidate,
  right: TextFragmentCandidate
) {
  return left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x;
}

function horizontalGap(
  left: TextFragmentCandidate,
  right: TextFragmentCandidate
) {
  return Math.max(0, right.bbox.x - (left.bbox.x + left.bbox.width));
}

function joinTextFragments(fragments: TextFragmentCandidate[]) {
  return fragments.reduce((text, fragment, index) => {
    if (index === 0) return fragment.text.trim();
    const previous = fragments[index - 1];
    const gap = horizontalGap(previous, fragment);
    const spaceThreshold = Math.max(previous.bbox.height, fragment.bbox.height) * 0.75;
    const separator = gap > spaceThreshold ? " " : "";
    return `${text}${separator}${fragment.text.trim()}`;
  }, "");
}

function textFragmentsOf(fragment: TextFragmentCandidate) {
  return fragment.textFragments ?? [{ text: fragment.text, bbox: fragment.bbox }];
}
