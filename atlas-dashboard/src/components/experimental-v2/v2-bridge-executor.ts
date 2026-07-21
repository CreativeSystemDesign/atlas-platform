// Execute an agent command against the canvas. Pure dispatch: everything the
// command can touch is injected via BridgeDeps, so this module is trivially
// unit-testable (see v2-bridge-executor.test.mjs) and the screen stays thin.

import type {
  AnnotateOp,
  BridgeCommand,
  BridgeHighlight,
  Point,
} from "./v2-bridge-types";

export type BridgeDeps = {
  setPage: (page: number) => void;
  setTool: (tool: string) => void;
  setZoom: (zoom: number) => void;
  centerOn: (point: Point, zoom?: number) => void;
  setNetColorMode: (enabled: boolean) => void;
  select: (id: string | null) => void;
  addHighlight: (h: Omit<BridgeHighlight, "key">) => void;
  // kind scopes the clear to one layer (e.g. "flag" wipes only audit flags,
  // leaving net-color highlights intact); omit to clear every highlight.
  clearHighlights: (kind?: "flag") => void;
  clearAskMarks: (marks?: number[]) => void;
  // meta identifies the originating bridge command so the screen can send an
  // apply-receipt back up (and dedupe server-side resends by idempotency key).
  // meta.page is the command's authored-for page stamp: the screen refuses a
  // stamped batch whose page differs from the one on screen (replay-after-flip).
  applyOps: (
    ops: AnnotateOp[],
    reason?: string | null,
    meta?: { commandId: number; idempotencyKey?: string; page?: number }
  ) => void;
  showToast: (message: string) => void;
};

const DEFAULT_HIGHLIGHT_TTL_MS = 6000;
const DEFAULT_HIGHLIGHT_COLOR = "#f59e0b"; // amber — distinct from net-mode hues

export function executeBridgeCommand(cmd: BridgeCommand, deps: BridgeDeps): void {
  switch (cmd.type) {
    case "highlight": {
      const ttl = cmd.ttl_ms ?? DEFAULT_HIGHLIGHT_TTL_MS;
      deps.addHighlight({
        netId: cmd.net_id,
        segments: cmd.segments,
        elementId: cmd.element_id,
        point: cmd.point,
        color: cmd.color ?? DEFAULT_HIGHLIGHT_COLOR,
        note: cmd.note,
        // ttl_ms:0 → never expires (flag layer: audit flags live until the audit
        // clears/replaces them, not until a 10-min timer kills them mid-review).
        expiresAt: ttl > 0 ? Date.now() + ttl : null,
        kind: cmd.kind,
        rule: cmd.rule,
        severity: cmd.severity,
      });
      break;
    }
    case "clear_highlights":
      deps.clearHighlights(cmd.kind);
      break;
    case "clear_ask_marks":
      deps.clearAskMarks(cmd.marks);
      break;
    case "view": {
      if (typeof cmd.page === "number") deps.setPage(cmd.page);
      if (typeof cmd.tool === "string") deps.setTool(cmd.tool);
      if (cmd.center) deps.centerOn(cmd.center, cmd.zoom);
      else if (typeof cmd.zoom === "number") deps.setZoom(cmd.zoom);
      if (typeof cmd.net_color_mode === "boolean") deps.setNetColorMode(cmd.net_color_mode);
      if ("select_id" in cmd && cmd.select_id !== undefined) deps.select(cmd.select_id);
      break;
    }
    case "annotate":
      deps.applyOps(cmd.ops ?? [], cmd.reason, {
        commandId: cmd.id,
        idempotencyKey: cmd.idempotency_key,
        // Unstamped commands (older server) carry no page key at all, so the
        // screen's mismatch check stays inert for them.
        ...(cmd.page !== undefined ? { page: cmd.page } : {}),
      });
      break;
    case "toast":
      deps.showToast(cmd.message);
      break;
    default:
      // Unknown command types are ignored — forward compatibility with newer tools.
      break;
  }
}
