import { normalizeSymbolText } from "./annotation-labeling.ts";
import {
  areaOfBox,
  boxesIntersect,
  centerOfBox,
  intersectionArea,
  type BBoxPx,
} from "./studio-geometry.ts";
import type { LabelCandidate } from "./studio-types.ts";

function toYoloSymbolLabelCandidate(candidate: LabelCandidate): LabelCandidate {
  if (!candidate.symbol?.symbol) return candidate;
  const symbolText = candidate.symbol.symbol.trim();
  const normalizedSymbol = normalizeSymbolText(symbolText);
  return {
    ...candidate,
    text: symbolText,
    normalizedText: normalizedSymbol || symbolText,
    reason: `${candidate.reason}_yolo_symbol_bank_label`,
  };
}

function toYoloLabelCandidate(candidate: LabelCandidate): LabelCandidate {
  return candidate.symbol?.symbol
    ? toYoloSymbolLabelCandidate(candidate)
    : candidate;
}

export function yoloComponentLabelCandidates(
  candidates: LabelCandidate[],
  componentBox: BBoxPx,
  options: { visiblePageBox?: BBoxPx | null } = {}
) {
  const componentCenter = centerOfBox(componentBox);
  const componentTop = componentBox.y;
  const componentLeft = componentBox.x;
  const componentRight = componentBox.x + componentBox.width;
  return candidates
    .map(toYoloLabelCandidate)
    .filter(isYoloComponentLabelCandidate)
    .filter((candidate) =>
      options.visiblePageBox ? boxesIntersect(options.visiblePageBox, candidate.bbox) : true
    )
    .sort((left, right) => {
      const leftRank = options.visiblePageBox
        ? yoloVisibleCandidateRank(left, {
            componentBox,
            componentLeft,
            componentRight,
            visiblePageBox: options.visiblePageBox,
          })
        : yoloCandidateSpatialRank(left, {
            componentBox,
            componentCenter,
            componentTop,
            componentLeft,
            componentRight,
          });
      const rightRank = options.visiblePageBox
        ? yoloVisibleCandidateRank(right, {
            componentBox,
            componentLeft,
            componentRight,
            visiblePageBox: options.visiblePageBox,
          })
        : yoloCandidateSpatialRank(right, {
            componentBox,
            componentCenter,
            componentTop,
            componentLeft,
            componentRight,
          });
      if (leftRank.zone !== rightRank.zone) return leftRank.zone - rightRank.zone;
      if (Math.abs(leftRank.verticalGap - rightRank.verticalGap) > 0.001) {
        return leftRank.verticalGap - rightRank.verticalGap;
      }
      if (Math.abs(leftRank.horizontalOffset - rightRank.horizontalOffset) > 0.001) {
        return leftRank.horizontalOffset - rightRank.horizontalOffset;
      }
      const leftKnown = left.symbol ? 0 : 1;
      const rightKnown = right.symbol ? 0 : 1;
      if (leftKnown !== rightKnown) return leftKnown - rightKnown;
      return left.distance - right.distance;
    });
}

function yoloVisibleCandidateRank(
  candidate: LabelCandidate,
  component: {
    componentBox: BBoxPx;
    componentLeft: number;
    componentRight: number;
    visiblePageBox: BBoxPx;
  }
) {
  const insideRank = yoloInsideComponentRank(candidate, component.componentBox);
  if (insideRank) return insideRank;

  const candidateCenter = centerOfBox(candidate.bbox);
  const candidateRight = candidate.bbox.x + candidate.bbox.width;
  const horizontalPadding = Math.max(16, (component.componentRight - component.componentLeft) * 0.25);
  const overlapsComponentX =
    candidate.bbox.x <= component.componentRight &&
    candidateRight >= component.componentLeft;
  const nearComponentX =
    candidate.bbox.x <= component.componentRight + horizontalPadding &&
    candidateRight >= component.componentLeft - horizontalPadding;
  const zone = overlapsComponentX ? 1 : nearComponentX ? 2 : 3;
  return {
    zone,
    verticalGap: Math.max(0, candidate.bbox.y - component.visiblePageBox.y),
    horizontalOffset: Math.min(
      Math.abs(candidateCenter.x - component.componentLeft),
      Math.abs(candidateCenter.x - component.componentRight)
    ),
  };
}

