import type { CSSProperties } from "react";

import type {
  RelationshipHighlight,
  RelationshipPathColor,
} from "./relationship-highlight.ts";

export function truthRowPathStyle(color: RelationshipPathColor): CSSProperties {
  return {
    borderColor: color.border,
    backgroundColor: color.panelBackground,
    boxShadow: `0 0 0 1px rgba(0,0,0,0.35), 0 0 18px ${color.glow}`,
  };
}

export function truthRowItemStyle(color: RelationshipPathColor): CSSProperties {
  return {
    borderColor: color.border,
    backgroundColor: color.fill,
  };
}

export function relationshipRootHighlightClass() {
  return "ring-[3px]";
}

export function relationshipRootHighlightStyle(
  highlight: RelationshipHighlight | null
): CSSProperties {
  if (!highlight) return {};
  return relationshipHighlightStyle(highlight, 24);
}

export function relationshipAttachmentHighlightClass(
  highlight: RelationshipHighlight | null
) {
  if (!highlight) return "";
  return "ring-[3px]";
}

export function relationshipAttachmentHighlightStyle(
  highlight: RelationshipHighlight | null
): CSSProperties {
  if (!highlight) return {};
  return relationshipHighlightStyle(highlight, 18);
}

export function relationshipHighlightStyle(
  highlight: RelationshipHighlight,
  glowSize: number
): CSSProperties {
  const color = highlight.color;
  return {
    borderColor: color.border,
    backgroundColor: color.fill,
    outlineColor: color.border,
    outlineStyle: "solid",
    outlineWidth: "2px",
    outlineOffset: "2px",
    boxShadow: `0 0 0 1px rgba(0,0,0,0.8), 0 0 0 5px ${color.fill}, 0 0 ${glowSize}px ${color.glow}, 0 0 ${
      glowSize * 1.75
    }px ${color.glow}`,
    ["--tw-ring-color" as string]: color.border,
  };
}

export function relationshipHighlightStroke(highlight: RelationshipHighlight) {
  return highlight.color.stroke;
}

export function relationshipLineGlowStyle(
  highlight: RelationshipHighlight,
  glowSize: number
): CSSProperties {
  const color = highlight.color;
  return {
    filter: `drop-shadow(0 0 2px rgba(0,0,0,0.85)) drop-shadow(0 0 ${glowSize}px ${color.glow}) drop-shadow(0 0 ${
      glowSize * 1.5
    }px ${color.glow})`,
  };
}
