"use client";

import { StudioWorkspaceViewportShell } from "./studio-workspace-viewport-shell";
import type { WorkspaceViewportShellProps } from "./studio-workspace-viewport-shell";

export type WorkspaceMainViewportProps = WorkspaceViewportShellProps;

export function StudioWorkspaceMainViewport({
  ...props
}: WorkspaceMainViewportProps) {
  return <StudioWorkspaceViewportShell {...props} />;
}
