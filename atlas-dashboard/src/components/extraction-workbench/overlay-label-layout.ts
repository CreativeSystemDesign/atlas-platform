import {
  attachmentTypeLabel,
  rootObjectTypeLabel,
  type AttachmentKind,
  type RootObjectKind,
} from "./annotation-model.ts";
import {
  attachmentsOf,
  isReferenceOnlyAttachment,
  rootTypeOf,
} from "./annotation-box-helpers.ts";
import {
  areaOfBox,
  boxContainsPoint,
  boxesIntersect,
  centerOfBox,
  distanceBetween,
  expandBox,
  intersectionArea,
  type BBoxPx,
} from "./studio-geometry.ts";

const PAGE_WIDTH_PX = 2481;
const PAGE_HEIGHT_PX = 3509;

type OverlayAttachmentLike = {
  id: string;
  type: AttachmentKind;
  text?: string | null;
  bbox: BBoxPx;
  relation?: string | null;
};

type OverlayAnnotationLike = {
  id: string;
  label?: string | null;
  bbox: BBoxPx;
  labelBbox?: BBoxPx | null;
  metadata?: {
    rootType?: RootObjectKind | null;
    attachments?: OverlayAttachmentLike[] | null;
  } | null;
};

export type HoverStackTarget =
  | {
      kind: "root";
      boxId: string;
      label: string;
      bbox: BBoxPx;
    }
  | {
      kind: "attachment";
      boxId: string;
      attachmentId: string;
      label: string;
      bbox: BBoxPx;
    };

export type OverlayLabelTarget = {
  id: string;
  kind: "root" | "attachment";
  boxId: string;
  attachmentId?: string;
  text: string;
  targetType: RootObjectKind | AttachmentKind;
  anchor: { x: number; y: number };
  bbox: BBoxPx;
  labelBox: BBoxPx;
};

