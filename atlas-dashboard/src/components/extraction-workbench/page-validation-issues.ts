import {
  attachmentTypeLabel,
  rootObjectTypeLabel,
  strictAttachmentRelation,
  type AnnotationRelation,
  type AttachmentKind,
  type LegacyAnnotationRelation,
  type RootObjectKind,
} from "./annotation-model.ts";
import { auditCanonicalWireAnnotations } from "./wire-canonical-audit.ts";

type BBoxLike = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ValidationAttachmentLike = {
  id: string;
  type: AttachmentKind;
  text?: string | null;
  bbox?: BBoxLike | null;
  relation?: AnnotationRelation | LegacyAnnotationRelation | null;
  parentAttachmentId?: string | null;
};

type ValidationAnnotationLike = {
  id: string;
  label?: string | null;
  bbox?: BBoxLike | null;
  metadata?: {
    rootType?: RootObjectKind | null;
    attachments?: ValidationAttachmentLike[] | null;
    wireGeometry?: {
      segments?: Array<{ bbox?: BBoxLike | null }> | null;
    } | null;
  } | null;
};

export type ValidationIssue = {
  id: string;
  kind?: string;
  severity: "warn" | "error";
  label: string;
  detail: string;
};

export function pageValidationIssues(
  boxes: ValidationAnnotationLike[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const issue of auditCanonicalWireAnnotations(boxes)) {
    issues.push({
      id: issue.id,
      kind: issue.kind,
      severity: issue.severity,
      label: issue.label,
      detail: issue.detail,
    });
  }
  for (const box of boxes) {
    const rootType = rootTypeOf(box);
    const label = box.label || rootObjectTypeLabel(rootType);
    if (!box.metadata?.rootType) {
      issues.push({
        id: `${box.id}-missing-root-type`,
        severity: "warn",
        label: `${label}: missing root type`,
        detail: "This object predates strict root typing and should be reviewed.",
      });
    }
    if (label.toLowerCase() === "terminal" && rootType !== "terminal") {
      issues.push({
        id: `${box.id}-terminal-label-root-mismatch`,
        severity: "warn",
        label: `${label}: suspicious root`,
        detail: `Saved as ${rootObjectTypeLabel(rootType)} but the visible label still reads terminal.`,
      });
    }
    if (rootType === "location" && !looksLikeLocationLabel(label)) {
      issues.push({
        id: `${box.id}-location-text-mismatch`,
        severity: "warn",
        label: `${label}: suspicious location`,
        detail: "Location roots should usually be compact panel/location marks such as PP or CP.",
      });
    }
    for (const attachment of attachmentsOf(box)) {
      const strictRelation = strictAttachmentRelation(
        rootType,
        attachment.type,
        attachment.parentAttachmentId
      );
      if (!attachment.relation) {
        issues.push({
          id: `${box.id}-${attachment.id}-missing-relation`,
          severity: "error",
          label: `${label} -> ${attachment.text || attachment.type}`,
          detail: "Attachment is missing an explicit relation.",
        });
        continue;
      }
      if (
        attachment.relation === "object_has_attachment" &&
        attachment.type !== "text"
      ) {
        issues.push({
          id: `${box.id}-${attachment.id}-generic-relation`,
          severity: "warn",
          label: `${label} -> ${attachment.text || attachment.type}`,
          detail:
            "Saved with the generic legacy relation; review and relink before using this as certified truth.",
        });
        continue;
      }
      if (!strictRelation && attachment.relation !== "object_has_text") {
        issues.push({
          id: `${box.id}-${attachment.id}-invalid-relation`,
          severity: "warn",
          label: `${label} -> ${attachment.text || attachment.type}`,
          detail: `${rootObjectTypeLabel(rootType)} to ${attachmentTypeLabel(attachment.type)} is not a strict relation path.`,
        });
      }
    }
  }
  return issues;
}

function rootTypeOf(box: ValidationAnnotationLike): RootObjectKind {
  return box.metadata?.rootType ?? "component";
}

function looksLikeLocationLabel(value: string) {
  return /^(PP|CP|OP|HP|MP|TB|JB|BOX|PANEL)$/.test(normalizeSymbolText(value));
}

function normalizeSymbolText(value: string) {
  return value
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９＋－]/g, (char) => {
      if (char === "＋") return "+";
      if (char === "－") return "-";
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function attachmentsOf(box: ValidationAnnotationLike): ValidationAttachmentLike[] {
  return Array.isArray(box.metadata?.attachments) ? box.metadata.attachments : [];
}
