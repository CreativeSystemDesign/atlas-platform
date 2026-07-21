"""Ops seat tools — Arc's self-heal hands: SENSE the platform's health and
REQUEST a blue-green self-deploy.

These close Arc's loop (sense → diagnose → fix → deploy → verify) without a
human relay:
- ops_health  — read aggregated health so Arc NOTICES a break (service liveness,
                recent restarts, recent errors, last deploy outcome, copilot busy).
- ops_deploy  — drop a deploy REQUEST; the detached deploy-worker (a separate
                service, outside this process) boots + verifies a green instance
                and only then cuts over the live server. Arc CANNOT restart its
                own process, so it hands the restart off and reads the result
                from ops_health afterwards.

Both are platform-wide (not seat-scoped). Deploys are autonomous by Shane's
ruling; the safety is structural — green must boot + pass smoke before any
cutover, bad code never reaches the live port, and the .atlas/deploy/AUTONOMY_OFF
kill-switch stops all deploys instantly.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool

from src.config import ATLAS_REPO_ROOT

_REPO = Path(ATLAS_REPO_ROOT)
_DEPLOY = _REPO / ".atlas" / "deploy"
_REQ_DIR = _DEPLOY / "requests"
_RES_DIR = _DEPLOY / "results"
_KILL_SWITCH = _DEPLOY / "AUTONOMY_OFF"
_RUN_LOGS = _REPO / ".atlas" / "run-logs"


def _text(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text",
                         "text": json.dumps(payload, ensure_ascii=False)}]}


def _tail_jsonl(path: Path, n: int) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-n:]
        out = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except Exception:
                pass
        return out
    except Exception:
        return []


def _tail_errors(path: Path, n: int) -> list[str]:
    """Recent lines that look like failures — the cheap 'what broke' signal."""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return []
    hits = [ln for ln in lines
            if any(m in ln for m in ("ERROR", "Traceback", "Exception", "CRITICAL"))]
    return hits[-n:]


def _last_deploy() -> dict[str, Any] | None:
    try:
        results = sorted(_RES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)
        if not results:
            return None
        return json.loads(results[-1].read_text(encoding="utf-8"))
    except Exception:
        return None


@tool(
    name="ops_health",
    description=(
        "Read the platform's health so you can SENSE whether something is broken "
        "before acting. Returns: the copilot's busy state; recent server "
        "start/stop events (unexpected restarts = trouble); recent ERROR/Traceback "
        "lines from the agent-server log; the outcome of the last self-deploy; and "
        "whether the AUTONOMY_OFF kill-switch is set. Use this to notice a "
        "regression, and again after a deploy to confirm the fix landed. Read-only."
    ),
    input_schema={"type": "object", "properties": {}, "additionalProperties": False},
)
async def ops_health(args: dict[str, Any]) -> dict[str, Any]:
    from src.canvas_copilot.copilot import copilot_session
    busy = bool(getattr(copilot_session, "busy", False))
    return _text({
        "ok": True,
        "copilot": {"busy": busy, "session_id": getattr(copilot_session, "session_id", None)},
        "autonomy_off": _KILL_SWITCH.exists(),
        "server_lifecycle_recent": _tail_jsonl(_RUN_LOGS / "server-lifecycle.jsonl", 6),
        "recent_errors": _tail_errors(_RUN_LOGS / "agent-server.log", 12),
        "last_deploy": _last_deploy(),
        "deploy_worker_recent": _tail_jsonl(_RUN_LOGS / "deploy-worker.jsonl", 6),
    })


@tool(
    name="ops_deploy",
    description=(
        "Request a self-deploy of the agent-server after you've edited + committed "
        "the code. A DETACHED worker (outside this process) then boots a GREEN copy "
        "on an alternate port, proves it serves, and ONLY THEN restarts the live "
        "server on the new code — if green fails, the live server is never touched "
        "(no bricking). You cannot restart your own process, so this hands the "
        "restart off and returns immediately; read the outcome next turn with "
        "ops_health (last_deploy). Pass a short reason. Set no_cutover:true to only "
        "build + verify green without restarting live (a safe dry run). Frontend "
        "edits already hot-reload — this is for agent-server (Python) changes."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "reason": {"type": "string"},
            "no_cutover": {"type": "boolean"},
        },
        "additionalProperties": False,
    },
)
async def ops_deploy(args: dict[str, Any]) -> dict[str, Any]:
    if _KILL_SWITCH.exists():
        return _text({"ok": False, "note": "AUTONOMY_OFF kill-switch is set — "
                      "Shane has paused autonomous deploys. Raise it to him."})
    reason = str(args.get("reason") or "").strip() or "arc self-deploy"
    rid = uuid.uuid4().hex[:12]
    _REQ_DIR.mkdir(parents=True, exist_ok=True)
    req = {"id": rid, "reason": reason, "no_cutover": bool(args.get("no_cutover")),
           "queued_at": time.time()}
    # Write to a temp then rename so the worker never reads a half-written request.
    tmp = _REQ_DIR / f".{rid}.tmp"
    tmp.write_text(json.dumps(req), encoding="utf-8")
    tmp.replace(_REQ_DIR / f"{rid}.json")
    return _text({
        "ok": True, "request_id": rid, "no_cutover": req["no_cutover"],
        "note": ("green will be built + smoke-verified"
                 + ("" if req["no_cutover"] else ", then the live server cuts over to it")
                 + " when the copilot is idle. Check ops_health.last_deploy next turn "
                 "for the outcome — do not assume success."),
    })
