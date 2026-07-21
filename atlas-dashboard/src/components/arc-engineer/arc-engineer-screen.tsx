"use client";

// The Arc room — presentation canvas (main) + the LIVE Arc panel (right),
// speaking from the industrial-engineer seat (design: docs/vault/Arc
// Industrial Engineer — Design.md). Phase 1: the seat has no tools yet;
// the canvas offers a manufactured sample trace so the answer format is
// visible while the engine is built in later phases.

import { useState } from "react";
import { useParams } from "next/navigation";
import { Waypoints } from "lucide-react";
import { ExperimentalV2CopilotPanel } from "@/components/experimental-v2/experimental-v2-copilot-panel";
import { PT } from "@/lib/platform-theme";
import { AnswerView } from "./answer-renderer";
import { MOCK_TRACE } from "./mock-fixtures";

function CanvasEmptyState({ onShowSample }: { onShowSample: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-[20px]"
        style={{
          background: "rgba(34,211,238,.08)",
          boxShadow: "rgba(34,211,238,.12) 0px 0px 40px",
        }}
      >
        <Waypoints size={28} style={{ color: PT.cyanText }} />
      </div>
      <div>
        <div className="text-[15px] font-bold tracking-[.01em]" style={{ color: PT.text }}>
          The answer surface
        </div>
        <div className="mx-auto mt-1.5 max-w-[380px] text-[12px] leading-[1.6]" style={{ color: PT.textMute }}>
          Ask Arc for a circuit trace and it composes the answer here — the circuit
          walked connection by connection, origination to termination, every step
          beside the print it came from.
        </div>
      </div>
      <button
        type="button"
        onClick={onShowSample}
        className="cursor-pointer rounded-lg border px-3.5 py-[7px] text-[11.5px] font-semibold"
        style={{ borderColor: PT.lineStrong, background: PT.well, color: PT.textDim }}
      >
        View the sample trace format
      </button>
    </div>
  );
}

export function ArcEngineerScreen() {
  const params = useParams<{ projectSlug: string }>();
  const [arcOpen, setArcOpen] = useState(true);
  const [showSample, setShowSample] = useState(false);
  return (
    <div className="flex h-full min-h-0">
      <section className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
        {showSample ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="mx-auto mb-3 flex w-full max-w-[860px] items-center justify-between">
              <span
                className="rounded-md px-2 py-[3px] text-[9px] font-bold uppercase tracking-[.09em]"
                style={{ background: "rgba(245,158,11,.14)", color: PT.amberText }}
              >
                Sample · manufactured data
              </span>
              <button
                type="button"
                onClick={() => setShowSample(false)}
                className="cursor-pointer border-0 bg-transparent text-[11px] font-semibold"
                style={{ color: PT.textMute }}
              >
                hide sample
              </button>
            </div>
            <AnswerView layout={MOCK_TRACE} />
          </div>
        ) : (
          <CanvasEmptyState onShowSample={() => setShowSample(true)} />
        )}
      </section>

      {arcOpen ? (
        <ExperimentalV2CopilotPanel
          open
          onClose={() => setArcOpen(false)}
          seat={{
            area: "industrial-engineer",
            context: () => ({
              project_slug: params.projectSlug,
              phase:
                "ui-1 — canvas shows a manufactured sample trace; no seat tools yet",
            }),
          }}
          title="Arc · Industrial Engineer"
          composerPlaceholder="Ask Arc — the machine's AI Industrial Engineer…"
          emptyStateCopy={{
            headline: "Arc, the AI Industrial Engineer",
            blurb:
              "This is the answer room — ask about the machine, its documentation, or this room's design. Live circuit tracing arrives with the trace engine.",
            examples: [
              "What can you do in this room right now?",
              "Walk me through the sample trace format",
              "What will a real trace look like when the engine lands?",
            ],
          }}
          kickoff={`Arc room opened — machine "${params.projectSlug}". Phase 1: the presentation canvas renders a manufactured sample trace; the trace engine and seat tools arrive in later phases.`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setArcOpen(true)}
          className="w-[26px] shrink-0 cursor-pointer border-0 text-[10px] font-bold uppercase tracking-[.14em]"
          style={{ background: "rgba(3,8,18,.55)", color: PT.cyanText, writingMode: "vertical-rl" }}
          title="Open Arc"
        >
          Arc
        </button>
      )}
    </div>
  );
}
