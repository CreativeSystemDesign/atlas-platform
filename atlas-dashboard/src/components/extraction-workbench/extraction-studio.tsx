"use client";

import { StudioWorkspaceScreen } from "./studio-workspace-screen";
import { useStudioWorkspaceController } from "./studio-workspace-controller";

export function ExtractionStudio() {
  const screenProps = useStudioWorkspaceController();
  return <StudioWorkspaceScreen {...screenProps} />;
}
