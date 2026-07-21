"use client";

// Smart Canvas, re-housed (Platform Graduation phase 3, first slice).
// The Experimental v2 screen renders directly inside the platform shell —
// the legacy deep-agent console at "/" is no longer on the path to the
// canvas. The screen is self-contained (bridge, copilot panel, PDF underlay
// all self-connect); it fills the shell's main area and never page-scrolls.

import dynamic from "next/dynamic";
import { PT } from "@/lib/platform-theme";

const ExperimentalV2Screen = dynamic(
  () =>
    import("@/components/experimental-v2/experimental-v2-screen").then(
      (m) => m.ExperimentalV2Screen
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-[12px]" style={{ color: PT.textMute }}>
        loading the canvas…
      </div>
    ),
  }
);

export default function PlatformCanvasPage() {
  return (
    <div className="h-full w-full">
      <ExperimentalV2Screen />
    </div>
  );
}
