"use client";

// Copilot WS lifecycle (full-SDK panel): reconnecting socket, feed reducer
// dispatch, and the complete send surface (messages+images, rich approval
// answers, live permission mode, task stop, queue cancel).

import { useCallback, useEffect, useRef, useState } from "react";
import { agentBaseUrl } from "@/lib/agent-base-url";
import { agentWsUrl } from "@/lib/agent-ws-url";
import { applyEvent, removeApproval, seedHistory, EMPTY_FEED } from "./copilot-feed";
import type { ApprovalAnswer, CopilotSettings, Feed, IssueItem } from "./copilot-types";

export type ComposerImage = { media_type: string; data: string };

// A seat names which bench this panel speaks from (canvas panels pass none);
// context() is sampled at send time so every message carries live state.
export type CopilotSeat = {
  area: string;
  context: () => Record<string, unknown>;
  /** Server->bench commands (Arc driving the viewer): goto_page, mark,
      region, clear_marks, toast. Panels without a bench simply omit this. */
  onCommand?: (cmd: Record<string, unknown>) => void;
};

async function fetchIssues(page: number): Promise<IssueItem[] | null> {
  const res = await fetch(`${agentBaseUrl()}/experimental-v2/copilot/issues?page=${page}`);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.items) ? (data.items as IssueItem[]) : [];
}

export function useCopilotWs(open: boolean, currentPage?: number, seat?: CopilotSeat) {
  const [feed, setFeed] = useState<Feed>(EMPTY_FEED);
  const wsRef = useRef<WebSocket | null>(null);
  // Ref-synced page so the long-lived WS closure sees the live value without
  // re-subscribing on every page flip.
  const pageRef = useRef<number | undefined>(currentPage);
  useEffect(() => {
    pageRef.current = currentPage;
  }, [currentPage]);
  const seatRef = useRef<CopilotSeat | undefined>(seat);
  useEffect(() => {
    seatRef.current = seat;
  }, [seat]);

  // Issues are page-scoped and served over HTTP (crops stay off the WS);
  // WS "issues" events act as the refresh signal.
  const refreshIssues = useCallback(() => {
    const page = pageRef.current;
    if (page === undefined) return;
    fetchIssues(page)
      .then((items) => {
        if (items) setFeed((f) => ({ ...f, issues: items }));
      })
      .catch(() => { /* offline — the panel keeps its last list */ });
  }, []);

  useEffect(() => {
    if (!open || currentPage === undefined) return;
    let cancelled = false;
    fetchIssues(currentPage)
      .then((items) => {
        if (!cancelled && items) setFeed((f) => ({ ...f, issues: items }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, currentPage]);

  useEffect(() => {
    if (!open) return;
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      if (closed) return;
      setFeed((f) => ({ ...f, state: "connecting" }));
      const ws = new WebSocket(agentWsUrl("/experimental-v2/copilot/ws"));
      wsRef.current = ws;
      ws.onopen = () => {
        setFeed((f) => ({ ...f, state: "ready" }));
        refreshIssues(); // reconnect = server may have restarted; re-sync the drawer
      };
      ws.onclose = () => {
        setFeed((f) => ({ ...f, state: "disconnected" }));
        if (!closed) retry = window.setTimeout(connect, 2500);
      };
      ws.onmessage = (raw) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.data as string);
        } catch {
          return;
        }
        if (msg.kind === "history") {
          const rows = Array.isArray(msg.messages) ? (msg.messages as Record<string, unknown>[]) : [];
          setFeed((f) => seedHistory(f, rows));
          return;
        }
        if (msg.kind === "issues") {
          void refreshIssues(); // page-scoped refetch (crops stay off the WS)
          return;
        }
        if (msg.kind === "bench_command") {
          // Arc driving the bench viewer — the seat handles it; panels
          // without a bench (the canvas panel) drop it here.
          const cmd = msg.command;
          if (cmd && typeof cmd === "object")
            seatRef.current?.onCommand?.(cmd as Record<string, unknown>);
          return;
        }
        setFeed((f) => applyEvent(f, msg));
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [open, refreshIssues]);

  const wsSend = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const sendMessage = useCallback(
    (text: string, images: ComposerImage[] = []) => {
      const s = seatRef.current;
      wsSend({
        type: "user_message", text,
        ...(images.length ? { images } : {}),
        ...(s ? { area: s.area, area_context: s.context() } : {}),
      });
      setFeed((f) =>
        applyEvent(f, { kind: "user", text, ...(images.length ? { images: images.length } : {}) })
      );
    },
    [wsSend]
  );

  const answerApproval = useCallback(
    (answer: ApprovalAnswer) => {
      wsSend({ type: "approval_response", ...answer });
      setFeed((f) => removeApproval(f, answer.id));
    },
    [wsSend]
  );

  const answerIssue = useCallback(
    async (rule: string, elementId: string, answer: "yes" | "no" | "custom", note: string) => {
      // Optimistic: mark answered immediately; the server broadcast reconciles.
      setFeed((f) => ({
        ...f,
        issues: f.issues.map((it) =>
          it.rule === rule && it.element_id === elementId
            ? { ...it, state: "shane-answered", answer: { answer, note } }
            : it
        ),
      }));
      try {
        await fetch(`${agentBaseUrl()}/experimental-v2/copilot/issue-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule, element_id: elementId, answer, note }),
        });
      } catch {
        void refreshIssues(); // reconcile on failure
      }
    },
    [refreshIssues]
  );

  const patchSettings = useCallback(
    (patch: Partial<CopilotSettings>) => wsSend({ type: "set_settings", settings: patch }),
    [wsSend]
  );

  const setPermissionMode = useCallback(
    (mode: string) => wsSend({ type: "set_permission_mode", mode }),
    [wsSend]
  );

  const interrupt = useCallback(() => wsSend({ type: "interrupt" }), [wsSend]);
  const newSession = useCallback(() => wsSend({ type: "new_session" }), [wsSend]);
  const stopTask = useCallback(
    (taskId: string) => wsSend({ type: "stop_task", task_id: taskId }),
    [wsSend]
  );
  const removeQueued = useCallback(
    (index: number) => wsSend({ type: "queue_remove", index }),
    [wsSend]
  );

  return {
    feed,
    sendMessage,
    answerApproval,
    answerIssue,
    patchSettings,
    setPermissionMode,
    interrupt,
    newSession,
    stopTask,
    removeQueued,
  };
}
