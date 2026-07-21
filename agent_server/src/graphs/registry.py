"""Graph registry — maps graph_id + model_id to compiled graph instances."""

from __future__ import annotations

import uuid

from src.graphs.code_agent import build_code_graph, get_code_topology
from src.graphs.model_resolution import (
    default_model_for_graph,
    resolve_code_model_lanes_for_run,
    resolve_code_model_lanes_for_thread_state,
    resolve_model_for_thread_state,
)
from src.persistence.settings import get_setting, get_system_prompt
from src.persistence.threads import thread_store

_graphs: dict[str, object] = {}
"""Compiled graph instances keyed by graph id and model lane ids."""

_prompt_snapshot: dict[str, str] = {}
"""System prompt text last used to build each cached graph (for hot reload)."""


def _cache_key(
    graph_id: str,
    model_id: str,
    worker_model_id: str | None = None,
    ui_model_id: str | None = None,
    reasoning_effort: str | None = None,
) -> str:
    if graph_id == "atlas-code":
        return (
            f"{graph_id}:atlas={model_id}:worker={worker_model_id}:ui={ui_model_id}:"
            f"reasoning={reasoning_effort or 'default'}"
        )
    return f"{graph_id}:{model_id}"


async def get_graph(
    graph_id: str = "atlas-architect",
    model_id: str | None = None,
    worker_model_id: str | None = None,
    ui_model_id: str | None = None,
    reasoning_effort: str | None = None,
):
    mid = model_id or default_model_for_graph(graph_id)
    if graph_id == "atlas-code":
        incoming = {
            **({"model": model_id} if model_id else {}),
            **({"worker_model": worker_model_id} if worker_model_id else {}),
            **({"ui_model": ui_model_id} if ui_model_id else {}),
        }
        lanes = await resolve_code_model_lanes_for_run(incoming)
        mid = lanes.model
        worker_mid = lanes.worker_model
        ui_mid = lanes.ui_model
    else:
        worker_mid = None
        ui_mid = None
        reasoning_effort = None
    key = _cache_key(graph_id, mid, worker_mid, ui_mid, reasoning_effort)
    from src.persistence.checkpointer import get_checkpointer
    from src.persistence.langgraph_store import get_store

    if graph_id == "atlas-code":
        system_prompt = await get_setting("code_system_prompt", "")
    else:
        system_prompt = await get_system_prompt()
    if key in _graphs and _prompt_snapshot.get(key) != system_prompt:
        del _graphs[key]
        _prompt_snapshot.pop(key, None)

    if key not in _graphs:
        checkpointer = await get_checkpointer()
        store = await get_store()
        if graph_id == "atlas-architect":
            from src.graphs.architect import build_architect_graph

            builder = build_architect_graph
        elif graph_id == "atlas-code":
            builder = build_code_graph
        elif graph_id == "extraction-orchestrator":
            from src.graphs.architect import build_extraction_orchestrator_graph

            builder = build_extraction_orchestrator_graph
        else:
            raise ValueError(f"Unknown graph_id: {graph_id}")
        if graph_id == "atlas-code":
            _graphs[key] = builder(
                checkpointer=checkpointer,
                store=store,
                system_prompt=system_prompt,
                model_id=mid,
                worker_model_id=worker_mid,
                ui_model_id=ui_mid,
                reasoning_effort=reasoning_effort,
            )
        else:
            _graphs[key] = builder(
                checkpointer=checkpointer,
                store=store,
                system_prompt=system_prompt,
                model_id=mid,
            )
        _prompt_snapshot[key] = system_prompt
    return _graphs[key]


def list_graph_ids() -> list[str]:
    return ["atlas-architect", "atlas-code", "extraction-orchestrator"]


def get_graph_topology(graph_id: str = "atlas-architect") -> dict[str, list[dict[str, object]]]:
    if graph_id == "atlas-architect":
        from src.graphs.architect import get_architect_topology

        return get_architect_topology()
    if graph_id == "atlas-code":
        return get_code_topology()
    if graph_id == "extraction-orchestrator":
        from src.graphs.architect import get_extraction_orchestrator_topology

        return get_extraction_orchestrator_topology()
    raise ValueError(f"Unknown graph_id: {graph_id}")


async def get_graph_for_thread(thread_id: uuid.UUID):
    """Load graph for thread checkpoint (metadata or global preference)."""
    thread = await thread_store.get(thread_id)
    meta = thread.metadata if thread else None
    graph_id = "atlas-architect"
    if isinstance(meta, dict):
        candidate = meta.get("graph_id") or meta.get("assistant_graph_id")
        if isinstance(candidate, str) and candidate in list_graph_ids():
            graph_id = candidate
    if graph_id == "atlas-code":
        lanes = await resolve_code_model_lanes_for_thread_state(meta)
        return await get_graph(
            graph_id=graph_id,
            model_id=lanes.model,
            worker_model_id=lanes.worker_model,
            ui_model_id=lanes.ui_model,
        )
    mid = await resolve_model_for_thread_state(graph_id, meta)
    return await get_graph(graph_id=graph_id, model_id=mid)


def invalidate_graph(graph_id: str | None = None) -> None:
    """Drop cached graphs. If graph_id is set, only entries for that graph; else clear all."""
    global _graphs, _prompt_snapshot
    if graph_id is None:
        _graphs.clear()
        _prompt_snapshot.clear()
        return
    prefix = f"{graph_id}:"
    for k in list(_graphs.keys()):
        if k.startswith(prefix):
            del _graphs[k]
            _prompt_snapshot.pop(k, None)
