"use client";

// Live bridge between the smart canvas and the embedded copilot (agent_server).
// State/events flow UP via throttled POSTs; commands flow DOWN via SSE and are
// executed through v2-bridge-executor. The hook owns the overlay state
// (highlights + toasts); everything screen-specific arrives via depsRef.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { executeBridgeCommand, type BridgeDeps } from "./v2-bridge-executor";
import {
  type BridgeCommand,
  type BridgeEvent,
  type BridgeHighlight,
  type BridgeToast,
} from "./v2-bridge-types";

const STATE_POST_THROTTLE_MS = 600;
const EVENT_FLUSH_MS = 200;
const TOAST_TTL_MS = 5000;
// Server pings every 15s; three missed beats means the stream is a zombie
// (tablet sleep, silent proxy drop) even though fetch POSTs still work.
const PING_DEADMAN_MS = 45_000;
// Idle heartbeat: the bridge's writer election judges liveness by posting
// recency, and a canvas Shane is merely READING posts nothing — without a
// beat, a healthy idle writer would "expire" and any duplicate could take
// the pin. Must stay well under the server's 90s liveness window.
const HEARTBEAT_MS = 25_000;
// "focused" for the election = window has OS focus AND a human touched it
// recently. Steady-state document.hasFocus() alone is true on BOTH an
// unattended desktop and a foreground tablet — the flip-flop, reintroduced.
const FOCUS_ATTENTION_MS = 15_000;
// One quick retry after a rejected snapshot post; the heartbeat re-posts
// after that for as long as the bridge keeps rejecting.
const RESEED_RETRY_MS = 5_000;

export type ScreenBridgeDeps = Omit<BridgeDeps, "addHighlight" | "clearHighlights" | "showToast">;

