import { normalizeSymbolText } from "./annotation-labeling.ts";
import type { ResizeHandle } from "./annotation-styles.ts";
import { enclosingBox, MIN_BOX_SIZE, type BBoxPx } from "./studio-geometry.ts";
import type {
  AnnotationBox,
  LabelCandidate,
  LabelTextFragment,
} from "./studio-types.ts";

type TextBoxLike = {
  text: string;
  normalizedText?: string;
  bbox: BBoxPx;
  textFragments?: LabelTextFragment[];
};

export function toTrainingDatasetComponentLabelCandidate(
  candidate: LabelCandidate
): LabelCandidate {
  const labelLine = componentLabelLineTextBox(candidate);
  const normalizedText = normalizedComponentText(labelLine);
  const classLabel = componentClassPrefix(normalizedText);
  const narrowedToLine = labelLine !== candidate;
  if (!classLabel) return candidate;
  if (!narrowedToLine && classLabel === normalizedText) return candidate;

  return {
    ...candidate,
    text: classLabel,
    normalizedText: classLabel,
    bbox:
      classLabel === normalizedText
        ? labelLine.bbox
        : leadingComponentLabelBbox(labelLine, classLabel.length),
    textFragments: labelLine.textFragments,
    reason: "component_class_prefix_for_training_dataset",
  };
}

export function trainingDatasetComponentLabelFromResolvedText(
  resolvedText: TextBoxLike,
  currentLabel = "",
  options: {
    allowMultiline?: boolean;
    editedLabelBbox?: BBoxPx | null;
    resizeHandle?: ResizeHandle;
  } = {}
) {
  const labelTextBox = options.allowMultiline
    ? resolvedText
    : componentLabelLineTextBox(resolvedText);
  const normalizedText = normalizedComponentText(labelTextBox);
  const currentPrefix = componentClassPrefix(normalizeSymbolText(currentLabel));
  const currentPrefixIndex =
    currentPrefix && normalizedText.includes(currentPrefix)
      ? normalizedText.indexOf(currentPrefix)
      : -1;
  const classLabel =
    currentPrefixIndex >= 0 ? currentPrefix : componentClassPrefix(normalizedText);

  const labelBbox =
    currentPrefixIndex >= 0
      ? componentLabelSpanBbox(
          labelTextBox,
          currentPrefixIndex,
          currentPrefix.length
        )
      : classLabel || normalizedText
        ? leadingComponentLabelBbox(
          labelTextBox,
          (classLabel || normalizedText).length
        )
        : labelTextBox.bbox;

  const snappedLabelBbox = snapResizedLabelBboxToCharacterEdge({
    fallbackBbox: labelBbox,
    textBox: labelTextBox,
    editedLabelBbox: options.editedLabelBbox,
    resizeHandle: options.resizeHandle,
  });

  return {
    label: classLabel || normalizedText || labelTextBox.text.trim(),
    labelBbox: options.allowMultiline
      ? snappedLabelBbox
      : clampLabelBboxToSingleLineHeight(
          snappedLabelBbox,
          labelTextBox,
          options.editedLabelBbox
        ),
  };
}

export function trainingDatasetComponentLabelBboxForManualLabel(
  box: AnnotationBox,
  nextLabel: string
): BBoxPx | null {
  const normalizedNextLabel = normalizeSymbolText(nextLabel);
  if (!normalizedNextLabel) return box.labelBbox;

  const matchingCandidate = box.labelCandidates.find((candidate) => {
    const normalizedCandidate = normalizedComponentText(candidate);
    return normalizedCandidate.startsWith(normalizedNextLabel);
  });
  if (matchingCandidate) {
    return leadingComponentLabelBbox(matchingCandidate, normalizedNextLabel.length);
  }

  const currentText = normalizeSymbolText(box.label);
  if (
    box.labelBbox &&
    currentText.startsWith(normalizedNextLabel) &&
    currentText.length > normalizedNextLabel.length
  ) {
    return leadingTextBbox(box.labelBbox, {
      leadingLength: normalizedNextLabel.length,
      totalLength: currentText.length,
    });
  }

  return box.labelBbox;
}

