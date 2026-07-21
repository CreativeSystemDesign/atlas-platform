// Slate 6.6: per-op reference validation in the annotate executor.
// renameElement/deleteElement no-op on missing ids while bridge-ops
// unconditionally pushed success notes — a one-hex-char corrupted UUID at
// 319k context was accepted with the turn reporting success having done
// nothing. Same-batch cascade removals get a distinct status, not ERROR.
import { describe, expect, it } from "vitest";

import type { V2Graph } from "../experimental-v2-types";
import { applyAnnotateOps } from "../v2-bridge-ops";

function graph(): V2Graph {
  return {
    nodes: [
      {
        id: "node-1",
        type: "component",
        bbox: { x: 0, y: 0, width: 100, height: 100 },
        label: "CNV40",
        identity: null,
      },
    ],
    ports: [
      {
        id: "port-1",
        type: "terminal",
        label: "T~1~X",
        point: { x: 0, y: 50 },
        parentId: "node-1",
      },
    ],
    edges: [],
    continuations: [],
  } as unknown as V2Graph;
}

describe("slate 6.6 per-op reference validation", () => {
  it("errors loudly on a rename of a nonexistent id (corrupted-UUID class)", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [
      { op: "rename", id: "port-254f9e1a44e", label: "T~2~Y" } as never,
    ]);
    expect(r.notes.join("\n")).toContain("ERROR rename: id port-254f9e1a44e not found");
    expect(g.ports[0].label).toBe("T~1~X");
  });

  it("marks cascade-removed targets as already-removed-this-batch, not ERROR", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [
      { op: "delete", id: "node-1" } as never,
      { op: "rename", id: "port-1", label: "T~2~Y" } as never, // dropped by the node cascade
    ]);
    const joined = r.notes.join("\n");
    expect(joined).toContain("deleted node-1");
    expect(joined).toContain("rename port-1: already-removed-this-batch");
    expect(joined).not.toContain("ERROR rename");
  });

  it("errors on deleting a nonexistent id", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [{ op: "delete", id: "node-ghost" } as never]);
    expect(r.notes.join("\n")).toContain("ERROR delete: id node-ghost not found");
  });

  it("validates both legs of a reparent", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [
      { op: "reparent", id: "port-1", component_id: "node-ghost" } as never,
    ]);
    expect(r.notes.join("\n")).toContain("ERROR reparent->component: id node-ghost not found");
    expect(g.ports[0].parentId).toBe("node-1");
  });

  it("flags a continuation whose explicit target is missing as UNATTACHED", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [
      {
        op: "add_continuation",
        point: { x: 500, y: 500 },
        sheet: "49",
        zone: "19",
        target_id: "port-ghost",
      } as never,
    ]);
    expect(r.notes.join("\n")).toContain("warning: continuation target port-ghost not found");
    expect(g.continuations).toHaveLength(1);
    expect(g.continuations[0].target).toBeNull();
  });

  it("slate 3.5: a junction heal names itself in the receipt", () => {
    const g = graph();
    g.ports.push({ id: "port-j", type: "junction", label: "J-1", point: { x: 50, y: 50 }, parentId: "" } as never);
    g.ports.push({ id: "port-a", type: "terminal", label: "A", point: { x: 0, y: 50 }, parentId: null } as never);
    g.ports.push({ id: "port-b", type: "terminal", label: "B", point: { x: 100, y: 50 }, parentId: null } as never);
    g.edges.push({ id: "edge-a", sourcePortId: "port-a", targetPortId: "port-j",
      path: [{ x: 0, y: 50 }, { x: 50, y: 50 }], label: "N1" } as never);
    g.edges.push({ id: "edge-b", sourcePortId: "port-j", targetPortId: "port-b",
      path: [{ x: 50, y: 50 }, { x: 100, y: 50 }], label: "N1" } as never);
    const r = applyAnnotateOps(g, [{ op: "delete", id: "port-j" } as never]);
    expect(r.notes.join("\n")).toContain("junction heal: merged edges edge-a + edge-b");
    expect(g.edges).toHaveLength(1);
  });

  it("slate 3.5: continuation receipts show raw_ref, never ?/?", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [
      { op: "add_continuation", point: { x: 700, y: 700 }, raw_ref: "49/19" } as never,
    ]);
    expect(r.notes.join("\n")).toContain("added continuation 49/19");
    expect(r.notes.join("\n")).not.toContain("?/?");
  });

  it("refuses add_terminal onto a nonexistent component", () => {
    const g = graph();
    const r = applyAnnotateOps(g, [
      { op: "add_terminal", component_id: "node-ghost", point: { x: 900, y: 900 } } as never,
    ]);
    expect(r.notes.join("\n")).toContain(
      "ERROR add_terminal->component: id node-ghost not found"
    );
    expect(g.ports).toHaveLength(1);
  });
});
