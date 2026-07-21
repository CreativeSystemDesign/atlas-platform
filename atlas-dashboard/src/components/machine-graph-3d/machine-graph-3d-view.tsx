"use client";

import { useEffect, useState } from "react";
import { MachineGraph3dScene } from "./machine-graph-3d-scene";
import { NET_ROLE_LABEL, NET_ROLE_RGB } from "./net-class";
import { useMg3dGraph } from "./use-mg3d-graph";
import { useMg3dLinkedSheets } from "./use-mg3d-links";

// NET_ROLE_RGB stores deck.gl-style [r, g, b] tuples; convert for CSS.
function roleCssColor(rgb: readonly number[] | string): string {
  return Array.isArray(rgb) ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : String(rgb);
}

export function MachineGraph3dView({ pageNum }: { pageNum: number }) {
  const { graph, sheetRef, loading, error } = useMg3dGraph(pageNum);
  const { sheets, arcs } = useMg3dLinkedSheets(pageNum, graph, sheetRef);
  // Billboard labels (always facing — investigating) vs printed-on-surface
  // (fixed to block faces — navigating). Shane's toggle; L flips it.
  const [surfaceLabels, setSurfaceLabels] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "l" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setSurfaceLabels((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        background: "#0a0e16",
        color: "#cbd5e1",
      }}
    >
      {graph && (
        <MachineGraph3dScene
          graph={graph}
          sheetRef={sheetRef}
          pageNum={pageNum}
          surfaceLabels={surfaceLabels}
          linkedSheets={sheets}
          arcs={arcs}
        />
      )}

      <button
        type="button"
        onClick={() => setSurfaceLabels((v) => !v)}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 10,
          background: "rgba(10,14,22,0.85)",
          color: surfaceLabels ? "#5eead4" : "#94a3b8",
          border: "1px solid rgba(148,163,184,0.25)",
          borderRadius: 8,
          padding: "6px 12px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {surfaceLabels ? "labels: printed on (L)" : "labels: facing you (L)"}
      </button>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: "#e2e8f0",
          }}
        >
          Machine graph
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {`sheet ${sheetRef ?? "?"} · page ${pageNum} · annotation layer only`}
        </div>
        {sheets.length > 0 && (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {`linked: ${sheets.map((s) => `sheet ${s.sheetRef ?? s.pageNum}`).join(" · ")} — ${arcs.length} continuation${arcs.length === 1 ? "" : "s"}`}
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          zIndex: 10,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          background: "rgba(10,14,22,0.75)",
          padding: "8px 12px",
          borderRadius: 8,
        }}
      >
        {(Object.keys(NET_ROLE_LABEL) as Array<keyof typeof NET_ROLE_LABEL>).map(
          (role) => (
            <div
              key={String(role)}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: roleCssColor(NET_ROLE_RGB[role]),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {NET_ROLE_LABEL[role]}
              </span>
            </div>
          ),
        )}
      </div>

      {loading && !graph && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#475569",
            fontSize: 13,
          }}
        >
          loading sheet…
        </div>
      )}

      {error && !graph && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f87171",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