function normalizedComponentText(textBox: TextBoxLike) {
  return normalizeSymbolText(textBox.normalizedText || textBox.text);
}

function componentClassPrefix(value: string) {
  return value.match(/^[A-Z]+/)?.[0] ?? "";
}

function componentLabelLineTextBox(textBox: TextBoxLike): TextBoxLike {
  return lineFromFragments(textBox) ?? lineFromRawText(textBox) ?? textBox;
}

function lineFromFragments(textBox: TextBoxLike): TextBoxLike | null {
  const fragments = textBox.textFragments ?? [];
  if (fragments.length <= 1) return null;

  const lines = groupFragmentsByLine(fragments);
  if (lines.length <= 1) return null;

  const line = lines.find((items) =>
    Boolean(componentClassPrefix(normalizeSymbolText(joinFragments(items))))
  ) ?? lines[0];
  const text = joinFragments(line);
  return {
    text,
    normalizedText: normalizeSymbolText(text),
    bbox: enclosingBox(line.map((fragment) => fragment.bbox)),
    textFragments: line,
  };
}

function lineFromRawText(textBox: TextBoxLike): TextBoxLike | null {
  const lines = textBox.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return null;

  const lineIndex = Math.max(
    0,
    lines.findIndex((line) =>
      Boolean(componentClassPrefix(normalizeSymbolText(line)))
    )
  );
  const lineText = lines[lineIndex] ?? lines[0];
  const lineHeight = textBox.bbox.height / lines.length;
  const bbox = {
    ...textBox.bbox,
    y: textBox.bbox.y + lineHeight * lineIndex,
    height: Math.max(MIN_BOX_SIZE, lineHeight),
  };
  return {
    text: lineText,
    normalizedText: normalizeSymbolText(lineText),
    bbox,
    textFragments: [{ text: lineText, normalizedText: normalizeSymbolText(lineText), bbox }],
  };
}

function groupFragmentsByLine(fragments: LabelTextFragment[]) {
  const lines: LabelTextFragment[][] = [];
  for (const fragment of [...fragments].sort(
    (left, right) => left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x
  )) {
    const centerY = fragment.bbox.y + fragment.bbox.height / 2;
    const line = lines.find((items) => {
      const averageCenterY =
        items.reduce(
          (total, item) => total + item.bbox.y + item.bbox.height / 2,
          0
        ) / items.length;
      const lineHeight = Math.max(...items.map((item) => item.bbox.height));
      const tolerance = Math.max(6, Math.max(lineHeight, fragment.bbox.height) * 0.75);
      return Math.abs(centerY - averageCenterY) <= tolerance;
    });
    if (line) {
      line.push(fragment);
    } else {
      lines.push([fragment]);
    }
  }

  return lines.map((line) => [...line].sort((left, right) => left.bbox.x - right.bbox.x));
}

function joinFragments(fragments: LabelTextFragment[]) {
  return fragments.reduce((text, fragment, index) => {
    const value = fragment.text.trim();
    if (index === 0) return value;
    const previous = fragments[index - 1];
    const gap = Math.max(
      0,
      fragment.bbox.x - (previous.bbox.x + previous.bbox.width)
    );
    const spaceThreshold =
      Math.max(previous.bbox.height, fragment.bbox.height) * 0.75;
    return `${text}${gap > spaceThreshold ? " " : ""}${value}`;
  }, "");
}

function leadingComponentLabelBbox(
  textBox: TextBoxLike,
  leadingLength: number
): BBoxPx {
  const normalizedText = normalizedComponentText(textBox);
  if (leadingLength <= 0 || leadingLength >= normalizedText.length) {
    return textBox.bbox;
  }

  const fragmentBbox = leadingFragmentBbox(textBox, leadingLength);
  if (fragmentBbox) return fragmentBbox;

  return leadingTextBbox(textBox.bbox, {
    leadingLength,
    totalLength: normalizedText.length,
  });
}

