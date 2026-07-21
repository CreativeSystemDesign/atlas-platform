from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.codex_runtime.manager import (
    ATLAS_FAST_APP_EDITS_SKILL_PATH,
    CODEX_REASONING_SUMMARY_MODES,
    _codex_memory_observability,
    CodexRuntimeManager,
    sse_frame,
)
from src.codex_runtime import manager as codex_manager_module
from src.codex_runtime import environment as codex_environment
from src.codex_runtime.client import CodexJsonRpcError, CodexLaunchConfig
from src.routes import codex_runtime


class FakeCodexManager:
    def __init__(self) -> None:
        self.start_thread_calls: list[dict[str, Any]] = []
        self.list_threads_calls: list[dict[str, Any]] = []
        self.read_thread_calls: list[dict[str, Any]] = []
        self.list_thread_turns_calls: list[dict[str, Any]] = []
        self.list_thread_turn_items_calls: list[dict[str, Any]] = []
        self.set_thread_name_calls: list[dict[str, str]] = []
        self.get_thread_goal_calls: list[str] = []
        self.set_thread_goal_calls: list[dict[str, Any]] = []
        self.clear_thread_goal_calls: list[str] = []
        self.start_review_calls: list[dict[str, Any]] = []
        self.archive_thread_calls: list[str] = []
        self.unarchive_thread_calls: list[str] = []
        self.fork_thread_calls: list[dict[str, Any]] = []
        self.compact_thread_calls: list[str] = []
        self.rollback_thread_calls: list[dict[str, Any]] = []
        self.native_request_calls: list[dict[str, Any]] = []
        self.stream_turn_calls: list[dict[str, Any]] = []
        self.stream_new_thread_turn_calls: list[dict[str, Any]] = []
        self.set_thread_memory_mode_calls: list[dict[str, str]] = []
        self.set_memory_settings_calls: list[dict[str, str | None]] = []
        self.reset_memory_calls = 0
        self.steer_calls: list[dict[str, str]] = []
        self.interrupt_calls: list[dict[str, str]] = []

    async def list_models(self, *, include_hidden: bool = False) -> dict[str, Any]:
        return {
            "data": [
                {
                    "id": "gpt-5.4",
                    "displayName": "GPT-5.4",
                    "hidden": False,
                    "include_hidden": include_hidden,
                }
            ]
        }

    async def list_supported_models(
        self,
        *,
        include_hidden: bool = False,
        cwd: str | None = None,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        return {
            "data": [
                {
                    "id": "gpt-5.4",
                    "displayName": "GPT-5.4",
                    "hidden": False,
                    "supported": True,
                    "supportedSummaryModes": list(CODEX_REASONING_SUMMARY_MODES),
                    "include_hidden": include_hidden,
                    "cwd": cwd,
                    "force_refresh": force_refresh,
                }
            ],
            "unsupported": [
                {
                    "id": "gpt-5.1-codex-max",
                    "reason": (
                        "The 'gpt-5.1-codex-max' model is not supported when "
                        "using Codex with a ChatGPT account."
                    ),
                }
            ],
            "supportProbe": {"cached": False},
        }

    async def start_thread(self, **kwargs: Any) -> dict[str, Any]:
        self.start_thread_calls.append(kwargs)
        return {
            "thread": {"id": "thr_test", "turns": []},
            "cwd": kwargs["cwd"] or "/home/eshanegross/dev/atlas_platform",
            "model": kwargs["model"] or "gpt-5.4",
            "serviceTier": kwargs.get("service_tier"),
        }

    async def developer_capabilities(self, **kwargs: Any) -> dict[str, Any]:
        return {
            "checkedAt": "2026-05-18T00:00:00+00:00",
            "cwd": kwargs.get("cwd"),
            "threadId": kwargs.get("thread_id"),
            "memory": {"mode": "enabled"},
            "activeTurns": [],
            "sections": {
                "account": {
                    "method": "account/read",
                    "ok": True,
                    "payload": {
                        "account": {"email": "dev@example.com"},
                        "requiresOpenaiAuth": False,
                    },
                },
                "skills": {
                    "method": "skills/list",
                    "ok": True,
                    "payload": {"data": [{"cwd": kwargs.get("cwd"), "skills": []}]},
                },
                "threadGoal": {
                    "method": "thread/goal/get",
                    "ok": True,
                    "payload": {"goal": {"objective": "ship native console"}},
                },
            },
        }

    async def list_threads(self, **kwargs: Any) -> dict[str, Any]:
        self.list_threads_calls.append(kwargs)
        return {
            "data": [
                {
                    "id": "thr_visible",
                    "name": "Visible thread",
                    "preview": "hello",
                    "cwd": kwargs.get("cwd") or "/tmp/atlas",
                    "createdAt": 1_779_000_000,
                    "updatedAt": 1_779_000_010,
                    "status": {"type": "idle"},
                    "turns": [],
                }
            ],
            "nextCursor": "cursor-next",
            "backwardsCursor": None,
        }

    async def read_thread(
        self,
        *,
        thread_id: str,
        include_turns: bool = False,
    ) -> dict[str, Any]:
        self.read_thread_calls.append(
            {"thread_id": thread_id, "include_turns": include_turns}
        )
        return {
            "thread": {
                "id": thread_id,
                "name": "Visible thread",
                "preview": "hello",
                "turns": [{"id": "turn_one", "status": "completed"}]
                if include_turns
                else [],
            }
        }

    async def list_thread_turns(self, **kwargs: Any) -> dict[str, Any]:
        self.list_thread_turns_calls.append(kwargs)
        return {
            "data": [
                {
                    "id": "turn_one",
                    "status": "completed",
                    "itemsView": kwargs.get("items_view") or "summary",
                    "items": [],
                }
            ],
            "nextCursor": None,
        }

    async def list_thread_turn_items(self, **kwargs: Any) -> dict[str, Any]:
        self.list_thread_turn_items_calls.append(kwargs)
        return {
            "data": [
                {
                    "id": "item_one",
                    "type": "agentMessage",
                    "text": "Done",
                }
            ],
            "nextCursor": None,
        }

    async def set_thread_name(self, *, thread_id: str, name: str) -> dict[str, Any]:
        self.set_thread_name_calls.append({"thread_id": thread_id, "name": name})
        return {"threadId": thread_id, "name": name}

    async def get_thread_goal(self, *, thread_id: str) -> dict[str, Any]:
        self.get_thread_goal_calls.append(thread_id)
        return {"goal": {"objective": "ship native console", "status": "active"}}

    async def set_thread_goal(
        self,
        *,
        thread_id: str,
        objective: str | None = None,
        status: str | None = None,
        token_budget: int | None = None,
    ) -> dict[str, Any]:
        self.set_thread_goal_calls.append(
            {
                "thread_id": thread_id,
                "objective": objective,
                "status": status,
                "token_budget": token_budget,
            }
        )
        return {
            "goal": {
                "objective": objective,
                "status": status,
                "tokenBudget": token_budget,
            }
        }

    async def clear_thread_goal(self, *, thread_id: str) -> dict[str, Any]:
        self.clear_thread_goal_calls.append(thread_id)
        return {"cleared": True}

    async def start_review(
        self,
        *,
        thread_id: str,
        target: dict[str, Any],
        delivery: str | None = None,
    ) -> dict[str, Any]:
        self.start_review_calls.append(
            {"thread_id": thread_id, "target": target, "delivery": delivery}
        )
        return {
            "reviewThreadId": "thr_review",
            "turn": {"id": "turn_review", "status": "inProgress"},
        }

    async def archive_thread(self, *, thread_id: str) -> dict[str, Any]:
        self.archive_thread_calls.append(thread_id)
        return {"threadId": thread_id, "archived": True}

    async def unarchive_thread(self, *, thread_id: str) -> dict[str, Any]:
        self.unarchive_thread_calls.append(thread_id)
        return {"thread": {"id": thread_id, "turns": []}}

    async def fork_thread(self, **kwargs: Any) -> dict[str, Any]:
        self.fork_thread_calls.append(kwargs)
        return {"thread": {"id": "thr_forked", "forkedFromId": kwargs["thread_id"]}}

    async def compact_thread(self, *, thread_id: str) -> dict[str, Any]:
        self.compact_thread_calls.append(thread_id)
        return {"threadId": thread_id, "compactStarted": True}

    async def rollback_thread(
        self,
        *,
        thread_id: str,
        num_turns: int,
    ) -> dict[str, Any]:
        self.rollback_thread_calls.append(
            {"thread_id": thread_id, "num_turns": num_turns}
        )
        return {"thread": {"id": thread_id, "rolledBackTurns": num_turns}}

    async def native_request(
        self,
        *,
        method: str,
        params: dict[str, Any] | None = None,
        cwd: str | None = None,
        timeout: float = 12,
    ) -> dict[str, Any]:
        self.native_request_calls.append(
            {
                "method": method,
                "params": params or {},
                "cwd": cwd,
                "timeout": timeout,
            }
        )
        return {"method": method, "ok": True, "payload": {"echo": params or {}}}

    async def stream_turn(self, **kwargs: Any):
        self.stream_turn_calls.append(kwargs)
        yield {
            "event": "codex_response",
            "data": {
                "method": "turn/start",
                "result": {"turn": {"id": "turn_test", "status": "inProgress"}},
                "text": kwargs["text"],
                "visibleTranscript": kwargs.get("visible_transcript"),
            },
        }
        yield {
            "event": "codex_event",
            "data": {
                "method": "turn/completed",
                "params": {"turn": {"id": "turn_test", "status": "completed"}},
            },
        }

    async def stream_new_thread_turn(self, **kwargs: Any):
        self.stream_new_thread_turn_calls.append(kwargs)
        yield {
            "event": "codex_session",
            "data": {"threadId": "thr_fresh"},
        }
        yield {
            "event": "codex_response",
            "data": {
                "method": "thread/start",
                "result": {"thread": {"id": "thr_fresh"}},
            },
        }
        yield {
            "event": "codex_response",
            "data": {
                "method": "turn/start",
                "result": {"turn": {"id": "turn_fresh", "status": "inProgress"}},
                "text": kwargs["text"],
                "visibleTranscript": kwargs.get("visible_transcript"),
            },
        }
        yield {
            "event": "codex_event",
            "data": {
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "thr_fresh",
                    "turnId": "turn_fresh",
                    "delta": "hello",
                },
            },
        }

    async def steer(self, *, thread_id: str, turn_id: str, text: str) -> dict[str, Any]:
        self.steer_calls.append({"thread_id": thread_id, "turn_id": turn_id, "text": text})
        return {"turnId": turn_id}

    async def interrupt(self, *, thread_id: str, turn_id: str) -> dict[str, Any]:
        self.interrupt_calls.append({"thread_id": thread_id, "turn_id": turn_id})
        return {}

    async def set_thread_memory_mode(
        self,
        *,
        thread_id: str,
        mode: str,
    ) -> dict[str, Any]:
        self.set_thread_memory_mode_calls.append({"thread_id": thread_id, "mode": mode})
        return {"threadId": thread_id, "mode": mode}

    async def memory_settings(self) -> dict[str, Any]:
        return {
            "mode": "enabled",
            "default_from_env": "enabled",
            "availableModes": ["enabled", "disabled"],
            "canReset": True,
        }

    async def set_memory_settings(
        self,
        *,
        mode: str,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        self.set_memory_settings_calls.append({"mode": mode, "thread_id": thread_id})
        return {
            "mode": mode,
            "threadId": thread_id,
            "availableModes": ["enabled", "disabled"],
            "canReset": True,
        }

    async def reset_memory(self) -> dict[str, Any]:
        self.reset_memory_calls += 1
        return {"reset": True}


def _test_app(manager: FakeCodexManager) -> FastAPI:
    app = FastAPI()
    app.include_router(codex_runtime.router)
    app.dependency_overrides = {}
    codex_runtime.get_codex_runtime_manager = lambda: manager  # type: ignore[assignment]
    return app


def test_codex_models_route_returns_native_model_list() -> None:
    async def run() -> dict[str, Any]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/code/codex/models?include_hidden=true")
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert payload["data"][0]["id"] == "gpt-5.4"
    assert payload["data"][0]["include_hidden"] is True


def test_codex_audio_transcription_uses_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakeOpenRouterClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeOpenRouterClient":
            return self

        async def __aexit__(self, *args: Any) -> None:
            return None

        async def post(self, url: str, **kwargs: Any) -> codex_runtime.httpx.Response:
            captured["url"] = url
            captured["kwargs"] = kwargs
            return codex_runtime.httpx.Response(200, json={"text": "hello atlas"})

    monkeypatch.setattr(codex_runtime.settings, "openrouter_api_key", "sk-or-test")
    monkeypatch.setattr(
        codex_runtime.settings,
        "codex_transcription_model",
        "qwen/qwen3-asr-flash-2026-02-10",
    )
    monkeypatch.setattr(codex_runtime.httpx, "AsyncClient", FakeOpenRouterClient)

    async def run() -> dict[str, Any]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(FakeCodexManager())),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/audio/transcriptions?model=mistralai%2Fvoxtral-mini-transcribe",
                content=b"audio-bytes",
                headers={"Content-Type": "audio/webm;codecs=opus"},
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert payload == {"text": "hello atlas", "model": "mistralai/voxtral-mini-transcribe"}
    assert captured["url"] == "https://openrouter.ai/api/v1/audio/transcriptions"
    request_json = captured["kwargs"]["json"]
    assert request_json["model"] == "mistralai/voxtral-mini-transcribe"
    assert request_json["input_audio"]["format"] == "webm"
    assert request_json["input_audio"]["data"]
    assert captured["kwargs"]["headers"]["Authorization"] == "Bearer sk-or-test"


