// Run: node --experimental-strip-types --test net-class.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { classifyNet, terminalNet, terminalPin, NET_ROLE_RGB, NET_ROLE_LABEL } from "./net-class.ts";

test("phase: AC phase legs", () => {
  for (const label of ["R502", "S502", "T1", "U2", "V2", "W2", "L1", "L2", "L3"]) {
    assert.equal(classifyNet(label), "phase", label);
  }
  // component-shaped labels must NOT read as phase (digit must follow the letter)
  assert.equal(classifyNet("LB11"), "control");
});

test("dc-rail: control-power rails", () => {
  for (const label of ["P24", "N24"]) {
    assert.equal(classifyNet(label), "dc-rail", label);
  }
  assert.equal(classifyNet("24V"), "dc-rail");
  assert.equal(classifyNet("+24V"), "dc-rail");
});

test("earth: exact labels", () => {
  for (const label of ["PE", "E", "G", "GND", "FG"]) {
    assert.equal(classifyNet(label), "earth", label);
  }
});

test("control: everything else", () => {
  for (const label of ["PLS24", "X2315", "210", "FU40", "MC7"]) {
    assert.equal(classifyNet(label), "control", label);
  }
});

test("unlabeled: empty / whitespace / nullish", () => {
  for (const label of ["", "  ", null, undefined]) {
    assert.equal(classifyNet(label), "unlabeled", String(label));
  }
});

test("classifyNet trims and uppercases", () => {
  assert.equal(classifyNet(" r502 "), "phase");
  assert.equal(classifyNet("pe"), "earth");
});

test("terminalNet extracts the last ~-segment", () => {
  assert.equal(terminalNet("T~F12~R1"), "R1");
  assert.equal(terminalNet("T~T52~T507"), "T507");
  assert.equal(terminalNet("T~MC7~13~PLS24"), "PLS24");
});

test("terminalNet returns null for non-terminal labels", () => {
  assert.equal(terminalNet("MC7"), null);
  assert.equal(terminalNet(null), null);
  assert.equal(terminalNet(undefined), null);
});

test("terminalNet composes with classifyNet", () => {
  assert.equal(classifyNet(terminalNet("T~F12~R1")), "phase");
});

test("terminalPin: printed pin only in the 4-segment form", () => {
  assert.equal(terminalPin("T~MC7~13~PLS24"), "13");
  assert.equal(terminalPin("T~CON23~A1~X10"), "A1");
  assert.equal(terminalPin("T~F12~R1"), null);
  assert.equal(terminalPin("T~T52~T507"), null);
  assert.equal(terminalPin("MC7"), null);
  assert.equal(terminalPin(null), null);
});

test("palette and legend cover every role", () => {
  const roles = ["phase", "dc-rail", "earth", "control", "unlabeled"];
  for (const role of roles) {
    const rgb = NET_ROLE_RGB[role];
    assert.ok(Array.isArray(rgb) && rgb.length === 3, role);
    assert.equal(typeof NET_ROLE_LABEL[role], "string", role);
  }
  assert.deepEqual(NET_ROLE_RGB.phase, [251, 191, 36]);
  assert.deepEqual(NET_ROLE_RGB["dc-rail"], [56, 189, 248]);
  assert.deepEqual(NET_ROLE_RGB.earth, [74, 222, 128]);
  assert.deepEqual(NET_ROLE_RGB.control, [129, 140, 248]);
  assert.deepEqual(NET_ROLE_RGB.unlabeled, [100, 116, 139]);
  assert.equal(NET_ROLE_LABEL.phase, "AC phase");
  assert.equal(NET_ROLE_LABEL["dc-rail"], "DC rail");
  assert.equal(NET_ROLE_LABEL.earth, "Earth");
  assert.equal(NET_ROLE_LABEL.control, "Control");
  assert.equal(NET_ROLE_LABEL.unlabeled, "Unlabeled");
});