export function useV2LiveBridge(
  snapshot: Record<string, unknown>,
  depsRef: React.RefObject<ScreenBridgeDeps | null>,
  enabled: boolean = true
) {
  const [highlights, setHighlights] = useState<BridgeHighlight[]>([]);
  const [toasts, setToasts] = useState<BridgeToast[]>([]);
  const [connected, setConnected] = useState(false);

  const keyRef = useRef(1);
  const eventQueueRef = useRef<BridgeEvent[]>([]);
  const lastCommandIdRef = useRef(0);

  // Multi-canvas hardening (2026-07-12): every mount mints an identity and
  // stamps its POSTs and its SSE subscription with it. The bridge pins
  // snapshot writes to the elected writer (newest subscriber) so a duplicate
  // canvas can never flip-flop the copilot's page state — it gets a toast
  // telling Shane to close it instead.
  const canvasIdRef = useRef("");
  if (!canvasIdRef.current) {
    canvasIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `cv-${crypto.randomUUID().slice(0, 8)}`
        : `cv-${Math.random().toString(36).slice(2, 10)}`;
  }
  // Throttle for the up-channel-failure toast (post failures were silent for
  // days — the 64KiB keepalive quota class; never let that hide again).
  const lastPostFailToastRef = useRef(0);
  // Last human input on this window — pointer/key/wheel/focus-switch. Feeds
  // the election's `focused` claim.
  const lastInputTsRef = useRef(0);
  // True while the bridge is rejecting our snapshots (another canvas holds
  // the pin) or a post failed — the heartbeat re-posts the full snapshot
  // until one is accepted again.
  const needsReseedRef = useRef(false);
  const reseedTimerRef = useRef<number | undefined>(undefined);
  const lastFocusPostRef = useRef(0);

  // Flags are page-scoped truth (Shane, 2026-07-11: stale flags from the
  // previous page kept showing on the new page until the next audit). A page
  // flip wipes the flag layer immediately; the next audit repopulates it for
  // the page actually on screen. Copilot scratch highlights expire by TTL
  // and are left alone.
  const pageNow = snapshot?.page as number | undefined;
  const prevPageRef = useRef(pageNow);
  useEffect(() => {
    if (prevPageRef.current === pageNow) return;
    prevPageRef.current = pageNow;
    setHighlights((prev) => prev.filter((h) => h.kind !== "flag"));
  }, [pageNow]);

  const addHighlight = useCallback((h: Omit<BridgeHighlight, "key">) => {
    setHighlights((prev) => {
      const next = [...prev, { ...h, key: keyRef.current++ }];
      if (next.length <= 20) return next;
      // Cap the array, but NEVER evict audit flags: they're permanent (ttl_ms:0)
      // unresolved-defect markers and the server's sig-gate won't re-push an
      // evicted one. Drop the oldest NON-flag (copilot scratch) highlights first.
      let over = next.length - 20;
      return next.filter((x) => {
        if (over > 0 && x.kind !== "flag") { over--; return false; }
        return true;
      });
    });
  }, []);
  const removeHighlight = useCallback(
    (key: number) => setHighlights((prev) => prev.filter((h) => h.key !== key)),
    []
  );
  const clearHighlights = useCallback(
    (kind?: "flag") =>
      setHighlights((prev) =>
        kind === "flag"
          ? prev.filter((h) => h.kind !== "flag") // clear the audit flag layer
          : prev.filter((h) => h.kind === "flag") // bare clear = copilot's own scratch highlights; KEEP the flags
      ),
    []
  );
  const showToast = useCallback((message: string) => {
    const key = keyRef.current++;
    setToasts((prev) => [...prev.slice(-3), { key, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.key !== key)), TOAST_TTL_MS);
  }, []);

  // Prune expired highlights.
  useEffect(() => {
    if (highlights.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setHighlights((prev) => {
        const kept = prev.filter((h) => h.expiresAt === null || h.expiresAt > now);
        return kept.length === prev.length ? prev : kept;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [highlights.length]);

  // --- state up ------------------------------------------------------------

  const snapshotJson = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const snapshotJsonRef = useRef(snapshotJson);
  useEffect(() => {
    snapshotJsonRef.current = snapshotJson;
  }, [snapshotJson]);

  const postStateRef = useRef<((body: { snapshot?: unknown; events?: BridgeEvent[] }) => void) | null>(null);

  const scheduleReseedRetry = useCallback(() => {
    if (reseedTimerRef.current) return; // one pending retry max
    reseedTimerRef.current = window.setTimeout(() => {
      reseedTimerRef.current = undefined;
      if (!needsReseedRef.current) return;
      postStateRef.current?.({ snapshot: JSON.parse(snapshotJsonRef.current) });
    }, RESEED_RETRY_MS);
  }, []);

  const postState = useCallback(
    (body: { snapshot?: unknown; events?: BridgeEvent[] }) => {
      const hasSnapshot = body.snapshot !== undefined;
      const payload = JSON.stringify({
        canvas_id: canvasIdRef.current,
        // The election's focus claim: OS window focus AND recent human input.
        // Steady-state hasFocus() alone claims focus from an unattended
        // desktop forever — both surfaces would "win" and the pin flip-flops.
        focused:
          typeof document !== "undefined" &&
          document.hasFocus() &&
          Date.now() - lastInputTsRef.current < FOCUS_ATTENTION_MS,
        ...body,
      });
      const complain = (what: string) => {
        // A silent catch here is what hid the quota failures for days.
        console.warn(`[bridge] state post ${what}`);
        const now = Date.now();
        if (now - lastPostFailToastRef.current > 30_000) {
          lastPostFailToastRef.current = now;
          showToast("⚠ bridge state post failed — Arc may be seeing stale canvas state");
        }
      };
      // THE PAGE-13 DESYNC ROOT CAUSE (2026-07-12): the fetch spec makes any
      // keepalive request fail instantly once in-flight keepalive bodies
      // exceed 64KiB — and a full-graph snapshot alone crosses that line on a
      // dense page (page 13 measured ~71KB vs page 7 ~36KB). Result: page-7
      // snapshots posted fine, page-13 snapshots silently never left the
      // browser, and the bridge kept saying page 7. keepalive exists to let
      // posts survive unload, which only the small event flushes and
      // heartbeats need — snapshot posts NEVER get it (the quota pool is
      // shared, so even mid-size snapshots overlapping in flight would trip it).
      void fetch(`${agentBaseUrl()}/experimental-v2/bridge/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: !hasSnapshot,
      })
        .then(async (res) => {
          if (!res.ok) {
            // fetch only rejects on network failures — 4xx/5xx land here.
            complain(`rejected (HTTP ${res.status})`);
            if (hasSnapshot) {
              needsReseedRef.current = true;
              scheduleReseedRetry();
            }
            return;
          }
          if (!hasSnapshot) return;
          try {
            const j = await res.json();
            if (j?.snapshot_accepted === false) {
              // Another canvas holds the writer pin. Keep re-posting (quick
              // retry, then heartbeat cadence) so the moment the election
              // lets us in — focus, liveness expiry, writer gone — the bridge
              // has our page, not a stale one.
              needsReseedRef.current = true;
              scheduleReseedRetry();
            } else {
              needsReseedRef.current = false;
            }
          } catch {
            // body parse hiccup — nothing actionable
          }
        })
        .catch(() => {
          complain("failed (network)");
          if (hasSnapshot) {
            needsReseedRef.current = true;
            scheduleReseedRetry();
          }
        });
    },
    [showToast, scheduleReseedRetry]
  );
  useEffect(() => {
    postStateRef.current = postState;
  }, [postState]);

  // Idle heartbeat: tiny keepalive body (canvas_id + focused) that defends
  // the writer pin server-side; doubles as the re-post loop while our
  // snapshots are being rejected.
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (needsReseedRef.current) {
        postState({ snapshot: JSON.parse(snapshotJsonRef.current) });
      } else {
        postState({});
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [enabled, postState]);

  // Human-attention tracking + the election's takeover path: switching to
  // this window posts the full snapshot with focused=true immediately —
  // without this, `focused` was only ever sampled when the graph happened to
  // change, and a plain alt-tab never moved the pin.
  useEffect(() => {
    if (!enabled) return;
    const touch = () => {
      lastInputTsRef.current = Date.now();
    };
    const onFocus = () => {
      lastInputTsRef.current = Date.now();
      const now = Date.now();
      if (now - lastFocusPostRef.current < 500) return; // focus+visibility double-fire
      lastFocusPostRef.current = now;
      postState({ snapshot: JSON.parse(snapshotJsonRef.current) });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch, { passive: true });
    window.addEventListener("wheel", touch, { passive: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("wheel", touch);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (reseedTimerRef.current) window.clearTimeout(reseedTimerRef.current);
    };
  }, [enabled, postState]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      const events = eventQueueRef.current;
      eventQueueRef.current = [];
      postState({ snapshot: JSON.parse(snapshotJson), events });
    }, STATE_POST_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [snapshotJson, enabled, postState]);

  const reportEvent = useCallback(
    (event: BridgeEvent) => {
      if (!enabled) return;
      eventQueueRef.current.push(event);
      if (eventQueueRef.current.length === 1) {
        window.setTimeout(() => {
          if (eventQueueRef.current.length === 0) return;
          const events = eventQueueRef.current;
          eventQueueRef.current = [];
          postState({ events });
        }, EVENT_FLUSH_MS);
      }
    },
    [enabled, postState]
  );

  // --- commands down ----------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let closed = false;
    let retryTimer: number | undefined;
    let deadman: number | undefined;
    let lastBeat = Date.now();

    const reconnect = () => {
      source?.close();
      setConnected(false);
      connect();
    };

    // Any sign of life from the stream re-arms the deadman. If it expires the
    // connection died without an error event — resubscribe with our cursor and
    // let the server replay what we missed.
    const beat = () => {
      lastBeat = Date.now();
      if (deadman) window.clearTimeout(deadman);
      deadman = window.setTimeout(reconnect, PING_DEADMAN_MS);
    };

    const connect = () => {
      if (closed) return;
      source = new EventSource(
        `${agentBaseUrl()}/experimental-v2/bridge/commands/stream?last_seen_id=${lastCommandIdRef.current}&canvas_id=${canvasIdRef.current}`
      );
      source.onopen = () => {
        setConnected(true);
        beat();
        // Re-seed the bridge immediately: a restarted backend has an empty
        // in-memory bridge, and the throttled poster only fires on *changes*.
        postState({ snapshot: JSON.parse(snapshotJsonRef.current) });
      };
      source.addEventListener("ping", beat);
      source.onmessage = (msg) => {
        beat();
        let cmd: BridgeCommand;
        try {
          cmd = JSON.parse(msg.data);
        } catch {
          return;
        }
        const screen = depsRef.current;
        // Screen not mounted yet: leave the cursor alone so the command is NOT
        // consumed — the next reconnect replays it instead of dropping it.
        if (!screen) return;
        if (typeof cmd.id === "number") {
          if (cmd.id <= lastCommandIdRef.current) return; // replay dedupe
          lastCommandIdRef.current = cmd.id;
        }
        executeBridgeCommand(cmd, { ...screen, addHighlight, clearHighlights, showToast });
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (deadman) window.clearTimeout(deadman);
        // EventSource reconnects itself for transient errors, but a closed
        // stream (server restart) needs a manual retry with our cursor.
        if (!closed) retryTimer = window.setTimeout(connect, 2000);
      };
    };

    // Tablet thaw / network restored: frozen timers never fired, so check
    // staleness directly and force a fresh subscribe (replay covers the gap).
    const onWake = () => {
      if (closed || document.visibilityState !== "visible") return;
      if (Date.now() - lastBeat > PING_DEADMAN_MS / 1.5) reconnect();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    connect();
    return () => {
      closed = true;
      setConnected(false);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      if (retryTimer) window.clearTimeout(retryTimer);
      if (deadman) window.clearTimeout(deadman);
      source?.close();
    };
  }, [enabled, depsRef, addHighlight, clearHighlights, showToast, postState]);

  // addHighlight exposed since 2026-07-07: the issues drawer lights up the
  // element a card refers to — same overlay the copilot's highlights use.
  return { highlights, toasts, connected, reportEvent, showToast, addHighlight, removeHighlight };
}
