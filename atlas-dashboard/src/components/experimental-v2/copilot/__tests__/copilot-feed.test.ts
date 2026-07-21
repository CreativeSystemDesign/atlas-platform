// Feed reducer contract (full-SDK panel, 2026-07-07): tool call↔result
// pairing, subagent tags, task lifecycle across BOTH terminal vocabularies,
// rate-limit clear-on-allowed, queue mirroring, fresh-session wipe.
import { describe, expect, it } from "vitest";

import { EMPTY_FEED, activeTasks, applyEvent, seedHistory } from "../copilot-feed";
import type { Feed } from "../copilot-types";

function run(events: Record<string, unknown>[], from: Feed = EMPTY_FEED): Feed {
  return events.reduce<Feed>((f, e) => applyEvent(f, e), from);
}

describe("tool pairing", () => {
  it("attaches a result to its call by tool_use_id", () => {
    const feed = run([
      { kind: "tool_use", id: "tu-1", tool: "mcp__canvas__audit_page", input: {} },
      { kind: "tool_use", id: "tu-2", tool: "Read", input: { file: "x" } },
      { kind: "tool_result", tool_use_id: "tu-1", preview: "0 ERR / 2 WARN", is_error: false },
    ]);
    const tools = feed.items.filter((i) => i.kind === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ id: "tu-1", result: { preview: "0 ERR / 2 WARN", isError: false } });
    expect(tools[1].kind === "tool" && tools[1].result).toBeFalsy();
  });

  it("orphan results become standalone rows, never lost", () => {
    const feed = run([{ kind: "tool_result", tool_use_id: "gone", preview: "late" }]);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ kind: "tool", tool: "(result)" });
  });

  it("carries subagent parent ids and server-tool flags", () => {
    const feed = run([
      { kind: "tool_use", id: "t", tool: "web_search", server_tool: true, parent_tool_use_id: "task-1" },
      { kind: "assistant_text", text: "hi", model: "claude-sonnet-5", parent_tool_use_id: "task-1" },
    ]);
    expect(feed.items[0]).toMatchObject({ kind: "tool", server: true, parent: "task-1" });
    expect(feed.items[1]).toMatchObject({ kind: "assistant_text", model: "claude-sonnet-5", parent: "task-1" });
  });
});

describe("tasks", () => {
  it("tracks lifecycle and clears on either terminal vocabulary", () => {
    let feed = run([
      { kind: "task", event: "started", task_id: "t1", description: "verify wiring" },
      { kind: "task", event: "progress", task_id: "t1", usage: { total_tokens: 500 }, last_tool: "Grep" },
    ]);
    expect(activeTasks(feed)).toHaveLength(1);
    expect(feed.tasks["t1"].lastTool).toBe("Grep");
    // terminal via task_updated's raw vocabulary ("killed")
    feed = applyEvent(feed, { kind: "task", event: "updated", task_id: "t1", status: "killed" });
    expect(activeTasks(feed)).toHaveLength(0);
    // notification-style terminal on another task
    feed = run([
      { kind: "task", event: "started", task_id: "t2", description: "x" },
      { kind: "task", event: "notification", task_id: "t2", status: "completed", summary: "done" },
    ], feed);
    expect(activeTasks(feed)).toHaveLength(0);
    // started + notification produce feed rows; progress does not
    expect(feed.items.filter((i) => i.kind === "task_note")).toHaveLength(3);
  });
});

describe("telemetry", () => {
  it("rate limit shows on warning and clears on allowed", () => {
    let feed = applyEvent(EMPTY_FEED, {
      kind: "rate_limit", status: "allowed_warning", resets_at: 99, utilization: 0.9,
    });
    expect(feed.rateLimit?.status).toBe("allowed_warning");
    feed = applyEvent(feed, { kind: "rate_limit", status: "allowed" });
    expect(feed.rateLimit).toBeNull();
  });

  it("context meter keeps categories across partial updates", () => {
    let feed = applyEvent(EMPTY_FEED, {
      kind: "context", total: 1000, max: 10_000, pct: 10,
      categories: [{ name: "System prompt", tokens: 400 }],
    });
    feed = applyEvent(feed, { kind: "context", total: 2000, max: 10_000, pct: 20 });
    expect(feed.context?.total).toBe(2000);
    expect(feed.context?.categories?.[0]?.name).toBe("System prompt");
  });

  it("result rows surface error forensics and update cost", () => {
    const feed = applyEvent(EMPTY_FEED, {
      kind: "result", ok: false, subtype: "success", cost_usd: 2.5,
      usage: { output_tokens: 10 }, stop_reason: "max_tokens",
      errors: ["boom"], api_error_status: 529,
    });
    expect(feed.totalCost).toBe(2.5);
    expect(feed.items[0]).toMatchObject({
      kind: "result", ok: false, stopReason: "max_tokens", apiErrorStatus: 529,
    });
  });
});

describe("session plumbing", () => {
  it("queue mirrors server events and the state snapshot", () => {
    let feed = applyEvent(EMPTY_FEED, { kind: "queue", items: [{ text: "later", images: 1 }] });
    expect(feed.queue).toEqual([{ text: "later", images: 1 }]);
    feed = applyEvent(feed, { kind: "state", session_id: "s", settings: EMPTY_FEED.settings, queue: [] });
    expect(feed.queue).toEqual([]);
  });

  it("a null session wipes the transcript (fresh session)", () => {
    let feed = run([{ kind: "assistant_text", text: "old" }]);
    feed = applyEvent(feed, { kind: "session", session_id: null });
    expect(feed.items).toHaveLength(0);
  });

  it("history seeds only an empty transcript and pairs replayed results", () => {
    const rows = [
      { kind: "tool_use", id: "tu-1", tool: "capture", input: {} },
      { kind: "tool_result", tool_use_id: "tu-1", preview: "scene packet" },
    ];
    const seeded = seedHistory(EMPTY_FEED, rows);
    expect(seeded.items).toHaveLength(1);
    expect(seeded.items[0]).toMatchObject({ kind: "tool", result: { preview: "scene packet" } });
    const live = run([{ kind: "user", text: "already here" }]);
    expect(seedHistory(live, rows).items).toHaveLength(1); // untouched
  });

  it("approval requests dedupe by id", () => {
    const feed = run([
      { kind: "approval_request", id: "a1", tool: "Bash", input: {} },
      { kind: "approval_request", id: "a1", tool: "Bash", input: {} },
    ]);
    expect(feed.approvals).toHaveLength(1);
  });
});