function componentLabelSpanBbox(
  textBox: TextBoxLike,
  startIndex: number,
  spanLength: number
): BBoxPx {
  if (startIndex <= 0) {
    return leadingComponentLabelBbox(textBox, spanLength);
  }
  const normalizedText = normalizedComponentText(textBox);
  if (
    spanLength <= 0 ||
    startIndex < 0 ||
    startIndex + spanLength > normalizedText.length
  ) {
    return textBox.bbox;
  }

  const fragmentBbox = fragmentSpanBbox(textBox, startIndex, spanLength);
  if (fragmentBbox) return fragmentBbox;

  return textSpanBbox(textBox.bbox, {
    startIndex,
    spanLength,
    totalLength: normalizedText.length,
  });
}

function fragmentSpanBbox(
  textBox: TextBoxLike,
  startIndex: number,
  spanLength: number
): BBoxPx | null {
  const fragments = orderedFragments(textBox);
  if (fragments.length <= 1) return null;

  const spanEnd = startIndex + spanLength;
  const boxes: BBoxPx[] = [];
  let cursor = 0;
  for (const fragment of fragments) {
    const normalizedFragment = normalizedComponentText(fragment);
    if (!normalizedFragment) continue;
    const fragmentStart = cursor;
    const fragmentEnd = cursor + normalizedFragment.length;
    const overlapStart = Math.max(startIndex, fragmentStart);
    const overlapEnd = Math.min(spanEnd, fragmentEnd);
    if (overlapStart < overlapEnd) {
      boxes.push(
        textSpanBbox(fragment.bbox, {
          startIndex: overlapStart - fragmentStart,
          spanLength: overlapEnd - overlapStart,
          totalLength: normalizedFragment.length,
        })
      );
    }
    cursor = fragmentEnd;
    if (cursor >= spanEnd) break;
  }

  return boxes.length > 0 ? enclosingBox(boxes) : null;
}

function textSpanBbox(
  bbox: BBoxPx,
  {
    startIndex,
    spanLength,
    totalLength,
  }: {
    startIndex: number;
    spanLength: number;
    totalLength: number;
  }
): BBoxPx {
  if (spanLength <= 0 || totalLength <= 0 || spanLength >= totalLength) {
    return bbox;
  }
  const startRatio = startIndex / totalLength;
  const spanRatio = spanLength / totalLength;
  if (bbox.width >= bbox.height) {
    return {
      ...bbox,
      x: bbox.x + bbox.width * startRatio,
      width: Math.max(MIN_BOX_SIZE, bbox.width * spanRatio),
    };
  }
  return {
    ...bbox,
    y: bbox.y + bbox.height * startRatio,
    height: Math.max(MIN_BOX_SIZE, bbox.height * spanRatio),
  };
}

function leadingFragmentBbox(
  textBox: TextBoxLike,
  leadingLength: number
): BBoxPx | null {
  const fragments = orderedFragments(textBox);
  if (fragments.length <= 1) return null;

  const leadingBoxes: BBoxPx[] = [];
  let remaining = leadingLength;
  for (const fragment of fragments) {
    const normalizedFragment = normalizedComponentText(fragment);
    if (!normalizedFragment) continue;
    if (remaining >= normalizedFragment.length) {
      leadingBoxes.push(fragment.bbox);
      remaining -= normalizedFragment.length;
      if (remaining === 0) break;
      continue;
    }

    leadingBoxes.push(
      leadingTextBbox(fragment.bbox, {
        leadingLength: remaining,
        totalLength: normalizedFragment.length,
      })
    );
    remaining = 0;
    break;
  }

  return remaining === 0 && leadingBoxes.length > 0
    ? enclosingBox(leadingBoxes)
    : null;
}

