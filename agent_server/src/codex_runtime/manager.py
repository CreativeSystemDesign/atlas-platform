from __future__ import annotations

import asyncio
import copy
import json
import os
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from src.codex_runtime.client import (
    CodexAppServerClient,
    CodexJsonRpcError,
    CodexLaunchConfig,
    JsonObject,
)
from src.config import settings
from src.persistence.settings import get_setting, set_setting

MODEL_SUPPORT_CACHE_TTL_SECONDS = 60 * 60
MODEL_SUPPORT_PROBE_TIMEOUT_SECONDS = 75.0
MODEL_SUPPORT_PROBE_PROMPT = "Reply with exactly: OK"
CODEX_REASONING_SUMMARY_MODES = ("none", "auto", "concise", "detailed")
CODEX_MEMORY_MODES = ("enabled", "disabled", "inherit")
PREFERRED_CODEX_MEMORY_MODE_KEY = "preferred_codex_memory_mode"
REPO_ROOT = Path(__file__).resolve().parents[3]
ATLAS_FAST_APP_EDITS_SKILL_PATH = (
    REPO_ROOT / ".codex" / "skills" / "atlas-fast-app-edits" / "SKILL.md"
)


@dataclass
class ActiveCodexTurn:
    client: CodexAppServerClient
    thread_id: str
    turn_id: str


