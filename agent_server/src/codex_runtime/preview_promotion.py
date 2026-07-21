from __future__ import annotations

import asyncio
import json
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Mapping
from uuid import uuid4

JsonObject = dict[str, object]

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PROMOTION_SCRIPT = REPO_ROOT / "scripts" / "promote-codex-preview.sh"
DEFAULT_PULL_LIVE_SCRIPT = REPO_ROOT / "scripts" / "pull-codex-preview-from-live.sh"
DEFAULT_PREVIEW_HOST = "preview.atlas-platform.cloud"
MAX_OUTPUT_BYTES = 60_000
PULL_LIVE_CONFIRMATION_TOKEN = "RESET_PREVIEW_TO_LIVE"
_promotion_task: asyncio.Task[None] | None = None
_promotion_status: JsonObject = {
    "ok": False,
    "state": "idle",
    "exitCode": 0,
    "output": "No preview promotion has been started.",
}
_pull_live_task: asyncio.Task[None] | None = None
_pull_live_status: JsonObject = {
    "ok": False,
    "state": "idle",
    "exitCode": 0,
    "output": "No preview live pull has been started.",
}


class CodexPreviewPromotionError(RuntimeError):
    def __init__(self, message: str, *, exit_code: int = 1, output: str = "") -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.output = output

    def as_payload(self) -> JsonObject:
        return {
            "ok": False,
            "exitCode": self.exit_code,
            "output": self.output or str(self),
        }


def is_preview_promotion_request(headers: Mapping[str, str]) -> bool:
    allowed_hosts = {
        host.strip().lower()
        for host in os.getenv(
            "ATLAS_CODEX_PREVIEW_PROMOTION_HOSTS",
            DEFAULT_PREVIEW_HOST,
        ).split(",")
        if host.strip()
    }
    candidates = [
        headers.get("host", ""),
        _url_host(headers.get("origin", "")),
        _url_host(headers.get("referer", "")),
    ]
    return any(_strip_port(candidate).lower() in allowed_hosts for candidate in candidates)


async def run_codex_preview_promotion(*, timeout: float = 900) -> JsonObject:
    output = await _run_preview_script(
        env_var="ATLAS_CODEX_PREVIEW_PROMOTE_SCRIPT",
        default_script=DEFAULT_PROMOTION_SCRIPT,
        missing_label="Preview promotion",
        timeout=timeout,
    )

    return {
        "ok": True,
        "state": "succeeded",
        "exitCode": 0,
        "output": output,
        "promotedAt": datetime.now(UTC).isoformat(),
    }


async def run_codex_preview_pull_live(*, timeout: float = 240) -> JsonObject:
    output = await _run_preview_script(
        env_var="ATLAS_CODEX_PREVIEW_PULL_LIVE_SCRIPT",
        default_script=DEFAULT_PULL_LIVE_SCRIPT,
        missing_label="Preview live pull",
        timeout=timeout,
    )

    return {
        "ok": True,
        "state": "succeeded",
        "exitCode": 0,
        "output": output,
        "pulledAt": datetime.now(UTC).isoformat(),
    }


def codex_preview_pull_live_safety(
    *,
    repo_root: Path | None = None,
    drafts_root: Path | None = None,
) -> JsonObject:
    root = (repo_root or REPO_ROOT).resolve()
    draft_root = (drafts_root or root.parent / ".codex-interface-drafts").resolve()
    dirty = _git_status(root)
    revisions = _interface_revision_summaries(root)
    blocking_revisions = [
        revision
        for revision in revisions
        if revision.get("status") in {"candidate", "validated", "failed"}
    ]
    drafts = _draft_workspace_summaries(draft_root)
    blockers: list[str] = []
    if dirty:
        blockers.append("preview checkout has uncommitted or untracked changes")
    if blocking_revisions:
        blockers.append("interface revisions are still active")
    if drafts:
        blockers.append("interface draft workspaces exist")
    requires_confirmation = bool(blockers)
    return {
        "okToPull": not requires_confirmation,
        "requiresConfirmation": requires_confirmation,
        "confirmationToken": PULL_LIVE_CONFIRMATION_TOKEN,
        "blockers": blockers,
        "dirty": dirty,
        "activeRevisions": blocking_revisions,
        "drafts": drafts,
        "repoRoot": root.as_posix(),
        "draftsRoot": draft_root.as_posix(),
    }


async def _run_preview_script(
    *,
    env_var: str,
    default_script: Path,
    missing_label: str,
    timeout: float,
) -> str:
    script = Path(os.getenv(env_var, str(default_script)))
    if not script.exists():
        raise CodexPreviewPromotionError(
            f"{missing_label} script does not exist: {script}",
            exit_code=127,
        )

    process = await asyncio.create_subprocess_exec(
        str(script),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=os.environ.copy(),
    )
    try:
        stdout, _stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise CodexPreviewPromotionError(
            f"Preview promotion timed out after {int(timeout)} seconds.",
            exit_code=124,
        ) from exc

    output = _trim_output(stdout.decode(errors="replace"))
    if process.returncode != 0:
        raise CodexPreviewPromotionError(
            f"Preview promotion failed with exit code {process.returncode}.",
            exit_code=process.returncode or 1,
            output=output,
        )

    return output


