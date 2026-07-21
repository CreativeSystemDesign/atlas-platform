import assert from "node:assert/strict";
import test from "node:test";
import { executeBridgeCommand } from "./v2-bridge-executor.ts";

function mockDeps() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    deps: {
      setPage: record("setPage"),
      setTool: record("setTool"),
      setZoom: record("setZoom"),
      centerOn: record("centerOn"),
      setNetColorMode: record("setNetColorMode"),
      select: record("select"),
      addHighlight: record("addHighlight"),
      clearHighlights: record("clearHighlights"),
      clearAskMarks: record("clearAskMarks"),
      applyOps: record("applyOps"),
      showToast: record("showToast"),
    },
  };
}

test("highlight command adds a highlight with default color and ttl", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "highlight", id: 1, net_id: 3 }, deps);
  assert.equal(calls.length, 1);
  const [, h] = calls[0];
  assert.equal(h.netId, 3);
  assert.ok(h.color);
  assert.ok(h.expiresAt > Date.now());
});

test("highlight with ttl_ms 0 never expires", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "highlight", id: 2, point: { x: 1, y: 2 }, ttl_ms: 0 }, deps);
  assert.equal(calls[0][1].expiresAt, null);
});

test("view command dispatches only provided fields", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "view", id: 3, page: 8, net_color_mode: true }, deps);
  assert.deepEqual(
    calls.map((c) => c[0]).sort(),
    ["setNetColorMode", "setPage"]
  );
});

test("view center takes precedence over bare zoom and passes zoom through", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "view", id: 4, center: { x: 10, y: 20 }, zoom: 2 }, deps);
  assert.deepEqual(calls, [["centerOn", { x: 10, y: 20 }, 2]]);
});

test("view select_id null clears the selection", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "view", id: 5, select_id: null }, deps);
  assert.deepEqual(calls, [["select", null]]);
});

test("annotate forwards ops, reason, and command meta for the apply-receipt", () => {
  const { calls, deps } = mockDeps();
  const ops = [{ op: "rename", id: "x", label: "F11" }];
  executeBridgeCommand({ type: "annotate", id: 6, ops, reason: "fix label", idempotency_key: "k1" }, deps);
  assert.deepEqual(calls, [["applyOps", ops, "fix label", { commandId: 6, idempotencyKey: "k1" }]]);
});

test("annotate page stamp rides the meta; unstamped commands stay stamp-free", () => {
  const { calls, deps } = mockDeps();
  const ops = [{ op: "add_terminal", point: { x: 1, y: 2 }, label: "T~1~R401" }];
  executeBridgeCommand({ type: "annotate", id: 12, ops, idempotency_key: "k2", page: 10 }, deps);
  assert.deepEqual(calls, [["applyOps", ops, undefined, { commandId: 12, idempotencyKey: "k2", page: 10 }]]);
  // legacy/unstamped: no page key at all, so the screen's mismatch check is inert
  executeBridgeCommand({ type: "annotate", id: 13, ops, idempotency_key: "k3" }, deps);
  assert.equal("page" in calls[1][3], false);
});

test("toast and clear_highlights dispatch; unknown types are ignored", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "toast", id: 7, message: "hi" }, deps);
  executeBridgeCommand({ type: "clear_highlights", id: 8 }, deps);
  executeBridgeCommand({ type: "mystery", id: 9 }, deps);
  assert.deepEqual(calls.map((c) => c[0]), ["showToast", "clearHighlights"]);
});

test("clear_ask_marks clears all when no marks given", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "clear_ask_marks", id: 10 }, deps);
  assert.deepEqual(calls, [["clearAskMarks", undefined]]);
});

test("clear_ask_marks passes specific mark numbers through", () => {
  const { calls, deps } = mockDeps();
  executeBridgeCommand({ type: "clear_ask_marks", id: 11, marks: [2, 5] }, deps);
  assert.deepEqual(calls, [["clearAskMarks", [2, 5]]]);
});
