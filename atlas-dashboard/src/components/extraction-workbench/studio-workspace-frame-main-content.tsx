"use client";

import type { WorkspaceFrameProps } from "./studio-workspace-frame";
import { StudioWorkspaceMainContent } from "./studio-workspace-main-content";

export type WorkspaceFrameMainContentProps = Omit<
  WorkspaceFrameProps,
  "children" | "onAnnotationWorkspaceModeChange"
>;

export function StudioWorkspaceFrameMainContent({
  ...props
}: WorkspaceFrameMainContentProps) {
  return <StudioWorkspaceMainContent {...props} />;
}
