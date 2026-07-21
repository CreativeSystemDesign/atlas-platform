from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from src.graphs.registry import get_graph_for_thread
from src.persistence.runs import run_store
from src.persistence.threads import thread_store
from src.runtime_active_runs import active_run_manager
from src.schemas import (
    Thread,
    ThreadCreate,
    ThreadLiveRunPhase,
    ThreadOperationalState,
    ThreadSearch,
    ThreadStatus,
    ThreadTimelineItem,
)
from src.terminal.manager import get_terminal_manager

router = APIRouter(prefix="/threads", tags=["Threads"])


@router.post("", response_model=Thread)
async def create_thread(body: ThreadCreate):
    try:
        return await thread_store.create(
            thread_id=body.thread_id,
            metadata=body.metadata,
            project_id=body.project_id,
        )
    except Exception as e:
        if "duplicate" in str(e).lower() or "unique" in str(e).lower():
            if body.if_exists == "do_nothing" and body.thread_id:
                existing = await thread_store.get(body.thread_id)
                if existing:
                    return existing
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{thread_id}", response_model=Thread)
async def get_thread(thread_id: uuid.UUID):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return await _enrich_thread(thread, include_values=True)


@router.post("/search", response_model=list[Thread])
async def search_threads(body: ThreadSearch | None = None):
    query = body or ThreadSearch()
    limit = max(1, min(query.limit, 200))
    offset = max(0, query.offset)
    if query.metadata:
        threads = await thread_store.list_by_metadata(
            query.metadata,
            limit=limit,
            offset=offset,
        )
    else:
        threads = await thread_store.list_all(limit=limit, offset=offset)
    return [await _enrich_thread(thread) for thread in threads]


@router.delete("/{thread_id}")
async def delete_thread(thread_id: uuid.UUID):
    deleted = await thread_store.delete(thread_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Thread not found")
    try:
        get_terminal_manager().release_thread_terminal(str(thread_id))
    except RuntimeError:
        pass
    return {"ok": True}


@router.get("/{thread_id}/state")
async def get_thread_state(thread_id: uuid.UUID):
    graph = await get_graph_for_thread(thread_id)
    config = {"configurable": {"thread_id": str(thread_id)}}
    state = await graph.aget_state(config)
    if not state or not state.values:
        return {
            "values": {},
            "next": [],
            "checkpoint": None,
            "parent_checkpoint": None,
            "created_at": None,
            "summary": _build_timeline_summary({}, []),
        }
    serialized_values = _serialize_values(state.values)
    next_nodes = list(state.next) if state.next else []
    return {
        "values": serialized_values,
        "next": next_nodes,
        "checkpoint": _configurable_dict(state.config),
        "parent_checkpoint": _configurable_dict(getattr(state, "parent_config", None)),
        "created_at": getattr(state, "created_at", None),
        "summary": _build_timeline_summary(serialized_values, next_nodes),
    }


@router.get("/{thread_id}/history")
async def get_thread_history(thread_id: uuid.UUID):
    graph = await get_graph_for_thread(thread_id)
    config = {"configurable": {"thread_id": str(thread_id)}}
    history = []
    async for state in graph.aget_state_history(config):
        serialized_values = _serialize_values(state.values)
        next_nodes = list(state.next) if state.next else []
        history.append({
            "values": serialized_values,
            "next": next_nodes,
            "checkpoint": _configurable_dict(state.config),
            "parent_checkpoint": _configurable_dict(getattr(state, "parent_config", None)),
            "created_at": getattr(state, "created_at", None),
            "summary": _build_timeline_summary(serialized_values, next_nodes),
        })
        if len(history) >= 50:
            break
    return history


@router.get("/{thread_id}/runtime-history")
async def get_thread_runtime_history(thread_id: uuid.UUID, limit: int = 500):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    bounded_limit = max(1, min(limit, 2000))
    session = await active_run_manager.live_snapshot(str(thread_id))
    live_run_id = session.get("run_id") if session else None
    latest_run = None
    latest_run_id = live_run_id
    if not latest_run_id:
        latest_run = await run_store.latest_for_thread(thread_id)
        latest_run_id = latest_run.get("run_id") if latest_run else None
    elif not latest_run:
        latest_run = await run_store.latest_for_thread(thread_id)

    events = []
    if latest_run_id:
        events = await run_store.list_events_for_thread(
            thread_id,
            run_id=uuid.UUID(str(latest_run_id)),
            limit=bounded_limit,
        )

    return {
        "thread_id": str(thread_id),
        "run_id": str(latest_run_id) if latest_run_id else None,
        "live_run_phase": _infer_live_phase(thread, session, latest_run).value,
        "events": events,
    }


@router.get("/{thread_id}/timeline", response_model=list[ThreadTimelineItem])
async def get_thread_timeline(thread_id: uuid.UUID, limit: int = 200):
    graph = await get_graph_for_thread(thread_id)
    config = {"configurable": {"thread_id": str(thread_id)}}
    bounded_limit = max(1, min(limit, 500))
    items: list[ThreadTimelineItem] = []
    async for state in graph.aget_state_history(config):
        checkpoint = _configurable_dict(state.config)
        parent_checkpoint = _configurable_dict(getattr(state, "parent_config", None))
        serialized_values = _serialize_values(state.values)
        next_nodes = list(state.next) if state.next else []
        items.append(
            ThreadTimelineItem(
                order=0,
                created_at=getattr(state, "created_at", None),
                next=next_nodes,
                checkpoint={
                    "thread_id": thread_id,
                    "checkpoint_id": checkpoint.get("checkpoint_id"),
                    "checkpoint_ns": str(checkpoint.get("checkpoint_ns", "") or ""),
                    "parent_checkpoint_id": parent_checkpoint.get("checkpoint_id"),
                },
                summary=_build_timeline_summary(serialized_values, next_nodes),
                can_replay=bool(checkpoint.get("checkpoint_id")),
                can_fork=bool(checkpoint.get("checkpoint_id")),
                values=serialized_values,
            )
        )
        if len(items) >= bounded_limit:
            break

    items.reverse()
    for index, item in enumerate(items):
        item.order = index
    return items


def _configurable_dict(config: Any) -> dict[str, Any]:
    if not config or not isinstance(config, dict):
        return {}
    configurable = config.get("configurable")
    return configurable if isinstance(configurable, dict) else {}


def _serialize_values(values: dict) -> dict:
    result = {}
    for key, val in values.items():
        if key == "messages" and isinstance(val, list):
            result["messages"] = []
            for msg in val:
                if hasattr(msg, "type") and hasattr(msg, "content"):
                    m = {"type": msg.type, "content": msg.content, "id": getattr(msg, "id", "")}
                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                        m["tool_calls"] = [
                            {
                                "id": tc.get("id", ""),
                                "name": tc.get("name", ""),
                                "args": tc.get("args", {}),
                            }
                            for tc in msg.tool_calls
                        ]
                    result["messages"].append(m)
                else:
                    result["messages"].append(str(msg))
        else:
            try:
                result[key] = val
            except Exception:
                result[key] = str(val)
    return result


def _content_preview(content: Any, max_chars: int = 180) -> str | None:
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, dict) and "text" in item:
                chunks.append(str(item["text"]))
            else:
                chunks.append(str(item))
        text = "".join(chunks)
    elif content is None:
        return None
    else:
        text = str(content)

    flattened = " ".join(text.split())
    if not flattened:
        return None
    if len(flattened) <= max_chars:
        return flattened
    return flattened[: max_chars - 3] + "..."