def test_codex_scoped_transcription_preference_route_uses_preview_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        codex_runtime.settings,
        "codex_transcription_model",
        "qwen/qwen3-asr-flash-2026-02-10",
    )

    async def fake_get_setting(key: str, default: str = "") -> str:
        assert key == "preferred_codex_transcription_model"
        return ""

    monkeypatch.setattr(codex_runtime, "get_setting", fake_get_setting)

    async def run() -> dict[str, Any]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(FakeCodexManager())),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.get(
                "/code/codex/settings/preferred-codex-transcription-model",
                headers={"host": "preview.atlas-platform.cloud"},
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert payload == {
        "model_id": None,
        "default_from_env": "qwen/qwen3-asr-flash-2026-02-10",
    }


def test_codex_audio_transcription_requires_openrouter_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(codex_runtime.settings, "openrouter_api_key", "")

    async def run() -> dict[str, Any]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(FakeCodexManager())),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/audio/transcriptions",
                content=b"audio",
                headers={"Content-Type": "audio/webm"},
            )
        assert response.status_code == 503
        return response.json()

    payload = asyncio.run(run())

    assert "OPENROUTER_API_KEY" in payload["detail"]


def test_codex_audio_transcription_reports_unavailable_model_clearly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeOpenRouterClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeOpenRouterClient":
            return self

        async def __aexit__(self, *args: Any) -> None:
            return None

        async def post(self, url: str, **kwargs: Any) -> codex_runtime.httpx.Response:
            return codex_runtime.httpx.Response(
                404,
                json={"error": {"message": "Not Found"}},
            )

    monkeypatch.setattr(codex_runtime.settings, "openrouter_api_key", "sk-or-test")
    monkeypatch.setattr(
        codex_runtime.settings,
        "codex_transcription_model",
        "qwen/qwen3-asr-flash-2026-02-10",
    )
    monkeypatch.setattr(codex_runtime.httpx, "AsyncClient", FakeOpenRouterClient)

    async def run() -> dict[str, Any]:
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(FakeCodexManager())),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/audio/transcriptions?model=bad%2Fmodel",
                content=b"audio",
                headers={"Content-Type": "audio/webm"},
            )
        assert response.status_code == 502
        return response.json()

    payload = asyncio.run(run())

    assert "bad/model" in payload["detail"]
    assert "not available for speech-to-text" in payload["detail"]


