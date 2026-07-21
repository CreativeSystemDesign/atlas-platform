"use client";

import type { ReactNode } from "react";

export type WorkspaceMainContentShellProps = {
  children: ReactNode;
};

export function StudioWorkspaceMainContentShell({
  children,
}: WorkspaceMainContentShellProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-background/55">
      {children}
    </div>
  );
}
