export type BBoxPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContinuationTextBlock = {
  text: string;
  bbox: BBoxPx;
  allowAdjacentDigitGrouping?: boolean;
};

export type ContinuationReference = {
  page: number;
  row: number;
  label: string;
  pageText: string;
  rowText: string;
  pageBbox: BBoxPx;
  rowBbox: BBoxPx;
};

type Candidate = {
  text: string;
  value: number;
  bbox: BBoxPx;
  center: { x: number; y: number };
  score: number;
};

type CandidatePair = {
  upper: Candidate;
  lower: Candidate;
  verticalGap: number;
  midpointDelta: number;
  straddlesSymbolCenter: boolean;
  score: number;
};

export function resolveContinuationReference(
  symbolBox: BBoxPx,
  textBlocks: ContinuationTextBlock[]
): ContinuationReference | null {
  const symbolCenter = centerOfBox(symbolBox);
  const numericCandidates = continuationNumberCandidates({
    symbolBox,
    textBlocks,
    maxHorizontalDelta: Math.max(44, symbolBox.width * 1.15),
  });
  const pair = continuationPairsForSymbolCenter(
    numericCandidates,
    symbolCenter
  )[0];

  return pair ? referenceFromPair(pair) : null;
}

export function resolveContinuationReferenceBank(
  symbolBox: BBoxPx,
  textBlocks: ContinuationTextBlock[]
): ContinuationReference[] {
  const clickedReference = resolveContinuationReference(symbolBox, textBlocks);
  if (!clickedReference) return [];

  const clickedTopCenter = centerOfBox(clickedReference.pageBbox);
  const clickedBottomCenter = centerOfBox(clickedReference.rowBbox);
  const verticalTolerance =
    Math.max(clickedReference.pageBbox.height, clickedReference.rowBbox.height) *
    0.75;
  const rowSearchBox = expandBox(
    enclosingBox([clickedReference.pageBbox, clickedReference.rowBbox]),
    220
  );
  const numericCandidates = continuationNumberCandidates({
    symbolBox: rowSearchBox,
    textBlocks,
    maxHorizontalDelta: rowSearchBox.width,
  });
  const topRow = numericCandidates
    .filter(
      (candidate) => Math.abs(candidate.center.y - clickedTopCenter.y) <= verticalTolerance
    )
    .sort((left, right) => left.center.x - right.center.x);
  const bottomRow = numericCandidates
    .filter(
      (candidate) => Math.abs(candidate.center.y - clickedBottomCenter.y) <= verticalTolerance
    )
    .sort((left, right) => left.center.x - right.center.x);

  const usedBottomIndexes = new Set<number>();
  const references = topRow
    .map((upper) => {
      const bottomMatch = bottomRow
        .map((lower, index) => ({
          lower,
          index,
          distance: Math.abs(lower.center.x - upper.center.x),
        }))
        .filter((candidate) => !usedBottomIndexes.has(candidate.index))
        .filter(
          (candidate) =>
            candidate.distance <=
            Math.max(34, upper.bbox.width * 1.7, candidate.lower.bbox.width * 1.7)
        )
        .sort((left, right) => left.distance - right.distance)[0];
      if (!bottomMatch) return null;
      usedBottomIndexes.add(bottomMatch.index);
      return referenceFromPair({
        upper,
        lower: bottomMatch.lower,
      });
    })
    .filter((reference): reference is ContinuationReference => Boolean(reference));

  return references.length > 0 ? references : [clickedReference];
}