def test_codex_environment_route_marks_preview_lane_safe(monkeypatch) -> None:
    monkeypatch.setattr(codex_environment.settings, "codex_lane", "preview")
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_public_host",
        "preview.atlas-platform.cloud",
    )
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_dashboard_url",
        "http://127.0.0.1:3010/codex",
    )
    monkeypatch.setattr(
        codex_environment.settings,
        "codex_interface_mutation_enabled",
        True,
    )
    monkeypatch.setattr(codex_environment.settings, "atlas_root", "/tmp/atlas-preview")

    async def run() -> dict[str, Any]:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.get(
                "/code/codex/environment",
                headers={"host": "preview.atlas-platform.cloud"},
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert payload["lane"] == "preview"
    assert payload["repoRoot"] == "/tmp/atlas-preview"
    assert payload["expectedHost"] == "preview.atlas-platform.cloud"
    assert payload["hostMatchesLane"] is True
    assert payload["interfaceMutationEnabled"] is True
    assert payload["interfaceMutationSafe"] is True


def test_codex_environment_route_detects_preview_host_on_live_lane(
    monkeypatch,
) -> None:
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
    monkeypatch.setattr(codex_environment.settings, "atlas_root", "/tmp/atlas-live")

    async def run() -> dict[str, Any]:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.get(
                "/code/codex/environment",
                headers={"host": "preview.atlas-platform.cloud"},
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert payload["lane"] == "live"
    assert payload["expectedHost"] == "atlas-platform.cloud"
    assert payload["requestHost"] == "preview.atlas-platform.cloud"
    assert payload["hostMatchesLane"] is False
    assert payload["interfaceMutationSafe"] is False


def test_codex_supported_models_route_filters_unusable_models() -> None:
    async def run() -> dict[str, Any]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.get(
                "/code/codex/models/supported"
                "?cwd=/tmp/atlas&force_refresh=true"
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert [model["id"] for model in payload["data"]] == ["gpt-5.4"]
    assert payload["data"][0]["supported"] is True
    assert payload["data"][0]["supportedSummaryModes"] == [
        "none",
        "auto",
        "concise",
        "detailed",
    ]
    assert payload["data"][0]["cwd"] == "/tmp/atlas"
    assert payload["data"][0]["force_refresh"] is True
    assert payload["unsupported"][0]["id"] == "gpt-5.1-codex-max"


def test_codex_runtime_manager_marks_supported_models_with_reasoning_summaries() -> None:
    async def run() -> dict[str, Any]:
        manager = CodexRuntimeManager()

        async def fake_list_models(*, include_hidden: bool = False) -> dict[str, Any]:
            return {
                "data": [
                    {
                        "id": "gpt-5.5",
                        "displayName": "GPT-5.5",
                        "hidden": False,
                    }
                ]
            }

        async def fake_probe_model_support(
            model: dict[str, Any],
            *,
            cwd: str,
        ) -> dict[str, Any]:
            return {"supported": True, "status": "supported"}

        manager.list_models = fake_list_models  # type: ignore[method-assign]
        manager._probe_model_support = fake_probe_model_support  # type: ignore[method-assign]
        return await manager.list_supported_models(cwd="/tmp/atlas", force_refresh=True)

    payload = asyncio.run(run())

    assert payload["data"][0]["id"] == "gpt-5.5"
    assert payload["data"][0]["supportedSummaryModes"] == [
        "none",
        "auto",
        "concise",
        "detailed",
    ]


def test_codex_runtime_manager_reports_unsupported_turn_item_capability() -> None:
    async def run() -> dict[str, Any]:
        manager = CodexRuntimeManager()

        async def fake_codex_request(
            method: str,
            params: dict[str, Any] | None = None,
            *,
            timeout: float = 30,
        ) -> dict[str, Any]:
            raise CodexJsonRpcError(
                {"message": f"{method} is not supported yet", "code": -32601}
            )

        manager._codex_request = fake_codex_request  # type: ignore[method-assign]
        return await manager.list_thread_turn_items(
            thread_id="thr_visible",
            turn_id="turn_one",
            limit=8,
            sort_direction="asc",
        )

    payload = asyncio.run(run())

    assert payload["data"] == []
    assert payload["capability"] == {
        "method": "thread/turns/items/list",
        "supported": False,
        "reason": "thread/turns/items/list is not supported yet",
    }


def test_codex_start_thread_route_returns_codex_thread() -> None:
    async def run() -> dict[str, Any]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/threads",
                json={
                    "cwd": "/tmp",
                    "model": "gpt-5.4",
                    "service_tier": "priority",
                    "effort": "xhigh",
                },
            )
        assert response.status_code == 200
        return {"payload": response.json(), "manager": manager}

    result = asyncio.run(run())
    payload = result["payload"]
    manager = result["manager"]

    assert payload["thread"]["id"] == "thr_test"
    assert payload["model"] == "gpt-5.4"
    assert payload["serviceTier"] == "priority"
    assert manager.start_thread_calls[0]["service_tier"] == "priority"


def test_codex_thread_library_routes_expose_native_conversation_state() -> None:
    async def run() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], FakeCodexManager]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            listed = await client.get(
                "/code/codex/threads"
                "?archived=false&cwd=/tmp/atlas&search_term=Visible&limit=12"
                "&sort_key=updated_at&sort_direction=desc&use_state_db_only=true"
            )
            read = await client.get(
                "/code/codex/threads/thr_visible?include_turns=true"
            )
            turns = await client.get(
                "/code/codex/threads/thr_visible/turns"
                "?items_view=summary&sort_direction=asc&limit=4"
            )
            items = await client.get(
                "/code/codex/threads/thr_visible/turns/turn_one/items"
                "?sort_direction=asc&limit=8"
            )
        assert listed.status_code == 200
        assert read.status_code == 200
        assert turns.status_code == 200
        assert items.status_code == 200
        return listed.json(), read.json(), turns.json(), items.json(), manager

    listed, read, turns, items, manager = asyncio.run(run())

    assert listed["data"][0]["id"] == "thr_visible"
    assert read["thread"]["turns"][0]["id"] == "turn_one"
    assert turns["data"][0]["itemsView"] == "summary"
    assert items["data"][0]["type"] == "agentMessage"
    assert manager.list_threads_calls == [
        {
            "archived": False,
            "cursor": None,
            "cwd": "/tmp/atlas",
            "include_support_probes": False,
            "limit": 12,
            "search_term": "Visible",
            "sort_direction": "desc",
            "sort_key": "updated_at",
            "use_state_db_only": True,
        }
    ]
    assert manager.read_thread_calls == [
        {"thread_id": "thr_visible", "include_turns": True}
    ]
    assert manager.list_thread_turns_calls == [
        {
            "thread_id": "thr_visible",
            "cursor": None,
            "items_view": "summary",
            "limit": 4,
            "sort_direction": "asc",
        }
    ]
    assert manager.list_thread_turn_items_calls == [
        {
            "thread_id": "thr_visible",
            "turn_id": "turn_one",
            "cursor": None,
            "limit": 8,
            "sort_direction": "asc",
        }
    ]