class CodexRuntimeManager:
    def __init__(self, launch_config: CodexLaunchConfig | None = None) -> None:
        self.launch_config = launch_config or CodexLaunchConfig(
            codex_bin=settings.codex_bin,
            cwd=settings.atlas_root,
        )
        self._active_turns: dict[tuple[str, str], ActiveCodexTurn] = {}
        self._active_lock = asyncio.Lock()
        self._supported_models_cache: dict[tuple[bool, str], tuple[float, JsonObject]] = {}
        self._supported_models_lock = asyncio.Lock()

    async def list_models(self, *, include_hidden: bool = False) -> JsonObject:
        async with CodexAppServerClient(self.launch_config) as client:
            return await client.request(
                "model/list",
                {"includeHidden": include_hidden, "limit": 200},
                timeout=30,
            )

    async def list_supported_models(
        self,
        *,
        include_hidden: bool = False,
        cwd: str | None = None,
        force_refresh: bool = False,
    ) -> JsonObject:
        absolute_cwd = _absolute_cwd(cwd)
        cache_key = (include_hidden, absolute_cwd)
        now = time.time()

        async with self._supported_models_lock:
            cached = self._supported_models_cache.get(cache_key)
            if (
                cached
                and not force_refresh
                and now - cached[0] < MODEL_SUPPORT_CACHE_TTL_SECONDS
            ):
                payload = copy.deepcopy(cached[1])
                support_probe = dict(payload.get("supportProbe") or {})
                support_probe["cached"] = True
                payload["supportProbe"] = support_probe
                return payload

            raw_models = await self.list_models(include_hidden=include_hidden)
            data = raw_models.get("data")
            candidate_data = data if isinstance(data, list) else []
            candidates = [
                model
                for model in candidate_data
                if isinstance(model, dict)
                and (include_hidden or not model.get("hidden"))
                and _model_id(model)
            ]

            supported: list[JsonObject] = []
            unsupported: list[JsonObject] = []
            for model in candidates:
                probe = await self._probe_model_support(model, cwd=absolute_cwd)
                model_id = _model_id(model)
                if probe.get("supported") is True:
                    supported.append(
                        {
                            **model,
                            "supported": True,
                            "supportedSummaryModes": list(CODEX_REASONING_SUMMARY_MODES),
                            "supportProbe": probe,
                        }
                    )
                    continue
                unsupported.append(
                    {
                        "id": model_id,
                        "model": model.get("model") or model_id,
                        "displayName": model.get("displayName")
                        or model.get("name")
                        or model_id,
                        "reason": probe.get("reason")
                        or "Model failed the native Codex support probe.",
                        "supportProbe": probe,
                    }
                )

            checked_at = datetime.now(UTC).isoformat()
            payload = {
                **raw_models,
                "data": supported,
                "unsupported": unsupported,
                "supportProbe": {
                    "cached": False,
                    "checkedAt": checked_at,
                    "ttlSeconds": MODEL_SUPPORT_CACHE_TTL_SECONDS,
                    "probePrompt": MODEL_SUPPORT_PROBE_PROMPT,
                },
            }
            self._supported_models_cache[cache_key] = (time.time(), copy.deepcopy(payload))
            return payload

    async def start_thread(
        self,
        *,
        cwd: str | None = None,
        model: str | None = None,
        service_tier: str | None = None,
        effort: str | None = None,
        developer_instructions: str | None = None,
        memory_mode: str | None = None,
    ) -> JsonObject:
        async with CodexAppServerClient(self.launch_config) as client:
            params: JsonObject = {
                "cwd": _absolute_cwd(cwd),
                "model": model,
                "serviceTier": service_tier,
                "developerInstructions": developer_instructions,
                "sandbox": "danger-full-access",
                "approvalPolicy": "never",
                "personality": "friendly",
                "persistExtendedHistory": True,
                "experimentalRawEvents": False,
                "config": _config_for_effort(effort),
            }
            thread_response = await client.request(
                "thread/start",
                _without_none(params),
                timeout=30,
            )
            thread = thread_response.get("thread") if isinstance(thread_response, dict) else None
            thread_id = str(thread.get("id") or "") if isinstance(thread, dict) else ""
            if thread_id:
                await self._set_thread_memory_mode(
                    client,
                    thread_id=thread_id,
                    mode=memory_mode,
                )
            return thread_response

    async def list_threads(
        self,
        *,
        archived: bool | None = None,
        cursor: str | None = None,
        cwd: str | None = None,
        include_support_probes: bool = False,
        limit: int | None = None,
        search_term: str | None = None,
        sort_direction: str | None = None,
        sort_key: str | None = None,
        use_state_db_only: bool | None = None,
    ) -> JsonObject:
        payload = await self._codex_request(
            "thread/list",
            _without_none(
                {
                    "archived": archived,
                    "cursor": cursor,
                    "cwd": _absolute_cwd(cwd) if cwd else None,
                    "limit": limit,
                    "searchTerm": search_term,
                    "sortDirection": sort_direction,
                    "sortKey": sort_key,
                    "useStateDbOnly": use_state_db_only,
                }
            ),
        )
        if include_support_probes:
            return payload
        return _without_support_probe_threads(payload)

    async def read_thread(
        self,
        *,
        thread_id: str,
        include_turns: bool = False,
    ) -> JsonObject:
        return await self._codex_request(
            "thread/read",
            {"threadId": thread_id, "includeTurns": include_turns},
        )

    async def developer_capabilities(
        self,
        *,
        cwd: str | None = None,
        thread_id: str | None = None,
    ) -> JsonObject:
        absolute_cwd = _absolute_cwd(cwd)
        checked_at = datetime.now(UTC).isoformat()
        calls: list[tuple[str, str, JsonObject, float]] = [
            ("account", "account/read", {"refreshToken": False}, 8),
            ("rateLimits", "account/rateLimits/read", {}, 8),
            (
                "config",
                "config/read",
                {"cwd": absolute_cwd, "includeLayers": True},
                8,
            ),
            ("configRequirements", "configRequirements/read", {}, 8),
            ("modelProvider", "modelProvider/capabilities/read", {}, 8),
            ("experimentalFeatures", "experimentalFeature/list", {"limit": 200}, 8),
            (
                "skills",
                "skills/list",
                {"cwds": [absolute_cwd], "forceReload": False},
                10,
            ),
            ("hooks", "hooks/list", {"cwds": [absolute_cwd]}, 8),
            (
                "mcpServers",
                "mcpServerStatus/list",
                {"detail": "full", "limit": 100},
                10,
            ),
            (
                "apps",
                "app/list",
                {"threadId": thread_id, "limit": 100, "forceRefetch": False},
                10,
            ),
            (
                "plugins",
                "plugin/list",
                {
                    "cwds": [absolute_cwd],
                    "marketplaceKinds": [
                        "local",
                        "workspace-directory",
                        "shared-with-me",
                    ],
                },
                10,
            ),
        ]
        if thread_id:
            calls.extend(
                [
                    ("threadGoal", "thread/goal/get", {"threadId": thread_id}, 8),
                    (
                        "thread",
                        "thread/read",
                        {"threadId": thread_id, "includeTurns": False},
                        8,
                    ),
                ]
            )

        sections = await self._collect_developer_capability_sections(calls)

        return {
            "checkedAt": checked_at,
            "cwd": absolute_cwd,
            "threadId": thread_id,
            "memory": await self.memory_settings(),
            "activeTurns": [
                {"threadId": thread_id, "turnId": turn_id}
                for thread_id, turn_id in sorted(self._active_turns.keys())
            ],
            "sections": sections,
        }

    async def native_request(
        self,
        *,
        method: str,
        params: JsonObject | None = None,
        cwd: str | None = None,
        timeout: float = 12,
    ) -> JsonObject:
        launch_config = self.launch_config
        if cwd:
            launch_config = replace(launch_config, cwd=_absolute_cwd(cwd))
        return await _safe_isolated_client_request(
            launch_config,
            method,
            params or {},
            timeout=timeout,
        )

    async def _collect_developer_capability_sections(
        self,
        calls: list[tuple[str, str, JsonObject, float]],
    ) -> dict[str, JsonObject]:
        semaphore = asyncio.Semaphore(12)

        async def run_call(
            key: str,
            method: str,
            params: JsonObject,
            timeout: float,
        ) -> tuple[str, JsonObject]:
            async with semaphore:
                return (
                    key,
                    await _safe_isolated_client_request(
                        self.launch_config,
                        method,
                        _without_none(params),
                        timeout=timeout,
                    ),
                )

        results = await asyncio.gather(*(run_call(*call) for call in calls))
        return dict(results)

    async def list_thread_turns(
        self,
        *,
        thread_id: str,
        cursor: str | None = None,
        items_view: str | None = None,
        limit: int | None = None,
        sort_direction: str | None = None,
    ) -> JsonObject:
        return await self._codex_request(
            "thread/turns/list",
            _without_none(
                {
                    "threadId": thread_id,
                    "cursor": cursor,
                    "itemsView": items_view,
                    "limit": limit,
                    "sortDirection": sort_direction,
                }
            ),
        )

    async def list_thread_turn_items(
        self,
        *,
        thread_id: str,
        turn_id: str,
        cursor: str | None = None,
        limit: int | None = None,
        sort_direction: str | None = None,
    ) -> JsonObject:
        method = "thread/turns/items/list"
        try:
            return await self._codex_request(
                method,
                _without_none(
                    {
                        "threadId": thread_id,
                        "turnId": turn_id,
                        "cursor": cursor,
                        "limit": limit,
                        "sortDirection": sort_direction,
                    }
                ),
            )
        except CodexJsonRpcError as exc:
            reason = str(exc)
            if "not supported yet" not in reason.lower():
                raise
            return {
                "data": [],
                "nextCursor": None,
                "backwardsCursor": None,
                "capability": {
                    "method": method,
                    "supported": False,
                    "reason": reason,
                },
            }

    async def set_thread_name(self, *, thread_id: str, name: str) -> JsonObject:
        return await self._codex_request(
            "thread/name/set",
            {"threadId": thread_id, "name": name},
        )

    async def get_thread_goal(self, *, thread_id: str) -> JsonObject:
        return await self._codex_request("thread/goal/get", {"threadId": thread_id})

    async def set_thread_goal(
        self,
        *,
        thread_id: str,
        objective: str | None = None,
        status: str | None = None,
        token_budget: int | None = None,
    ) -> JsonObject:
        return await self._codex_request(
            "thread/goal/set",
            _without_none(
                {
                    "threadId": thread_id,
                    "objective": objective,
                    "status": status,
                    "tokenBudget": token_budget,
                }
            ),
        )

    async def clear_thread_goal(self, *, thread_id: str) -> JsonObject:
        return await self._codex_request("thread/goal/clear", {"threadId": thread_id})

    async def start_review(
        self,
        *,
        thread_id: str,
        target: JsonObject,
        delivery: str | None = None,
    ) -> JsonObject:
        return await self._codex_request(
            "review/start",
            _without_none(
                {
                    "threadId": thread_id,
                    "target": target,
                    "delivery": delivery,
                }
            ),
        )

    async def archive_thread(self, *, thread_id: str) -> JsonObject:
        return await self._codex_request("thread/archive", {"threadId": thread_id})

    async def unarchive_thread(self, *, thread_id: str) -> JsonObject:
        return await self._codex_request("thread/unarchive", {"threadId": thread_id})

    async def fork_thread(
        self,
        *,
        thread_id: str,
        cwd: str | None = None,
        model: str | None = None,
        service_tier: str | None = None,
        effort: str | None = None,
        developer_instructions: str | None = None,
        exclude_turns: bool | None = None,
    ) -> JsonObject:
        return await self._codex_request(
            "thread/fork",
            _without_none(
                {
                    "threadId": thread_id,
                    "cwd": _absolute_cwd(cwd) if cwd else None,
                    "model": model,
                    "serviceTier": service_tier,
                    "developerInstructions": developer_instructions,
                    "excludeTurns": exclude_turns,
                    "sandbox": "danger-full-access",
                    "approvalPolicy": "never",
                    "config": _config_for_effort(effort),
                }
            ),
        )

    async def compact_thread(self, *, thread_id: str) -> JsonObject:
        return await self._codex_request("thread/compact/start", {"threadId": thread_id})

    async def rollback_thread(self, *, thread_id: str, num_turns: int) -> JsonObject:
        return await self._codex_request(
            "thread/rollback",
            {"threadId": thread_id, "numTurns": num_turns},
        )

    async def stream_new_thread_turn(
        self,
        *,
        text: str,
        cwd: str | None = None,
        model: str | None = None,
        service_tier: str | None = None,
        effort: str | None = None,
        summary: str | None = "auto",
        developer_instructions: str | None = None,
        visible_transcript: str | None = None,
        interface_mutation_requested: bool = False,
        memory_mode: str | None = None,
    ) -> AsyncIterator[JsonObject]:
        client = CodexAppServerClient(self.launch_config)
        await client.start()
        try:
            thread_response = await client.request(
                "thread/start",
                _without_none(
                    {
                        "cwd": _absolute_cwd(cwd),
                        "model": model,
                        "serviceTier": service_tier,
                        "developerInstructions": developer_instructions,
                        "sandbox": "danger-full-access",
                        "approvalPolicy": "never",
                        "personality": "friendly",
                        "persistExtendedHistory": True,
                        "experimentalRawEvents": False,
                        "config": _config_for_effort(effort),
                    }
                ),
                timeout=30,
            )
            thread = thread_response.get("thread") if isinstance(thread_response, dict) else None
            thread_id = str(thread.get("id") or "") if isinstance(thread, dict) else ""
            if not thread_id:
                raise RuntimeError("Codex thread/start did not return a thread id")

            await self._set_thread_memory_mode(
                client,
                thread_id=thread_id,
                mode=memory_mode,
            )

            yield _envelope("codex_session", {"threadId": thread_id})
            yield _envelope(
                "codex_response",
                {"method": "thread/start", "result": thread_response},
            )
            if await self._inject_visible_transcript(
                client,
                thread_id=thread_id,
                visible_transcript=visible_transcript,
            ):
                yield _envelope(
                    "codex_context",
                    {
                        "threadId": thread_id,
                        "source": "visible_transcript",
                        "injected": True,
                    },
                )

            async for payload in self._start_turn_and_stream(
                client,
                thread_id=thread_id,
                text=text,
                cwd=cwd,
                model=model,
                service_tier=service_tier,
                effort=effort,
                summary=summary,
                interface_mutation_requested=interface_mutation_requested,
            ):
                yield payload
        finally:
            await client.close()

    async def stream_turn(
        self,
        *,
        thread_id: str,
        text: str,
        cwd: str | None = None,
        model: str | None = None,
        service_tier: str | None = None,
        effort: str | None = None,
        summary: str | None = "auto",
        developer_instructions: str | None = None,
        visible_transcript: str | None = None,
        interface_mutation_requested: bool = False,
        memory_mode: str | None = None,
    ) -> AsyncIterator[JsonObject]:
        client = CodexAppServerClient(self.launch_config)
        await client.start()
        try:
            yield _envelope("codex_session", {"threadId": thread_id})
            await client.request(
                "thread/resume",
                _without_none(
                    {
                        "threadId": thread_id,
                        "cwd": _absolute_cwd(cwd),
                        "model": model,
                        "serviceTier": service_tier,
                        "developerInstructions": developer_instructions,
                        "config": _config_for_effort(effort),
                        "sandbox": "danger-full-access",
                        "approvalPolicy": "never",
                        "persistExtendedHistory": True,
                    }
                ),
                timeout=30,
            )
            await self._set_thread_memory_mode(
                client,
                thread_id=thread_id,
                mode=memory_mode,
            )
            if visible_transcript and not await self._thread_has_recoverable_history(
                client,
                thread_id=thread_id,
            ) and await self._inject_visible_transcript(
                client,
                thread_id=thread_id,
                visible_transcript=visible_transcript,
            ):
                yield _envelope(
                    "codex_context",
                    {
                        "threadId": thread_id,
                        "source": "visible_transcript",
                        "injected": True,
                        "reason": "resume_missing_history",
                    },
                )
            async for payload in self._start_turn_and_stream(
                client,
                thread_id=thread_id,
                text=text,
                cwd=cwd,
                model=model,
                service_tier=service_tier,
                effort=effort,
                summary=summary,
                interface_mutation_requested=interface_mutation_requested,
            ):
                yield payload
        finally:
            await client.close()

    async def memory_settings(self) -> JsonObject:
        mode = await self._resolve_memory_mode(None)
        return {
            "mode": mode if mode != "inherit" else "enabled",
            "default_from_env": _effective_memory_mode(None),
            "availableModes": ["enabled", "disabled"],
            "canReset": True,
            "observability": _codex_memory_observability(self.launch_config),
        }

    async def set_memory_settings(
        self,
        *,
        mode: str,
        thread_id: str | None = None,
    ) -> JsonObject:
        effective_mode = _effective_user_memory_mode(mode)
        await set_setting(PREFERRED_CODEX_MEMORY_MODE_KEY, effective_mode)
        if thread_id:
            await self.set_thread_memory_mode(
                thread_id=thread_id,
                mode=effective_mode,
            )
        return {
            "mode": effective_mode,
            "threadId": thread_id,
            "availableModes": ["enabled", "disabled"],
            "canReset": True,
            "observability": _codex_memory_observability(self.launch_config),
        }

    async def set_thread_memory_mode(
        self,
        *,
        thread_id: str,
        mode: str,
    ) -> JsonObject:
        async with CodexAppServerClient(self.launch_config) as client:
            await self._set_thread_memory_mode(client, thread_id=thread_id, mode=mode)
        return {"threadId": thread_id, "mode": mode}

    async def reset_memory(self) -> JsonObject:
        async with CodexAppServerClient(self.launch_config) as client:
            await client.request("memory/reset", {}, timeout=30)
        return {"reset": True}

    async def _codex_request(
        self,
        method: str,
        params: JsonObject | None = None,
        *,
        timeout: float = 30,
    ) -> JsonObject:
        async with CodexAppServerClient(self.launch_config) as client:
            return await client.request(method, params or {}, timeout=timeout)

    async def steer(self, *, thread_id: str, turn_id: str, text: str) -> JsonObject:
        active = await self._get_active(thread_id, turn_id)
        return await active.client.request(
            "turn/steer",
            {
                "threadId": thread_id,
                "expectedTurnId": turn_id,
                "input": [{"type": "text", "text": text}],
            },
            timeout=30,
        )

    async def interrupt(self, *, thread_id: str, turn_id: str) -> JsonObject:
        active = await self._get_active(thread_id, turn_id)
        return await active.client.request(
            "turn/interrupt",
            {"threadId": thread_id, "turnId": turn_id},
            timeout=30,
        )

    async def _get_active(self, thread_id: str, turn_id: str) -> ActiveCodexTurn:
        async with self._active_lock:
            active = self._active_turns.get((thread_id, turn_id))
        if not active:
            raise KeyError(f"No active Codex turn {turn_id} for thread {thread_id}")
        return active

    async def _inject_visible_transcript(
        self,
        client: CodexAppServerClient,
        *,
        thread_id: str,
        visible_transcript: str | None,
    ) -> bool:
        transcript = (visible_transcript or "").strip()
        if not transcript:
            return False
        await client.request(
            "thread/inject_items",
            {
                "threadId": thread_id,
                "items": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": transcript,
                            }
                        ],
                    }
                ],
            },
            timeout=30,
        )
        return True

    async def _thread_has_recoverable_history(
        self,
        client: CodexAppServerClient,
        *,
        thread_id: str,
    ) -> bool:
        try:
            payload = await client.request(
                "thread/turns/list",
                {
                    "threadId": thread_id,
                    "itemsView": "summary",
                    "limit": 1,
                    "sortDirection": "desc",
                },
                timeout=8,
            )
        except Exception:
            return False

        for key in ("data", "turns"):
            turns = payload.get(key)
            if isinstance(turns, list):
                return len(turns) > 0

        thread = payload.get("thread")
        if isinstance(thread, dict):
            turns = thread.get("turns")
            if isinstance(turns, list):
                return len(turns) > 0

        return False

    async def _set_thread_memory_mode(
        self,
        client: CodexAppServerClient,
        *,
        thread_id: str,
        mode: str | None,
    ) -> bool:
        effective_mode = await self._resolve_memory_mode(mode)
        if effective_mode == "inherit":
            return False
        await client.request(
            "thread/memoryMode/set",
            {"threadId": thread_id, "mode": effective_mode},
            timeout=30,
        )
        return True

    async def _resolve_memory_mode(self, mode: str | None) -> str:
        if mode is not None:
            return _effective_memory_mode(mode)
        stored = (await get_setting(PREFERRED_CODEX_MEMORY_MODE_KEY, "")).strip()
        return _effective_memory_mode(stored or None)

    async def _start_turn_and_stream(
        self,
        client: CodexAppServerClient,
        *,
        thread_id: str,
        text: str,
        cwd: str | None,
        model: str | None,
        service_tier: str | None,
        effort: str | None,
        summary: str | None,
        interface_mutation_requested: bool = False,
    ) -> AsyncIterator[JsonObject]:
        turn_id: str | None = None
        try:
            response = await client.request(
                "turn/start",
                _without_none(
                    {
                        "threadId": thread_id,
                        "input": _native_turn_input(
                            text,
                            attach_app_edit_skill=interface_mutation_requested,
                        ),
                        "cwd": _absolute_cwd(cwd),
                        "model": model,
                        "serviceTier": service_tier,
                        "effort": effort,
                        "summary": summary,
                        "sandboxPolicy": {"type": "dangerFullAccess"},
                        "approvalPolicy": "never",
                    }
                ),
                timeout=30,
            )
            turn = response.get("turn") if isinstance(response, dict) else None
            if isinstance(turn, dict):
                turn_id = str(turn.get("id") or "")
            if not turn_id:
                raise RuntimeError("Codex turn/start did not return a turn id")
            async with self._active_lock:
                self._active_turns[(thread_id, turn_id)] = ActiveCodexTurn(
                    client=client,
                    thread_id=thread_id,
                    turn_id=turn_id,
                )
            yield _envelope("codex_response", {"method": "turn/start", "result": response})

            async for notification in client.notifications():
                yield _envelope("codex_event", notification)
                if (
                    notification.get("method") == "turn/completed"
                    and notification.get("params", {}).get("turn", {}).get("id") == turn_id
                ):
                    break
        finally:
            if turn_id:
                async with self._active_lock:
                    self._active_turns.pop((thread_id, turn_id), None)

    async def _probe_model_support(self, model: JsonObject, *, cwd: str) -> JsonObject:
        model_id = _model_id(model)
        if not model_id:
            return {
                "status": "unsupported",
                "supported": False,
                "reason": "Codex model entry did not include an id.",
            }

        client = CodexAppServerClient(self.launch_config)
        await client.start()
        try:
            thread_response = await client.request(
                "thread/start",
                _without_none(
                    {
                        "cwd": cwd,
                        "model": model_id,
                        "developerInstructions": (
                            "You are Atlas Code. This is a support probe. "
                            "Do not modify files or run commands unless needed."
                        ),
                        "sandbox": "danger-full-access",
                        "approvalPolicy": "never",
                        "personality": (
                            "friendly" if model.get("supportsPersonality") is not False else None
                        ),
                        "persistExtendedHistory": False,
                        "experimentalRawEvents": False,
                        "config": _config_for_effort(_probe_effort_for_model(model)),
                    }
                ),
                timeout=30,
            )
            thread = thread_response.get("thread") if isinstance(thread_response, dict) else None
            thread_id = str(thread.get("id") or "") if isinstance(thread, dict) else ""
            if not thread_id:
                return {
                    "status": "unsupported",
                    "supported": False,
                    "reason": "Codex thread/start did not return a thread id.",
                }

            turn_response = await client.request(
                "turn/start",
                _without_none(
                    {
                        "threadId": thread_id,
                        "input": [{"type": "text", "text": MODEL_SUPPORT_PROBE_PROMPT}],
                        "cwd": cwd,
                        "model": model_id,
                        "effort": _probe_effort_for_model(model),
                        "summary": "none",
                        "sandboxPolicy": {"type": "dangerFullAccess"},
                        "approvalPolicy": "never",
                    }
                ),
                timeout=30,
            )
            turn = turn_response.get("turn") if isinstance(turn_response, dict) else None
            turn_id = str(turn.get("id") or "") if isinstance(turn, dict) else ""
            if not turn_id:
                return {
                    "status": "unsupported",
                    "supported": False,
                    "reason": "Codex turn/start did not return a turn id.",
                    "threadId": thread_id,
                }

            deadline = time.monotonic() + MODEL_SUPPORT_PROBE_TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                remaining = max(0.1, deadline - time.monotonic())
                notification = await client.next_notification(timeout=remaining)
                method = notification.get("method")
                if method == "error":
                    return {
                        "status": "unsupported",
                        "supported": False,
                        "reason": _codex_error_reason(notification),
                        "threadId": thread_id,
                        "turnId": turn_id,
                    }
                if (
                    method == "turn/completed"
                    and notification.get("params", {}).get("turn", {}).get("id") == turn_id
                ):
                    status = str(
                        notification.get("params", {}).get("turn", {}).get("status") or ""
                    )
                    if status == "completed":
                        return {
                            "status": "supported",
                            "supported": True,
                            "threadId": thread_id,
                            "turnId": turn_id,
                        }
                    return {
                        "status": "unsupported",
                        "supported": False,
                        "reason": _turn_failure_reason(notification),
                        "threadId": thread_id,
                        "turnId": turn_id,
                    }
        except TimeoutError:
            return {
                "status": "unsupported",
                "supported": False,
                "reason": "Codex support probe timed out before the turn completed.",
            }
        except Exception as exc:
            return {
                "status": "unsupported",
                "supported": False,
                "reason": _readable_error_message(str(exc)),
            }
        finally:
            await client.close()

        return {
            "status": "unsupported",
            "supported": False,
            "reason": "Codex support probe ended without a turn/completed event.",
        }