function continuationNumberCandidates({
  symbolBox,
  textBlocks,
  maxHorizontalDelta,
}: {
  symbolBox: BBoxPx;
  textBlocks: ContinuationTextBlock[];
  maxHorizontalDelta: number;
}): Candidate[] {
  const symbolCenter = centerOfBox(symbolBox);
  const searchBox = expandBox(symbolBox, 54);
  return groupAdjacentDigitCandidates(textBlocks)
    .map((block) => {
      const text = normalizeContinuationNumber(block.text);
      if (!text) return null;
      const center = centerOfBox(block.bbox);
      if (!boxesIntersect(searchBox, block.bbox)) return null;
      const horizontalDelta = Math.abs(center.x - symbolCenter.x);
      const verticalDelta = Math.abs(center.y - symbolCenter.y);
      if (horizontalDelta > maxHorizontalDelta) return null;
      return {
        text,
        value: Number.parseInt(text, 10),
        bbox: block.bbox,
        center,
        score: horizontalDelta * 1.8 + verticalDelta,
      };
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((left, right) => left.score - right.score);
}

function continuationPairsForSymbolCenter(
  numericCandidates: Candidate[],
  symbolCenter: { x: number; y: number }
): CandidatePair[] {
  return numericCandidates
    .flatMap((upper, upperIndex) =>
      numericCandidates.slice(upperIndex + 1).map((lower) => {
        const top = upper.center.y <= lower.center.y ? upper : lower;
        const bottom = top === upper ? lower : upper;
        const midpointY = (top.center.y + bottom.center.y) / 2;
        return {
          upper: top,
          lower: bottom,
          verticalGap: bottom.center.y - top.center.y,
          midpointDelta: Math.abs(midpointY - symbolCenter.y),
          straddlesSymbolCenter:
            top.center.y <= symbolCenter.y + 4 &&
            bottom.center.y >= symbolCenter.y - 4,
          score: top.score + bottom.score,
        };
      })
    )
    .filter(
      (candidate) =>
        candidate.verticalGap >= 8 &&
        candidate.verticalGap <= 54 &&
        candidate.straddlesSymbolCenter &&
        candidate.midpointDelta <= Math.max(18, candidate.verticalGap * 0.55)
    )
    .sort((left, right) => {
      const scoreDelta = left.score - right.score;
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
      const midpointDelta = left.midpointDelta - right.midpointDelta;
      if (Math.abs(midpointDelta) > 0.001) return midpointDelta;
      return left.verticalGap - right.verticalGap;
    });
}

function referenceFromPair(pair: Pick<CandidatePair, "upper" | "lower">) {
  const { upper, lower } = pair;
  return {
    page: upper.value,
    row: lower.value,
    label: `${upper.value}/${lower.value}`,
    pageText: upper.text,
    rowText: lower.text,
    pageBbox: upper.bbox,
    rowBbox: lower.bbox,
  };
}

function normalizeContinuationNumber(value: string) {
  const normalized = normalizeFullWidthDigits(value).trim().replace(/\s+/g, "");
  if (!/^\d{1,3}$/.test(normalized)) return "";
  return normalized;
}

function groupAdjacentDigitCandidates(
  textBlocks: ContinuationTextBlock[]
): ContinuationTextBlock[] {
  const expandedTextBlocks = splitSeparatedNumericRuns(textBlocks);
  const digitBlocks = expandedTextBlocks
    .map((block) => ({
      text: normalizeContinuationNumber(block.text),
      bbox: block.bbox,
      center: centerOfBox(block.bbox),
      original: block,
      allowAdjacentDigitGrouping: block.allowAdjacentDigitGrouping !== false,
    }))
    .filter((block) => /^\d$/.test(block.text) && block.allowAdjacentDigitGrouping)
    .sort((left, right) => left.center.y - right.center.y || left.center.x - right.center.x);
  const groupedIds = new Set<number>();
  const grouped: ContinuationTextBlock[] = [];

  for (let index = 0; index < digitBlocks.length; index += 1) {
    if (groupedIds.has(index)) continue;
    const seed = digitBlocks[index];
    const row = digitBlocks
      .map((block, blockIndex) => ({ ...block, blockIndex }))
      .filter((block) => {
        if (groupedIds.has(block.blockIndex)) return false;
        const verticalDelta = Math.abs(block.center.y - seed.center.y);
        return verticalDelta <= Math.max(seed.bbox.height, block.bbox.height) * 0.45;
      })
      .sort((left, right) => left.center.x - right.center.x);
    const cluster = [row[0]];
    for (const block of row.slice(1)) {
      const previous = cluster[cluster.length - 1];
      const horizontalGap = block.bbox.x - (previous.bbox.x + previous.bbox.width);
      if (
        horizontalGap < -previous.bbox.width * 0.45 ||
        horizontalGap > Math.max(18, previous.bbox.height * 1.35)
      ) {
        break;
      }
      cluster.push(block);
    }
    if (cluster.length < 2) continue;
    for (const block of cluster) groupedIds.add(block.blockIndex);
    grouped.push({
      text: cluster.map((block) => block.text).join(""),
      bbox: enclosingBox(cluster.map((block) => block.bbox)),
    });
  }

  return [
    ...expandedTextBlocks.filter((block) => {
      const text = normalizeContinuationNumber(block.text);
      return !/^\d$/.test(text) || block.allowAdjacentDigitGrouping === false;
    }),
    ...digitBlocks
      .filter((_, index) => !groupedIds.has(index))
      .map((block) => block.original),
    ...grouped,
  ];
}

function splitSeparatedNumericRuns(
  textBlocks: ContinuationTextBlock[]
): ContinuationTextBlock[] {
  return textBlocks.flatMap((block) => {
    const normalized = normalizeFullWidthDigits(block.text).trim();
    if (!/^[\d\s]+$/.test(normalized)) return [block];

    const runs = [...normalized.matchAll(/\d{1,3}/g)];
    if (runs.length <= 1) return [block];

    const characterCount = Math.max(1, normalized.length);
    return runs.map((run) => {
      const start = run.index ?? 0;
      const text = run[0];
      return {
        text,
        bbox: {
          x: block.bbox.x + (start / characterCount) * block.bbox.width,
          y: block.bbox.y,
          width: (text.length / characterCount) * block.bbox.width,
          height: block.bbox.height,
        },
        allowAdjacentDigitGrouping: false,
      };
    });
  });
}

function normalizeFullWidthDigits(value: string) {
  return value.replace(/[\uFF10-\uFF19]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

function centerOfBox(box: BBoxPx) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function expandBox(box: BBoxPx, amount: number): BBoxPx {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

function boxesIntersect(left: BBoxPx, right: BBoxPx) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function enclosingBox(boxes: BBoxPx[]): BBoxPx {
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