def test_codex_developer_capability_route_exposes_native_snapshot() -> None:
    async def run() -> dict[str, Any]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.get(
                "/code/codex/developer/capabilities"
                "?cwd=/tmp/atlas&thread_id=thr_visible"
            )
        assert response.status_code == 200
        return response.json()

    payload = asyncio.run(run())

    assert payload["cwd"] == "/tmp/atlas"
    assert payload["threadId"] == "thr_visible"
    assert payload["sections"]["account"]["method"] == "account/read"
    assert payload["sections"]["threadGoal"]["payload"]["goal"]["objective"] == (
        "ship native console"
    )


def test_codex_developer_native_request_route_runs_arbitrary_native_method() -> None:
    async def run() -> tuple[dict[str, Any], FakeCodexManager]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/developer/native-request",
                json={
                    "method": "config/read",
                    "params": {"cwd": "/tmp/atlas", "includeLayers": True},
                    "cwd": "/tmp/atlas",
                    "timeout": 7,
                },
            )
        assert response.status_code == 200
        return response.json(), manager

    payload, manager = asyncio.run(run())

    assert payload == {
        "method": "config/read",
        "ok": True,
        "payload": {"echo": {"cwd": "/tmp/atlas", "includeLayers": True}},
    }
    assert manager.native_request_calls == [
        {
            "method": "config/read",
            "params": {"cwd": "/tmp/atlas", "includeLayers": True},
            "cwd": "/tmp/atlas",
            "timeout": 7,
        }
    ]


def test_codex_thread_list_hides_support_probe_noise_by_default() -> None:
    async def run() -> tuple[dict[str, Any], dict[str, Any]]:
        manager = CodexRuntimeManager()

        async def fake_codex_request(
            method: str,
            params: dict[str, Any] | None = None,
            *,
            timeout: float = 30,
        ) -> dict[str, Any]:
            assert method == "thread/list"
            return {
                "data": [
                    {
                        "id": "probe_thread",
                        "preview": "Reply with exactly: OK",
                    },
                    {
                        "id": "real_thread",
                        "preview": "fix the model picker",
                    },
                ],
                "nextCursor": "next",
            }

        manager._codex_request = fake_codex_request  # type: ignore[method-assign]
        filtered = await manager.list_threads()
        unfiltered = await manager.list_threads(include_support_probes=True)
        return filtered, unfiltered

    filtered, unfiltered = asyncio.run(run())

    assert [item["id"] for item in filtered["data"]] == ["real_thread"]
    assert [item["id"] for item in unfiltered["data"]] == [
        "probe_thread",
        "real_thread",
    ]


def test_codex_thread_goal_and_review_routes_delegate_to_native_methods() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            goal = await client.get("/code/codex/threads/thr_visible/goal")
            set_goal = await client.put(
                "/code/codex/threads/thr_visible/goal",
                json={
                    "objective": "Finish native developer console",
                    "status": "active",
                    "token_budget": 120000,
                },
            )
            clear_goal = await client.delete("/code/codex/threads/thr_visible/goal")
            review = await client.post(
                "/code/codex/threads/thr_visible/review",
                json={
                    "target": {"type": "uncommittedChanges"},
                    "delivery": "detached",
                },
            )
        assert goal.status_code == 200
        assert set_goal.status_code == 200
        assert clear_goal.status_code == 200
        assert review.status_code == 200
        return manager

    manager = asyncio.run(run())

    assert manager.get_thread_goal_calls == ["thr_visible"]
    assert manager.set_thread_goal_calls == [
        {
            "thread_id": "thr_visible",
            "objective": "Finish native developer console",
            "status": "active",
            "token_budget": 120000,
        }
    ]
    assert manager.clear_thread_goal_calls == ["thr_visible"]
    assert manager.start_review_calls == [
        {
            "thread_id": "thr_visible",
            "target": {"type": "uncommittedChanges"},
            "delivery": "detached",
        }
    ]


