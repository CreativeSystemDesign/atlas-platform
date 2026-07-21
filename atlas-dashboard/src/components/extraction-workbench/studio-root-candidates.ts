import type { AttachmentKind } from "./annotation-model.ts";
import { classifyAttachmentText } from "./annotation-labeling.ts";
import {
  resolveContinuationReference,
  resolveContinuationReferenceBank,
  type ContinuationTextBlock,
  type ContinuationReference,
} from "./continuation-symbol.ts";
import {
  areaOfBox,
  centerOfBox,
  clampBoxToPage,
  distanceBetween,
  distanceToBox,
  boxesIntersect,
  enclosingBox,
  expandBox,
  pdfBboxToPx,
  type BBoxPx,
  type PageSizePx,
} from "./studio-geometry.ts";
import { mergeAdjacentTextFragmentsAroundPrimary } from "./studio-text-fragments.ts";
import {
  snapStrengthConfig,
  snapToleranceForZoom,
  TIGHT_TEXT_AUTOSNAP_MERGE_SCALE,
} from "./snap-strength.ts";
import type {
  PageMetadata,
  RootSnapCandidate,
  SnapStrength,
  SymbolBankEntry,
  WireLabelBankEntry,
} from "./studio-types.ts";

export type RootShapeCandidate = {
  bbox: BBoxPx;
  text: string;
  type: AttachmentKind;
};

export function junctionCandidateAtPoint({
  point,
  pageMetadata,
  pageSize,
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  pageSize: PageSizePx;
}): RootShapeCandidate | null {
  const scale = pageMetadata?.scale;
  if (!scale) return null;
  const hit = (pageMetadata?.shapes ?? [])
    .map((shape) => {
      const bbox = pdfBboxToPx(shape.bbox, scale);
      const center = centerOfBox(bbox);
      const maxSide = Math.max(bbox.width, bbox.height);
      const minSide = Math.min(bbox.width, bbox.height);
      return {
        bbox,
        center,
        distance: distanceBetween(point, center),
        compact: maxSide <= 24 && minSide >= 2,
        squareish: maxSide / Math.max(1, minSide) <= 2.2,
      };
    })
    .filter(
      (candidate) =>
        candidate.compact && candidate.squareish && candidate.distance <= 18
    )
    .sort((left, right) => left.distance - right.distance)[0];

  if (!hit) return null;

  return {
    bbox: clampBoxToPage(expandBox(hit.bbox, 10), pageSize),
    text: "junction",
    type: "junction",
  };
}

export function groundReferenceCandidateAtPoint({
  point,
  pageMetadata,
  pageSize,
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  pageSize: PageSizePx;
}): RootShapeCandidate | null {
  const scale = pageMetadata?.scale;
  if (!scale) return null;

  const nearby = (pageMetadata?.shapes ?? [])
    .map((shape) => {
      const bbox = pdfBboxToPx(shape.bbox, scale);
      const center = centerOfBox(bbox);
      const distance = distanceBetween(point, center);
      const horizontal = bbox.width > bbox.height * 1.8;
      const vertical = bbox.height > bbox.width * 1.8;
      return { bbox, center, distance, horizontal, vertical };
    })
    .filter((shape) => shape.distance <= 74);
  const horizontalCount = nearby.filter((shape) => shape.horizontal).length;
  const verticalCount = nearby.filter((shape) => shape.vertical).length;
  if (nearby.length < 3 || horizontalCount < 2 || verticalCount < 1) {
    return null;
  }

  const bbox = expandBox(
    enclosingBox(nearby.map((shape) => shape.bbox)),
    2
  );
  if (bbox.width < 18 || bbox.height < 18 || bbox.width > 130 || bbox.height > 130) {
    return null;
  }

  return {
    bbox: clampBoxToPage(bbox, pageSize),
    text: "ground",
    type: "ground_reference",
  };
}

