// Slate 4.3: TERMINAL-FIRST wire endpoint resolution. Root cause was real
// code: applyOps snapped paths FIRST (28px, top priority = printed terminal
// circles, interior under the border convention) and only then ensurePort
// reused graph ports at 12px — the ordering+radius mismatch that minted
// duplicate T-123/T-125 and stray T-56 instead of reusing R40's C terminal.
import { describe, expect, it } from "vitest";

import type { V2Graph } from "../experimental-v2-types";
import { applyAnnotateOps } from "../v2-bridge-ops";
import { buildPageGeometry } from "../v2-snapping";

function graphWithTerminal(): V2Graph {
  return {
    nodes: [
      {
        id: "node-r40",
        type: "component",
        bbox: { x: 874, y: 1471, width: 251, height: 147 },
        label: "R40",
        identity: null,
      },
    ],
    ports: [
      {
        id: "port-c",
        type: "terminal",
        label: "T~C~R40",
        point: { x: 1125, y: 1540 },
        parentId: "node-r40",
      },
    ],
    edges: [],
    continuations: [],
  } as unknown as V2Graph;
}

describe("slate 4.3 terminal-first endpoint resolution", () => {
  it("binds an endpoint to an existing terminal at 15px — no duplicate mint", () => {
    const g = graphWithTerminal();
    // 14px off: OUTSIDE the old 12px ensurePort reuse, inside the new bind
    const r = applyAnnotateOps(g, [
      {
        op: "add_wire",
        label: "R401",
        path: [
          { x: 1139, y: 1540 },
          { x: 1300, y: 1540 },
        ],
      } as never,
    ]);
    expect(r.notes.join("\n")).toContain("start bound to existing terminal T~C~R40");
    expect(r.minted[0]?.source_port).toBe("port-c");
    expect(g.ports.filter((p) => p.label === "T~C~R40")).toHaveLength(1);
    // the drawn endpoint sits exactly on the port (audit rule 4 tolerance)
    expect(g.edges[0].path[0]).toEqual({ x: 1125, y: 1540 });
  });

  it("warns in-op when binding to a dot-less stub-edge terminal", () => {
    const g = graphWithTerminal();
    g.ports.push({
      id: "port-stub",
      type: "terminal",
      label: "T~x~stub",
      point: { x: 500, y: 500 },
      parentId: null,
    } as never);
    g.edges.push({
      id: "edge-1",
      sourcePortId: "port-stub",
      targetPortId: "port-c",
      path: [
        { x: 500, y: 500 },
        { x: 1125, y: 1540 },
      ],
      label: null,
    } as never);
    const r = applyAnnotateOps(g, [
      {
        op: "add_wire",
        path: [
          { x: 503, y: 500 },
          { x: 200, y: 500 },
        ],
      } as never,
    ]);
    expect(r.notes.join("\n")).toContain("segmented conductor");
    // FP-class-4 exemption: same join ON a printed inline circle stays quiet
    const g2 = graphWithTerminal();
    g2.ports.push({
      id: "port-stub",
      type: "terminal",
      label: "T~x~stub",
      point: { x: 500, y: 500 },
      parentId: null,
    } as never);
    g2.edges.push({
      id: "edge-1",
      sourcePortId: "port-stub",
      targetPortId: "port-c",
      path: [
        { x: 500, y: 500 },
        { x: 1125, y: 1540 },
      ],
      label: null,
    } as never);
    const fakeGeom = { terminals: [{ point: { x: 500, y: 500 } }] } as never;
    const r2 = applyAnnotateOps(g2, [
      {
        op: "add_wire",
        path: [
          { x: 503, y: 500 },
          { x: 200, y: 500 },
        ],
      } as never,
    ], [], [], fakeGeom);
    expect(r2.notes.join("\n")).not.toContain("segmented conductor");
  });

  it("slate 4.4: a stranding resize draws ONE aggregated warning; net repair stays quiet", () => {
    const g = graphWithTerminal(); // T~C~R40 sits on R40's right border (x=1125)
    const r = applyAnnotateOps(g, [
      // tighten the box so the terminal lands 25px outside the new border
      { op: "resize", id: "node-r40", bbox: { x: 874, y: 1471, width: 226, height: 147 } } as never,
    ]);
    const joined = r.notes.join("\n");
    expect(joined).toContain("warning: resize of R40 leaves 1 own terminal(s)");
    expect(joined).toContain("25px OUTSIDE");
    // same resize with a same-batch net repair (delete the stranded terminal)
    const g2 = graphWithTerminal();
    const r2 = applyAnnotateOps(g2, [
      { op: "resize", id: "node-r40", bbox: { x: 874, y: 1471, width: 226, height: 147 } } as never,
      { op: "delete", id: "port-c" } as never,
    ]);
    expect(r2.notes.join("\n")).not.toContain("own terminal(s)");
  });

  it("rejects silent snap displacements past 8px, keeping raw coords", () => {
    // one printed horizontal run at y=50; the interior point sits 20px off it
    const geometry = buildPageGeometry({
      scale: 1,
      shapes: [{ bbox: [10, 50, 400, 50] }],
      text_blocks: [],
    });
    const g = graphWithTerminal();
    const r = applyAnnotateOps(g, [
      {
        op: "add_wire",
        snap: "artwork",
        path: [
          { x: 20, y: 70 },
          { x: 300, y: 70 },
        ],
      } as never,
    ], [], [], geometry);
    const joined = r.notes.join("\n");
    expect(joined).toContain("REJECTED");
    expect(joined).toContain("raw coordinate kept");
    // the path was NOT silently dragged onto the artwork
    expect(g.edges[0].path[0].y).toBe(70);
  });
});