def test_codex_thread_goal_routes_do_not_report_disabled_features_as_gateway_errors() -> None:
    class DisabledGoalManager(FakeCodexManager):
        async def set_thread_goal(self, **_kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("goals feature is disabled")

        async def clear_thread_goal(self, *, thread_id: str) -> dict[str, Any]:
            raise RuntimeError("goals feature is disabled")

    async def run() -> tuple[dict[str, Any], dict[str, Any], int, int]:
        manager = DisabledGoalManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            set_goal = await client.put(
                "/code/codex/threads/thr_visible/goal",
                json={"objective": "disabled feature", "status": "active"},
            )
            clear_goal = await client.delete("/code/codex/threads/thr_visible/goal")
        return (
            set_goal.json(),
            clear_goal.json(),
            set_goal.status_code,
            clear_goal.status_code,
        )

    set_payload, clear_payload, set_status, clear_status = asyncio.run(run())

    assert set_status == 424
    assert clear_status == 424
    assert set_payload == {"detail": "goals feature is disabled"}
    assert clear_payload == {"detail": "goals feature is disabled"}


def test_codex_thread_lifecycle_routes_map_native_unavailable_errors() -> None:
    class DisabledLifecycleManager(FakeCodexManager):
        async def compact_thread(self, *, thread_id: str) -> dict[str, Any]:
            raise RuntimeError("thread/compact/start is not supported yet")

        async def rollback_thread(
            self,
            *,
            thread_id: str,
            num_turns: int,
        ) -> dict[str, Any]:
            raise RuntimeError("thread/rollback is not available")

    async def run() -> tuple[dict[str, Any], dict[str, Any], int, int]:
        manager = DisabledLifecycleManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            compact = await client.post("/code/codex/threads/thr_visible/compact")
            rollback = await client.post(
                "/code/codex/threads/thr_visible/rollback",
                json={"num_turns": 1},
            )
        return compact.json(), rollback.json(), compact.status_code, rollback.status_code

    compact_payload, rollback_payload, compact_status, rollback_status = asyncio.run(run())

    assert compact_status == 424
    assert rollback_status == 424
    assert compact_payload == {"detail": "thread/compact/start is not supported yet"}
    assert rollback_payload == {"detail": "thread/rollback is not available"}


def test_codex_native_control_routes_avoid_cloudflare_gateway_statuses() -> None:
    class FailingReviewManager(FakeCodexManager):
        async def start_review(self, **_kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("native review failed upstream")

    async def run() -> tuple[dict[str, Any], int]:
        manager = FailingReviewManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            review = await client.post(
                "/code/codex/threads/thr_visible/review",
                json={"target": {"type": "uncommittedChanges"}},
            )
        return review.json(), review.status_code

    payload, status = asyncio.run(run())

    assert status == 424
    assert payload == {"detail": "native review failed upstream"}


def test_codex_thread_lifecycle_routes_delegate_to_native_thread_methods() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            rename = await client.put(
                "/code/codex/threads/thr_visible/name",
                json={"name": "Purchaser review"},
            )
            archive = await client.post("/code/codex/threads/thr_visible/archive")
            unarchive = await client.post("/code/codex/threads/thr_visible/unarchive")
            fork = await client.post(
                "/code/codex/threads/thr_visible/fork",
                json={
                    "cwd": "/tmp/atlas",
                    "model": "gpt-5.5",
                    "service_tier": "priority",
                    "effort": "xhigh",
                    "developer_instructions": "fork test",
                    "exclude_turns": True,
                },
            )
            compact = await client.post("/code/codex/threads/thr_visible/compact")
            rollback = await client.post(
                "/code/codex/threads/thr_visible/rollback",
                json={"num_turns": 2},
            )
        assert rename.status_code == 200
        assert archive.status_code == 200
        assert unarchive.status_code == 200
        assert fork.status_code == 200
        assert compact.status_code == 200
        assert rollback.status_code == 200
        return manager

    manager = asyncio.run(run())

    assert manager.set_thread_name_calls == [
        {"thread_id": "thr_visible", "name": "Purchaser review"}
    ]
    assert manager.archive_thread_calls == ["thr_visible"]
    assert manager.unarchive_thread_calls == ["thr_visible"]
    assert manager.fork_thread_calls == [
        {
            "thread_id": "thr_visible",
            "cwd": "/tmp/atlas",
            "model": "gpt-5.5",
            "service_tier": "priority",
            "effort": "xhigh",
            "developer_instructions": "fork test",
            "exclude_turns": True,
        }
    ]
    assert manager.compact_thread_calls == ["thr_visible"]
    assert manager.rollback_thread_calls == [
        {"thread_id": "thr_visible", "num_turns": 2}
    ]


def test_codex_preview_promote_route_requires_preview_host() -> None:
    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/preview/promote",
                headers={"host": "atlas-platform.cloud"},
            )

        assert response.status_code == 403
        assert "preview" in response.json()["detail"].lower()

    asyncio.run(run())


def test_codex_preview_promote_route_runs_promotion_for_preview_host(
    monkeypatch,
) -> None:
    async def fake_start_codex_preview_promotion(*, timeout: float):
        return {
            "ok": False,
            "state": "running",
            "exitCode": 0,
            "output": "Preview promotion started.",
            "timeout": timeout,
        }

    monkeypatch.setattr(
        codex_runtime,
        "start_codex_preview_promotion",
        fake_start_codex_preview_promotion,
    )

    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/preview/promote",
                headers={"host": "preview.atlas-platform.cloud"},
                json={"timeout": 42},
            )

        assert response.status_code == 200
        assert response.json() == {
            "ok": False,
            "state": "running",
            "exitCode": 0,
            "output": "Preview promotion started.",
            "timeout": 42,
        }

    asyncio.run(run())


def test_codex_preview_promote_route_reports_status_for_preview_host(
    monkeypatch,
) -> None:
    def fake_current_codex_preview_promotion():
        return {
            "ok": True,
            "state": "succeeded",
            "exitCode": 0,
            "output": "verified\ndeployed",
            "promotedAt": "2026-05-18T18:00:00Z",
        }

    monkeypatch.setattr(
        codex_runtime,
        "current_codex_preview_promotion",
        fake_current_codex_preview_promotion,
    )

    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.get(
                "/code/codex/preview/promote",
                headers={"host": "preview.atlas-platform.cloud"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "state": "succeeded",
            "exitCode": 0,
            "output": "verified\ndeployed",
            "promotedAt": "2026-05-18T18:00:00Z",
        }

    asyncio.run(run())


def test_codex_preview_pull_live_route_requires_preview_host() -> None:
    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/preview/pull-live",
                headers={"host": "atlas-platform.cloud"},
            )

        assert response.status_code == 403
        assert "preview" in response.json()["detail"].lower()

    asyncio.run(run())


def test_codex_preview_pull_live_route_runs_for_preview_host(monkeypatch) -> None:
    async def fake_start_codex_preview_pull_live(*, timeout: float):
        return {
            "ok": False,
            "state": "running",
            "exitCode": 0,
            "output": "Preview live pull started.",
            "timeout": timeout,
        }

    def fake_codex_preview_pull_live_safety():
        return {
            "okToPull": True,
            "requiresConfirmation": False,
            "blockers": [],
            "dirty": [],
            "activeRevisions": [],
            "drafts": [],
        }

    monkeypatch.setattr(
        codex_runtime,
        "codex_preview_pull_live_safety",
        fake_codex_preview_pull_live_safety,
    )
    monkeypatch.setattr(
        codex_runtime,
        "start_codex_preview_pull_live",
        fake_start_codex_preview_pull_live,
    )

    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/preview/pull-live",
                headers={"host": "preview.atlas-platform.cloud"},
                json={"timeout": 30},
            )

        assert response.status_code == 200
        assert response.json() == {
            "ok": False,
            "state": "running",
            "exitCode": 0,
            "output": "Preview live pull started.",
            "timeout": 30,
        }

    asyncio.run(run())


