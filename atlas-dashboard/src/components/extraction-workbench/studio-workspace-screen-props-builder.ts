"use client";

import type { WorkspacePaneProps } from "./studio-workspace-pane";

export type WorkspacePanePropsInput = Omit<WorkspacePaneProps, "children">;

export function buildWorkspacePaneProps(
  workspacePanePropsInput: WorkspacePanePropsInput,
): WorkspacePaneProps {
  return workspacePanePropsInput;
}

