import { attachmentsOf, rootTypeOf } from "./annotation-box-helpers.ts";
import {
  datasetWireLabelClassName,
  normalizeSymbolText,
} from "./annotation-labeling.ts";
import type { AnnotationAttachment, AnnotationBox } from "./studio-types.ts";

export type DatasetClassCount = {
  className: string;
  mark: string;
  rootType: string;
  count: number;
};

export type DatasetClassHighlight = {
  className: string | null;
  rootBoxIds: Set<string>;
  labelBoxIds: Set<string>;
  attachmentIds: Set<string>;
};

const STANDALONE_DATASET_ROOT_LABELS = new Set([
  "CONTINUATION",
  "INPUTSIGNALWIRE",
  "OUTPUTSIGNALWIRE",
  "SHIELDEDCABLE",
  "TERMINAL",
  "WIRELABEL",
  "5VWIRELABEL",
  "-5VWIRELABEL",
  "24VWIRELABEL",
  "-24VWIRELABEL",
  "NC24VWIRELABEL",
]);

export function isDatasetComponentTrainingPairRoot(box: AnnotationBox) {
  if (rootTypeOf(box) !== "component") return false;
  return !STANDALONE_DATASET_ROOT_LABELS.has(normalizeSymbolText(box.label));
}

export function datasetClassCountsForBoxes(
  boxesForPage: AnnotationBox[]
): DatasetClassCount[] {
  const counts = new Map<string, DatasetClassCount>();
  const increment = (className: string, rootType: string) => {
    const existing = counts.get(className);
    if (existing) {
      existing.count += 1;
      return;
    }
    counts.set(className, {
      className,
      mark: className,
      rootType,
      count: 1,
    });
  };

  for (const box of boxesForPage) {
    const rootType = rootTypeOf(box);
    if (rootType === "component") {
      increment(datasetComponentClassName(box.label), rootType);
      if (box.labelBbox) {
        increment(datasetComponentLinkedClassName(box.label, "label"), rootType);
      }
    } else {
      increment(datasetRootClassName(rootType, box.label), rootType);
    }

    for (const attachment of attachmentsOf(box)) {
      increment(datasetAttachmentClassName(attachment, box.label), attachment.type);
    }
  }

  return [...counts.values()].sort((left, right) =>
    left.className.localeCompare(right.className)
  );
}

export function datasetClassHighlightForBoxes(
  boxesForPage: AnnotationBox[],
  className: string | null
): DatasetClassHighlight {
  const highlight: DatasetClassHighlight = {
    className,
    rootBoxIds: new Set(),
    labelBoxIds: new Set(),
    attachmentIds: new Set(),
  };
  if (!className) return highlight;

  for (const box of boxesForPage) {
    const rootType = rootTypeOf(box);
    if (rootType === "component") {
      if (datasetComponentClassName(box.label) === className) {
        highlight.rootBoxIds.add(box.id);
      }
      if (
        box.labelBbox &&
        className === datasetComponentLinkedClassName(box.label, "label")
      ) {
        highlight.labelBoxIds.add(box.id);
      }
    } else if (datasetRootClassName(rootType, box.label) === className) {
      highlight.rootBoxIds.add(box.id);
    }

    for (const attachment of attachmentsOf(box)) {
      if (datasetAttachmentClassName(attachment, box.label) === className) {
        highlight.attachmentIds.add(attachment.id);
      }
    }
  }

  return highlight;
}

export function datasetAttachmentClassName(
  attachment: AnnotationAttachment,
  ownerLabel = ""
) {
  if (attachment.type === "wire_label") {
    return datasetWireLabelClassName(attachment.text);
  }
  if (attachment.type === "part_number") {
    return datasetComponentLinkedClassName(ownerLabel, "part_number");
  }
  if (attachment.type === "spec") {
    return datasetComponentLinkedClassName(ownerLabel, "spec");
  }
  return `component_${attachment.type}`;
}

export function datasetComponentClassName(label: string) {
  const normalized = normalizeSymbolText(label);
  if (normalized === "CONTINUATION") return "continuation";
  return normalized.match(/^[A-Z]+/)?.[0] ?? "unknown_component";
}

export function datasetComponentLinkedClassName(label: string, role: string) {
  return `${datasetComponentClassName(label)}_${role}`;
}

function datasetRootClassName(rootType: string, label: string) {
  if (rootType === "wire_label") {
    return datasetWireLabelClassName(label);
  }
  if (rootType === "part_number") {
    return datasetComponentLinkedClassName("", "part_number");
  }
  if (rootType === "spec") {
    return datasetComponentLinkedClassName("", "spec");
  }
  if (rootType === "continuation") {
    return "continuation";
  }
  return rootType;
}
