from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

InterfaceRevisionStatus = Literal[
    "candidate",
    "validated",
    "failed",
    "rolled_back",
    "default",
    "archived",
]
InterfaceRestartAction = Literal[
    "refresh_only",
    "restart_frontend",
    "restart_backend",
]

DEFAULT_INTERFACE_PATHS = (
    "atlas-dashboard/next.config.ts",
    "atlas-dashboard/package.json",
    "atlas-dashboard/package-lock.json",
    "atlas-dashboard/postcss.config.mjs",
    "atlas-dashboard/src/app/codex",
    "atlas-dashboard/src/components/code",
    "agent_server/src/codex_interface",
    "agent_server/src/codex_runtime",
    "agent_server/src/config.py",
    "agent_server/src/graphs/codex_ui.py",
    "agent_server/src/graphs/model_resolution.py",
    "agent_server/src/main.py",
    "agent_server/src/routes/codex_interface.py",
    "agent_server/src/routes/codex_runtime.py",
    "agent_server/src/routes/codex_ui.py",
)

SAFE_INTERFACE_PREFIXES = DEFAULT_INTERFACE_PATHS + (
    "atlas-dashboard/tailwind.config.ts",
    "atlas-dashboard/tailwind.config.js",
)

IGNORED_DIRS = {
    ".next",
    "__pycache__",
    "node_modules",
    ".pytest_cache",
    ".vitest",
}


class UnsafeInterfacePathError(ValueError):
    """Raised when a checkpoint path is outside the Codex interface surface."""


@dataclass(frozen=True)
class InterfaceRevision:
    id: str
    label: str
    description: str
    status: InterfaceRevisionStatus
    created_at: str
    updated_at: str
    file_count: int
    paths: list[str]
    draft_path: str | None = None
    diagnostic: dict[str, Any] | None = None

    @classmethod
    def from_manifest(cls, manifest: dict[str, Any]) -> "InterfaceRevision":
        return cls(
            id=str(manifest["id"]),
            label=str(manifest["label"]),
            description=str(manifest.get("description") or ""),
            status=manifest.get("status", "candidate"),
            created_at=str(manifest["created_at"]),
            updated_at=str(manifest.get("updated_at") or manifest["created_at"]),
            file_count=len(manifest.get("files") or []),
            paths=[str(path) for path in manifest.get("paths") or []],
            draft_path=str(manifest["draft_path"]) if manifest.get("draft_path") else None,
            diagnostic=manifest.get("diagnostic")
            if isinstance(manifest.get("diagnostic"), dict)
            else None,
        )


@dataclass(frozen=True)
class InterfaceValidationResult:
    revision: InterfaceRevision
    rolled_back: bool
    diagnostic: dict[str, Any]


HealthProbe = Callable[[], Awaitable[tuple[bool, dict[str, Any]]]]
RestartService = Callable[..., Awaitable[dict[str, Any]]]
ALLOWED_DEV_SERVICES = {
    "atlas-dev-dashboard.service",
    "atlas-dev-server.service",
    "atlas-codex-preview-dashboard.service",
    "atlas-codex-preview-server.service",
}
ALLOWED_USER_SERVICES = {
    "atlas-dashboard-prod.service",
    "atlas-server.service",
}


@dataclass(frozen=True)
class InterfaceRestartPlan:
    changed_files: list[str]
    actions: list[InterfaceRestartAction]
    requires_frontend_restart: bool
    requires_backend_restart: bool

    @property
    def refresh_only(self) -> bool:
        return self.actions == ["refresh_only"]


DraftValidator = Callable[
    [Path, InterfaceRestartPlan],
    Awaitable[tuple[bool, dict[str, Any]]],
]


