import type { CSSProperties } from "react";

import type { AttachmentKind, RootObjectKind } from "./annotation-model.ts";
import {
  isObjectDetectionWorkspace,
  isYoloWorkspace,
  type AnnotationWorkspaceMode,
} from "./studio-types.ts";

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type StudioToolLike = "select" | "box" | "pan";
type AnnotationModeLike =
  | "component"
  | "terminal"
  | "wire"
  | "cable"
  | "terminal-block"
  | "wire-label"
  | "continuation-symbol"
  | "junction"
  | "continuation"
  | "descriptor"
  | "page-descriptor"
  | "part-spec"
  | "note"
  | "trace"
  | "relationship";

const DATASET_FALLBACK_COLOR = "#ff00ff";
const YOLO_COLOR = "#ef4444";

export const BBOX_OUTLINE_CLASS = "bg-transparent shadow-none";
export const BBOX_OUTLINE_STYLE: CSSProperties = {
  borderColor: DATASET_FALLBACK_COLOR,
  backgroundColor: "transparent",
  boxShadow: "none",
  outlineColor: DATASET_FALLBACK_COLOR,
  ["--tw-ring-color" as string]: DATASET_FALLBACK_COLOR,
};

export const YOLO_BBOX_STYLE: CSSProperties = {
  borderColor: YOLO_COLOR,
  backgroundColor: "rgba(239, 68, 68, 0.06)",
  boxShadow:
    "0 0 0 1px rgba(127, 29, 29, 0.95), 0 0 26px rgba(239, 68, 68, 0.38)",
  outlineColor: YOLO_COLOR,
  ["--tw-ring-color" as string]: YOLO_COLOR,
};

function isTrainingDatasetWorkspace(
  annotationWorkspaceMode: AnnotationWorkspaceMode = "digital_twin"
) {
  return isObjectDetectionWorkspace(annotationWorkspaceMode);
}

export function bboxOutlineClass(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? BBOX_OUTLINE_CLASS
    : "";
}

export function bboxOutlineStyle(
  annotationWorkspaceMode: AnnotationWorkspaceMode
): CSSProperties {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? BBOX_OUTLINE_STYLE
    : {};
}

export function attachmentColor(
  type: AttachmentKind,
  annotationWorkspaceMode: AnnotationWorkspaceMode = "digital_twin"
) {
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return DATASET_FALLBACK_COLOR;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return YOLO_COLOR;
  }
  if (type === "component") return "rgba(34, 211, 238, 0.92)";
  if (type === "terminal") return "rgba(52, 211, 153, 0.9)";
  if (type === "terminal_label") return "rgba(45, 212, 191, 0.92)";
  if (type === "wire_label") return "rgba(96, 165, 250, 0.92)";
  if (type === "wire_segment") return "rgba(125, 211, 252, 0.88)";
  if (type === "cable_segment") return "rgba(45, 212, 191, 0.9)";
  if (type === "cable_reference") return "rgba(20, 184, 166, 0.9)";
  if (type === "cable_label") return "rgba(45, 212, 191, 0.94)";
  if (type === "cable_endpoint") return "rgba(94, 234, 212, 0.96)";
  if (type === "wire_endpoint") return "rgba(56, 189, 248, 0.96)";
  if (type === "wire_color") return "rgba(251, 146, 60, 0.94)";
  if (type === "connection_point") return "rgba(244, 244, 245, 0.96)";
  if (type === "continuation") return "rgba(14, 165, 233, 0.95)";
  if (type === "junction") return "rgba(250, 204, 21, 0.95)";
  if (type === "ground_reference") return "rgba(52, 211, 153, 0.94)";
  if (type === "ground_label") return "rgba(190, 242, 100, 0.92)";
  if (type === "location") return "rgba(16, 185, 129, 0.95)";
  if (type === "part_number") return "rgba(251, 191, 36, 0.9)";
  if (type === "spec") return "rgba(168, 85, 247, 0.9)";
  return "rgba(244, 114, 182, 0.88)";
}

