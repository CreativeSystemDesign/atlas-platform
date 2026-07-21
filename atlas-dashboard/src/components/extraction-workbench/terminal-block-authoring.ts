import {
  buildSpatialProvenance,
  physicalSizeOf,
} from "./annotation-persistence.ts";
import {
  clampBoxToPage,
  centerOfBox,
  MIN_BOX_SIZE,
  pdfBboxToPx,
  type BBoxPx,
} from "./studio-geometry.ts";
import { mergeTextFragmentsInReadingOrder } from "./studio-text-fragments.ts";
import {
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  type LabelTextFragment,
  type AnnotationAttachment,
  type AnnotationBox,
} from "./studio-types.ts";

type TerminalBlockAuthoringResult =
  | {
      status: "created";
      box: AnnotationBox;
      terminalPositionIds: string[];
    }
  | {
      status: "blocked";
    };

type TerminalBlockTextBlock = {
  text: string;
  bbox: [number, number, number, number];
};

type TerminalBlockDetectedTextBlock = {
  text: string;
  bbox: BBoxPx;
  center: { x: number; y: number };
  textFragments: LabelTextFragment[];
  side: "left" | "right";
};

type TerminalBlockDetectedTerminal = {
  text: string;
  bbox: BBoxPx;
  textFragments?: LabelTextFragment[];
};

type TerminalBlockDetectedRow = {
  rowIndex: number;
  left: TerminalBlockDetectedTerminal | null;
  right: TerminalBlockDetectedTerminal | null;
};

export function buildTerminalBlockRootAnnotation({
  id,
  bbox,
  positionCount,
  pageNum,
  zoom,
  capturedAt,
  createId = (suffix) => `${id}-${suffix}-${crypto.randomUUID()}`,
}: {
  id: string;
  bbox: BBoxPx;
  positionCount: number;
  pageNum: number;
  zoom: number;
  capturedAt: string;
  createId?: (suffix: string) => string;
}): TerminalBlockAuthoringResult {
  const normalizedCount = Math.floor(positionCount);
  if (
    bbox.width < MIN_BOX_SIZE ||
    bbox.height < MIN_BOX_SIZE ||
    normalizedCount < 1
  ) {
    return { status: "blocked" };
  }

  const attachments = Array.from({ length: normalizedCount }, (_, index) => {
    const position = index + 1;
    return [
      buildManualTerminalAttachment({
        id: createId(`left-${position}`),
        label: "cable side",
        bbox,
        side: "left",
        index: position,
        positionCount: normalizedCount,
        zoom,
        pageNum,
        capturedAt,
        provenanceSource: "manual_terminal_block",
      }),
      buildManualTerminalAttachment({
        id: createId(`right-${position}`),
        label: "wire side",
        bbox,
        side: "right",
        index: position,
        positionCount: normalizedCount,
        zoom,
        pageNum,
        capturedAt,
        provenanceSource: "manual_terminal_block",
      }),
    ];
  }).flat();

  return buildTerminalBlockResult({
    id,
    bbox,
    pageNum,
    capturedAt,
    attachments,
    provenanceSource: "manual_terminal_block",
  });
}

export function detectTerminalBlockFromText({
  boxBbox,
  textBlocks,
  scale,
  pageNum,
  capturedAt,
  id = `page-${pageNum}-terminal-block-${crypto.randomUUID()}`,
}: {
  boxBbox: BBoxPx;
  textBlocks: TerminalBlockTextBlock[];
  scale: number;
  pageNum: number;
  capturedAt: string;
  id?: string;
}): TerminalBlockAuthoringResult {
  if (
    boxBbox.width < MIN_BOX_SIZE ||
    boxBbox.height < MIN_BOX_SIZE ||
    textBlocks.length === 0
  ) {
    return { status: "blocked" };
  }

  const rows = detectTerminalBlockRows({
    boxBbox,
    textBlocks,
    scale,
  });
  if (rows.length === 0) {
    return { status: "blocked" };
  }

  const attachments = rows.flatMap((row) =>
    buildDetectedRowAttachments({
      blockId: id,
      row,
      pageNum,
      capturedAt,
      boxBbox,
    })
  );

  if (attachments.length === 0) {
    return { status: "blocked" };
  }

  return buildTerminalBlockResult({
    id,
    bbox: boxBbox,
    pageNum,
    capturedAt,
    attachments,
    provenanceSource: "auto_terminal_block_text",
  });
}

