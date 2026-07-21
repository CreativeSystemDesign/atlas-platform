"use client";

import type { WorkspaceMainViewportProps } from "./studio-workspace-main-viewport";
import { StudioWorkspaceMainContentShell } from "./studio-workspace-main-content-shell";
import { StudioWorkspaceMainViewport } from "./studio-workspace-main-viewport";

export type WorkspaceMainContentProps = WorkspaceMainViewportProps;

export function StudioWorkspaceMainContent(props: WorkspaceMainContentProps) {
  return (
    <StudioWorkspaceMainContentShell>
      <StudioWorkspaceMainViewport {...props} />
    </StudioWorkspaceMainContentShell>
  );
}