export function attachmentClass(
  type: AttachmentKind,
  selected: boolean,
  annotationWorkspaceMode: AnnotationWorkspaceMode = "digital_twin"
) {
  const active = selected ? "opacity-100" : "opacity-80";
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return `${active} ${BBOX_OUTLINE_CLASS}`;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return `${active} border-red-500 bg-red-500/10 shadow-[0_0_0_1px_rgba(127,29,29,0.78),0_0_18px_rgba(239,68,68,0.34)]`;
  }
  if (type === "component") return `${active} border-cyan-300 bg-cyan-300/12`;
  if (type === "terminal") return `${active} border-emerald-300 bg-emerald-300/12`;
  if (type === "terminal_label") return `${active} border-teal-300 bg-teal-300/12`;
  if (type === "wire_label") return `${active} border-blue-300 bg-blue-300/12`;
  if (type === "wire_segment") return `${active} border-sky-300 bg-sky-300/12`;
  if (type === "cable_segment") {
    return `${active} border-teal-300 bg-teal-300/12 shadow-[0_0_0_1px_rgba(15,118,110,0.7),0_0_16px_rgba(45,212,191,0.32)]`;
  }
  if (type === "cable_reference") {
    return `${active} border-teal-200 bg-teal-300/10 shadow-[0_0_0_1px_rgba(15,118,110,0.68),0_0_18px_rgba(20,184,166,0.28)]`;
  }
  if (type === "cable_label") return `${active} border-teal-300 bg-teal-300/12`;
  if (type === "cable_endpoint") {
    return `${active} rounded-full border-teal-100 bg-teal-300/28 shadow-[0_0_0_1px_rgba(15,118,110,0.82),0_0_18px_rgba(94,234,212,0.46)]`;
  }
  if (type === "wire_endpoint") {
    return `${active} rounded-full border-sky-100 bg-sky-300/28 shadow-[0_0_0_1px_rgba(7,89,133,0.82),0_0_18px_rgba(56,189,248,0.46)]`;
  }
  if (type === "wire_color") {
    return `${active} border-orange-300 bg-orange-300/16 shadow-[0_0_0_1px_rgba(124,45,18,0.78),0_0_16px_rgba(251,146,60,0.38)]`;
  }
  if (type === "connection_point") {
    return `${active} border-zinc-50 bg-zinc-50/18 shadow-[0_0_0_1px_rgba(24,24,27,0.8),0_0_18px_rgba(244,244,245,0.36)]`;
  }
  if (type === "continuation") {
    return `${active} border-sky-300 bg-sky-300/16 shadow-[0_0_0_1px_rgba(12,74,110,0.78),0_0_18px_rgba(14,165,233,0.42)]`;
  }
  if (type === "junction") {
    return `${active} border-yellow-300 bg-yellow-300/18 shadow-[0_0_0_1px_rgba(113,63,18,0.78),0_0_18px_rgba(250,204,21,0.42)]`;
  }
  if (type === "ground_reference") {
    return `${active} border-emerald-300 bg-emerald-300/14 shadow-[0_0_0_1px_rgba(6,78,59,0.74),0_0_18px_rgba(52,211,153,0.34)]`;
  }
  if (type === "ground_label") return `${active} border-lime-300 bg-lime-300/12`;
  if (type === "location") {
    return `${active} border-emerald-400 bg-emerald-300/18 shadow-[0_0_0_1px_rgba(6,78,59,0.85),0_0_16px_rgba(16,185,129,0.42)]`;
  }
  if (type === "part_number") return `${active} border-amber-300 bg-amber-300/12`;
  if (type === "spec") return `${active} border-violet-300 bg-violet-300/12`;
  return `${active} border-pink-300 bg-pink-300/12`;
}

export function rootObjectClass(
  type: RootObjectKind,
  selected: boolean,
  annotationWorkspaceMode: AnnotationWorkspaceMode = "digital_twin"
) {
  const active = selected ? "opacity-100" : "opacity-85";
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return `${active} ${BBOX_OUTLINE_CLASS}`;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return `${active} border-red-500 bg-red-500/8 ${
      selected ? "border-red-100" : ""
    }`;
  }
  if (type === "component") {
    return `${active} border-cyan-400/75 bg-cyan-300/7 ${
      selected ? "border-cyan-200" : ""
    }`;
  }
  if (type === "terminal_block") {
    return `${active} border-purple-400/75 bg-purple-300/7 ${
      selected ? "border-purple-200" : ""
    }`;
  }
  if (type === "connector") {
    return `${active} border-orange-400/75 bg-orange-300/7 ${
      selected ? "border-orange-200" : ""
    }`;
  }
  if (type === "circuit_descriptor") {
    return `${active} border-fuchsia-300/80 bg-fuchsia-300/10 ${
      selected ? "border-fuchsia-100" : ""
    }`;
  }
  if (type === "page_descriptor") {
    return `${active} border-violet-300/80 bg-violet-300/10 ${
      selected ? "border-violet-100" : ""
    }`;
  }
  return attachmentClass(type, selected);
}

