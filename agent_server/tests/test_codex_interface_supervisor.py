from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from src.codex_interface.supervisor import (
    CodexInterfaceSupervisor,
    InterfaceRestartPlan,
    UnsafeInterfacePathError,
)


def test_checkpoint_restore_recovers_modified_codex_ui_file(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    target = repo / "atlas-dashboard" / "src" / "components" / "code"
    target.mkdir(parents=True)
    source = target / "codex-adaptive-workspace.tsx"
    source.write_text("healthy cockpit\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    revision = supervisor.create_checkpoint(
        label="Before telemetry strip",
        description="Snapshot before a live interface mutation.",
    )

    source.write_text("broken cockpit\n", encoding="utf-8")

    restored = supervisor.restore_revision(revision.id)

    assert restored.id == revision.id
    assert restored.status == "rolled_back"
    assert source.read_text(encoding="utf-8") == "healthy cockpit\n"


def test_checkpoint_creates_draft_workspace_for_interface_edits(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    target = repo / "atlas-dashboard" / "src" / "components" / "code"
    target.mkdir(parents=True)
    source = target / "codex-adaptive-workspace.tsx"
    source.write_text("live stable\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    revision = supervisor.create_checkpoint(
        label="Before draft edit",
        description="Snapshot before a draft interface mutation.",
    )

    assert revision.draft_path is not None
    draft_source = (
        Path(revision.draft_path)
        / "atlas-dashboard"
        / "src"
        / "components"
        / "code"
        / "codex-adaptive-workspace.tsx"
    )
    draft_source.write_text("draft candidate\n", encoding="utf-8")

    assert source.read_text(encoding="utf-8") == "live stable\n"
    assert supervisor.changed_files_since(revision.id) == [
        "atlas-dashboard/src/components/code/codex-adaptive-workspace.tsx"
    ]


def test_promote_revision_copies_validated_draft_changes_to_live_tree(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    target = repo / "atlas-dashboard" / "src" / "components" / "code"
    target.mkdir(parents=True)
    source = target / "codex-adaptive-workspace.tsx"
    source.write_text("before\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    revision = supervisor.create_checkpoint(
        label="Before promotion",
        description="Snapshot before a draft interface mutation.",
    )
    draft_source = (
        Path(revision.draft_path or "")
        / "atlas-dashboard"
        / "src"
        / "components"
        / "code"
        / "codex-adaptive-workspace.tsx"
    )
    draft_source.write_text("after\n", encoding="utf-8")

    promoted = supervisor.promote_revision(revision.id)

    assert promoted == ["atlas-dashboard/src/components/code/codex-adaptive-workspace.tsx"]
    assert source.read_text(encoding="utf-8") == "after\n"


def test_mark_revision_default_archives_prior_dirty_interface_revisions(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    target = repo / "atlas-dashboard" / "src" / "components" / "code"
    target.mkdir(parents=True)
    source = target / "codex-adaptive-workspace.tsx"
    source.write_text("baseline\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    first = supervisor.create_checkpoint(
        label="Previous experiment",
        description="Older interface work.",
    )
    second = supervisor.create_checkpoint(
        label="Current implementation",
        description="Accepted interface work.",
    )

    default_revision = supervisor.mark_revision_default(second.id)
    revisions = {revision.id: revision for revision in supervisor.list_revisions()}

    assert default_revision.status == "default"
    assert revisions[second.id].status == "default"
    assert revisions[first.id].status == "archived"


def test_checkpoint_rejects_paths_outside_the_codex_interface_scope(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    secret = repo / ".env"
    secret.write_text("OPENROUTER_API_KEY=nope\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)

    with pytest.raises(UnsafeInterfacePathError):
        supervisor.create_checkpoint(
            label="Unsafe",
            description="Should not snapshot secrets.",
            paths=[".env"],
        )


def test_validate_revision_rolls_back_when_health_probe_fails(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    target = repo / "atlas-dashboard" / "src" / "components" / "code"
    target.mkdir(parents=True)
    source = target / "codex-adaptive-workspace.tsx"
    source.write_text("healthy cockpit\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    revision = supervisor.create_checkpoint(
        label="Before candidate",
        description="Snapshot before a candidate edit.",
    )
    source.write_text("compile error\n", encoding="utf-8")

    async def failing_probe() -> tuple[bool, dict[str, object]]:
        return False, {"status_code": 500, "error": "Next compile failed"}

    result = asyncio.run(
        supervisor.validate_or_restore(revision.id, health_probe=failing_probe)
    )

    assert result.revision.status == "rolled_back"
    assert result.rolled_back is True
    assert result.diagnostic["error"] == "Next compile failed"
    assert source.read_text(encoding="utf-8") == "healthy cockpit\n"


def test_restart_plan_classifies_frontend_config_and_backend_route_changes(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    frontend_config = repo / "atlas-dashboard" / "next.config.ts"
    backend_route = repo / "agent_server" / "src" / "routes" / "codex_interface.py"
    frontend_config.parent.mkdir(parents=True)
    backend_route.parent.mkdir(parents=True)
    frontend_config.write_text("export default {}\n", encoding="utf-8")
    backend_route.write_text("router = None\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    revision = supervisor.create_checkpoint(
        label="Before restart-sensitive edit",
        description="Snapshot before config and route edit.",
        paths=[
            "atlas-dashboard/next.config.ts",
            "agent_server/src/routes/codex_interface.py",
        ],
    )

    draft_root = Path(revision.draft_path or "")
    (draft_root / "atlas-dashboard" / "next.config.ts").write_text(
        "export default { poweredByHeader: false }\n",
        encoding="utf-8",
    )
    (draft_root / "agent_server" / "src" / "routes" / "codex_interface.py").write_text(
        "router = 'changed'\n",
        encoding="utf-8",
    )

    plan = supervisor.restart_plan_for_revision(revision.id)

    assert plan.changed_files == [
        "agent_server/src/routes/codex_interface.py",
        "atlas-dashboard/next.config.ts",
    ]
    assert plan.requires_backend_restart is True
    assert plan.requires_frontend_restart is True
    assert plan.actions == ["restart_frontend", "restart_backend"]


def test_prepare_validation_emits_professional_progress_and_restarts_only_needed_services(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    backend_route = repo / "agent_server" / "src" / "routes" / "codex_runtime.py"
    backend_route.parent.mkdir(parents=True)
    backend_route.write_text("before\n", encoding="utf-8")
    supervisor = CodexInterfaceSupervisor(repo_root=repo)
    revision = supervisor.create_checkpoint(
        label="Backend route edit",
        description="Snapshot before backend-only mutation.",
        paths=["agent_server/src/routes/codex_runtime.py"],
    )
    draft_backend_route = (
        Path(revision.draft_path or "")
        / "agent_server"
        / "src"
        / "routes"
        / "codex_runtime.py"
    )
    draft_backend_route.write_text("after\n", encoding="utf-8")
    calls: list[str] = []

    async def fake_restart(service_name: str, *, deferred: bool) -> dict[str, object]:
        calls.append(f"{service_name}:{deferred}")
        return {"service": service_name, "deferred": deferred, "ok": True}

    async def fake_validate(
        draft_root: Path,
        plan: InterfaceRestartPlan,
    ) -> tuple[bool, dict[str, object]]:
        return True, {"draft_path": draft_root.as_posix(), "changed_files": plan.changed_files}

    async def run() -> list[dict[str, object]]:
        return [
            step
            async for step in supervisor.prepare_validation_steps(
                revision.id,
                restart_service=fake_restart,
                draft_validator=fake_validate,
            )
        ]

    steps = asyncio.run(run())
    labels = [step["label"] for step in steps]

    assert labels == [
        "Interface change detected",
        "Validating draft workspace",
        "Draft validation passed",
        "Promoted validated interface",
        "Backend restart required",
        "Restarting agent server",
        "Agent server restart scheduled",
    ]
    assert calls == ["atlas-dev-server.service:True"]


def test_prepare_validation_uses_configured_preview_restart_services(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    frontend_config = repo / "atlas-dashboard" / "next.config.ts"
    backend_route = repo / "agent_server" / "src" / "routes" / "codex_runtime.py"
    frontend_config.parent.mkdir(parents=True)
    backend_route.parent.mkdir(parents=True)
    frontend_config.write_text("export default {}\n", encoding="utf-8")
    backend_route.write_text("before\n", encoding="utf-8")

    supervisor = CodexInterfaceSupervisor(
        repo_root=repo,
        frontend_restart_service="atlas-codex-preview-dashboard.service",
        backend_restart_service="atlas-codex-preview-server.service",
    )
    revision = supervisor.create_checkpoint(
        label="Preview restart-sensitive edit",
        description="Snapshot before preview route and config edit.",
        paths=[
            "atlas-dashboard/next.config.ts",
            "agent_server/src/routes/codex_runtime.py",
        ],
    )
    draft_root = Path(revision.draft_path or "")
    (draft_root / "atlas-dashboard" / "next.config.ts").write_text(
        "export default { poweredByHeader: false }\n",
        encoding="utf-8",
    )
    (draft_root / "agent_server" / "src" / "routes" / "codex_runtime.py").write_text(
        "after\n",
        encoding="utf-8",
    )
    calls: list[str] = []

    async def fake_restart(service_name: str, *, deferred: bool) -> dict[str, object]:
        calls.append(f"{service_name}:{deferred}")
        return {"service": service_name, "deferred": deferred, "ok": True}

    async def fake_validate(
        draft_root: Path,
        plan: InterfaceRestartPlan,
    ) -> tuple[bool, dict[str, object]]:
        return True, {"draft_path": draft_root.as_posix(), "changed_files": plan.changed_files}

    async def run() -> list[dict[str, object]]:
        return [
            step
            async for step in supervisor.prepare_validation_steps(
                revision.id,
                restart_service=fake_restart,
                draft_validator=fake_validate,
            )
        ]

    steps = asyncio.run(run())
    services = [step.get("service") for step in steps if step.get("service")]

    assert "atlas-codex-preview-dashboard.service" in services
    assert "atlas-codex-preview-server.service" in services
    assert calls == [
        "atlas-codex-preview-dashboard.service:False",
        "atlas-codex-preview-server.service:True",
    ]
    assert backend_route.read_text(encoding="utf-8") == "after\n"
