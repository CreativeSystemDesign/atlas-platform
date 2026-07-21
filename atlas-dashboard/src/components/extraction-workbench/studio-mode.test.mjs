import assert from "node:assert/strict";
import test from "node:test";

import { defaultToolForMode } from "./studio-mode.ts";

test("uses box authoring for root-drawing modes", () => {
  assert.equal(defaultToolForMode("component"), "box");
  assert.equal(defaultToolForMode("cable"), "box");
  assert.equal(defaultToolForMode("wire"), "select");
});
