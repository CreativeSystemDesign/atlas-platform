"""Atlas deploy worker — executes blue-green self-deploys OUTSIDE the
agent-server process.

Arc (or a human) drops a request JSON in .atlas/deploy/requests/; this worker
— a SEPARATE systemd service, so its cgroup is NOT atlas-agent-server — runs
scripts/deploy-blue-green.sh for it. Running outside the agent-server process
is the whole point: restarting the agent-server during a cutover can't kill the
thing performing the restart (the constraint that made a self-deploy tool
impossible from inside a copilot turn).

Per request: honor the .atlas/deploy/AUTONOMY_OFF kill-switch, run the
blue-green deploy (which itself boots+verifies green, waits for the copilot to
be idle, then cuts over — never bricking on bad code), and write the outcome to
.atlas/deploy/results/<id>.json so Arc can read it via ops_health. Requests are
processed one at a time (serialized).

Run: systemd unit atlas-deploy-worker.service, or directly:
    cd agent_server && .venv/bin/python -m src.deploy_worker
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEPLOY_DIR = REPO / ".atlas" / "deploy"
REQ_DIR = DEPLOY_DIR / "requests"
RES_DIR = DEPLOY_DIR / "results"
KILL_SWITCH = DEPLOY_DIR / "AUTONOMY_OFF"
SCRIPT = REPO / "scripts" / "deploy-blue-green.sh"
JOURNAL = REPO / ".atlas" / "run-logs" / "deploy-worker.jsonl"
POLL_S = 5.0
DEPLOY_TIMEOUT_S = 600


def _log(event: str, **kw) -> None:
    try:
        JOURNAL.parent.mkdir(parents=True, exist_ok=True)
        with open(JOURNAL, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": time.time(), "event": event, **kw}) + "\n")
    except Exception:
        pass


def _write_result(rid: str, status: str, detail: str) -> None:
    RES_DIR.mkdir(parents=True, exist_ok=True)
    (RES_DIR / f"{rid}.json").write_text(
        json.dumps({"ts": time.time(), "status": status, "detail": detail, "id": rid}))


def _run_one(req_path: Path) -> None:
    try:
        req = json.loads(req_path.read_text())
    except Exception as exc:  # noqa: BLE001 — a malformed request is provenance, not a crash
        _log("bad-request", file=req_path.name, error=str(exc))
        req_path.unlink(missing_ok=True)
        return
    rid = str(req.get("id") or req_path.stem)
    reason = str(req.get("reason") or "")

    # Kill-switch: Shane's instant stop on all autonomous deploys.
    if KILL_SWITCH.exists():
        _log("refused-killswitch", id=rid)
        _write_result(rid, "REFUSED", "AUTONOMY_OFF kill-switch is set")
        req_path.unlink(missing_ok=True)
        return

    result_file = RES_DIR / f"{rid}.json"
    args = [str(SCRIPT), "--reason", reason, "--result", str(result_file)]
    if req.get("no_cutover"):
        args.append("--no-cutover")

    _log("deploy-start", id=rid, reason=reason)
    try:
        proc = subprocess.run(args, cwd=str(REPO), capture_output=True,
                              text=True, timeout=DEPLOY_TIMEOUT_S)
        tail = (proc.stdout or "") + (proc.stderr or "")
        _log("deploy-done", id=rid, code=proc.returncode, tail=tail[-400:])
        # The script writes the authoritative result file; only backfill if it
        # somehow didn't (e.g. killed before emit).
        if not result_file.exists():
            _write_result(rid, "ERROR" if proc.returncode else "UNKNOWN",
                          tail[-300:] or f"exit {proc.returncode}")
    except subprocess.TimeoutExpired:
        _log("deploy-timeout", id=rid)
        _write_result(rid, "ERROR", f"deploy exceeded {DEPLOY_TIMEOUT_S}s")
    except Exception as exc:  # noqa: BLE001
        _log("deploy-error", id=rid, error=str(exc))
        _write_result(rid, "ERROR", str(exc)[:300])
    req_path.unlink(missing_ok=True)


def main() -> None:
    REQ_DIR.mkdir(parents=True, exist_ok=True)
    RES_DIR.mkdir(parents=True, exist_ok=True)
    _log("worker-up", repo=str(REPO))
    while True:
        try:
            # Oldest first, one at a time (a cutover restarts the live server;
            # overlapping deploys would fight over it).
            for req in sorted(REQ_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime):
                _run_one(req)
        except Exception as exc:  # noqa: BLE001
            _log("loop-error", error=str(exc))
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