export function draftBoxClass(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return `border-2 border-dashed ${BBOX_OUTLINE_CLASS}`;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return "border-4 border-dashed border-cyan-300 bg-cyan-300/10 shadow-[0_0_24px_rgba(34,211,238,0.35)]";
  }
  return "border-2 border-dashed border-amber-300 bg-amber-300/10";
}

export function wireRootClass(
  selected: boolean,
  rootHighlightClass: string,
  annotationWorkspaceMode: AnnotationWorkspaceMode
) {
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return BBOX_OUTLINE_CLASS;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return "border-red-500/85 bg-red-500/8";
  }
  if (selected) return "border-sky-200 bg-sky-300/10";
  if (rootHighlightClass) return "border-sky-100 bg-sky-300/12";
  return "border-sky-300/70 bg-sky-300/5";
}

export function labelBoxClass(
  selected: boolean,
  annotationWorkspaceMode: AnnotationWorkspaceMode
) {
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return BBOX_OUTLINE_CLASS;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return selected
      ? "border-red-100 bg-red-500/12"
      : "border-red-500/90 bg-red-500/10";
  }
  return selected ? "border-sky-200 bg-sky-400/10" : "border-sky-400/80 bg-sky-400/10";
}

export function labelBoxShadowClass(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? "shadow-none"
    : isYoloWorkspace(annotationWorkspaceMode)
      ? "shadow-[0_0_0_1px_rgba(127,29,29,0.76),0_0_18px_rgba(239,68,68,0.3)]"
    : "shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_0_18px_rgba(56,189,248,0.2)]";
}

export function rootBoxShadowClass(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? "shadow-none"
    : isYoloWorkspace(annotationWorkspaceMode)
      ? "shadow-[0_0_0_1px_rgba(127,29,29,0.76),0_0_24px_rgba(239,68,68,0.34)]"
    : "shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_0_22px_rgba(34,211,238,0.24)]";
}

export function wireRootShadowClass(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? "shadow-none"
    : isYoloWorkspace(annotationWorkspaceMode)
      ? "shadow-[0_0_0_1px_rgba(127,29,29,0.7),0_0_18px_rgba(239,68,68,0.28)]"
    : "shadow-[0_0_0_1px_rgba(0,0,0,0.45),0_0_18px_rgba(56,189,248,0.22)]";
}

export function attachmentBoxShadowClass(annotationWorkspaceMode: AnnotationWorkspaceMode) {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? "shadow-none"
    : isYoloWorkspace(annotationWorkspaceMode)
      ? "shadow-[0_0_0_1px_rgba(127,29,29,0.76),0_0_18px_rgba(239,68,68,0.3)]"
    : "shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_0_18px_rgba(245,158,11,0.22)]";
}

export function annotationBboxStyle(
  annotationWorkspaceMode: AnnotationWorkspaceMode
): CSSProperties {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? BBOX_OUTLINE_STYLE
    : isYoloWorkspace(annotationWorkspaceMode)
      ? YOLO_BBOX_STYLE
    : {};
}

export function bboxStrokeStyle(
  annotationWorkspaceMode: AnnotationWorkspaceMode,
  width: string
): CSSProperties {
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return { borderWidth: "5px" };
  }
  if (!isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return { borderWidth: width };
  }
  return {
    borderWidth: 0,
    outlineStyle: "solid",
    outlineWidth: width,
    outlineOffset: "0px",
  };
}

export function labelLeaderVisible(
  annotationWorkspaceMode: AnnotationWorkspaceMode
) {
  if (isYoloWorkspace(annotationWorkspaceMode)) return false;
  return !isTrainingDatasetWorkspace(annotationWorkspaceMode);
}

export function wireSegmentStroke(
  annotationWorkspaceMode: AnnotationWorkspaceMode
) {
  if (isTrainingDatasetWorkspace(annotationWorkspaceMode)) {
    return DATASET_FALLBACK_COLOR;
  }
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return YOLO_COLOR;
  }
  return "rgba(14, 165, 233, 0.42)";
}

export function wireSegmentDropShadowClass(
  annotationWorkspaceMode: AnnotationWorkspaceMode
) {
  return isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? "drop-shadow-none"
    : isYoloWorkspace(annotationWorkspaceMode)
      ? "drop-shadow-[0_0_4px_rgba(239,68,68,0.38)]"
    : "drop-shadow-[0_0_3px_rgba(56,189,248,0.28)]";
}