def test_codex_preview_pull_live_refuses_unsafe_reset_without_confirmation(
    monkeypatch,
) -> None:
    async def fake_start_codex_preview_pull_live(*, timeout: float):
        raise AssertionError("unsafe pull-live should not start")

    def fake_codex_preview_pull_live_safety():
        return {
            "okToPull": False,
            "requiresConfirmation": True,
            "confirmationToken": "RESET_PREVIEW_TO_LIVE",
            "blockers": ["preview checkout has uncommitted or untracked changes"],
            "dirty": [" M atlas-dashboard/src/components/code/codex-adaptive-workspace.tsx"],
            "activeRevisions": [],
            "drafts": [],
        }

    monkeypatch.setattr(
        codex_runtime,
        "codex_preview_pull_live_safety",
        fake_codex_preview_pull_live_safety,
    )
    monkeypatch.setattr(
        codex_runtime,
        "start_codex_preview_pull_live",
        fake_start_codex_preview_pull_live,
    )

    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/preview/pull-live",
                headers={"host": "preview.atlas-platform.cloud"},
                json={"timeout": 30},
            )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert "reset active preview work" in detail["message"]
        assert detail["requiredConfirmationToken"] == "RESET_PREVIEW_TO_LIVE"
        assert detail["safety"]["dirty"]

    asyncio.run(run())


def test_codex_preview_pull_live_allows_explicitly_confirmed_reset(
    monkeypatch,
) -> None:
    async def fake_start_codex_preview_pull_live(*, timeout: float):
        return {
            "ok": False,
            "state": "running",
            "exitCode": 0,
            "output": "Preview live pull started.",
            "timeout": timeout,
        }

    def fake_codex_preview_pull_live_safety():
        return {
            "okToPull": False,
            "requiresConfirmation": True,
            "confirmationToken": "RESET_PREVIEW_TO_LIVE",
            "blockers": ["interface draft workspaces exist"],
            "dirty": [],
            "activeRevisions": [],
            "drafts": [{"id": "ui_123", "path": "/tmp/ui_123"}],
        }

    monkeypatch.setattr(
        codex_runtime,
        "codex_preview_pull_live_safety",
        fake_codex_preview_pull_live_safety,
    )
    monkeypatch.setattr(
        codex_runtime,
        "start_codex_preview_pull_live",
        fake_start_codex_preview_pull_live,
    )

    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.post(
                "/code/codex/preview/pull-live",
                headers={"host": "preview.atlas-platform.cloud"},
                json={
                    "timeout": 30,
                    "confirm_reset_to_live": True,
                    "confirmation_token": "RESET_PREVIEW_TO_LIVE",
                },
            )

        assert response.status_code == 200
        assert response.json()["state"] == "running"

    asyncio.run(run())


def test_codex_preview_pull_live_route_reports_status_for_preview_host(
    monkeypatch,
) -> None:
    def fake_current_codex_preview_pull_live():
        return {
            "ok": True,
            "state": "succeeded",
            "exitCode": 0,
            "output": "preview reset",
            "pulledAt": "2026-05-18T18:00:00Z",
        }

    monkeypatch.setattr(
        codex_runtime,
        "current_codex_preview_pull_live",
        fake_current_codex_preview_pull_live,
    )

    async def run() -> None:
        app = _test_app(FakeCodexManager())
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://preview.atlas-platform.cloud",
        ) as client:
            response = await client.get(
                "/code/codex/preview/pull-live",
                headers={"host": "preview.atlas-platform.cloud"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "state": "succeeded",
            "exitCode": 0,
            "output": "preview reset",
            "pulledAt": "2026-05-18T18:00:00Z",
        }

    asyncio.run(run())


def test_codex_new_thread_turn_stream_keeps_native_lifecycle_together() -> None:
    async def run() -> str:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/turns/stream",
                json={
                    "text": "hello",
                    "model": "gpt-5.4",
                    "service_tier": "priority",
                    "effort": "low",
                },
            )
        assert response.status_code == 200
        return response.text, manager

    body, manager = asyncio.run(run())

    assert "event: codex_session" in body
    assert '"threadId":"thr_fresh"' in body
    assert '"method":"thread/start"' in body
    assert '"method":"turn/start"' in body
    assert '"delta":"hello"' in body
    assert manager.stream_new_thread_turn_calls[0]["service_tier"] == "priority"
    assert manager.stream_new_thread_turn_calls[0]["summary"] == "auto"


def test_codex_session_turn_stream_creates_or_resumes_native_thread() -> None:
    async def run() -> tuple[str, str, FakeCodexManager]:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            first = await client.post(
                "/code/codex/session/turns/stream",
                json={
                    "text": "hello",
                    "model": "gpt-5.5",
                    "service_tier": "priority",
                    "developer_instructions": "native codex session",
                    "visible_transcript": "Prior visible browser transcript.",
                },
            )
            second = await client.post(
                "/code/codex/session/turns/stream",
                json={
                    "thread_id": "thr_fresh",
                    "text": "follow up",
                    "model": "gpt-5.5",
                    "developer_instructions": "native codex session",
                },
            )
        assert first.status_code == 200
        assert second.status_code == 200
        return first.text, second.text, manager

    first_body, second_body, manager = asyncio.run(run())

    assert "event: codex_session" in first_body
    assert '"threadId":"thr_fresh"' in first_body
    assert "event: codex_response" in second_body
    assert manager.stream_new_thread_turn_calls[0]["text"] == "hello"
    assert manager.stream_new_thread_turn_calls[0]["service_tier"] == "priority"
    assert manager.stream_new_thread_turn_calls[0]["visible_transcript"] == (
        "Prior visible browser transcript."
    )
    assert manager.stream_new_thread_turn_calls[0]["interface_mutation_requested"] is False
    assert manager.stream_turn_calls[0]["thread_id"] == "thr_fresh"
    assert manager.stream_turn_calls[0]["text"] == "follow up"
    assert manager.stream_turn_calls[0]["developer_instructions"] == (
        "native codex session"
    )
    assert manager.stream_turn_calls[0]["interface_mutation_requested"] is False


def test_codex_session_turn_stream_passes_interface_mutation_flag() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/session/turns/stream",
                json={
                    "text": "remove the telemetry panel",
                    "model": "gpt-5.5",
                    "interface_mutation_requested": True,
                },
            )
        assert response.status_code == 200
        return manager

    manager = asyncio.run(run())

    assert manager.stream_new_thread_turn_calls[0]["interface_mutation_requested"] is True


def test_codex_session_turn_stream_passes_memory_mode() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/session/turns/stream",
                json={
                    "text": "hello",
                    "model": "gpt-5.5",
                    "memory_mode": "enabled",
                },
            )
        assert response.status_code == 200
        return manager

    manager = asyncio.run(run())

    assert manager.stream_new_thread_turn_calls[0]["memory_mode"] == "enabled"


def test_codex_thread_memory_mode_route_sets_native_thread_mode() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/threads/thr_memory/memory-mode",
                json={"mode": "disabled"},
            )
        assert response.status_code == 200
        assert response.json() == {"threadId": "thr_memory", "mode": "disabled"}
        return manager

    manager = asyncio.run(run())

    assert manager.set_thread_memory_mode_calls == [
        {"thread_id": "thr_memory", "mode": "disabled"}
    ]