_manager: CodexRuntimeManager | None = None


def get_codex_runtime_manager() -> CodexRuntimeManager:
    global _manager
    if _manager is None:
        _manager = CodexRuntimeManager()
    return _manager


def _absolute_cwd(cwd: str | None) -> str:
    if cwd:
        return str(Path(cwd).expanduser().resolve())
    return str(Path(settings.atlas_root).resolve())


def _config_for_effort(effort: str | None) -> JsonObject | None:
    if not effort:
        return None
    return {"model_reasoning_effort": effort}


def _native_turn_input(
    text: str,
    *,
    attach_app_edit_skill: bool = False,
) -> list[JsonObject]:
    """Build the native Codex turn input.

    Normal conversation must stay plain so Codex owns the chat stream. The
    Atlas app-edit skill is attached only for explicit interface mutation turns.
    """

    user_text = {"type": "text", "text": text}
    if not attach_app_edit_skill:
        return [user_text]
    return [
        {
            "type": "skill",
            "name": "atlas-fast-app-edits",
            "path": str(ATLAS_FAST_APP_EDITS_SKILL_PATH),
        },
        user_text,
    ]


def _model_id(model: JsonObject) -> str:
    value = model.get("id") or model.get("model")
    return str(value or "")


def _probe_effort_for_model(model: JsonObject) -> str | None:
    efforts = _supported_reasoning_efforts(model)
    for preferred in ("low", "minimal", "medium", "high", "xhigh", "none"):
        if preferred in efforts:
            return preferred
    default = model.get("defaultReasoningEffort")
    if isinstance(default, str) and default:
        return default
    return efforts[0] if efforts else "medium"


