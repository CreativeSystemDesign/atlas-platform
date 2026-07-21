import { agentBaseUrl } from "@/lib/agent-base-url";

/** WebSocket URL for agent server paths (e.g. `/terminals/ws/{id}`). */
export function agentWsUrl(path: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  const base = agentBaseUrl();
  if (base) {
    return base.replace(/^http/, "ws") + path;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}
