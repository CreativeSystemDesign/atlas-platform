// Pure event → transcript reducer for the copilot panel (full-SDK, 2026-07-07).
// Every WS payload flows through applyEvent; React state is Feed. Pure module
// (no React) so the pairing/task/queue logic is unit-testable with vitest.

import {
  EMPTY_FEED,
  type ApprovalRequest,
  type Feed,
  type FeedItem,
  type TaskInfo,
} from "./copilot-types";

const MAX_ITEMS = 400;

const TERMINAL_TASK = new Set(["completed", "failed", "stopped", "killed"]);

type Ev = Record<string, unknown>;

const s = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function push(feed: Feed, item: FeedItem): Feed {
  const stamped = item.ts === undefined ? { ...item, ts: Date.now() } : item;
  return { ...feed, items: [...feed.items.slice(-(MAX_ITEMS - 1)), stamped] };
}

// Attach a tool result to its call (search from the end — recency wins).
function attachToolResult(feed: Feed, ev: Ev): Feed {
  const result = {
    preview: s(ev.preview),
    previewPath: s(ev.preview_path),
    isError: Boolean(ev.is_error),
    images: n(ev.images),
  };
  const items = [...feed.items];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "tool" && it.id && it.id === ev.tool_use_id && !it.result) {
      items[i] = { ...it, result };
      return { ...feed, items };
    }
  }
  // Orphan result (call predates the panel's history window) — standalone row.
  return push(feed, { kind: "tool", tool: "(result)", id: s(ev.tool_use_id), result });
}

function applyTask(feed: Feed, ev: Ev): Feed {
  const taskId = s(ev.task_id) ?? "?";
  const prior: TaskInfo = feed.tasks[taskId] ?? { taskId, terminal: false };
  const status = s(ev.status);
  const next: TaskInfo = {
    ...prior,
    description: s(ev.description) ?? prior.description,
    status: status ?? prior.status,
    lastTool: s(ev.last_tool) ?? prior.lastTool,
    summary: s(ev.summary) ?? prior.summary,
    usage: (ev.usage as TaskInfo["usage"]) ?? prior.usage,
    terminal: prior.terminal || (status !== undefined && TERMINAL_TASK.has(status)),
  };
  let out: Feed = { ...feed, tasks: { ...feed.tasks, [taskId]: next } };
  // Feed rows only for the loud moments; progress just updates the strip.
  if (ev.event === "started" || ev.event === "notification") {
    out = push(out, {
      kind: "task_note",
      taskId,
      status: next.status,
      summary: next.summary,
      description: next.description,
    });
  }
  return out;
}

