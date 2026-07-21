import { describe, it, expect } from "vitest";
import { pickForTool, pickAnyElement } from "../v2-picking";
import type { V2Graph } from "../experimental-v2-types";

const graph = {
  nodes: [{ id: "n1", type: "component", bbox: { x: 100, y: 100, width: 60, height: 40 }, label: "C1" }],
  ports: [{ id: "p1", parentId: "", type: "terminal", point: { x: 300, y: 300 }, label: "T1" }],
  edges: [{ id: "e1", sourcePortId: "p1", targetPortId: "p1", path: [{ x: 400, y: 400 }, { x: 500, y: 400 }] }],
  continuations: [{ id: "c1", type: "continuation", point: { x: 600, y: 200 }, sheet: "12", zone: "9", rawRef: null, target: null }],
  grounds: [
    { id: "g-outer", type: "ground", bbox: { x: 700, y: 700, width: 80, height: 80 }, label: "GND" },
    { id: "g-inner", type: "ground", bbox: { x: 720, y: 720, width: 30, height: 30 }, label: "PE" },
  ],
} as unknown as V2Graph;

describe("pickForTool", () => {
  it("selects a ground when the tool is ground and the point is inside it", () => {
    expect(pickForTool(graph, "ground", { x: 780, y: 780 })).toBe("g-outer");
  });
  it("prefers the smallest (inner) ground when boxes nest", () => {
    expect(pickForTool(graph, "ground", { x: 730, y: 730 })).toBe("g-inner");
  });
  it("returns null in ground mode over empty space", () => {
    expect(pickForTool(graph, "ground", { x: 10, y: 10 })).toBeNull();
  });
  it("selects a component in component mode", () => {
    expect(pickForTool(graph, "component", { x: 120, y: 110 })).toBe("n1");
  });
  it("selects a terminal in terminal mode within radius", () => {
    expect(pickForTool(graph, "terminal", { x: 304, y: 298 })).toBe("p1");
    expect(pickForTool(graph, "terminal", { x: 340, y: 300 })).toBeNull();
  });
  it("selects a wire in wire mode near its path", () => {
    expect(pickForTool(graph, "wire", { x: 450, y: 402 })).toBe("e1");
    expect(pickForTool(graph, "wire", { x: 450, y: 420 })).toBeNull();
  });
  it("selects a continuation in continuation mode over its chip", () => {
    expect(pickForTool(graph, "continuation", { x: 600, y: 200 })).toBe("c1");
  });
  it("never self-selects for non-placement tools", () => {
    expect(pickForTool(graph, "ground" as never, { x: 780, y: 780 })).toBe("g-outer");
    expect(pickForTool(graph, "select", { x: 780, y: 780 })).toBeNull();
    expect(pickForTool(graph, "ask", { x: 780, y: 780 })).toBeNull();
    expect(pickForTool(graph, "lasso", { x: 120, y: 110 })).toBeNull();
  });
});

describe("pickAnyElement (bless multi-select)", () => {
  // A ground box with a terminal sitting on its top border — Shane's real case.
  const g2 = {
    nodes: [{ id: "n1", type: "component", bbox: { x: 100, y: 100, width: 60, height: 40 }, label: "C1" }],
    ports: [{ id: "t-top", parentId: "", type: "terminal", point: { x: 740, y: 700 }, label: "PE" }],
    edges: [{ id: "e1", sourcePortId: "t-top", targetPortId: "t-top", path: [{ x: 400, y: 400 }, { x: 500, y: 400 }] }],
    continuations: [],
    grounds: [{ id: "g1", type: "ground", bbox: { x: 700, y: 700, width: 80, height: 80 }, label: "PE" }],
  } as unknown as V2Graph;

  it("selects the ground when the point is in its interior", () => {
    const hit = pickAnyElement(g2, { x: 740, y: 750 });
    expect(hit?.id).toBe("g1");
    expect(hit?.kind).toBe("ground");
    expect(hit?.label).toBe("PE");
    expect(hit?.bbox).toBeTruthy();
  });
  it("prefers the terminal ON the ground's border over the ground box", () => {
    const hit = pickAnyElement(g2, { x: 740, y: 701 });
    expect(hit?.id).toBe("t-top");
    expect(hit?.kind).toBe("terminal");
  });
  it("selects a component and a wire by kind", () => {
    expect(pickAnyElement(g2, { x: 120, y: 110 })?.kind).toBe("component");
    expect(pickAnyElement(g2, { x: 450, y: 401 })?.kind).toBe("wire");
  });
  it("returns null over empty space", () => {
    expect(pickAnyElement(g2, { x: 10, y: 10 })).toBeNull();
  });
});