def _supported_reasoning_efforts(model: JsonObject) -> list[str]:
    raw_efforts = model.get("supportedReasoningEfforts")
    if not isinstance(raw_efforts, list):
        return []
    efforts: list[str] = []
    for option in raw_efforts:
        if isinstance(option, str) and option:
            efforts.append(option)
            continue
        if isinstance(option, dict):
            value = option.get("reasoningEffort") or option.get("value")
            if isinstance(value, str) and value:
                efforts.append(value)
    return efforts


def _codex_error_reason(notification: JsonObject) -> str:
    params = notification.get("params")
    if not isinstance(params, dict):
        return _readable_error_message(str(notification))
    error = params.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message:
            return _readable_error_message(message)
        return _readable_error_message(json.dumps(error, separators=(",", ":")))
    if isinstance(error, str) and error:
        return _readable_error_message(error)
    return _readable_error_message(str(params))


def _turn_failure_reason(notification: JsonObject) -> str:
    params = notification.get("params")
    if isinstance(params, dict):
        turn = params.get("turn")
        if isinstance(turn, dict):
            error = turn.get("error") or turn.get("lastError")
            if isinstance(error, str) and error:
                return _readable_error_message(error)
            if isinstance(error, dict):
                message = error.get("message")
                if isinstance(message, str) and message:
                    return _readable_error_message(message)
                return _readable_error_message(json.dumps(error, separators=(",", ":")))
            status = turn.get("status")
            if isinstance(status, str) and status:
                return f"Codex turn completed with status {status}."
    return "Codex support probe turn failed."


