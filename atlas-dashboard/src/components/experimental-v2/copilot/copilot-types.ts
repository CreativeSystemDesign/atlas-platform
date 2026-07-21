// Copilot panel wire types — protocol v2 (full-SDK panel, 2026-07-07).
// Mirrors agent_server/src/routes/experimental_v2_copilot.py's docstring and
// CopilotSession._relay/_broadcast. One file = one source of truth client-side.

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  num_turns?: number | null;
  duration_ms?: number | null;
  model?: string | null;
};

export type CopilotSettings = {
  model: string | null;
  effort: string | null;
  show_thinking: boolean;
  thinking: string | null;
  // The one mode axis (2026-07-08): false = Collaborative (turn-by-turn),
  // true = Autonomous (chains to completion). The redundant "collaborative"
  // flag was retired — autonomous-off already IS turn-by-turn.
  autonomous: boolean;
  guided?: boolean;
  fast_mode?: boolean;
  // Full-SDK: switchable live; null = server default (acceptEdits).
  permission_mode?: string | null;
};

export type PermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
export const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "acceptEdits", label: "accept edits", hint: "Default trust tier: graph + file edits auto-approved; dangerous Bash still asks" },
  { value: "plan", label: "plan", hint: "Observe-only: the copilot may read and plan but tool execution is gated" },
  { value: "default", label: "default", hint: "Standard Claude Code prompting: edits ask too" },
  { value: "dontAsk", label: "don't ask", hint: "Deny anything not pre-approved instead of prompting" },
  { value: "bypassPermissions", label: "bypass", hint: "No permission checks at all — use with care" },
];

// A CLI-suggested persistent permission rule (display form of PermissionUpdate).
export type PermissionSuggestion = {
  type: string;
  behavior?: string;
  rules?: { toolName: string; ruleContent?: string | null }[];
  destination?: string;
};

export type ApprovalRequest = {
  id: string;
  tool: string;
  input: unknown;
  title?: string;
  display_name?: string;
  description?: string;
  decision_reason?: string;
  blocked_path?: string;
  tool_use_id?: string;
  agent_id?: string;
  suggestions?: PermissionSuggestion[];
};

export type ApprovalAnswer = {
  id: string;
  allow: boolean;
  message?: string;
  always_allow?: boolean;
  updated_input?: Record<string, unknown>;
  interrupt?: boolean;
};

export type ToolResultInfo = {
  preview?: string;
  previewPath?: string;
  isError?: boolean;
  images?: number;
};

export type TaskInfo = {
  taskId: string;
  description?: string;
  status?: string; // pending/running/paused/completed/failed/stopped/killed
  lastTool?: string;
  summary?: string;
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number } | null;
  terminal: boolean;
};

export type ContextInfo = {
  total: number;
  max: number;
  pct: number;
  categories?: { name: string; tokens: number; color?: string }[];
  raw_max?: number;
};

export type RateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected";
  rate_limit_type?: string | null;
  resets_at?: number | null;
  utilization?: number | null;
  overage_status?: string | null;
};

export type InitInfo = {
  model?: string | null;
  permissionMode?: string | null;
  tools?: string[];
  slash_commands?: string[];
};

export type QueueItem = { text: string; images?: number };

// A Table card (Shane's design 2026-07-08): an issue the copilot genuinely
// could not resolve with its own resources, parked as a yes/no question with a
// crop for Shane's verdict. The copilot resolves everything else itself.
export type IssueItem = {
  rule: string;
  element_id: string;
  state: "awaiting-shane" | "shane-answered";
  question?: string;
  element_label?: string;
  page?: number | null;
  yes_means?: string;
  no_means?: string;
  has_crop?: boolean;
  // True when the element exists in NO saved graph (wiped experiment legs) —
  // locate can't work; the card says so and the answer flow is the exit.
  orphan?: boolean;
  // "custom" = Shane's "Something Else" (2026-07-09): neither offered path
  // matched — his typed note IS the ruling.
  answer?: { answer: "yes" | "no" | "custom"; note?: string };
  ts?: number;
};

export type ResultInfo = {
  ok: boolean;
  subtype: string;
  costUsd: number | null;
  usage: Usage | null;
  stopReason?: string | null;
  durationApiMs?: number | null;
  modelUsage?: unknown;
  permissionDenials?: number;
  errors?: string[];
  apiErrorStatus?: number;
};

// --- The rendered transcript model -------------------------------------------

// Every item is stamped at arrival (client clock) so rows can show a subtle
// time affordance; optional — replayed history rows may lack it.
export type FeedStamp = { ts?: number };

export type FeedItem = FeedStamp &
  (
  | { kind: "user"; text: string; source?: string; images?: number }
  | { kind: "assistant_text"; text: string; model?: string; parent?: string }
  | { kind: "thinking"; text: string; parent?: string }
  | {
      kind: "tool";
      id?: string;
      tool: string;
      input?: unknown;
      inputPath?: string;
      server?: boolean;
      parent?: string;
      result?: ToolResultInfo;
    }
  | { kind: "tool_image"; tool: string; label: string; b64?: string }
  | { kind: "task_note"; taskId: string; status?: string; summary?: string; description?: string }
    | { kind: "system_event"; subtype: string }
    | ({ kind: "result" } & ResultInfo)
    | { kind: "error"; message: string; code?: string }
  );

export type CopilotState = "connecting" | "ready" | "working" | "disconnected";

export type Feed = {
  items: FeedItem[];
  approvals: ApprovalRequest[];
  queue: QueueItem[];
  issues: IssueItem[];
  tasks: Record<string, TaskInfo>;
  context: ContextInfo | null;
  rateLimit: RateLimitInfo | null;
  initInfo: InitInfo | null;
  settings: CopilotSettings;
  sessionId: string | null;
  totalCost: number | null;
  lastUsage: Usage | null;
  state: CopilotState;
  streamText: string;
  thinkStream: string;
  statusNote: string | null;
};

export const EMPTY_FEED: Feed = {
  items: [],
  approvals: [],
  queue: [],
  issues: [],
  tasks: {},
  context: null,
  rateLimit: null,
  initInfo: null,
  settings: { model: null, effort: null, show_thinking: false, thinking: null, autonomous: false },
  sessionId: null,
  totalCost: null,
  lastUsage: null,
  state: "connecting",
  streamText: "",
  thinkStream: "",
  statusNote: null,
};