async def start_codex_preview_promotion(*, timeout: float = 900) -> JsonObject:
    global _promotion_status, _promotion_task

    if _promotion_task and not _promotion_task.done():
        return dict(_promotion_status)

    job_id = uuid4().hex
    _promotion_status = {
        "ok": False,
        "state": "running",
        "id": job_id,
        "exitCode": 0,
        "output": "Preview promotion started.",
        "startedAt": datetime.now(UTC).isoformat(),
    }
    _promotion_task = asyncio.create_task(
        _run_codex_preview_promotion_job(job_id=job_id, timeout=timeout)
    )
    return dict(_promotion_status)


def current_codex_preview_promotion() -> JsonObject:
    return dict(_promotion_status)


async def start_codex_preview_pull_live(*, timeout: float = 240) -> JsonObject:
    global _pull_live_status, _pull_live_task

    if _pull_live_task and not _pull_live_task.done():
        return dict(_pull_live_status)

    job_id = uuid4().hex
    _pull_live_status = {
        "ok": False,
        "state": "running",
        "id": job_id,
        "exitCode": 0,
        "output": "Preview live pull started.",
        "startedAt": datetime.now(UTC).isoformat(),
    }
    _pull_live_task = asyncio.create_task(
        _run_codex_preview_pull_live_job(job_id=job_id, timeout=timeout)
    )
    return dict(_pull_live_status)


def current_codex_preview_pull_live() -> JsonObject:
    return dict(_pull_live_status)


async def _run_codex_preview_promotion_job(*, job_id: str, timeout: float) -> None:
    global _promotion_status

    try:
        result = await run_codex_preview_promotion(timeout=timeout)
        _promotion_status = {
            **result,
            "id": job_id,
            "state": "succeeded",
        }
    except CodexPreviewPromotionError as exc:
        _promotion_status = {
            **exc.as_payload(),
            "id": job_id,
            "state": "failed",
            "failedAt": datetime.now(UTC).isoformat(),
        }
    except Exception as exc:  # pragma: no cover - defensive job boundary
        _promotion_status = {
            "ok": False,
            "id": job_id,
            "state": "failed",
            "exitCode": 1,
            "output": str(exc),
            "failedAt": datetime.now(UTC).isoformat(),
        }


async def _run_codex_preview_pull_live_job(*, job_id: str, timeout: float) -> None:
    global _pull_live_status

    try:
        result = await run_codex_preview_pull_live(timeout=timeout)
        _pull_live_status = {
            **result,
            "id": job_id,
            "state": "succeeded",
        }
    except CodexPreviewPromotionError as exc:
        _pull_live_status = {
            **exc.as_payload(),
            "id": job_id,
            "state": "failed",
            "failedAt": datetime.now(UTC).isoformat(),
        }
    except Exception as exc:  # pragma: no cover - defensive job boundary
        _pull_live_status = {
            "ok": False,
            "id": job_id,
            "state": "failed",
            "exitCode": 1,
            "output": str(exc),
            "failedAt": datetime.now(UTC).isoformat(),
        }


def _strip_port(value: str) -> str:
    value = value.strip()
    if value.startswith("["):
        return value.split("]", 1)[0].lstrip("[")
    return value.split(":", 1)[0]


def _url_host(value: str) -> str:
    if "://" not in value:
        return value
    return value.split("://", 1)[1].split("/", 1)[0]


def _trim_output(value: str) -> str:
    encoded = value.encode()
    if len(encoded) <= MAX_OUTPUT_BYTES:
        return value
    return encoded[-MAX_OUTPUT_BYTES:].decode(errors="replace")


def _git_status(repo_root: Path) -> list[str]:
    if not (repo_root / ".git").exists():
        return [f"missing git checkout: {repo_root.as_posix()}"]
    process = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        cwd=repo_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=10,
    )
    if process.returncode != 0:
        return [process.stderr.strip() or "git status failed"]
    return [line for line in process.stdout.splitlines() if line.strip()]


def _interface_revision_summaries(repo_root: Path) -> list[JsonObject]:
    store_root = repo_root / ".atlas" / "codex-interface-revisions"
    if not store_root.exists():
        return []
    revisions: list[JsonObject] = []
    for manifest_path in sorted(store_root.glob("*/manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        revision_id = str(manifest.get("id") or manifest_path.parent.name)
        status = str(manifest.get("status") or "candidate")
        revisions.append(
            {
                "id": revision_id,
                "status": status,
                "label": str(manifest.get("label") or revision_id),
                "draftPath": str(manifest.get("draft_path") or ""),
                "updatedAt": str(manifest.get("updated_at") or manifest.get("created_at") or ""),
            }
        )
    return revisions


def _draft_workspace_summaries(drafts_root: Path) -> list[JsonObject]:
    if not drafts_root.exists():
        return []
    drafts: list[JsonObject] = []
    for path in sorted(drafts_root.glob("ui_*")):
        if not path.is_dir():
            continue
        try:
            updated_at = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()
        except OSError:
            updated_at = ""
        drafts.append({"id": path.name, "path": path.as_posix(), "updatedAt": updated_at})
    return drafts[-12:]