class CodexInterfaceSupervisor:
    """Snapshots and restores the bounded file surface that can alter /codex."""

    def __init__(
        self,
        *,
        repo_root: Path,
        store_root: Path | None = None,
        drafts_root: Path | None = None,
        frontend_restart_service: str = "atlas-dev-dashboard.service",
        backend_restart_service: str = "atlas-dev-server.service",
    ) -> None:
        self.repo_root = repo_root.resolve()
        self.store_root = (
            store_root.resolve()
            if store_root
            else self.repo_root / ".atlas" / "codex-interface-revisions"
        )
        self.drafts_root = (
            drafts_root.resolve()
            if drafts_root
            else self.repo_root.parent / ".codex-interface-drafts"
        )
        self.frontend_restart_service = frontend_restart_service
        self.backend_restart_service = backend_restart_service

    def create_checkpoint(
        self,
        *,
        label: str,
        description: str = "",
        paths: Iterable[str] | None = None,
    ) -> InterfaceRevision:
        now = _utc_now()
        revision_id = f"ui_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"
        requested_paths = list(paths or DEFAULT_INTERFACE_PATHS)
        safe_paths = [self._safe_relative_path(path) for path in requested_paths]
        files = self._collect_files(safe_paths)

        revision_root = self.store_root / revision_id
        files_root = revision_root / "files"
        files_root.mkdir(parents=True, exist_ok=False)
        draft_root = self._create_draft_workspace(revision_id, safe_paths)

        manifest_files: list[dict[str, Any]] = []
        for rel_path in files:
            source = self.repo_root / rel_path
            destination = files_root / rel_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            content = source.read_bytes()
            manifest_files.append(
                {
                    "path": rel_path.as_posix(),
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )

        manifest = {
            "id": revision_id,
            "label": label.strip() or "Interface checkpoint",
            "description": description.strip(),
            "status": "candidate",
            "created_at": now,
            "updated_at": now,
            "paths": [path.as_posix() for path in safe_paths],
            "files": manifest_files,
            "draft_path": draft_root.as_posix(),
        }
        self._write_manifest(revision_id, manifest)
        return InterfaceRevision.from_manifest(manifest)

    def list_revisions(self) -> list[InterfaceRevision]:
        if not self.store_root.exists():
            return []
        revisions = [
            InterfaceRevision.from_manifest(self._read_manifest(path.name))
            for path in self.store_root.iterdir()
            if path.is_dir() and (path / "manifest.json").exists()
        ]
        return sorted(revisions, key=lambda revision: revision.created_at)

    def changed_files_since(
        self,
        revision_id: str,
        *,
        source_root: Path | None = None,
    ) -> list[str]:
        manifest = self._read_manifest(revision_id)
        root = source_root.resolve() if source_root else self._revision_draft_root(manifest)
        manifest_files = {
            str(file_entry["path"]): str(file_entry["sha256"])
            for file_entry in manifest.get("files") or []
        }
        current_files = {
            rel_path.as_posix(): _sha256(root / rel_path)
            for rel_path in self._collect_files(
                [self._safe_relative_path(str(path)) for path in manifest.get("paths") or []],
                source_root=root,
            )
        }

        changed = {
            path
            for path, snapshot_hash in manifest_files.items()
            if current_files.get(path) != snapshot_hash
        }
        changed.update(path for path in current_files if path not in manifest_files)
        return sorted(changed)

    def restart_plan_for_revision(self, revision_id: str) -> InterfaceRestartPlan:
        changed_files = self.changed_files_since(revision_id)
        return restart_plan_for_changed_files(changed_files)

    async def prepare_validation_steps(
        self,
        revision_id: str,
        *,
        restart_service: RestartService | None = None,
        draft_validator: DraftValidator | None = None,
    ):
        plan = self.restart_plan_for_revision(revision_id)
        runner = restart_service or restart_dev_service
        validator = draft_validator or validate_draft_workspace
        manifest = self._read_manifest(revision_id)
        draft_root = self._revision_draft_root(manifest)

        yield {
            "code": "change_detected",
            "label": "Interface change detected",
            "changed_files": plan.changed_files,
            "actions": plan.actions,
        }
        yield {
            "code": "draft_validation_started",
            "label": "Validating draft workspace",
            "changed_files": plan.changed_files,
        }
        ok, diagnostic = await validator(draft_root, plan)
        if not ok:
            yield {
                "code": "draft_validation_failed",
                "label": "Draft validation failed",
                "result": diagnostic,
            }
            raise RuntimeError(diagnostic.get("error") or "Draft validation failed.")
        yield {
            "code": "draft_validation_passed",
            "label": "Draft validation passed",
            "result": diagnostic,
        }

        promoted_files = self.promote_revision(revision_id)
        yield {
            "code": "promotion_completed",
            "label": "Promoted validated interface",
            "changed_files": promoted_files,
        }

        if plan.requires_frontend_restart:
            yield {
                "code": "frontend_restart_required",
                "label": "Frontend restart required",
                "service": self.frontend_restart_service,
            }
            yield {
                "code": "frontend_restart_started",
                "label": "Restarting dashboard service",
                "service": self.frontend_restart_service,
            }
            result = await runner(self.frontend_restart_service, deferred=False)
            yield {
                "code": "frontend_restart_completed",
                "label": "Dashboard service restarted",
                "service": self.frontend_restart_service,
                "result": result,
            }

        if plan.requires_backend_restart:
            yield {
                "code": "backend_restart_required",
                "label": "Backend restart required",
                "service": self.backend_restart_service,
            }
            yield {
                "code": "backend_restart_started",
                "label": "Restarting agent server",
                "service": self.backend_restart_service,
            }
            result = await runner(self.backend_restart_service, deferred=True)
            yield {
                "code": "backend_restart_scheduled",
                "label": "Agent server restart scheduled",
                "service": self.backend_restart_service,
                "result": result,
            }

    def restore_revision(
        self,
        revision_id: str,
        *,
        diagnostic: dict[str, Any] | None = None,
    ) -> InterfaceRevision:
        manifest = self._read_manifest(revision_id)
        files_root = self.store_root / revision_id / "files"
        for file_entry in manifest.get("files") or []:
            rel_path = self._safe_relative_path(str(file_entry["path"]))
            source = files_root / rel_path
            if not source.exists():
                raise FileNotFoundError(f"Snapshot file missing: {rel_path.as_posix()}")
            destination = self.repo_root / rel_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

        manifest["status"] = "rolled_back"
        manifest["updated_at"] = _utc_now()
        if diagnostic:
            manifest["diagnostic"] = diagnostic
        self._write_manifest(revision_id, manifest)
        return InterfaceRevision.from_manifest(manifest)

    async def validate_or_restore(
        self,
        revision_id: str,
        *,
        health_probe: HealthProbe,
    ) -> InterfaceValidationResult:
        ok, diagnostic = await health_probe()
        manifest = self._read_manifest(revision_id)
        manifest["diagnostic"] = diagnostic
        manifest["updated_at"] = _utc_now()

        if ok:
            manifest["status"] = "validated"
            self._write_manifest(revision_id, manifest)
            return InterfaceValidationResult(
                revision=InterfaceRevision.from_manifest(manifest),
                rolled_back=False,
                diagnostic=diagnostic,
            )

        restored = self.restore_revision(revision_id, diagnostic=diagnostic)
        return InterfaceValidationResult(
            revision=restored,
            rolled_back=True,
            diagnostic=diagnostic,
        )

    def promote_revision(self, revision_id: str) -> list[str]:
        manifest = self._read_manifest(revision_id)
        draft_root = self._revision_draft_root(manifest)
        changed_files = self.changed_files_since(revision_id, source_root=draft_root)
        for changed_file in changed_files:
            rel_path = self._safe_relative_path(changed_file)
            source = draft_root / rel_path
            destination = self.repo_root / rel_path
            if source.exists():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
            elif destination.exists():
                destination.unlink()
        return changed_files

    def mark_revision_default(self, revision_id: str) -> InterfaceRevision:
        target_manifest = self._read_manifest(revision_id)
        updated_at = _utc_now()

        if self.store_root.exists():
            for revision_root in self.store_root.iterdir():
                manifest_path = revision_root / "manifest.json"
                if not revision_root.is_dir() or not manifest_path.exists():
                    continue
                manifest = self._read_manifest(revision_root.name)
                if str(manifest.get("id")) == revision_id:
                    manifest["status"] = "default"
                    manifest["updated_at"] = updated_at
                    manifest.pop("diagnostic", None)
                    target_manifest = manifest
                elif manifest.get("status") in {
                    "candidate",
                    "validated",
                    "failed",
                    "default",
                }:
                    manifest["status"] = "archived"
                    manifest["updated_at"] = updated_at
                else:
                    continue
                self._write_manifest(str(manifest["id"]), manifest)

        return InterfaceRevision.from_manifest(target_manifest)

    def _collect_files(
        self,
        safe_paths: list[Path],
        *,
        source_root: Path | None = None,
    ) -> list[Path]:
        root = source_root or self.repo_root
        files: list[Path] = []
        for rel_path in safe_paths:
            absolute = root / rel_path
            if absolute.is_file():
                files.append(rel_path)
                continue
            if not absolute.exists():
                continue
            for candidate in absolute.rglob("*"):
                if not candidate.is_file():
                    continue
                if any(part in IGNORED_DIRS for part in candidate.relative_to(absolute).parts):
                    continue
                files.append(candidate.relative_to(root))
        return sorted(set(files))

    def _create_draft_workspace(self, revision_id: str, safe_paths: list[Path]) -> Path:
        draft_root = self.drafts_root / revision_id
        draft_root.parent.mkdir(parents=True, exist_ok=True)
        if self._create_git_worktree(draft_root):
            self._overlay_paths_to_draft(safe_paths, draft_root)
        else:
            draft_root.mkdir(parents=True, exist_ok=False)
            self._overlay_paths_to_draft(safe_paths, draft_root)
        self._link_shared_dependency_dirs(draft_root)
        return draft_root

    def _create_git_worktree(self, draft_root: Path) -> bool:
        try:
            process = subprocess.run(
                ["git", "worktree", "add", "--detach", draft_root.as_posix(), "HEAD"],
                cwd=self.repo_root,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=45,
            )
        except Exception:
            return False
        return process.returncode == 0

    def _overlay_paths_to_draft(self, safe_paths: list[Path], draft_root: Path) -> None:
        for rel_path in self._collect_files(safe_paths):
            source = self.repo_root / rel_path
            destination = draft_root / rel_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    def _link_shared_dependency_dirs(self, draft_root: Path) -> None:
        for rel_path in (
            Path("atlas-dashboard/node_modules"),
            Path("agent_server/.venv"),
        ):
            source = self.repo_root / rel_path
            destination = draft_root / rel_path
            if not source.exists() or destination.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.symlink(source, destination, target_is_directory=source.is_dir())
            except OSError:
                pass

    def _revision_draft_root(self, manifest: dict[str, Any]) -> Path:
        raw = manifest.get("draft_path")
        if not raw:
            return self.repo_root
        draft_root = Path(str(raw)).resolve()
        if not draft_root.exists():
            raise FileNotFoundError(f"Interface draft workspace missing: {draft_root}")
        return draft_root

    def _safe_relative_path(self, value: str) -> Path:
        raw = Path(value)
        candidate = raw if raw.is_absolute() else self.repo_root / raw
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self.repo_root):
            raise UnsafeInterfacePathError(f"Path is outside the repo: {value}")
        rel = resolved.relative_to(self.repo_root)
        rel_text = rel.as_posix()
        if not any(
            rel_text == prefix or rel_text.startswith(f"{prefix}/")
            for prefix in SAFE_INTERFACE_PREFIXES
        ):
            raise UnsafeInterfacePathError(
                f"Path is outside the Codex interface surface: {rel_text}"
            )
        return rel

    def _manifest_path(self, revision_id: str) -> Path:
        return self.store_root / revision_id / "manifest.json"

    def _read_manifest(self, revision_id: str) -> dict[str, Any]:
        path = self._manifest_path(revision_id)
        if not path.exists():
            raise FileNotFoundError(f"Interface revision not found: {revision_id}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_manifest(self, revision_id: str, manifest: dict[str, Any]) -> None:
        path = self._manifest_path(revision_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def restart_plan_for_changed_files(changed_files: Iterable[str]) -> InterfaceRestartPlan:
    files = sorted(set(changed_files))
    requires_backend_restart = any(path.startswith("agent_server/") for path in files)
    requires_frontend_restart = any(_requires_frontend_restart(path) for path in files)
    actions: list[InterfaceRestartAction] = []
    if requires_frontend_restart:
        actions.append("restart_frontend")
    if requires_backend_restart:
        actions.append("restart_backend")
    if not actions:
        actions.append("refresh_only")
    return InterfaceRestartPlan(
        changed_files=files,
        actions=actions,
        requires_frontend_restart=requires_frontend_restart,
        requires_backend_restart=requires_backend_restart,
    )


async def restart_dev_service(
    service_name: str,
    *,
    deferred: bool = False,
) -> dict[str, Any]:
    allowed_services = ALLOWED_DEV_SERVICES | ALLOWED_USER_SERVICES
    if service_name not in allowed_services:
        raise ValueError(f"Service is not restartable by the interface supervisor: {service_name}")

    if deferred:
        log_path = f"/tmp/atlas-codex-{service_name}.restart.log"
        command = _systemctl_restart_command(service_name)
        subprocess.Popen(
            [
                "bash",
                "-lc",
                (
                    "sleep 1; "
                    f"{shlex.join(command)} "
                    f"> {log_path} 2>&1"
                ),
            ],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=_systemctl_env(service_name),
        )
        return {"service": service_name, "deferred": True, "ok": True, "log_path": log_path}

    process = await asyncio.create_subprocess_exec(
        *_systemctl_restart_command(service_name),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_systemctl_env(service_name),
    )
    stdout, stderr = await process.communicate()
    return {
        "service": service_name,
        "deferred": False,
        "ok": process.returncode == 0,
        "returncode": process.returncode,
        "stdout": stdout.decode("utf-8", errors="replace")[-2000:],
        "stderr": stderr.decode("utf-8", errors="replace")[-2000:],
    }


def _systemctl_restart_command(service_name: str) -> list[str]:
    if service_name in ALLOWED_USER_SERVICES:
        return ["systemctl", "--user", "restart", service_name]
    return ["sudo", "-n", "systemctl", "restart", service_name]


def _systemctl_env(service_name: str) -> dict[str, str] | None:
    if service_name not in ALLOWED_USER_SERVICES:
        return None
    env = os.environ.copy()
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    return env


async def validate_draft_workspace(
    draft_root: Path,
    plan: InterfaceRestartPlan,
) -> tuple[bool, dict[str, Any]]:
    diagnostics: dict[str, Any] = {
        "draft_path": draft_root.as_posix(),
        "changed_files": plan.changed_files,
        "checks": [],
    }

    if any(path.startswith("atlas-dashboard/") for path in plan.changed_files):
        result = await _run_validation_command(
            ["npm", "run", "build"],
            cwd=draft_root / "atlas-dashboard",
            label="dashboard_build",
        )
        diagnostics["checks"].append(result)
        if not result["ok"]:
            diagnostics["error"] = "Draft dashboard build failed."
            return False, diagnostics

    backend_python_files = [
        draft_root / path
        for path in plan.changed_files
        if path.startswith("agent_server/") and path.endswith(".py")
    ]
    if backend_python_files:
        result = await _run_validation_command(
            ["python3", "-m", "py_compile", *[path.as_posix() for path in backend_python_files]],
            cwd=draft_root,
            label="backend_py_compile",
        )
        diagnostics["checks"].append(result)
        if not result["ok"]:
            diagnostics["error"] = "Draft backend Python compile failed."
            return False, diagnostics

    if not diagnostics["checks"]:
        diagnostics["checks"].append(
            {
                "label": "no_compile_required",
                "ok": True,
                "stdout": "",
                "stderr": "",
                "returncode": 0,
            }
        )

    return True, diagnostics


async def _run_validation_command(
    command: list[str],
    *,
    cwd: Path,
    label: str,
) -> dict[str, Any]:
    if not cwd.exists():
        return {
            "label": label,
            "ok": False,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Validation cwd does not exist: {cwd.as_posix()}",
        }
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return {
        "label": label,
        "ok": process.returncode == 0,
        "returncode": process.returncode,
        "command": command,
        "cwd": cwd.as_posix(),
        "stdout": stdout.decode("utf-8", errors="replace")[-4000:],
        "stderr": stderr.decode("utf-8", errors="replace")[-4000:],
    }


def _requires_frontend_restart(path: str) -> bool:
    frontend_restart_files = {
        "atlas-dashboard/next.config.ts",
        "atlas-dashboard/next.config.js",
        "atlas-dashboard/package.json",
        "atlas-dashboard/package-lock.json",
        "atlas-dashboard/postcss.config.mjs",
        "atlas-dashboard/tailwind.config.ts",
        "atlas-dashboard/tailwind.config.js",
    }
    return path in frontend_restart_files


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
