"""Resolve which OpenRouter model id to use for each graph."""

from __future__ import annotations

from dataclasses import dataclass

from src.config import settings
from src.persistence.settings import get_setting

PREFERRED_ARCHITECT_MODEL_KEY = "preferred_architect_model"
PREFERRED_CODE_MODEL_KEY = "preferred_code_model"
PREFERRED_CODE_WORKER_MODEL_KEY = "preferred_code_worker_model"
PREFERRED_CODE_UI_MODEL_KEY = "preferred_code_ui_model"
PREFERRED_CODEX_LAYOUT_MODEL_KEY = "preferred_codex_layout_model"
PREFERRED_CODEX_COMPONENT_MODEL_KEY = "preferred_codex_component_model"
PREFERRED_CODEX_TRANSCRIPTION_MODEL_KEY = "preferred_codex_transcription_model"


@dataclass(frozen=True)
class CodeModelLanes:
    """Resolved first-class model lanes for Atlas Code."""

    model: str
    worker_model: str
    ui_model: str


def model_override_from_config(configurable: dict | None) -> str | None:
    """Per-run override from client `config.configurable.model`."""
    return _model_override_from_config(configurable, "model")


def _model_override_from_config(configurable: dict | None, key: str) -> str | None:
    if not configurable:
        return None
    raw = configurable.get(key)
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


async def resolve_architect_model_for_run(configurable: dict | None) -> str:
    """Order: request override > Neon preference > .env default."""
    override = model_override_from_config(configurable)
    if override:
        return override
    pref = await get_setting(PREFERRED_ARCHITECT_MODEL_KEY, "")
    if pref.strip():
        return pref.strip()
    return settings.architect_model


async def resolve_architect_model_for_thread_state(thread_metadata: dict | None) -> str:
    """Checkpoint loads: last model used on this thread, else preference > .env."""
    if thread_metadata:
        tid = thread_metadata.get("architect_model")
        if tid is not None and str(tid).strip():
            return str(tid).strip()
    pref = await get_setting(PREFERRED_ARCHITECT_MODEL_KEY, "")
    if pref.strip():
        return pref.strip()
    return settings.architect_model


def model_metadata_key_for_graph(graph_id: str) -> str:
    if graph_id == "atlas-code":
        return "code_model"
    return "architect_model"


def default_model_for_graph(graph_id: str) -> str:
    if graph_id == "atlas-code":
        return settings.code_model
    return settings.architect_model


def preferred_model_key_for_graph(graph_id: str) -> str:
    if graph_id == "atlas-code":
        return PREFERRED_CODE_MODEL_KEY
    return PREFERRED_ARCHITECT_MODEL_KEY


async def resolve_model_for_run(graph_id: str, configurable: dict | None) -> str:
    """Order: request override > graph-specific preference > graph-specific .env default."""
    override = model_override_from_config(configurable)
    if override:
        return override
    pref = await get_setting(preferred_model_key_for_graph(graph_id), "")
    if pref.strip():
        return pref.strip()
    return default_model_for_graph(graph_id)


async def resolve_code_model_lanes_for_run(configurable: dict | None) -> CodeModelLanes:
    """Resolve Atlas Code coordinator, worker, and UI-craft model lanes."""
    model = (
        _model_override_from_config(configurable, "model")
        or (await get_setting(PREFERRED_CODE_MODEL_KEY, "")).strip()
        or settings.code_model
    )
    worker_model = (
        _model_override_from_config(configurable, "worker_model")
        or (await get_setting(PREFERRED_CODE_WORKER_MODEL_KEY, "")).strip()
        or settings.code_worker_model
    )
    ui_model = (
        _model_override_from_config(configurable, "ui_model")
        or (await get_setting(PREFERRED_CODE_UI_MODEL_KEY, "")).strip()
        or settings.code_ui_model
    )
    return CodeModelLanes(model=model, worker_model=worker_model, ui_model=ui_model)


async def resolve_model_for_thread_state(
    graph_id: str,
    thread_metadata: dict | None,
) -> str:
    """Checkpoint loads: last graph model used on this thread, else preference > .env."""
    if thread_metadata:
        key = model_metadata_key_for_graph(graph_id)
        tid = thread_metadata.get(key)
        if tid is not None and str(tid).strip():
            return str(tid).strip()
    pref = await get_setting(preferred_model_key_for_graph(graph_id), "")
    if pref.strip():
        return pref.strip()
    return default_model_for_graph(graph_id)


async def resolve_code_model_lanes_for_thread_state(
    thread_metadata: dict | None,
) -> CodeModelLanes:
    """Resolve Atlas Code lanes for a checkpoint resume."""
    meta = thread_metadata or {}
    model = (
        str(meta.get("code_model") or "").strip()
        or (await get_setting(PREFERRED_CODE_MODEL_KEY, "")).strip()
        or settings.code_model
    )
    worker_model = (
        str(meta.get("code_worker_model") or "").strip()
        or (await get_setting(PREFERRED_CODE_WORKER_MODEL_KEY, "")).strip()
        or settings.code_worker_model
    )
    ui_model = (
        str(meta.get("code_ui_model") or "").strip()
        or (await get_setting(PREFERRED_CODE_UI_MODEL_KEY, "")).strip()
        or settings.code_ui_model
    )
    return CodeModelLanes(model=model, worker_model=worker_model, ui_model=ui_model)
