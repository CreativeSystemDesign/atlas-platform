// Click-to-locate (issues drawer, 2026-07-07): findElementAnchor resolves any
// element kind to a viewport-centerable point; null off-graph so the caller
// can toast instead of panning nowhere.
import { describe, expect, it } from "vitest";

import type { V2Graph } from "../experimental-v2-types";
import { findElementAnchor } from "../v2-graph-ops";

const graph: V2Graph = {
  nodes: [{ id: "node-1", type: "component", bbox: { x: 100, y: 200, width: 40, height: 20 }, label: "MMS7", identity: null }],
  ports: [{ id: "port-1", parentId: "node-1", type: "terminal", point: { x: 110, y: 220 }, label: "T~MMS7~L1~R401" }],
  edges: [{ id: "edge-1", sourcePortId: "port-1", targetPortId: "port-1", path: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 80 }], label: "R401" }],
  continuations: [{ id: "cont-1", type: "continuation", point: { x: 900, y: 40 }, sheet: "12", zone: "9", rawRef: "12/9", target: null }],
};

describe("findElementAnchor", () => {
  it("components anchor at bbox center", () => {
    expect(findElementAnchor(graph, "node-1")).toEqual({ x: 120, y: 210, kind: "component" });
  });
  it("terminals anchor at their point", () => {
    expect(findElementAnchor(graph, "port-1")).toEqual({ x: 110, y: 220, kind: "terminal" });
  });
  it("wires anchor at the path midpoint", () => {
    expect(findElementAnchor(graph, "edge-1")).toEqual({ x: 50, y: 0, kind: "wire" });
  });
  it("continuations anchor at their point", () => {
    expect(findElementAnchor(graph, "cont-1")).toEqual({ x: 900, y: 40, kind: "continuation" });
  });
  it("off-graph elements resolve to null (caller toasts)", () => {
    expect(findElementAnchor(graph, "node-ghost")).toBeNull();
  });
});