function orderedFragments(textBox: TextBoxLike): LabelTextFragment[] {
  const fragments = textBox.textFragments ?? [];
  const horizontal = textBox.bbox.width >= textBox.bbox.height;
  return [...fragments].sort((left, right) =>
    horizontal ? left.bbox.x - right.bbox.x : left.bbox.y - right.bbox.y
  );
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

function snapResizedLabelBboxToCharacterEdge({
  fallbackBbox,
  textBox,
  editedLabelBbox,
  resizeHandle,
}: {
  fallbackBbox: BBoxPx;
  textBox: TextBoxLike;
  editedLabelBbox?: BBoxPx | null;
  resizeHandle?: ResizeHandle;
}): BBoxPx {
  if (!editedLabelBbox || !resizeHandle) return fallbackBbox;
  if (!resizeHandle.includes("e") && !resizeHandle.includes("w")) {
    return fallbackBbox;
  }

  const segments = characterSegmentsForTextBox(textBox);
  if (segments.length === 0) return fallbackBbox;

  const next = { ...fallbackBbox };
  if (resizeHandle.includes("e")) {
    const right = snapCharacterBoundary(
      editedLabelBbox.x + editedLabelBbox.width,
      segments,
      "right"
    );
    next.x = editedLabelBbox.x;
    next.width = Math.max(MIN_BOX_SIZE, right - next.x);
  }
  if (resizeHandle.includes("w")) {
    const left = snapCharacterBoundary(editedLabelBbox.x, segments, "left");
    const right = editedLabelBbox.x + editedLabelBbox.width;
    next.x = left;
    next.width = Math.max(MIN_BOX_SIZE, right - left);
  }
  return next;
}

function clampLabelBboxToSingleLineHeight(
  bbox: BBoxPx,
  textBox: TextBoxLike,
  editedLabelBbox?: BBoxPx | null
): BBoxPx {
  if (!editedLabelBbox) return bbox;
  const singleLineHeight = Math.max(
    MIN_BOX_SIZE,
    Math.min(editedLabelBbox.height, textBox.bbox.height)
  );
  if (bbox.height <= singleLineHeight * 1.2) return bbox;

  const maxY = textBox.bbox.y + textBox.bbox.height - singleLineHeight;
  const y = Math.max(textBox.bbox.y, Math.min(maxY, editedLabelBbox.y));
  return {
    ...bbox,
    y,
    height: singleLineHeight,
  };
}

type CharacterSegment = {
  left: number;
  right: number;
};

function characterSegmentsForTextBox(textBox: TextBoxLike): CharacterSegment[] {
  const fragments = orderedFragments(textBox);
  const sourceFragments = fragments.length > 0
    ? fragments
    : [
        {
          text: textBox.text,
          normalizedText: textBox.normalizedText,
          bbox: textBox.bbox,
        },
      ];

  const segments: CharacterSegment[] = [];
  for (const fragment of sourceFragments) {
    const normalizedText = normalizedComponentText(fragment);
    if (!normalizedText || fragment.bbox.width <= 0) continue;
    const charWidth = fragment.bbox.width / normalizedText.length;
    for (let index = 0; index < normalizedText.length; index += 1) {
      segments.push({
        left: fragment.bbox.x + charWidth * index,
        right: fragment.bbox.x + charWidth * (index + 1),
      });
    }
  }

  return segments.sort((left, right) => left.left - right.left);
}

function snapCharacterBoundary(
  edgeX: number,
  segments: CharacterSegment[],
  side: "left" | "right"
) {
  const containing = segments.find(
    (segment) => edgeX >= segment.left && edgeX <= segment.right
  );
  if (containing) return side === "left" ? containing.left : containing.right;

  const nearest = segments.reduce((best, segment) => {
    const distance = distanceToSegment(edgeX, segment);
    return distance < best.distance ? { segment, distance } : best;
  }, { segment: segments[0], distance: distanceToSegment(edgeX, segments[0]) });

  return side === "left" ? nearest.segment.left : nearest.segment.right;
}

function distanceToSegment(edgeX: number, segment: CharacterSegment) {
  if (edgeX < segment.left) return segment.left - edgeX;
  if (edgeX > segment.right) return edgeX - segment.right;
  return 0;
}
