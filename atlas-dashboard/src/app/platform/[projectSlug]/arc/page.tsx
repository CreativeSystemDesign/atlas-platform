"use client";

// /platform/[projectSlug]/arc — the AI Industrial Engineer's room.
// Project-scoped: a trace is always a trace OF a machine. Phase 1 is
// UI-only over manufactured data (Shane's ruling, 2026-07-17); the seat,
// tools, and trace engine arrive in later phases.

import { ArcEngineerScreen } from "@/components/arc-engineer/arc-engineer-screen";

export default function ArcEngineerPage() {
  return (
    <div className="h-full" style={{ height: "calc(100vh - 56px)" }}>
      <ArcEngineerScreen />
    </div>
  );
}