export function annotationStackAtPoint(
  boxes: OverlayAnnotationLike[],
  point: { x: number; y: number }
): HoverStackTarget[] {
  return boxes
    .flatMap((box) => {
      const targets: HoverStackTarget[] = [];
      if (boxContainsPoint(box.bbox, point)) {
        targets.push({
          kind: "root",
          boxId: box.id,
          label: box.label || rootObjectTypeLabel(rootTypeOf(box)),
          bbox: box.bbox,
        });
      }
      for (const attachment of attachmentsOf(box)) {
        if (boxContainsPoint(attachment.bbox, point)) {
          targets.push({
            kind: "attachment",
            boxId: box.id,
            attachmentId: attachment.id,
            label: attachment.text || attachmentTypeLabel(attachment.type),
            bbox: attachment.bbox,
          });
        }
      }
      return targets;
    })
    .sort((left, right) => {
      const areaDelta = areaOfBox(left.bbox) - areaOfBox(right.bbox);
      if (Math.abs(areaDelta) > 0.001) return areaDelta;
      if (left.kind !== right.kind) return left.kind === "attachment" ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
}

export function layoutOverlayLabels(
  boxes: OverlayAnnotationLike[],
  zoom: number
): OverlayLabelTarget[] {
  const minZoom = Math.max(zoom, 0.08);
  const textHeight = 15 / minZoom;
  const gap = 7 / minZoom;
  const collisionPadding = 5 / minZoom;
  const obstacleBoxes = annotationOverlayObstacles(boxes, collisionPadding);
  const targets = boxes
    .flatMap((box) => {
      const rootType = rootTypeOf(box);
      const rootText = box.label || rootObjectTypeLabel(rootType);
      const rootTarget: OverlayLabelTarget = {
        id: `root-label-${box.id}`,
        kind: "root",
        boxId: box.id,
        text: rootText,
        targetType: rootType,
        anchor: centerOfBox(box.bbox),
        bbox: box.bbox,
        labelBox: estimateOverlayLabelBox(rootText, box.bbox, minZoom, 0),
      };
      const attachmentTargets = attachmentsOf(box)
        .filter((attachment) => !isReferenceOnlyAttachment(attachment))
        .map((attachment, index) => {
          const text =
            attachment.text && attachment.text !== "connection"
              ? attachment.text
              : attachment.type === "connection_point"
                ? ""
                : attachmentTypeLabel(attachment.type);
          return {
            id: `attachment-label-${box.id}-${attachment.id}`,
            kind: "attachment" as const,
            boxId: box.id,
            attachmentId: attachment.id,
            text,
            targetType: attachment.type,
            anchor: centerOfBox(attachment.bbox),
            bbox: attachment.bbox,
            labelBox: estimateOverlayLabelBox(
              text,
              attachment.bbox,
              minZoom,
              index + 1
            ),
          };
        });
      return [rootTarget, ...attachmentTargets];
    })
    .filter((target) => target.text.trim().length > 0)
    .sort((left, right) => {
      const yDelta = left.anchor.y - right.anchor.y;
      if (Math.abs(yDelta) > 0.001) return yDelta;
      const xDelta = left.anchor.x - right.anchor.x;
      if (Math.abs(xDelta) > 0.001) return xDelta;
      if (left.kind !== right.kind) return left.kind === "root" ? -1 : 1;
      return left.text.localeCompare(right.text);
    });

  const placed: OverlayLabelTarget[] = [];
  for (const target of targets) {
    const candidates = overlayLabelCandidates(target, minZoom, gap);
    let chosen = candidates[0];
    let chosenScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const labelCollisions = placed.filter((item) =>
        boxesIntersect(expandBox(item.labelBox, collisionPadding), candidate)
      ).length;
      const obstacleOverlap = obstacleBoxes.reduce(
        (total, obstacle) => total + intersectionArea(obstacle, candidate),
        0
      );
      const obstacleCollisions = obstacleBoxes.filter((obstacle) =>
        boxesIntersect(obstacle, candidate)
      ).length;
      const score =
        labelCollisions * 1200 +
        obstacleCollisions * 900 +
        obstacleOverlap * 0.45 +
        distanceBetween(centerOfBox(candidate), target.anchor);
      if (score < chosenScore) {
        chosen = candidate;
        chosenScore = score;
      }
      if (score < 1) break;
    }
    let resolved = chosen;
    for (let attempt = 0; attempt < 72; attempt += 1) {
      const collides =
        placed.some((item) =>
          boxesIntersect(expandBox(item.labelBox, collisionPadding), resolved)
        ) || obstacleBoxes.some((obstacle) => boxesIntersect(obstacle, resolved));
      if (!collides) break;
      const direction = attempt % 4;
      const distance = textHeight + collisionPadding + Math.floor(attempt / 4) * gap;
      resolved = clampOverlayLabelBox(
        direction === 0
          ? { ...resolved, y: resolved.y - distance }
          : direction === 1
            ? { ...resolved, x: resolved.x + distance }
            : direction === 2
              ? { ...resolved, y: resolved.y + distance }
              : { ...resolved, x: resolved.x - distance }
      );
    }
    placed.push({ ...target, labelBox: resolved });
  }
  return placed;
}

export function hoverStackSignature(stack: HoverStackTarget[]) {
  return stack
    .map((target) =>
      target.kind === "root"
        ? `root:${target.boxId}`
        : `attachment:${target.boxId}:${target.attachmentId}`
    )
    .join("|");
}

function annotationOverlayObstacles(
  boxes: OverlayAnnotationLike[],
  padding: number
): BBoxPx[] {
  return boxes.flatMap((box) => [
    expandBox(box.bbox, padding),
    ...(box.labelBbox ? [expandBox(box.labelBbox, padding)] : []),
    ...attachmentsOf(box)
      .filter((attachment) => !isReferenceOnlyAttachment(attachment))
      .map((attachment) => expandBox(attachment.bbox, padding)),
  ]);
}

function estimateOverlayLabelBox(
  text: string,
  targetBox: BBoxPx,
  zoom: number,
  staggerIndex: number
): BBoxPx {
  const width = Math.max(24, text.length * 6.4 + 8) / zoom;
  const height = 15 / zoom;
  const anchor = centerOfBox(targetBox);
  return clampOverlayLabelBox({
    x: anchor.x + (8 + (staggerIndex % 3) * 3) / zoom,
    y: targetBox.y - (height + 7 + (staggerIndex % 4) * 5) / zoom,
    width,
    height,
  });
}

function overlayLabelCandidates(
  target: OverlayLabelTarget,
  zoom: number,
  gap: number
): BBoxPx[] {
  const width = target.labelBox.width;
  const height = target.labelBox.height;
  const box = target.bbox;
  const center = centerOfBox(box);
  const candidates: BBoxPx[] = [];
  const offsets = [0, 1, -1, 2, -2, 3, -3].map((item) => item * (height + gap));
  for (const offset of offsets) {
    candidates.push(
      {
        x: center.x - width / 2 + offset,
        y: box.y - height - gap,
        width,
        height,
      },
      {
        x: center.x - width / 2 + offset,
        y: box.y + box.height + gap,
        width,
        height,
      },
      {
        x: box.x + box.width + gap,
        y: center.y - height / 2 + offset,
        width,
        height,
      },
      {
        x: box.x - width - gap,
        y: center.y - height / 2 + offset,
        width,
        height,
      }
    );
  }
  candidates.push(
    {
      x: box.x + box.width + gap,
      y: box.y - height - gap,
      width,
      height,
    },
    {
      x: box.x - width - gap,
      y: box.y - height - gap,
      width,
      height,
    },
    {
      x: box.x + box.width + gap,
      y: box.y + box.height + gap,
      width,
      height,
    },
    {
      x: box.x - width - gap,
      y: box.y + box.height + gap,
      width,
      height,
    },
    {
      x: center.x - width / 2,
      y: box.y - height - gap * 3 - (target.kind === "attachment" ? 10 / zoom : 0),
      width,
      height,
    }
  );
  return candidates.map(clampOverlayLabelBox);
}

function clampOverlayLabelBox(box: BBoxPx): BBoxPx {
  return {
    ...box,
    x: Math.max(2, Math.min(PAGE_WIDTH_PX - box.width - 2, box.x)),
    y: Math.max(2, Math.min(PAGE_HEIGHT_PX - box.height - 2, box.y)),
  };
}
