/**
 * Base URL for the Atlas agent HTTP API (FastAPI).
 *
 * - **Local dev:** `http://localhost:8123` (or 127.0.0.1 / ::1) so the UI talks to uvicorn, not the
 *   Next dev server.
 * - **Production:** same browser origin (`https://your-host`) so `/terminals`, `/threads`, and
 *   `wss:` for `/terminals/ws/...` all go through your edge (e.g. Cloudflare) to the agent. Set
 *   `NEXT_PUBLIC_AGENT_URL` only if the agent is on a different host than the dashboard.
 */
export function agentBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const fromEnv = process.env.NEXT_PUBLIC_AGENT_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") {
    return `${window.location.protocol}//${h}:8123`;
  }
  return window.location.origin;
}
