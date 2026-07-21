"use client";

import { Maximize2, Minimize2, MoveHorizontal, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ReactFlow, Controls, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { buildTruthFlow } from "./relationship-truth-flow";
import type { RelationshipTruthRow } from "./relationship-truth-rows";

export function TruthVisualizerPanel({
  truthRows,
}: {
  truthRows: RelationshipTruthRow[];
}) {
  const [incomingHops, setIncomingHops] = useState(3);
  const [outgoingHops, setOutgoingHops] = useState(3);
  const [docked, setDocked] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [visible, setVisible] = useState(true);

  const { nodes, edges } = useMemo(
    () => buildTruthFlow(truthRows),
    [truthRows]
  );

  if (!visible) return null;

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between shrink-0 p-3 pb-2 border-b border-cyan-200/10">
        <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-100 flex items-center gap-2">
          Relationship Visualizer
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-cyan-100/70">IN:</span>
            <button onClick={() => setIncomingHops(h => Math.max(1, h - 1))} className="px-1 hover:text-white">-</button>
            <span className="text-[10px] text-cyan-100">{incomingHops}</span>
            <button onClick={() => setIncomingHops(h => h + 1)} className="px-1 hover:text-white">+</button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-cyan-100/70">OUT:</span>
            <button onClick={() => setOutgoingHops(h => Math.max(1, h - 1))} className="px-1 hover:text-white">-</button>
            <span className="text-[10px] text-cyan-100">{outgoingHops}</span>
            <button onClick={() => setOutgoingHops(h => h + 1)} className="px-1 hover:text-white">+</button>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button onClick={() => setDocked(!docked)} title={docked ? "Pop out" : "Dock to sidebar"} className="text-cyan-100/70 hover:text-white">
              <MoveHorizontal className="h-3 w-3" />
            </button>
            {!docked && (
              <button onClick={() => setMaximized(!maximized)} title={maximized ? "Restore size" : "Maximize"} className="text-cyan-100/70 hover:text-white">
                {maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </button>
            )}
            <button onClick={() => setVisible(false)} title="Close visualizer" className="text-cyan-100/70 hover:text-white">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative bg-background/50">
        {nodes.length > 0 ? (
          <ReactFlow nodes={nodes} edges={edges} fitView attributionPosition="bottom-left">
            <Background color="#22d3ee" gap={16} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Select an element to view relationships
          </div>
        )}
      </div>
    </div>
  );

  if (!docked) {
    return (
      <div
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-cyan-200/30 bg-cyan-950/95 shadow-2xl backdrop-blur-xl transition-all duration-300",
          maximized
            ? "inset-4" // Almost full screen
            : "right-4 top-16 h-[500px] w-[700px] resize" // Floating upper right
        )}
      >
        {content}
      </div>
    );
  }

  // Docked state (in sidebar)
  return (
    <div className="flex flex-col rounded-2xl border border-cyan-200/25 bg-cyan-300/8 shadow-[0_0_24px_rgba(34,211,238,0.06)] h-[400px] overflow-hidden">
      {content}
    </div>
  );
}