export function attachmentCandidateAtPoint({
  point,
  pageMetadata,
  zoom,
  pageSize,
  symbolBank,
  wireLabelBank,
  snapStrength = "normal",
  textSnap = "normal",
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  zoom: number;
  pageSize: PageSizePx;
  symbolBank: SymbolBankEntry[];
  wireLabelBank: WireLabelBankEntry[];
  snapStrength?: SnapStrength;
  textSnap?: "normal" | "tight";
}): RootShapeCandidate | null {
  const scale = pageMetadata?.scale;
  if (!scale) return null;
  const tightTextSnap = textSnap === "tight";
  const strength = snapStrengthConfig(snapStrength);
  const shapePadding = snapToleranceForZoom({
    strength: snapStrength,
    zoom,
    normalScreenPx: 10,
    minPagePx: 6,
  });
  const textPadding = snapToleranceForZoom({
    strength: snapStrength,
    zoom,
    normalScreenPx: tightTextSnap ? 8 : 18,
    minPagePx: tightTextSnap ? 2 : 10,
  });
  const textCenterFallbackPx = tightTextSnap
    ? snapToleranceForZoom({
        strength: snapStrength,
        zoom,
        normalScreenPx: 10,
        minPagePx: 4,
      })
    : strength.centerFallbackPx;

  const junctionHit = junctionCandidateAtPoint({ point, pageMetadata, pageSize });
  if (junctionHit) return junctionHit;

  const groundReferenceHit = groundReferenceCandidateAtPoint({
    point,
    pageMetadata,
    pageSize,
  });
  if (groundReferenceHit) return groundReferenceHit;

  const shapeHits = (pageMetadata?.shapes ?? [])
    .map((shape) => {
      const bbox = pdfBboxToPx(shape.bbox, scale);
      const expanded = expandBox(bbox, shapePadding);
      const center = centerOfBox(bbox);
      const maxSide = Math.max(bbox.width, bbox.height);
      const inside =
        point.x >= expanded.x &&
        point.x <= expanded.x + expanded.width &&
        point.y >= expanded.y &&
        point.y <= expanded.y + expanded.height;
      return {
        bbox,
        score: distanceBetween(point, center),
        maxSide,
        inside,
      };
    })
    .filter(
      (candidate) =>
        candidate.maxSide <= 80 &&
        (candidate.inside || candidate.score <= strength.shapeFallbackPx)
    )
    .sort((left, right) => {
      if (left.inside !== right.inside) return left.inside ? -1 : 1;
      return left.score - right.score;
    });

  const directShapeHit = shapeHits.find(
    (candidate) =>
      candidate.inside || candidate.score <= strength.directShapeFallbackPx
  );
  if (directShapeHit) {
    return {
      bbox: clampBoxToPage(expandBox(directShapeHit.bbox, 8), pageSize),
      text: "",
      type: "terminal",
    };
  }

  const textHits = (pageMetadata?.text_blocks ?? [])
    .map((block) => {
      const bbox = pdfBboxToPx(block.bbox, scale);
      const expanded = expandBox(bbox, textPadding);
      const center = centerOfBox(bbox);
      const inside =
        point.x >= expanded.x &&
        point.x <= expanded.x + expanded.width &&
        point.y >= expanded.y &&
        point.y <= expanded.y + expanded.height;
      return {
        bbox,
        text: block.text.trim(),
        centerDistance: distanceBetween(point, center),
        score: inside
          ? distanceBetween(point, center)
          : distanceBetween(point, center) + 1000,
      };
    })
    .filter(
      (candidate) =>
        candidate.text &&
        (candidate.score < 1000 ||
          candidate.centerDistance <= textCenterFallbackPx)
    )
    .sort((left, right) => left.score - right.score);

  const textHit = textHits[0]
    ? mergeAdjacentTextFragmentsAroundPrimary(textHits, textHits[0], {
        mergeScale: tightTextSnap
          ? TIGHT_TEXT_AUTOSNAP_MERGE_SCALE
          : strength.textMergeScale,
      })
    : null;
  if (textHit) {
    return {
      bbox: clampBoxToPage(textHit.bbox, pageSize),
      text: textHit.text,
      type: classifyAttachmentText(textHit.text, symbolBank, wireLabelBank),
    };
  }

  const shapeHit = shapeHits[0];
  if (!shapeHit) return null;

  return {
    bbox: clampBoxToPage(expandBox(shapeHit.bbox, 8), pageSize),
    text: "",
    type: "terminal",
  };
}