export function yoloComponentDisplayLabel(candidate: LabelCandidate) {
  const metadataFamily = normalizeSymbolText(candidate.symbol?.family ?? "");
  if (metadataFamily) return metadataFamily;
  const normalized = normalizeSymbolText(candidate.normalizedText || candidate.text);
  return normalized.match(/^[A-Z]+/)?.[0] ?? normalized;
}

function yoloCandidateSpatialRank(
  candidate: LabelCandidate,
  component: {
    componentBox: BBoxPx;
    componentCenter: { x: number; y: number };
    componentTop: number;
    componentLeft: number;
    componentRight: number;
  }
) {
  const insideRank = yoloInsideComponentRank(candidate, component.componentBox);
  if (insideRank) return insideRank;

  const candidateCenter = centerOfBox(candidate.bbox);
  const candidateBottom = candidate.bbox.y + candidate.bbox.height;
  const candidateRight = candidate.bbox.x + candidate.bbox.width;
  const horizontalPadding = Math.max(16, (component.componentRight - component.componentLeft) * 0.25);
  const overlapsComponentX =
    candidate.bbox.x <= component.componentRight &&
    candidateRight >= component.componentLeft;
  const nearComponentX =
    candidate.bbox.x <= component.componentRight + horizontalPadding &&
    candidateRight >= component.componentLeft - horizontalPadding;
  const isAboveTop = candidateBottom <= component.componentTop + 10;
  const isAboveCenter = candidateCenter.y < component.componentCenter.y;
  const zone =
    isAboveTop && overlapsComponentX
      ? 1
      : isAboveTop && nearComponentX
        ? 2
        : isAboveTop
          ? 3
          : isAboveCenter
            ? 4
            : 5;
  return {
    zone,
    verticalGap: isAboveTop
      ? Math.max(0, component.componentTop - candidateBottom)
      : Math.max(0, candidateCenter.y - component.componentTop),
    horizontalOffset: Math.abs(candidateCenter.x - component.componentCenter.x),
  };
}

function yoloInsideComponentRank(candidate: LabelCandidate, componentBox: BBoxPx) {
  if (!isYoloInsidePriorityLabel(candidate)) return null;

  const candidateCenter = centerOfBox(candidate.bbox);
  const componentCenter = centerOfBox(componentBox);
  const overlap = intersectionArea(candidate.bbox, componentBox);
  const candidateArea = Math.max(1, areaOfBox(candidate.bbox));
  const centerInside =
    candidateCenter.x >= componentBox.x &&
    candidateCenter.x <= componentBox.x + componentBox.width &&
    candidateCenter.y >= componentBox.y &&
    candidateCenter.y <= componentBox.y + componentBox.height;
  const mostlyInside = overlap / candidateArea >= 0.55;

  if (!centerInside && !mostlyInside) return null;

  return {
    zone: 0,
    verticalGap: Math.max(0, candidate.bbox.y - componentBox.y),
    horizontalOffset: Math.abs(candidateCenter.x - componentCenter.x),
  };
}

function isYoloInsidePriorityLabel(candidate: LabelCandidate) {
  const normalized = normalizeSymbolText(candidate.normalizedText || candidate.text);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (isTerminalLikeLabel(normalized)) return false;
  if (candidate.source === "bbox_text") return true;
  if (candidate.symbol) return true;
  return /^[A-Z]{2,}\d+[A-Z0-9-]*$/.test(normalized);
}

function isYoloComponentLabelCandidate(candidate: LabelCandidate) {
  if (candidate.symbol) return true;
  const normalized = normalizeSymbolText(candidate.normalizedText || candidate.text);
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (isTerminalLikeLabel(normalized)) return false;
  if (candidate.source === "bbox_text") return true;
  return /^[A-Z]{2,}\d+[A-Z0-9-]*$/.test(normalized);
}

function isTerminalLikeLabel(normalized: string) {
  return /^(P|U|V|W|R|S|T|L|N|PE|G)\d{1,2}$/.test(normalized);
}