export function stageCursorClass(
  tool: StudioToolLike,
  activeMode: AnnotationModeLike
) {
  const base = "relative h-full min-h-[420px] overflow-hidden";
  if (activeMode === "descriptor" || activeMode === "page-descriptor") {
    return `${base} cursor-crosshair`;
  }
  if (tool === "pan") return `${base} cursor-grab active:cursor-grabbing`;
  if ((activeMode === "cable" || activeMode === "terminal-block") && tool === "box") return `${base} cursor-crosshair`;
  if (activeMode !== "component") return `${base} cursor-default`;
  if (tool === "box") return `${base} cursor-crosshair`;
  return `${base} cursor-default`;
}

export function handleClass(
  handle: ResizeHandle,
  annotationWorkspaceMode: AnnotationWorkspaceMode = "digital_twin"
) {
  const base = isTrainingDatasetWorkspace(annotationWorkspaceMode)
    ? "pointer-events-auto absolute z-[70] touch-none rounded-full border shadow-none"
    : isYoloWorkspace(annotationWorkspaceMode)
      ? "pointer-events-auto absolute z-[90] touch-none rounded-full border-red-950 bg-red-400 shadow-[0_0_12px_rgba(239,68,68,0.5)]"
    : "pointer-events-auto absolute z-[70] touch-none rounded-full border-cyan-950 bg-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.45)]";
  const positions: Record<ResizeHandle, string> = {
    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-n-resize",
    ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize",
    e: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-e-resize",
    se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize",
    s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
    sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
  };
  return `${base} ${positions[handle]}`;
}

// --- Per-component uniform color palette -----------------------------------
// Every box (root, label, and each of its attachments) shares the same color
// so an entire component is visually identifiable as a single unit.

const COMPONENT_HUES = [
  { hue: 188, tailwindBorder: "border-cyan-300", tailwindBg: "bg-cyan-300/12" },
  { hue: 160, tailwindBorder: "border-emerald-300", tailwindBg: "bg-emerald-300/12" },
  { hue: 28, tailwindBorder: "border-orange-300", tailwindBg: "bg-orange-300/12" },
  { hue: 280, tailwindBorder: "border-violet-300", tailwindBg: "bg-violet-300/12" },
  { hue: 340, tailwindBorder: "border-pink-300", tailwindBg: "bg-pink-300/12" },
  { hue: 50, tailwindBorder: "border-amber-300", tailwindBg: "bg-amber-300/12" },
  { hue: 100, tailwindBorder: "border-lime-300", tailwindBg: "bg-lime-300/12" },
  { hue: 220, tailwindBorder: "border-blue-300", tailwindBg: "bg-blue-300/12" },
  { hue: 0, tailwindBorder: "border-red-300", tailwindBg: "bg-red-300/12" },
  { hue: 320, tailwindBorder: "border-fuchsia-300", tailwindBg: "bg-fuchsia-300/12" },
  { hue: 140, tailwindBorder: "border-green-300", tailwindBg: "bg-green-300/12" },
  { hue: 200, tailwindBorder: "border-sky-300", tailwindBg: "bg-sky-300/12" },
];

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function componentColorForSeed(seed: string) {
  const index = hashSeed(seed) % COMPONENT_HUES.length;
  const entry = COMPONENT_HUES[index];
  return {
    hue: entry.hue,
    borderClass: entry.tailwindBorder,
    bgClass: entry.tailwindBg,
    borderColor: `hsl(${entry.hue}, 95%, 65%)`,
    fillColor: `hsla(${entry.hue}, 95%, 65%, 0.14)`,
    shadowColor: `hsla(${entry.hue}, 95%, 60%, 0.45)`,
  };
}

export function componentColor(seed: string) {
  return componentColorForSeed(seed);
}

export function componentColorStyle(
  seed: string,
  annotationWorkspaceMode: AnnotationWorkspaceMode = "digital_twin"
): CSSProperties {
  if (isYoloWorkspace(annotationWorkspaceMode)) {
    return {
      borderColor: YOLO_COLOR,
      outlineColor: YOLO_COLOR,
      backgroundColor: "rgba(239, 68, 68, 0.06)",
      boxShadow: "0 0 20px rgba(239, 68, 68, 0.28)",
    };
  }
  if (!isTrainingDatasetWorkspace(annotationWorkspaceMode)) return {};
  const color = componentColorForSeed(seed);
  return {
    borderColor: color.borderColor,
    outlineColor: color.borderColor,
    backgroundColor: "transparent",
    boxShadow: "none",
  };
}