export function wireSegmentCandidateAtPoint({
  point,
  pageMetadata,
  zoom,
  pageSize,
  snapStrength = "normal",
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  zoom: number;
  pageSize: PageSizePx;
  snapStrength?: SnapStrength;
}): RootShapeCandidate | null {
  const scale = pageMetadata?.scale;
  if (!scale) return null;
  const hitTolerance = snapToleranceForZoom({
    strength: snapStrength,
    zoom,
    normalScreenPx: 18,
    minPagePx: 10,
  });
  const shapePadding = snapToleranceForZoom({
    strength: snapStrength,
    zoom,
    normalScreenPx: 14,
    minPagePx: 8,
  });

  const hits = (pageMetadata?.shapes ?? [])
    .map((shape) => {
      const bbox = pdfBboxToPx(shape.bbox, scale);
      const expanded = expandBox(bbox, shapePadding);
      const center = centerOfBox(bbox);
      const hitDistance = distanceToBox(point, expanded);
      const inside =
        point.x >= expanded.x &&
        point.x <= expanded.x + expanded.width &&
        point.y >= expanded.y &&
        point.y <= expanded.y + expanded.height;
      const longEnough = Math.max(bbox.width, bbox.height) >= 36;
      const thinEnough = Math.min(bbox.width, bbox.height) <= 24;
      return {
        bbox,
        centerDistance: distanceBetween(point, center),
        score: hitDistance,
        longEnough,
        thinEnough,
        inside,
      };
    })
    .filter(
      (candidate) =>
        candidate.longEnough &&
        candidate.thinEnough &&
        candidate.score <= hitTolerance
    )
    .sort((left, right) => {
      if (left.inside !== right.inside) return left.inside ? -1 : 1;
      const scoreDelta = left.score - right.score;
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
      const areaDelta = areaOfBox(left.bbox) - areaOfBox(right.bbox);
      if (Math.abs(areaDelta) > 0.001) return areaDelta;
      return left.centerDistance - right.centerDistance;
    });

  const hit = hits[0];
  if (!hit) return null;

  return {
    bbox: clampBoxToPage(expandBox(hit.bbox, 4), pageSize),
    text: "",
    type: "wire_segment",
  };
}

export function wireLabelObjectCandidateAtPoint({
  point,
  pageMetadata,
  zoom,
  pageSize,
  snapStrength = "normal",
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  zoom: number;
  pageSize: PageSizePx;
  snapStrength?: SnapStrength;
}): RootSnapCandidate | null {
  const scale = pageMetadata?.scale;
  if (!scale) return null;

  const textPadding = snapToleranceForZoom({
    strength: snapStrength,
    zoom,
    normalScreenPx: 12,
    minPagePx: 4,
  });

  const textBoxes = (pageMetadata.text_blocks ?? [])
    .map((block) => ({
      bbox: pdfBboxToPx(block.bbox, scale),
      text: block.text.trim(),
    }))
    .filter((block) => block.text.length > 0);

  const clickedText = textBoxes
    .map((block) => ({
      ...block,
      distance: distanceToBox(point, expandBox(block.bbox, textPadding)),
    }))
    .filter((block) => block.distance <= 0)
    .sort((left, right) => areaOfBox(left.bbox) - areaOfBox(right.bbox))[0];
  if (!clickedText) return null;
  const bbox = clampBoxToPage(expandBox(clickedText.bbox, 1), pageSize);

  return {
    bbox,
    labelBbox: bbox,
    text: classNameForWireLabelText(clickedText.text),
    type: "wire_label",
  };
}

function classNameForWireLabelText(text: string) {
  const compact = text.replace(/[\s_-]+/g, "").toUpperCase();
  if (compact === "P24") return "+24v wire label";
  if (compact === "N24") return "-24v wire label";
  if (compact === "P5") return "+5v wire label";
  if (compact === "N5") return "-5v wire label";
  if (compact === "NC5") return "5v common wire label";
  if (compact === "NC24") return "24v common wire label";
  if (/^X\d+$/.test(compact)) return "input signal wire label";
  if (/^Y\d+$/.test(compact)) return "output signal wire label";
  return "wire label";
}