def _infer_event_family(values: dict[str, Any], next_nodes: list[str]) -> str:
    messages = values.get("messages")
    if isinstance(messages, list) and messages:
        last_message = messages[-1]
        if isinstance(last_message, dict):
            last_type = str(last_message.get("type", "")).lower()
            if last_type == "tool":
                return "tool"
            if last_type in {"ai", "assistant"}:
                return "assistant"
            if last_type in {"human", "user"}:
                return "user"
    if next_nodes:
        return "checkpoint"
    return "state"


def _build_timeline_summary(
    values: dict[str, Any],
    next_nodes: list[str],
) -> dict[str, Any]:
    messages = values.get("messages")
    last_message_type = None
    last_message_preview = None
    message_count = 0
    if isinstance(messages, list):
        message_count = len(messages)
        if messages:
            last_message = messages[-1]
            if isinstance(last_message, dict):
                raw_type = last_message.get("type")
                last_message_type = str(raw_type) if raw_type is not None else None
                last_message_preview = _content_preview(last_message.get("content"))

    files = values.get("files")
    todos = values.get("todos")
    file_count = len(files) if isinstance(files, (list, dict)) else None
    todo_count = len(todos) if isinstance(todos, list) else None
    return {
        "event_family": _infer_event_family(values, next_nodes),
        "message_count": message_count,
        "last_message_type": last_message_type,
        "last_message_preview": last_message_preview,
        "file_count": file_count,
        "todo_count": todo_count,
    }


def _infer_live_phase(
    thread: Thread,
    session: dict[str, str | None] | None,
    latest_run: dict[str, Any] | None,
) -> ThreadLiveRunPhase:
    if session and session.get("status") == "running":
        live_phase = str(session.get("live_phase") or "").strip().lower()
        if live_phase == ThreadLiveRunPhase.starting.value:
            return ThreadLiveRunPhase.starting
        return ThreadLiveRunPhase.active
    latest_status = str((latest_run or {}).get("status", "") or "").strip().lower()
    if (
        thread.operational_state == ThreadOperationalState.active
        and latest_status in {"pending", "running", "error", "interrupted"}
    ):
        return ThreadLiveRunPhase.recovery
    return ThreadLiveRunPhase.ended


async def _thread_graph_values(thread_id: uuid.UUID) -> dict[str, Any]:
    graph = await get_graph_for_thread(thread_id)
    state = await graph.aget_state({"configurable": {"thread_id": str(thread_id)}})
    if not state or not isinstance(state.values, dict):
        return {}
    return _serialize_values(state.values)


async def _enrich_thread(thread: Thread, *, include_values: bool = False) -> Thread:
    session = await active_run_manager.live_snapshot(str(thread.thread_id))
    latest_run = await run_store.latest_for_thread(thread.thread_id)
    live_phase = _infer_live_phase(thread, session, latest_run)
    live_run_id = str(session.get("run_id")) if session and session.get("run_id") else None
    status = thread.status
    if live_phase in {
        ThreadLiveRunPhase.starting,
        ThreadLiveRunPhase.active,
        ThreadLiveRunPhase.recovery,
    }:
        status = ThreadStatus.busy
    return thread.model_copy(
        update={
            "status": status,
            "live_run_phase": live_phase,
            "live_run_id": live_run_id,
            "values": await _thread_graph_values(thread.thread_id) if include_values else {},
        }
    )
