"use client";

import {
  attachmentColor,
  labelLeaderVisible,
  wireSegmentDropShadowClass,
  wireSegmentStroke,
} from "./annotation-styles";
import type { RelationshipHighlight } from "./relationship-highlight";
import {
  relationshipHighlightStroke,
  relationshipLineGlowStyle,
} from "./relationship-visuals";
import { centerOfBox } from "./studio-geometry";
import type {
  AnnotationAttachment,
  AnnotationWorkspaceMode,
  WireSegmentGeometry,
} from "./studio-types";

type Point = {
  x: number;
  y: number;
};

type AnnotationRelationshipOverlayProps = {
  zoom: number;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  labelCenter: Point | null;
  rootAnchorCenter: Point;
  wireSegments: WireSegmentGeometry[];
  attachments: AnnotationAttachment[];
  attachmentsById: Map<string, AnnotationAttachment>;
  relationshipRootHighlight: RelationshipHighlight | null;
  relationshipAttachmentHighlights: Map<string, RelationshipHighlight>;
};

export function AnnotationRelationshipOverlay({
  zoom,
  annotationWorkspaceMode,
  labelCenter,
  rootAnchorCenter,
  wireSegments,
  attachments,
  attachmentsById,
  relationshipRootHighlight,
  relationshipAttachmentHighlights,
}: AnnotationRelationshipOverlayProps) {
  const labelLeaderShouldRender =
    labelCenter !== null && labelLeaderVisible(annotationWorkspaceMode);
  const attachmentLeaderAttachments =
    annotationWorkspaceMode === "training_dataset"
      ? []
      : attachments.filter((attachment) => attachment.type !== "wire_endpoint");

  if (
    !labelLeaderShouldRender &&
    attachmentLeaderAttachments.length === 0 &&
    wireSegments.length === 0
  ) {
    return null;
  }

  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible">
      {wireSegments.map((segment) => (
        <line
          key={segment.id}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          stroke={
            relationshipRootHighlight
              ? relationshipHighlightStroke(relationshipRootHighlight)
              : wireSegmentStroke(annotationWorkspaceMode)
          }
          strokeWidth={Math.max(
            1.25,
            relationshipRootHighlight ? 5.5 / zoom : 2 / zoom
          )}
          strokeLinecap="round"
          className={wireSegmentDropShadowClass(annotationWorkspaceMode)}
          style={
            relationshipRootHighlight
              ? relationshipLineGlowStyle(relationshipRootHighlight, 14)
              : undefined
          }
        />
      ))}
      {labelLeaderShouldRender ? (
        <line
          x1={rootAnchorCenter.x}
          y1={rootAnchorCenter.y}
          x2={labelCenter.x}
          y2={labelCenter.y}
          stroke="rgba(34, 211, 238, 0.88)"
          strokeWidth={Math.max(1, 2 / zoom)}
          strokeDasharray={`${10 / zoom} ${7 / zoom}`}
        />
      ) : null}
      {attachmentLeaderAttachments.map((attachment) => {
        const attachmentCenter = centerOfBox(attachment.bbox);
        const parent = attachment.parentAttachmentId
          ? attachmentsById.get(attachment.parentAttachmentId)
          : null;
        const sourceCenter = parent ? centerOfBox(parent.bbox) : rootAnchorCenter;
        const attachmentHighlight = relationshipAttachmentHighlights.get(
          attachment.id
        );

        return (
          <line
            key={attachment.id}
            x1={sourceCenter.x}
            y1={sourceCenter.y}
            x2={attachmentCenter.x}
            y2={attachmentCenter.y}
            stroke={
              attachmentHighlight
                ? relationshipHighlightStroke(attachmentHighlight)
                : attachmentColor(attachment.type, annotationWorkspaceMode)
            }
            strokeWidth={Math.max(
              1,
              attachmentHighlight ? 4.5 / zoom : 1.75 / zoom
            )}
            strokeDasharray={`${5 / zoom} ${6 / zoom}`}
            style={
              attachmentHighlight
                ? relationshipLineGlowStyle(attachmentHighlight, 10)
                : undefined
            }
          />
        );
      })}
    </svg>
  );
}
