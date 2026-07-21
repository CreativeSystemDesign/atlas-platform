import type { AnnotationMode, StudioTool } from "./studio-types.ts";

export function defaultToolForMode(mode: AnnotationMode): StudioTool {
  return mode === "component" || mode === "cable" || mode === "terminal-block" ? "box" : "select";
}

export function applyAnnotationModeChange(
  nextMode: AnnotationMode,
  options: {
    setActiveMode: (mode: AnnotationMode) => void;
    setTool: (tool: StudioTool) => void;
    clearModeTransientState: () => void;
  }
) {
  options.setActiveMode(nextMode);
  options.setTool(defaultToolForMode(nextMode));
  options.clearModeTransientState();
}