def test_codex_memory_settings_routes_are_backend_owned() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            get_response = await client.get("/code/codex/memory")
            put_response = await client.put(
                "/code/codex/memory",
                json={"mode": "enabled", "thread_id": "thr_current"},
            )
        assert get_response.status_code == 200
        assert get_response.json()["mode"] == "enabled"
        assert put_response.status_code == 200
        assert put_response.json()["mode"] == "enabled"
        return manager

    manager = asyncio.run(run())

    assert manager.set_memory_settings_calls == [
        {"mode": "enabled", "thread_id": "thr_current"}
    ]


def test_codex_memory_observability_reports_codex_home_artifacts(tmp_path: Path) -> None:
    codex_home = tmp_path / "codex-home"
    memories_dir = codex_home / "memories"
    summaries_dir = memories_dir / "rollout_summaries"
    summaries_dir.mkdir(parents=True)
    raw_memories = memories_dir / "raw_memories.md"
    raw_memories.write_text("# Memory\n\nAtlas Codex prefers concise UI.", encoding="utf-8")
    (summaries_dir / "summary.md").write_text("summary", encoding="utf-8")

    payload = _codex_memory_observability(
        CodexLaunchConfig(env={"CODEX_HOME": str(codex_home)})
    )

    assert payload["codexHome"] == str(codex_home)
    assert payload["memoryDirectory"] == str(memories_dir)
    assert payload["memoryDirectoryExists"] is True
    assert payload["artifactCount"] == 2
    assert payload["lastModified"]
    artifacts = {artifact["name"]: artifact for artifact in payload["artifacts"]}
    assert artifacts["raw_memories.md"]["exists"] is True
    assert artifacts["raw_memories.md"]["sizeBytes"] > 0
    assert artifacts["rollout_summaries"]["entryCount"] == 1


def test_codex_memory_reset_route_calls_native_memory_reset() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post("/code/codex/memory/reset")
        assert response.status_code == 200
        assert response.json() == {"reset": True}
        return manager

    manager = asyncio.run(run())

    assert manager.reset_memory_calls == 1


def test_codex_turn_route_rejects_unknown_service_tier() -> None:
    async def run() -> int:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/code/codex/turns/stream",
                json={
                    "text": "hello",
                    "model": "gpt-5.5",
                    "service_tier": "fast",
                    "effort": "medium",
                },
            )
        return response.status_code

    assert asyncio.run(run()) == 422


def test_codex_steer_and_interrupt_routes_call_active_manager() -> None:
    async def run() -> FakeCodexManager:
        manager = FakeCodexManager()
        async with AsyncClient(
            transport=ASGITransport(app=_test_app(manager)),
            base_url="http://testserver",
        ) as client:
            steer = await client.post(
                "/code/codex/threads/thr_test/turns/turn_test/steer",
                json={"text": "focus on tests"},
            )
            interrupt = await client.post(
                "/code/codex/threads/thr_test/turns/turn_test/interrupt"
            )
        assert steer.status_code == 200
        assert interrupt.status_code == 200
        return manager

    manager = asyncio.run(run())

    assert manager.steer_calls == [
        {"thread_id": "thr_test", "turn_id": "turn_test", "text": "focus on tests"}
    ]
    assert manager.interrupt_calls == [{"thread_id": "thr_test", "turn_id": "turn_test"}]


def test_sse_frame_preserves_native_payload_shape() -> None:
    frame = sse_frame(
        {
            "event": "codex_event",
            "data": {
                "method": "item/agentMessage/delta",
                "params": {"threadId": "thr", "turnId": "turn", "delta": "hello"},
            },
        }
    )

    assert frame["event"] == "codex_event"
    assert json.loads(frame["data"])["method"] == "item/agentMessage/delta"


def test_codex_runtime_manager_injects_visible_transcript_as_native_history() -> None:
    class FakeInjectClient:
        def __init__(self) -> None:
            self.requests: list[dict[str, Any]] = []

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            return {}

    async def run() -> FakeInjectClient:
        manager = CodexRuntimeManager()
        client = FakeInjectClient()
        injected = await manager._inject_visible_transcript(  # noqa: SLF001
            client,  # type: ignore[arg-type]
            thread_id="thr_visible",
            visible_transcript="Visible browser transcript",
        )
        assert injected is True
        return client

    client = asyncio.run(run())

    assert client.requests == [
        {
            "method": "thread/inject_items",
            "params": {
                "threadId": "thr_visible",
                "items": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Visible browser transcript",
                            }
                        ],
                    }
                ],
            },
            "timeout": 30,
        }
    ]


def test_codex_runtime_manager_detects_missing_resumed_thread_history() -> None:
    class FakeHistoryClient:
        def __init__(self, payload: dict[str, Any]) -> None:
            self.payload = payload
            self.requests: list[dict[str, Any]] = []

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            return self.payload

    async def run() -> tuple[bool, bool, FakeHistoryClient, FakeHistoryClient]:
        manager = CodexRuntimeManager()
        empty_client = FakeHistoryClient({"data": []})
        populated_client = FakeHistoryClient({"data": [{"id": "turn_existing"}]})

        empty_has_history = await manager._thread_has_recoverable_history(  # noqa: SLF001
            empty_client,  # type: ignore[arg-type]
            thread_id="thr_empty",
        )
        populated_has_history = await manager._thread_has_recoverable_history(  # noqa: SLF001
            populated_client,  # type: ignore[arg-type]
            thread_id="thr_populated",
        )
        return empty_has_history, populated_has_history, empty_client, populated_client

    empty_has_history, populated_has_history, empty_client, populated_client = asyncio.run(
        run()
    )

    assert empty_has_history is False
    assert populated_has_history is True
    assert empty_client.requests[0]["method"] == "thread/turns/list"
    assert empty_client.requests[0]["params"] == {
        "threadId": "thr_empty",
        "itemsView": "summary",
        "limit": 1,
        "sortDirection": "desc",
    }
    assert populated_client.requests[0]["method"] == "thread/turns/list"