export function applyEvent(feed: Feed, ev: Ev): Feed {
  switch (ev.kind) {
    case "state": {
      const out: Feed = { ...feed };
      if (ev.settings) out.settings = ev.settings as Feed["settings"];
      out.sessionId = (s(ev.session_id) ?? null) as string | null;
      if (typeof ev.total_cost_usd === "number") out.totalCost = ev.total_cost_usd;
      if (ev.last_usage) out.lastUsage = ev.last_usage as Feed["lastUsage"];
      if (Array.isArray(ev.queue)) out.queue = ev.queue as Feed["queue"];
      if (ev.last_context && typeof ev.last_context === "object") {
        out.context = { ...(out.context ?? {}), ...(ev.last_context as object) } as Feed["context"];
      }
      return out;
    }
    case "settings":
      return { ...feed, settings: { ...feed.settings, ...(ev as object) } as Feed["settings"] };
    case "session": {
      const sid = (s(ev.session_id) ?? null) as string | null;
      const out: Feed = { ...feed, sessionId: sid };
      if (ev.settings) out.settings = ev.settings as Feed["settings"];
      if (sid === null) {
        // fresh session: server cleared its history; mirror it
        return { ...out, items: [], totalCost: null, lastUsage: null, tasks: {}, context: null };
      }
      return out;
    }
    case "init_info":
      return {
        ...feed,
        initInfo: {
          model: s(ev.model) ?? null,
          permissionMode: s(ev.permissionMode) ?? null,
          tools: (ev.tools as string[]) ?? [],
          slash_commands: (ev.slash_commands as string[]) ?? [],
        },
      };
    case "user":
      return push({ ...feed, streamText: "", thinkStream: "" }, {
        kind: "user", text: String(ev.text ?? ""), source: s(ev.source), images: n(ev.images),
      });
    case "assistant_delta":
      return { ...feed, streamText: feed.streamText + String(ev.text ?? "") };
    case "thinking_delta":
      return { ...feed, thinkStream: feed.thinkStream + String(ev.text ?? "") };
    case "assistant_text":
      return push({ ...feed, streamText: "", thinkStream: "" }, {
        kind: "assistant_text", text: String(ev.text ?? ""),
        model: s(ev.model), parent: s(ev.parent_tool_use_id),
      });
    case "thinking":
      return push({ ...feed, thinkStream: "" }, {
        kind: "thinking", text: String(ev.text ?? ""), parent: s(ev.parent_tool_use_id),
      });
    case "tool_use":
      return push({ ...feed, streamText: "" }, {
        kind: "tool", id: s(ev.id), tool: String(ev.tool ?? "?"),
        input: ev.input, inputPath: s(ev.input_path),
        server: Boolean(ev.server_tool), parent: s(ev.parent_tool_use_id),
      });
    case "tool_result":
      return attachToolResult(feed, ev);
    case "tool_image":
      return push(feed, {
        kind: "tool_image", tool: String(ev.tool ?? "?"),
        label: String(ev.label ?? ""), b64: s(ev.b64),
      });
    case "task":
      return applyTask(feed, ev);
    case "rate_limit": {
      const status = s(ev.status);
      if (status === "allowed") return { ...feed, rateLimit: null };
      return {
        ...feed,
        rateLimit: {
          status: (status ?? "allowed_warning") as NonNullable<Feed["rateLimit"]>["status"],
          rate_limit_type: s(ev.rate_limit_type) ?? null,
          resets_at: n(ev.resets_at) ?? null,
          utilization: n(ev.utilization) ?? null,
          overage_status: s(ev.overage_status) ?? null,
        },
      };
    }
    case "system_event":
      return push(feed, { kind: "system_event", subtype: String(ev.subtype ?? "?") });
    case "context":
      return {
        ...feed,
        context: {
          total: n(ev.total) ?? 0,
          max: n(ev.max) ?? 0,
          pct: n(ev.pct) ?? 0,
          categories: (ev.categories as NonNullable<Feed["context"]>["categories"]) ?? feed.context?.categories,
          raw_max: n(ev.raw_max) ?? feed.context?.raw_max,
        },
      };
    case "queue":
      return { ...feed, queue: (ev.items as Feed["queue"]) ?? [] };
    case "result": {
      const cost = typeof ev.cost_usd === "number" ? ev.cost_usd : null;
      const out = push({ ...feed, streamText: "", thinkStream: "" }, {
        kind: "result",
        ok: Boolean(ev.ok),
        subtype: String(ev.subtype ?? ""),
        costUsd: cost,
        usage: (ev.usage as Feed["lastUsage"]) ?? null,
        stopReason: s(ev.stop_reason) ?? null,
        durationApiMs: n(ev.duration_api_ms) ?? null,
        modelUsage: ev.model_usage,
        permissionDenials: n(ev.permission_denials),
        errors: (ev.errors as string[]) ?? undefined,
        apiErrorStatus: n(ev.api_error_status),
      });
      if (cost !== null) out.totalCost = cost;
      if (ev.usage) out.lastUsage = ev.usage as Feed["lastUsage"];
      return { ...out, state: "ready" };
    }
    case "error":
      return push(feed, {
        kind: "error", message: String(ev.message ?? ""), code: s(ev.code),
      });
    case "status": {
      const st = String(ev.state ?? "");
      const note = s(ev.note) ?? null;
      const state: Feed["state"] =
        st === "working" || st === "busy" || st === "reconnecting" ? "working" : "ready";
      return { ...feed, state, statusNote: note };
    }
    case "approval_request": {
      const req = ev as unknown as ApprovalRequest;
      if (feed.approvals.some((a) => a.id === req.id)) return feed;
      return { ...feed, approvals: [...feed.approvals, req] };
    }
    default:
      return feed; // ingress + unknown future kinds: ignore, never crash
  }
}

export function removeApproval(feed: Feed, id: string): Feed {
  return { ...feed, approvals: feed.approvals.filter((a) => a.id !== id) };
}

// History replay on (re)connect: server rows share the live wire shapes.
// Only seed an empty transcript — a live panel already has everything.
export function seedHistory(feed: Feed, rows: Ev[]): Feed {
  if (feed.items.length > 0) return feed;
  let out = feed;
  for (const row of rows) out = applyEvent(out, row);
  // history replay must not leave stale stream buffers
  return { ...out, streamText: "", thinkStream: "" };
}

export function activeTasks(feed: Feed): TaskInfo[] {
  return Object.values(feed.tasks).filter((t) => !t.terminal);
}

export { EMPTY_FEED };