export function continuationCandidateAtPoint({
  point,
  pageMetadata,
  pageSize,
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  pageSize: PageSizePx;
}): RootSnapCandidate | null {
  const scale = pageMetadata?.scale;
  const textBlocks = pageMetadata?.text_blocks ?? [];
  if (!scale || textBlocks.length === 0) return null;

  const probeBox = {
    x: point.x - 28,
    y: point.y - 28,
    width: 56,
    height: 56,
  };
  const continuationTextBlocks: ContinuationTextBlock[] = textBlocks.map((block) => ({
    text: block.text,
    bbox: pdfBboxToPx(block.bbox, scale),
  }));
  const reference = resolveContinuationReference(
    probeBox,
    continuationTextBlocks
  );
  if (!reference) return null;

  const rawLabelBbox = enclosingBox([reference.pageBbox, reference.rowBbox]);
  const markerSearchBox = expandBox(rawLabelBbox, 12);
  const labelCenter = centerOfBox(rawLabelBbox);
  const labelTop = rawLabelBbox.y - 4;
  const labelBottom = rawLabelBbox.y + rawLabelBbox.height + 4;
  const markerShapeBboxes = (pageMetadata?.shapes ?? [])
    .map((shape) => pdfBboxToPx(shape.bbox, scale))
    .filter((bbox) => {
      const center = centerOfBox(bbox);
      const compactStroke =
        bbox.width <= Math.max(92, rawLabelBbox.width + 36) &&
        bbox.height <= rawLabelBbox.height + 10;
      const localToPair =
        center.y >= labelTop &&
        center.y <= labelBottom &&
        Math.abs(center.x - labelCenter.x) <= Math.max(42, rawLabelBbox.width);
      return compactStroke && localToPair && boxesIntersect(markerSearchBox, bbox);
    });
  const markerBbox = enclosingBox([rawLabelBbox, ...markerShapeBboxes]);
  const labelBbox = clampBoxToPage(expandBox(rawLabelBbox, 2), pageSize);
  return {
    bbox: clampBoxToPage(expandBox(markerBbox, 2), pageSize),
    labelBbox,
    text: reference.label,
    type: "continuation",
    continuationReference: reference,
  };
}

export function continuationCandidatesAtPoint({
  point,
  pageMetadata,
  pageSize,
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  pageSize: PageSizePx;
}): RootSnapCandidate[] {
  const scale = pageMetadata?.scale;
  const textBlocks = pageMetadata?.text_blocks ?? [];
  if (!scale || textBlocks.length === 0) return [];

  const probeBox = {
    x: point.x - 28,
    y: point.y - 28,
    width: 56,
    height: 56,
  };
  const continuationTextBlocks: ContinuationTextBlock[] = textBlocks.map((block) => ({
    text: block.text,
    bbox: pdfBboxToPx(block.bbox, scale),
  }));
  const references = resolveContinuationReferenceBank(
    probeBox,
    continuationTextBlocks
  );
  return references.map((reference) =>
    continuationCandidateFromReference({
      reference,
      pageMetadata,
      pageSize,
      scale,
    })
  );
}

