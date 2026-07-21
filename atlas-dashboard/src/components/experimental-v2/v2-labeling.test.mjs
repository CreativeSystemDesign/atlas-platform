import assert from "node:assert/strict";
import test from "node:test";
import { assignLabels } from "./v2-labeling.ts";

test("each label binds to its nearest element one-to-one (dense case)", () => {
  // Two terminals close together, two numbers each beside their own circle.
  const terminals = [{ x: 0, y: 0 }, { x: 30, y: 0 }];
  const tokens = [
    { text: "9", center: { x: 3, y: 6 } },   // nearest to terminal 0
    { text: "10", center: { x: 33, y: 6 } },  // nearest to terminal 1
  ];
  const m = assignLabels(terminals, tokens, 40);
  assert.equal(m.get(0), "9");
  assert.equal(m.get(1), "10");
});

test("a label is never shared between two elements", () => {
  // Both terminals are within range of the single label; only the closer wins.
  const terminals = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
  const tokens = [{ text: "5", center: { x: 2, y: 0 } }];
  const m = assignLabels(terminals, tokens, 40);
  assert.equal(m.get(0), "5");
  assert.equal(m.has(1), false);
});

test("stray labels beyond the cap stay unassigned", () => {
  const terminals = [{ x: 0, y: 0 }];
  const tokens = [{ text: "X", center: { x: 500, y: 500 } }];
  const m = assignLabels(terminals, tokens, 40);
  assert.equal(m.size, 0);
});

test("greedy-by-distance resolves contention correctly", () => {
  // t0 is slightly closer to label A; t1 must then take label B.
  const terminals = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const tokens = [
    { text: "A", center: { x: 4, y: 0 } }, // d0=4, d1=6
    { text: "B", center: { x: 12, y: 0 } }, // d0=12, d1=2
  ];
  const m = assignLabels(terminals, tokens, 40);
  // closest overall pair is (t1,B)=2, then (t0,A)=4
  assert.equal(m.get(1), "B");
  assert.equal(m.get(0), "A");
});
