from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.codex_runtime import environment as codex_environment
from src.routes import codex_interface


def _test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(codex_interface.router)
    return app


def test_interface_checkpoint_refuses_preview_host_on_live_lane(monkeypatch) -> None:
    monkeypatch.setattr(codex_environment.settings, "codex_lane", "live")
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_public_host",
        "atlas-platform.cloud",
    )
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_interface_mutation_enabled",
        False,
    )

    async def run() -> dict[str, object]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app()),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/interface/checkpoints",
                headers={"host": "preview.atlas-platform.cloud"},
                json={"label": "Before edit"},
            )
        assert response.status_code == 409
        return response.json()

    payload = asyncio.run(run())

    assert "lane mismatch" in str(payload["detail"]).lower()
    detail = payload["detail"]
    assert isinstance(detail, dict)
    environment = detail["environment"]
    assert isinstance(environment, dict)
    assert environment["lane"] == "live"
    assert environment["requestHost"] == "preview.atlas-platform.cloud"
    assert environment["hostMatchesLane"] is False


def test_interface_checkpoint_refuses_disabled_live_mutation(
    monkeypatch,
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.setattr(codex_environment.settings, "atlas_root", repo.as_posix())
    monkeypatch.setattr(codex_environment.settings, "codex_lane", "live")
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_public_host",
        "atlas-platform.cloud",
    )
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_interface_mutation_enabled",
        False,
    )

    async def run() -> dict[str, object]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app()),
            base_url="http://atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/interface/checkpoints",
                headers={"host": "atlas-platform.cloud"},
                json={"label": "Before edit"},
            )
        assert response.status_code == 409
        return response.json()

    payload = asyncio.run(run())

    assert "mutation is disabled" in str(payload["detail"]).lower()
    detail = payload["detail"]
    assert isinstance(detail, dict)
    environment = detail["environment"]
    assert isinstance(environment, dict)
    assert environment["hostMatchesLane"] is True
    assert environment["interfaceMutationEnabled"] is False


def test_interface_checkpoint_uses_preview_draft_root_when_lane_is_safe(
    monkeypatch,
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    drafts_root = tmp_path / "preview-drafts"
    monkeypatch.setattr(codex_environment.settings, "atlas_root", repo.as_posix())
    monkeypatch.setattr(codex_environment.settings, "codex_lane", "preview")
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_public_host",
        "preview.atlas-platform.cloud",
    )
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_interface_mutation_enabled",
        True,
    )
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_interface_drafts_root",
        drafts_root.as_posix(),
    )

    async def run() -> dict[str, object]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app()),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/interface/checkpoints",
                headers={"host": "preview.atlas-platform.cloud"},
                json={"label": "Before preview edit"},
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    revision = payload["revision"]
    assert isinstance(revision, dict)
    assert str(revision["draft_path"]).startswith(drafts_root.as_posix())


def test_interface_health_probe_targets_isolated_visual_inspector(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"
        text = "<html>ok</html>"

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get(self, target: str, headers: dict[str, str]):
            captured["target"] = target
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(
        codex_interface,
        "codex_dashboard_url",
        lambda: "http://127.0.0.1:3010/codex",
    )
    monkeypatch.setattr(codex_interface.httpx, "AsyncClient", FakeAsyncClient)

    ok, diagnostic = asyncio.run(codex_interface._probe_codex_route("ui_probe"))

    assert ok is True
    target = str(captured["target"])
    assert "ui_rev=ui_probe" in target
    assert "inspector_target=1" in target
    assert "inspector_session=server-health-probe" in target
    assert diagnostic["target"] == target