def _readable_error_message(message: str) -> str:
    current = message.strip()
    for _ in range(3):
        try:
            parsed = json.loads(current)
        except json.JSONDecodeError:
            break
        if isinstance(parsed, dict):
            nested_error = parsed.get("error")
            if isinstance(nested_error, dict):
                nested_message = nested_error.get("message")
                if isinstance(nested_message, str) and nested_message:
                    current = nested_message.strip()
                    continue
            nested_message = parsed.get("message") or parsed.get("detail")
            if isinstance(nested_message, str) and nested_message:
                current = nested_message.strip()
                continue
        if isinstance(parsed, str) and parsed:
            current = parsed.strip()
            continue
        break
    return current or "Unknown Codex runtime error."


def _effective_memory_mode(mode: str | None) -> str:
    requested = (mode or settings.codex_memory_mode or "inherit").strip().lower()
    if requested not in CODEX_MEMORY_MODES:
        raise ValueError(
            "Invalid Codex memory mode. Expected one of: "
            + ", ".join(CODEX_MEMORY_MODES)
        )
    return requested


def _effective_user_memory_mode(mode: str) -> str:
    requested = mode.strip().lower()
    if requested not in ("enabled", "disabled"):
        raise ValueError("Invalid Codex memory mode. Expected enabled or disabled.")
    return requested