def test_codex_runtime_manager_injects_visible_transcript_when_resume_has_no_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResumeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            self.requests: list[dict[str, Any]] = []

        async def start(self) -> None:
            return None

        async def close(self) -> None:
            return None

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            if method == "thread/turns/list":
                return {"data": []}
            if method == "turn/start":
                return {"turn": {"id": "turn_followup", "status": "inProgress"}}
            return {}

        async def notifications(self):
            yield {
                "method": "turn/completed",
                "params": {"turn": {"id": "turn_followup", "status": "completed"}},
            }

    clients: list[FakeResumeClient] = []

    def fake_client_factory(*args: Any, **kwargs: Any) -> FakeResumeClient:
        client = FakeResumeClient(*args, **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(
        codex_manager_module,
        "CodexAppServerClient",
        fake_client_factory,
    )

    async def run() -> list[dict[str, Any]]:
        manager = CodexRuntimeManager()
        events: list[dict[str, Any]] = []
        async for event in manager.stream_turn(
            thread_id="thr_followup",
            text="What about the model picker?",
            cwd="/tmp",
            model="gpt-5.5",
            effort="medium",
            summary="auto",
            visible_transcript="User: implement transcription\nCodex: Done.",
            memory_mode="inherit",
        ):
            events.append(event)
        return events

    events = asyncio.run(run())

    assert [request["method"] for request in clients[0].requests] == [
        "thread/resume",
        "thread/turns/list",
        "thread/inject_items",
        "turn/start",
    ]
    assert clients[0].requests[2]["params"]["items"][0]["content"][0]["text"] == (
        "User: implement transcription\nCodex: Done."
    )
    assert any(
        event["event"] == "codex_context"
        and event["data"]["reason"] == "resume_missing_history"
        for event in events
    )


def test_codex_runtime_manager_skips_visible_transcript_when_resume_has_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResumeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            self.requests: list[dict[str, Any]] = []

        async def start(self) -> None:
            return None

        async def close(self) -> None:
            return None

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            if method == "thread/turns/list":
                return {"data": [{"id": "turn_previous"}]}
            if method == "turn/start":
                return {"turn": {"id": "turn_followup", "status": "inProgress"}}
            return {}

        async def notifications(self):
            yield {
                "method": "turn/completed",
                "params": {"turn": {"id": "turn_followup", "status": "completed"}},
            }

    clients: list[FakeResumeClient] = []

    def fake_client_factory(*args: Any, **kwargs: Any) -> FakeResumeClient:
        client = FakeResumeClient(*args, **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(
        codex_manager_module,
        "CodexAppServerClient",
        fake_client_factory,
    )

    async def run() -> list[dict[str, Any]]:
        manager = CodexRuntimeManager()
        events: list[dict[str, Any]] = []
        async for event in manager.stream_turn(
            thread_id="thr_followup",
            text="What about the model picker?",
            cwd="/tmp",
            model="gpt-5.5",
            effort="medium",
            summary="auto",
            visible_transcript="User: implement transcription\nCodex: Done.",
            memory_mode="inherit",
        ):
            events.append(event)
        return events

    events = asyncio.run(run())

    assert [request["method"] for request in clients[0].requests] == [
        "thread/resume",
        "thread/turns/list",
        "turn/start",
    ]
    assert not any(event["event"] == "codex_context" for event in events)


def test_codex_runtime_manager_sends_plain_chat_as_plain_text_input() -> None:
    class FakeTurnClient:
        def __init__(self) -> None:
            self.requests: list[dict[str, Any]] = []

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            return {"turn": {"id": "turn_plain", "status": "inProgress"}}

        async def notifications(self):
            yield {
                "method": "turn/completed",
                "params": {"turn": {"id": "turn_plain", "status": "completed"}},
            }

    async def run() -> FakeTurnClient:
        manager = CodexRuntimeManager()
        client = FakeTurnClient()
        async for _ in manager._start_turn_and_stream(  # noqa: SLF001
            client,  # type: ignore[arg-type]
            thread_id="thr_plain",
            text="hello",
            cwd=None,
            model="gpt-5.5",
            service_tier=None,
            effort="medium",
            summary="auto",
        ):
            pass
        return client

    client = asyncio.run(run())
    turn_start = client.requests[0]

    assert turn_start["method"] == "turn/start"
    assert turn_start["params"]["input"] == [{"type": "text", "text": "hello"}]


@pytest.mark.skipif(
    not ATLAS_FAST_APP_EDITS_SKILL_PATH.exists(),
    reason="machine-local .codex skill file not present (never git-tracked; "
    "the /codex dashboard surface that requested interface mutations was "
    "archived 2026-07-11 — restore the skill from the archive README if the "
    "lane is revived)",
)
def test_codex_runtime_manager_attaches_atlas_fast_app_edits_skill_for_interface_mutations() -> None:
    class FakeTurnClient:
        def __init__(self) -> None:
            self.requests: list[dict[str, Any]] = []

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            return {"turn": {"id": "turn_skill", "status": "inProgress"}}

        async def notifications(self):
            yield {
                "method": "turn/completed",
                "params": {"turn": {"id": "turn_skill", "status": "completed"}},
            }

    async def run() -> FakeTurnClient:
        manager = CodexRuntimeManager()
        client = FakeTurnClient()
        async for _ in manager._start_turn_and_stream(  # noqa: SLF001
            client,  # type: ignore[arg-type]
            thread_id="thr_skill",
            text="polish the /codex center lane",
            cwd=None,
            model="gpt-5.5",
            service_tier=None,
            effort="medium",
            summary="none",
            interface_mutation_requested=True,
        ):
            pass
        return client

    client = asyncio.run(run())
    turn_start = client.requests[0]

    assert ATLAS_FAST_APP_EDITS_SKILL_PATH.exists()
    assert turn_start["method"] == "turn/start"
    assert turn_start["params"]["input"][0] == {
        "type": "skill",
        "name": "atlas-fast-app-edits",
        "path": str(ATLAS_FAST_APP_EDITS_SKILL_PATH),
    }
    assert turn_start["params"]["input"][1] == {
        "type": "text",
        "text": "polish the /codex center lane",
    }


def test_codex_runtime_manager_sets_thread_memory_mode_when_requested() -> None:
    class FakeMemoryClient:
        def __init__(self) -> None:
            self.requests: list[dict[str, Any]] = []

        async def request(
            self,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float = 30.0,
        ) -> dict[str, Any]:
            self.requests.append(
                {"method": method, "params": params, "timeout": timeout}
            )
            return {}

    async def run() -> FakeMemoryClient:
        manager = CodexRuntimeManager()
        client = FakeMemoryClient()
        changed = await manager._set_thread_memory_mode(  # noqa: SLF001
            client,  # type: ignore[arg-type]
            thread_id="thr_memory",
            mode="enabled",
        )
        assert changed is True
        return client

    client = asyncio.run(run())

    assert client.requests == [
        {
            "method": "thread/memoryMode/set",
            "params": {"threadId": "thr_memory", "mode": "enabled"},
            "timeout": 30,
        }
    ]


def test_main_app_includes_codex_runtime_router() -> None:
    from src.main import app

    def _flat_paths(routes):
        # FastAPI >=0.139 defers include_router into lazy _IncludedRouter
        # wrappers; router-level prefixes are already baked into the inner
        # routes, so walking original_router recovers the full path set.
        for route in routes:
            inner = getattr(route, "original_router", None)
            if inner is not None:
                yield from _flat_paths(inner.routes)
            else:
                yield getattr(route, "path", "")

    route_paths = set(_flat_paths(app.routes))
    assert "/code/codex/models" in route_paths
    assert "/code/codex/models/supported" in route_paths
    assert "/code/codex/threads" in route_paths
    assert "/code/codex/preview/promote" in route_paths
    assert "/code/codex/preview/pull-live" in route_paths
    assert "/code/codex/turns/stream" in route_paths
    assert "/code/codex/session/turns/stream" in route_paths


def test_codex_runtime_manager_uses_native_codex_bin_setting() -> None:
    manager = CodexRuntimeManager()
    assert manager.launch_config.codex_bin
    assert manager.launch_config.client_name == "atlas_code"