function continuationCandidateFromReference({
  reference,
  pageMetadata,
  pageSize,
  scale,
}: {
  reference: ContinuationReference;
  pageMetadata: PageMetadata | null;
  pageSize: PageSizePx;
  scale: number;
}): RootSnapCandidate {
  const rawLabelBbox = enclosingBox([reference.pageBbox, reference.rowBbox]);
  const markerSearchBox = expandBox(rawLabelBbox, 12);
  const labelCenter = centerOfBox(rawLabelBbox);
  const labelTop = rawLabelBbox.y - 4;
  const labelBottom = rawLabelBbox.y + rawLabelBbox.height + 4;
  const markerShapeBboxes = (pageMetadata?.shapes ?? [])
    .map((shape) => pdfBboxToPx(shape.bbox, scale))
    .filter((bbox) => {
      const center = centerOfBox(bbox);
      const compactStroke =
        bbox.width <= Math.max(92, rawLabelBbox.width + 36) &&
        bbox.height <= rawLabelBbox.height + 10;
      const localToPair =
        center.y >= labelTop &&
        center.y <= labelBottom &&
        Math.abs(center.x - labelCenter.x) <= Math.max(42, rawLabelBbox.width);
      return compactStroke && localToPair && boxesIntersect(markerSearchBox, bbox);
    });
  const markerBbox = enclosingBox([rawLabelBbox, ...markerShapeBboxes]);
  const labelBbox = clampBoxToPage(expandBox(rawLabelBbox, 2), pageSize);
  return {
    bbox: clampBoxToPage(expandBox(markerBbox, 2), pageSize),
    labelBbox,
    text: reference.label,
    type: "continuation",
    continuationReference: reference,
  };
}

export function continuationSymbolCandidateAtPoint({
  point,
  pageMetadata,
  pageSize,
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata | null;
  pageSize: PageSizePx;
}): RootSnapCandidate | null {
  const scale = pageMetadata?.scale;
  if (!scale) return null;

  const hSymbolBoxes = continuationHSymbolBoxesAtPoint({
    point,
    pageMetadata,
    scale,
  });
  const symbolBox = hSymbolBoxes[0];
  if (!symbolBox) return null;

  return {
    bbox: clampBoxToPage(expandBox(symbolBox, 2), pageSize),
    labelBbox: null,
    text: "continuation",
    type: "continuation",
  };
}

function continuationHSymbolBoxesAtPoint({
  point,
  pageMetadata,
  scale,
}: {
  point: { x: number; y: number };
  pageMetadata: PageMetadata;
  scale: number;
}) {
  const shapeBoxes = (pageMetadata.shapes ?? []).map((shape) =>
    pdfBboxToPx(shape.bbox, scale)
  );
  const verticals = shapeBoxes.filter(
    (box) =>
      box.height >= 18 &&
      box.height <= 110 &&
      box.width <= 18 &&
      box.height >= box.width * 1.8
  );
  const horizontals = shapeBoxes.filter(
    (box) =>
      box.width >= 14 &&
      box.width <= 110 &&
      box.height <= 18 &&
      box.width >= box.height * 1.8
  );
  const candidates: BBoxPx[] = [];

  for (const left of verticals) {
    for (const right of verticals) {
      if (left === right || centerOfBox(left).x >= centerOfBox(right).x) continue;
      const heightRatio =
        Math.max(left.height, right.height) / Math.max(1, Math.min(left.height, right.height));
      if (heightRatio > 1.65) continue;
      const yOverlap =
        Math.min(left.y + left.height, right.y + right.height) -
        Math.max(left.y, right.y);
      if (yOverlap < Math.min(left.height, right.height) * 0.42) continue;

      const leftCenter = centerOfBox(left);
      const rightCenter = centerOfBox(right);
      const gap = rightCenter.x - leftCenter.x;
      if (gap < 10 || gap > 90) continue;

      const bridge = horizontals.find((horizontal) => {
        const horizontalCenter = centerOfBox(horizontal);
        return (
          horizontalCenter.x > leftCenter.x &&
          horizontalCenter.x < rightCenter.x &&
          horizontalCenter.y >= Math.max(left.y, right.y) - 4 &&
          horizontalCenter.y <= Math.min(left.y + left.height, right.y + right.height) + 4 &&
          horizontal.x <= leftCenter.x + 8 &&
          horizontal.x + horizontal.width >= rightCenter.x - 8
        );
      });
      if (!bridge) continue;

      const symbolBox = enclosingBox([left, right, bridge]);
      if (distanceToBox(point, expandBox(symbolBox, 42)) > 0) continue;
      candidates.push(symbolBox);
    }
  }

  return candidates.sort((left, right) => {
    const distanceDelta = distanceToBox(point, left) - distanceToBox(point, right);
    if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
    return areaOfBox(left) - areaOfBox(right);
  });
}