def _codex_home(launch_config: CodexLaunchConfig) -> Path:
    configured = (launch_config.env or {}).get("CODEX_HOME") or os.environ.get("CODEX_HOME")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex"


def _iso_mtime(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()
    except OSError:
        return None


def _artifact_entry(path: Path) -> JsonObject:
    exists = path.exists()
    entry: JsonObject = {
        "name": path.name,
        "path": str(path),
        "exists": exists,
        "updatedAt": _iso_mtime(path),
    }
    if not exists:
        return entry
    try:
        if path.is_dir():
            entry["kind"] = "directory"
            entry["entryCount"] = sum(1 for _ in path.iterdir())
        else:
            entry["kind"] = "file"
            entry["sizeBytes"] = path.stat().st_size
    except OSError as exc:
        entry["error"] = str(exc)
    return entry


def _codex_memory_observability(launch_config: CodexLaunchConfig) -> JsonObject:
    codex_home = _codex_home(launch_config)
    memory_directory = codex_home / "memories"
    artifacts: list[JsonObject] = []
    if memory_directory.exists():
        try:
            artifacts = [
                _artifact_entry(path)
                for path in sorted(memory_directory.iterdir(), key=lambda item: item.name)
            ]
        except OSError as exc:
            artifacts = [
                {
                    "name": "memories",
                    "path": str(memory_directory),
                    "exists": True,
                    "error": str(exc),
                }
            ]

    artifact_times = [
        item.get("updatedAt") for item in artifacts if isinstance(item.get("updatedAt"), str)
    ]
    directory_mtime = _iso_mtime(memory_directory)
    last_modified = max(
        [*artifact_times, directory_mtime] if directory_mtime else artifact_times,
        default=None,
    )

    return {
        "codexHome": str(codex_home),
        "memoryDirectory": str(memory_directory),
        "memoryDirectoryExists": memory_directory.exists(),
        "artifactCount": len(artifacts),
        "lastModified": last_modified,
        "artifacts": artifacts,
        "nativeControls": {
            "threadMemoryModeSet": True,
            "memoryReset": True,
        },
    }


def _without_none(payload: JsonObject) -> JsonObject:
    return {key: value for key, value in payload.items() if value is not None}


def _without_support_probe_threads(payload: JsonObject) -> JsonObject:
    data = payload.get("data")
    if not isinstance(data, list):
        return payload
    return {
        **payload,
        "data": [
            item
            for item in data
            if not (
                isinstance(item, dict)
                and (
                    item.get("preview") == MODEL_SUPPORT_PROBE_PROMPT
                    or item.get("name") == MODEL_SUPPORT_PROBE_PROMPT
                )
            )
        ],
    }


async def _safe_isolated_client_request(
    launch_config: CodexLaunchConfig,
    method: str,
    params: JsonObject | None = None,
    *,
    timeout: float = 10,
) -> JsonObject:
    client = CodexAppServerClient(launch_config)
    try:
        await asyncio.wait_for(client.start(), timeout=8)
        return {
            "method": method,
            "ok": True,
            "payload": await client.request(method, params or {}, timeout=timeout),
        }
    except Exception as exc:
        return {
            "method": method,
            "ok": False,
            "error": _exception_message(exc),
        }
    finally:
        await client.close()


def _exception_message(exc: Exception) -> str:
    text = str(exc)
    if text:
        return text
    return exc.__class__.__name__


def _envelope(event: str, payload: JsonObject) -> JsonObject:
    return {
        "event": event,
        "id": str(uuid.uuid4()),
        "data": payload,
    }


def sse_frame(payload: JsonObject) -> dict[str, str]:
    return {
        "event": str(payload["event"]),
        "data": json.dumps(payload["data"], separators=(",", ":")),
    }