function buildTerminalBlockResult({
  id,
  bbox,
  pageNum,
  capturedAt,
  attachments,
  provenanceSource,
}: {
  id: string;
  bbox: BBoxPx;
  pageNum: number;
  capturedAt: string;
  attachments: AnnotationAttachment[];
  provenanceSource: string;
}): TerminalBlockAuthoringResult {
  return {
    status: "created",
    box: {
      id,
      pageNum,
      label: "terminal block",
      bbox,
      labelBbox: null,
      labelSource: "manual",
      labelCandidateIndex: -1,
      labelCandidates: [],
      source: "human",
      snapped: true,
      metadata: {
        rootType: "terminal_block",
        attachments,
        provenance: buildSpatialProvenance(
          bbox,
          pageNum,
          provenanceSource,
          capturedAt
        ),
        physicalSizePx: physicalSizeOf(bbox),
      },
      createdAt: capturedAt,
      updatedAt: capturedAt,
    },
    terminalPositionIds: attachments.map((attachment) => attachment.id),
  };
}

function buildManualTerminalAttachment({
  id,
  label,
  bbox,
  side,
  index,
  positionCount,
  zoom,
  pageNum,
  capturedAt,
  provenanceSource,
}: {
  id: string;
  label: string;
  bbox: BBoxPx;
  side: "left" | "right";
  index: number;
  positionCount: number;
  zoom: number;
  pageNum: number;
  capturedAt: string;
  provenanceSource: string;
}): AnnotationAttachment {
  const size = Math.max(18, 18 / zoom);
  const center = terminalPositionCenter(side, index, positionCount, bbox);
  const pointBox = clampBoxToPage(
    {
      x: center.x - size / 2,
      y: center.y - size / 2,
      width: size,
      height: size,
    },
    { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX }
  );

  return {
    id,
    type: "terminal_position",
    text: label,
    bbox: pointBox,
    parentAttachmentId: null,
    relation: "terminal_block_has_position",
    provenance: buildSpatialProvenance(
      pointBox,
      pageNum,
      `${provenanceSource}_${side}_terminal_position`,
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(pointBox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function buildDetectedRowAttachments({
  blockId,
  row,
  pageNum,
  capturedAt,
  boxBbox,
}: {
  blockId: string;
  row: TerminalBlockDetectedRow;
  pageNum: number;
  capturedAt: string;
  boxBbox: BBoxPx;
}): AnnotationAttachment[] {
  const attachments: AnnotationAttachment[] = [];
  const leftId = `${blockId}-left-${row.rowIndex + 1}-${crypto.randomUUID()}`;
  const rightId = `${blockId}-right-${row.rowIndex + 1}-${crypto.randomUUID()}`;

  if (row.left) {
    attachments.push(
      buildDetectedTerminalAttachment({
        id: leftId,
        text: row.left.text,
        bbox: row.left.bbox,
        pageNum,
        capturedAt,
        provenanceSource: `auto_terminal_block_row_${row.rowIndex + 1}_left`,
        parentAttachmentId: null,
        linkedAttachmentId: row.right ? rightId : null,
      })
    );
  }

  if (row.right) {
    attachments.push(
      buildDetectedTerminalAttachment({
        id: rightId,
        text: row.right.text,
        bbox: row.right.bbox,
        pageNum,
        capturedAt,
        provenanceSource: `auto_terminal_block_row_${row.rowIndex + 1}_right`,
        parentAttachmentId: row.left ? leftId : null,
        linkedAttachmentId: null,
      })
    );
  }

  return attachments;
}

function buildDetectedTerminalAttachment({
  id,
  text,
  bbox,
  pageNum,
  capturedAt,
  provenanceSource,
  parentAttachmentId = null,
  linkedAttachmentId = null,
}: {
  id: string;
  text: string;
  bbox: BBoxPx;
  pageNum: number;
  capturedAt: string;
  provenanceSource: string;
  parentAttachmentId?: string | null;
  linkedAttachmentId?: string | null;
}): AnnotationAttachment {
  return {
    id,
    type: "terminal_position",
    text,
    bbox,
    parentAttachmentId,
    linkedAttachmentId,
    relation: "terminal_block_has_position",
    provenance: buildSpatialProvenance(
      bbox,
      pageNum,
      provenanceSource,
      capturedAt
    ),
    physicalSizePx: physicalSizeOf(bbox),
    source: "ctrl_click",
    snapped: true,
    createdAt: capturedAt,
  };
}

function detectTerminalBlockRows({
  boxBbox,
  textBlocks,
  scale,
}: {
  boxBbox: BBoxPx;
  textBlocks: TerminalBlockTextBlock[];
  scale: number;
}): TerminalBlockDetectedRow[] {
  const midpointX = boxBbox.x + boxBbox.width / 2;
  const detected = textBlocks
    .map((block) => {
      const text = block.text.trim();
      if (!text) return null;
      const bbox = pdfBboxToPx(block.bbox, scale);
      const center = centerOfBox(bbox);
      if (!pointInsideBox(boxBbox, center)) {
        return null;
      }
      return {
        text,
        bbox,
        center,
        textFragments: [{ text, bbox }],
        side: center.x < midpointX ? "left" : "right",
      };
    })
    .filter(
      (
        block
      ): block is TerminalBlockDetectedTextBlock => Boolean(block)
    );

  if (detected.length === 0) return [];

  const rows = clusterTerminalBlockRows(detected);
  return rows.map((row, rowIndex) => ({
    rowIndex,
    left: mergeTerminalBlockSide(row.blocks.filter((block) => block.side === "left")),
    right: mergeTerminalBlockSide(
      row.blocks.filter((block) => block.side === "right")
    ),
  }));
}

function clusterTerminalBlockRows(blocks: TerminalBlockDetectedTextBlock[]) {
  const sorted = [...blocks].sort(
    (left, right) => left.center.y - right.center.y || left.center.x - right.center.x
  );
  const rows: Array<{ blocks: TerminalBlockDetectedTextBlock[]; centerY: number; maxHeight: number }> = [];

  for (const block of sorted) {
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      rows.push({
        blocks: [block],
        centerY: block.center.y,
        maxHeight: block.bbox.height,
      });
      continue;
    }

    const rowTolerance = Math.max(
      18,
      lastRow.maxHeight * 1.75,
      block.bbox.height * 1.75
    );
    if (Math.abs(block.center.y - lastRow.centerY) <= rowTolerance) {
      lastRow.blocks.push(block);
      const totalBlocks = lastRow.blocks.length;
      lastRow.centerY =
        (lastRow.centerY * (totalBlocks - 1) + block.center.y) / totalBlocks;
      lastRow.maxHeight = Math.max(lastRow.maxHeight, block.bbox.height);
      continue;
    }

    rows.push({
      blocks: [block],
      centerY: block.center.y,
      maxHeight: block.bbox.height,
    });
  }

  return rows;
}

function mergeTerminalBlockSide(
  blocks: TerminalBlockDetectedTextBlock[]
): TerminalBlockDetectedTerminal | null {
  if (blocks.length === 0) return null;
  const merged =
    blocks.length === 1 ? blocks[0] : mergeTextFragmentsInReadingOrder(blocks) ?? blocks[0];
  const text = merged.text.trim();
  if (!text) return null;
  return {
    text,
    bbox: merged.bbox,
    textFragments:
      merged.textFragments ??
      blocks.flatMap(
        (block) => block.textFragments ?? [{ text: block.text, bbox: block.bbox }]
      ),
  };
}

function terminalPositionCenter(
  side: "left" | "right",
  index: number,
  positionCount: number,
  bbox: BBoxPx
) {
  const verticalOffset = (bbox.height / (positionCount + 1)) * index;
  if (side === "left") return { x: bbox.x, y: bbox.y + verticalOffset };
  return { x: bbox.x + bbox.width, y: bbox.y + verticalOffset };
}

function pointInsideBox(box: BBoxPx, point: { x: number; y: number }) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}
