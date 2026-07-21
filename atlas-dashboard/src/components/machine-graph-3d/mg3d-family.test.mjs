// Run: node --experimental-strip-types --test mg3d-family.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { familyOf, familyStyle } from "./mg3d-family.ts";

test("familyOf: identity.family wins, label prefix is the fallback", () => {
  assert.equal(familyOf("ELB12", "ELB"), "ELB");
  assert.equal(familyOf("ELB12"), "ELB");
  assert.equal(familyOf("MCB10"), "MCB");
  assert.equal(familyOf("F12"), "F");
  assert.equal(familyOf("MC347"), "MC");
  assert.equal(familyOf("RTC40"), "RTC");
  assert.equal(familyOf("WHM10"), "WHM");
  assert.equal(familyOf("elb12"), "ELB");
  assert.equal(familyOf(""), "?");
  assert.equal(familyOf(null), "?");
  assert.equal(familyOf("T52", "T"), "T");
});

test("familyStyle: deterministic — same class, same signature, forever", () => {
  const a = familyStyle("ELB");
  const b = familyStyle("ELB");
  assert.deepEqual(a, b);
  // curated classes carry the designed palette
  assert.deepEqual(familyStyle("MCB").rgb, [249, 115, 22]);
  assert.equal(familyStyle("WHM").heightScale, 0.75);
});

test("familyStyle: unknown families get a stable hashed identity", () => {
  const x1 = familyStyle("ZZX");
  const x2 = familyStyle("ZZX");
  assert.deepEqual(x1, x2);
  assert.equal(x1.rgb.length, 3);
  for (const c of x1.rgb) assert.ok(c >= 0 && c <= 255);
  // distinct unknown families should not share a hue (spot check)
  assert.notDeepEqual(familyStyle("ZZX").rgb, familyStyle("QQY").rgb);
});
