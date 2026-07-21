"use client";

import type { ReactNode } from "react";

import { StudioWorkspaceHeader } from "./studio-workspace-header";
import type { AnnotationWorkspaceMode } from "./studio-types";

type WorkspaceLayoutShellProps = {
  children: ReactNode;
  annotationWorkspaceMode: AnnotationWorkspaceMode;
  onAnnotationWorkspaceModeChange: (mode: AnnotationWorkspaceMode) => void;
};

export function StudioWorkspaceLayoutShell({
  annotationWorkspaceMode,
  onAnnotationWorkspaceModeChange,
  children,
}: WorkspaceLayoutShellProps) {
  return (
    <section className="relative flex h-full min-h-0 overflow-hidden rounded-3xl border border-border/70 bg-[radial-gradient(circle_at_18%_12%,rgba(89,129,255,0.16),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015)_42%,rgba(0,0,0,0.18))] shadow-[0_24px_80px_-40px_rgba(0,0,0,0.88)]">
      <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <StudioWorkspaceHeader
          annotationWorkspaceMode={annotationWorkspaceMode}
          onAnnotationWorkspaceModeChange={onAnnotationWorkspaceModeChange}
        />

        <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          {children}
        </div>
      </div>
    </section>
  );
}
