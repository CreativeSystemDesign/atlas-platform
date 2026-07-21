"""Thread Runs - create and stream runs on threads."""

from __future__ import annotations

import asyncio
import json
import os
import re
import traceback
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from langchain_openai import ChatOpenAI
from langgraph.types import Command
from sse_starlette.sse import EventSourceResponse

from src.config import settings
from src.graphs.model_resolution import (
    model_metadata_key_for_graph,
    resolve_model_for_run,
    resolve_model_for_thread_state,
)
from src.graphs.registry import get_graph, list_graph_ids
from src.persistence.memory_backup import schedule_architect_memory_backup
from src.persistence.runs import run_store
from src.persistence.threads import thread_store
from src.runtime_active_runs import QueuedRunRequest, active_run_manager
from src.runtime_event_bus import get_runtime_event_bus
from src.schemas import (
    HITLResumeBody,
    RunCreate,
    RunStatus,
    ThreadOperationalState,
    ThreadStatus,
)

router = APIRouter(tags=["Thread Runs"])
_INTERNAL_AGENT_MESSAGE_KEYS = {
    "message_type",
    "status",
    "summary",
    "details",
    "metrics",
    "artifacts",
    "warnings",
    "next_action",
    "payload",
}
_INTERNAL_AGENT_MESSAGE_SYSTEM_PROMPT = (
    "You convert internal Atlas worker updates into strict JSON for UI rendering. "
    "Return only a single JSON object with snake_case keys and no code fences. "
    "The object may contain: message_type, status, summary, details, metrics, artifacts, warnings, next_action, payload. "
    "Keep summary concise. Keep details as short strings. Keep metrics as an object. Keep artifacts as absolute VM paths only when present. "
    "Preserve important meaning, but remove markdown headings, bold text, and presentation fluff."
)


class _RunCancelRequested(Exception):
    """Internal signal for cooperative run cancellation via the runtime bus."""


def _graph_config(body: RunCreate, invoke_cfg: dict) -> dict:
    """LangGraph config with recursion_limit (default 25 is too low for many tool calls)."""
    raw = dict(body.config) if body.config else {}
    rl = raw.get("recursion_limit", settings.graph_recursion_limit)
    try:
        rl_int = int(rl)
    except (TypeError, ValueError):
        rl_int = settings.graph_recursion_limit
    rl_int = max(25, min(rl_int, 1000))
    return {"configurable": invoke_cfg, "recursion_limit": rl_int}


def _reasoning_effort_from_config(configurable: dict | None) -> str | None:
    raw = str((configurable or {}).get("reasoning_effort") or "").strip().lower()
    aliases = {
        "extra_high": "xhigh",
        "extra-high": "xhigh",
        "extra high": "xhigh",
    }
    value = aliases.get(raw, raw)
    if value in {"minimal", "low", "medium", "high", "xhigh"}:
        return value
    return None


def _model_metadata_update(graph_id: str, resolved_model: str) -> dict[str, str]:
    return {model_metadata_key_for_graph(graph_id): resolved_model}


def _validate_graph_id(graph_id: str) -> str:
    if graph_id not in list_graph_ids():
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    return graph_id


def _json_safe(obj: Any) -> Any:
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(x) for x in obj]
    return str(obj)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sse(event: str, data: Any) -> dict[str, str]:
    return {"event": event, "data": json.dumps(_json_safe(data))}


def _sse_payload(frame: dict[str, str]) -> dict[str, Any]:
    try:
        return json.loads(frame.get("data", "{}"))
    except Exception:
        return {}


def _flatten_text(value: Any, max_chars: int = 220) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value
    elif isinstance(value, dict):
        try:
            text = json.dumps(value, ensure_ascii=False)
        except Exception:
            text = str(value)
    elif isinstance(value, (list, tuple)):
        parts = [_flatten_text(item, max_chars=max_chars) or "" for item in value]
        text = " ".join(part for part in parts if part)
    else:
        text = str(value)

    flattened = " ".join(text.split())
    if not flattened:
        return None
    if len(flattened) <= max_chars:
        return flattened
    return flattened[: max_chars - 3] + "..."


def _chat_chunk_text(content: Any) -> str:
    """Preserve model stream deltas as display text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content or "")


def _strip_json_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped.strip()


def _extract_absolute_paths(text: str) -> list[str]:
    seen: set[str] = set()
    paths: list[str] = []
    for match in re.finditer(r"`(/[^`\n]+)`|(/[^ \n`]+)", text):
        candidate = match.group(1) or match.group(2) or ""
        value = candidate.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        paths.append(value)
    return paths


def _normalize_internal_agent_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    if not any(key in payload for key in ("summary", "message_type", "details", "metrics", "payload")):
        return None
    normalized: dict[str, Any] = {}
    for key in _INTERNAL_AGENT_MESSAGE_KEYS:
        if key in payload:
            normalized[key] = payload[key]
    normalized.setdefault("message_type", "status_update")
    normalized.setdefault("status", "info")
    summary = normalized.get("summary")
    if not isinstance(summary, str):
        summary = _flatten_text(summary, max_chars=280) if summary is not None else ""
    normalized["summary"] = (summary or "").strip()
    details = normalized.get("details")
    if isinstance(details, str):
        details = [details]
    if not isinstance(details, list):
        details = []
    normalized["details"] = [
        str(item).strip() for item in details if str(item).strip()
    ][:8]
    metrics = normalized.get("metrics")
    normalized["metrics"] = metrics if isinstance(metrics, dict) else {}
    artifacts = normalized.get("artifacts")
    if isinstance(artifacts, str):
        artifacts = [artifacts]
    if not isinstance(artifacts, list):
        artifacts = []
    normalized["artifacts"] = [
        str(item).strip() for item in artifacts if isinstance(item, str) and str(item).strip().startswith("/")
    ][:6]
    warnings = normalized.get("warnings")
    if isinstance(warnings, str):
        warnings = [warnings]
    if not isinstance(warnings, list):
        warnings = []
    normalized["warnings"] = [
        str(item).strip() for item in warnings if str(item).strip()
    ][:6]
    next_action = normalized.get("next_action")
    normalized["next_action"] = next_action.strip() if isinstance(next_action, str) else ""
    payload_field = normalized.get("payload")
    normalized["payload"] = payload_field if isinstance(payload_field, dict) else {}
    return normalized


def _fallback_internal_agent_payload(text: str) -> dict[str, Any]:
    flattened = _flatten_text(text, max_chars=320) or "Worker update available."
    first_sentence = re.split(r"(?<=[.!?])\s+", flattened, maxsplit=1)[0].strip()
    summary = first_sentence or flattened[:160]
    details = []
    if flattened and flattened != summary:
        details.append(flattened)
    return {
        "message_type": "status_update",
        "status": "info",
        "summary": summary,
        "details": details,
        "metrics": {},
        "artifacts": _extract_absolute_paths(text),
        "warnings": [],
        "next_action": "",
        "payload": {},
    }


async def _repair_internal_agent_message_json(text: str, actor_name: str | None) -> str | None:
    llm = ChatOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.openrouter_data_extraction_api_key or settings.openrouter_api_key,
        model=settings.data_extraction_model,
        temperature=0.0,
        max_retries=1,
    )
    actor_label = actor_name or "worker"
    prompt = (
        f"Actor: {actor_label}\n"
        "Convert the following internal Atlas agent update into strict JSON only.\n"
        "Do not invent facts. Preserve dynamic task-specific details inside details, metrics, artifacts, warnings, next_action, or payload.\n\n"
        f"Update:\n{text}"
    )
    response = await asyncio.wait_for(
        llm.ainvoke(
            [
                ("system", _INTERNAL_AGENT_MESSAGE_SYSTEM_PROMPT),
                ("human", prompt),
            ]
        ),
        timeout=12,
    )
    content = response.content if hasattr(response, "content") else response
    if isinstance(content, list):
        content = "".join(str(part) for part in content)
    if not isinstance(content, str):
        content = str(content)
    return _strip_json_fences(content)


async def _ensure_internal_agent_message_json(
    text: str,
    actor_name: str | None,
    *,
    repairer: Any | None = None,
) -> str:
    cleaned = _strip_json_fences(text)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        parsed = None
    normalized = _normalize_internal_agent_payload(parsed) if isinstance(parsed, dict) else None
    if normalized:
        return json.dumps(normalized, ensure_ascii=False)

    repair = repairer or _repair_internal_agent_message_json
    try:
        repaired = await repair(text, actor_name)
    except Exception:
        repaired = None
    if isinstance(repaired, str) and repaired.strip():
        candidate = _strip_json_fences(repaired)
        try:
            parsed = json.loads(candidate)
        except Exception:
            parsed = None
        normalized = _normalize_internal_agent_payload(parsed) if isinstance(parsed, dict) else None
        if normalized:
            return json.dumps(normalized, ensure_ascii=False)

    return json.dumps(_fallback_internal_agent_payload(text), ensure_ascii=False)


def _primary_actor_label(actor_id: str) -> str:
    labels = {
        "atlas-architect": "Architect",
        "atlas-code": "Atlas Code",
        "extraction-orchestrator": "Extraction orchestrator",
    }
    return labels.get(actor_id, actor_id.replace("-", " ").strip().title())


def _display_actor_name(actor_name: str | None, primary_actor_id: str = "atlas-architect") -> str:
    if not actor_name or actor_name == primary_actor_id:
        return _primary_actor_label(primary_actor_id)
    return actor_name.replace("-", " ").strip().title()


def _tool_argument_focus(tool_name: str, tool_args: Any) -> str | None:
    if not isinstance(tool_args, dict):
        return None

    preferred_keys = {
        "shell": ("command",),
        "query_neon": ("sql",),
        "execute_neon": ("sql",),
        "read_file": ("file_path", "path"),
        "read_file_anywhere": ("file_path", "path"),
        "write_file": ("file_path", "path"),
        "write_file_anywhere": ("file_path", "path"),
        "edit_file": ("file_path", "path"),
        "append_file": ("file_path", "path"),
        "grep": ("pattern",),
        "glob": ("pattern",),
        "ls": ("path",),
        "list_documents": ("directory",),
        "preview_csv": ("file_path",),
        "task": ("description", "prompt"),
        "write_todos": ("todos",),
    }
    for key in preferred_keys.get(tool_name, ("description", "command", "sql", "file_path", "path")):
        value = tool_args.get(key)
        preview = _flatten_text(value, max_chars=180)
        if preview:
            return preview
    return _flatten_text(tool_args, max_chars=180)


def _tool_output_summary(tool_name: str, tool_args: Any, output: Any) -> str | None:
    focus = _tool_argument_focus(tool_name, tool_args)
    output_text = _flatten_text(output, max_chars=260)

    if tool_name in {"read_file", "read_file_anywhere"}:
        if isinstance(tool_args, dict):
            path = tool_args.get("file_path") or tool_args.get("path")
            if isinstance(path, str) and path.strip():
                return f"Read {os.path.basename(path.strip())}"
        return "Read file contents"

    if tool_name == "list_documents":
        if isinstance(tool_args, dict):
            directory = tool_args.get("directory")
            if isinstance(directory, str) and directory.strip():
                return f"Listed documents in {directory.strip()}"
        return "Listed available documents"

    if tool_name == "preview_csv":
        if isinstance(output, str):
            lines = output.splitlines()
            first_line = lines[0].strip() if lines else ""
            summary = first_line
            if "Rows shown:" in output and "Columns:" in output:
                try:
                    cols = output.split("Columns:", 1)[1].split("Rows shown:", 1)[0].strip()
                    rows = output.split("Rows shown:", 1)[1].splitlines()[0].strip()
                    if first_line:
                        return f"{first_line}; {len([c for c in cols.split(',') if c.strip()])} columns; {rows} rows shown"
                except Exception:
                    pass
            return summary or "Previewed CSV summary"
        return "Previewed CSV summary"

    if tool_name in {"extract_pdf_text_layer", "extract_pdf_tables", "ocr_pdf_pages", "analyze_pdf_visual_region"}:
        return focus or output_text

    if tool_name == "task":
        return _structured_output_summary(output) or output_text or focus

    return output_text or focus


def _structured_output_summary(output: Any) -> str | None:
    if isinstance(output, dict):
        payload = output
    elif isinstance(output, str):
        text = output.strip()
        if not text.startswith("{"):
            return None
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return None
    else:
        return None

    if not isinstance(payload, dict):
        return None
    summary = payload.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return None
    summary_text = summary.strip().rstrip(".")
    next_action = payload.get("next_action")
    if isinstance(next_action, str) and next_action.strip():
        return _flatten_text(
            f"{summary_text}. Next: {next_action.strip()}",
            max_chars=260,
        )
    return _flatten_text(summary.strip(), max_chars=260)


def _tool_event_kind(tool_name: str) -> str:
    if tool_name == "task":
        return "worker"
    if tool_name in {
        "query_neon",
        "read_file",
        "read_file_anywhere",
        "ls",
        "glob",
        "grep",
        "list_documents",
        "preview_csv",
    }:
        return "inspection"
    if tool_name == "write_todos":
        return "decision"
    return "tool"


def _tool_start_label(
    tool_name: str,
    actor_name: str | None,
    primary_actor_id: str = "atlas-architect",
) -> str:
    actor = _display_actor_name(actor_name, primary_actor_id)
    if tool_name == "task" and actor_name:
        return f"Delegating work to {actor}"
    labels = {
        "shell": f"{actor} is running shell",
        "query_neon": f"{actor} is querying Neon",
        "execute_neon": f"{actor} is changing Neon",
        "read_file": f"{actor} is reading a file",
        "read_file_anywhere": f"{actor} is reading a file",
        "write_file": f"{actor} is writing a file",
        "write_file_anywhere": f"{actor} is writing a file",
        "edit_file": f"{actor} is editing a file",
        "append_file": f"{actor} is appending to a file",
        "grep": f"{actor} is searching files",
        "glob": f"{actor} is scanning for files",
        "ls": f"{actor} is listing files",
        "list_documents": f"{actor} is inspecting the document library",
        "preview_csv": f"{actor} is previewing a CSV",
        "write_todos": f"{actor} is updating the plan",
    }
    return labels.get(tool_name, f"{actor} is running {tool_name}")


def _tool_complete_label(
    tool_name: str,
    actor_name: str | None,
    primary_actor_id: str = "atlas-architect",
) -> str:
    actor = _display_actor_name(actor_name, primary_actor_id)
    if tool_name == "task" and actor_name:
        return f"{actor} reported back"
    labels = {
        "shell": f"{actor} finished a shell step",
        "query_neon": f"{actor} finished a Neon query",
        "execute_neon": f"{actor} finished a Neon change",
        "read_file": f"{actor} finished reading",
        "read_file_anywhere": f"{actor} finished reading",
        "write_file": f"{actor} finished writing",
        "write_file_anywhere": f"{actor} finished writing",
        "edit_file": f"{actor} finished editing",
        "append_file": f"{actor} finished appending",
        "grep": f"{actor} finished searching files",
        "glob": f"{actor} finished scanning for files",
        "ls": f"{actor} finished listing files",
        "list_documents": f"{actor} finished inspecting documents",
        "preview_csv": f"{actor} finished previewing CSV data",
        "write_todos": f"{actor} updated the plan",
    }
    return labels.get(tool_name, f"{actor} completed {tool_name}")


def _semantic_tool_event(
    *,
    phase: str,
    thread_id: str,
    run_id: str,
    actor_name: str | None,
    tool_name: str,
    tool_args: Any,
    timestamp: str,
    output: Any = None,
    primary_actor_id: str = "atlas-architect",
) -> dict[str, Any]:
    detail = _tool_argument_focus(tool_name, tool_args)
    if phase == "complete":
        detail = _tool_output_summary(tool_name, tool_args, output) or detail
    return {
        "thread_id": thread_id,
        "run_id": run_id,
        "actor_id": actor_name or primary_actor_id,
        "kind": _tool_event_kind(tool_name),
        "label": _tool_complete_label(tool_name, actor_name, primary_actor_id)
        if phase == "complete"
        else _tool_start_label(tool_name, actor_name, primary_actor_id),
        "detail": detail,
        "tone": "success" if phase == "complete" else "info",
        "tool_name": tool_name,
        "status": "completed" if phase == "complete" else "started",
        "timestamp": timestamp,
    }


def _semantic_decision_event(
    *,
    thread_id: str,
    run_id: str,
    content: Any,
    tool_calls: list[dict[str, Any]],
    timestamp: str,
    actor_name: str | None = None,
    primary_actor_id: str = "atlas-architect",
) -> dict[str, Any] | None:
    if not tool_calls:
        return None
    first_call = tool_calls[0]
    tool_name = str(first_call.get("name", "") or "")
    tool_args = first_call.get("args", {})
    if not tool_name:
        return None

    actor_label = _display_actor_name(actor_name, primary_actor_id)
    if actor_name and actor_name != primary_actor_id:
        if tool_name == "task":
            label = f"{actor_label} chose to delegate"
        elif tool_name == "shell":
            label = f"{actor_label} chose to use shell"
        elif tool_name in {"query_neon", "read_file", "read_file_anywhere", "ls", "glob", "grep"}:
            label = f"{actor_label} chose to inspect state"
        elif tool_name == "write_todos":
            label = f"{actor_label} refined the plan"
        else:
            label = f"{actor_label} chose {tool_name}"
    else:
        if tool_name == "task":
            label = f"{actor_label} chose to delegate"
        elif tool_name == "shell":
            label = f"{actor_label} chose to use shell"
        elif tool_name in {"query_neon", "read_file", "read_file_anywhere", "ls", "glob", "grep"}:
            label = f"{actor_label} chose to inspect state"
        elif tool_name == "write_todos":
            label = f"{actor_label} refined the plan"
        else:
            label = f"{actor_label} chose {tool_name}"

    detail = _flatten_text(content, max_chars=220) or _tool_argument_focus(tool_name, tool_args)
    return {
        "thread_id": thread_id,
        "run_id": run_id,
        "actor_id": actor_name or primary_actor_id,
        "kind": "decision",
        "label": label,
        "detail": detail,
        "tone": "info",
        "tool_name": tool_name,
        "status": "started",
        "timestamp": timestamp,
    }


def _run_state_event(
    *,
    thread_id: str,
    run_id: str,
    state: str,
    model_id: str | None = None,
    detail: str | None = None,
) -> dict[str, str]:
    payload: dict[str, Any] = {
        "thread_id": thread_id,
        "run_id": run_id,
        "state": state,
        "timestamp": _utcnow_iso(),
    }
    if model_id:
        payload["model_id"] = model_id
    if detail:
        payload["detail"] = detail
    return _sse("run.state", payload)


def _model_event_is_primary(
    metadata: dict[str, Any] | None,
    primary_actor_id: str = "atlas-architect",
) -> bool:
    meta = metadata or {}
    actor = meta.get("lc_agent_name")
    if isinstance(actor, str) and actor.strip() and actor.strip() != primary_actor_id:
        return False

    checkpoint_ns = meta.get("langgraph_checkpoint_ns") or meta.get("checkpoint_ns")
    if isinstance(checkpoint_ns, str) and "|" in checkpoint_ns:
        return False
    return True


async def _semantic_agent_message_payload(
    *,
    thread_id: str,
    run_id: str,
    actor_name: str | None,
    content: Any,
    tool_calls: list[dict[str, Any]],
    message_id: str,
    timestamp: str,
    primary_actor_id: str = "atlas-architect",
) -> dict[str, Any] | None:
    actor_id = actor_name or primary_actor_id
    actor_label = _display_actor_name(actor_name, primary_actor_id)
    text = _flatten_text(content, max_chars=4000)
    if not text and tool_calls:
        first_call = tool_calls[0]
        tool_name = str(first_call.get("name", "") or "")
        tool_args = first_call.get("args", {})
        focus = _tool_argument_focus(tool_name, tool_args)
        if tool_name == "task":
            text = f"Delegating: {focus}" if focus else "Delegating work to another agent."
        elif tool_name:
            text = f"Using {tool_name}: {focus}" if focus else f"Using {tool_name}."
    if not text:
        return None
    if actor_id != primary_actor_id and primary_actor_id != "atlas-code":
        text = await _ensure_internal_agent_message_json(text, actor_name)
    return {
        "thread_id": thread_id,
        "run_id": run_id,
        "actor_id": actor_id,
        "actor_label": actor_label,
        "message_id": message_id,
        "content": text,
        "timestamp": timestamp,
        "tool_calls": tool_calls,
    }


def _session_is_attachable(session: Any | None) -> bool:
    if not session:
        return False
    return session.status == "running" and session.live_phase in {"starting", "active"}


def _thread_should_accept_steer(thread: Any, session: Any | None) -> bool:
    return (
        thread.operational_state == ThreadOperationalState.active
        and _session_is_attachable(session)
    )


def _thread_should_accept_resume(thread: Any, session: Any | None) -> bool:
    return (
        thread.operational_state == ThreadOperationalState.active
        and thread.status == ThreadStatus.interrupted
        and bool(session)
        and session.status == 'interrupted'
        and session.live_phase == 'ended'
    )


def _persistable_event(frame: dict[str, str]) -> tuple[str, dict[str, Any], str | None] | None:
    event_name = frame.get("event", "")
    if event_name not in {"agent.message", "timeline.event", "run.state"}:
        return None
    payload = _sse_payload(frame)
    actor_id = payload.get("actor_id")
    return event_name, payload, str(actor_id) if actor_id else None


def _is_retryable_provider_error(exc: Exception) -> bool:
    text = str(exc).lower()
    retryable_markers = (
        "provider returned error",
        "rate limit",
        "timeout",
        "temporarily unavailable",
        "service unavailable",
        "connection error",
        "apierror",
    )
    return any(marker in text for marker in retryable_markers)


def _provider_error_detail(exc: Exception, model_id: str) -> str:
    detail = str(exc).strip() or "Provider returned error"
    return f"Model provider error on {model_id}: {detail}"


async def _publish_retry_notice(
    thread_id: str,
    run_id: str,
    *,
    model_id: str,
    attempt: int,
    delay_seconds: int,
    detail: str,
    primary_actor_id: str = "atlas-architect",
) -> None:
    retry_detail = f"{detail} Retrying in {delay_seconds} seconds (attempt {attempt})."
    await _publish_active_frame(
        thread_id,
        _run_state_event(
            thread_id=thread_id,
            run_id=run_id,
            state="waiting_on_model",
            model_id=model_id,
            detail=retry_detail,
        ),
    )
    await _publish_active_frame(
        thread_id,
        _sse(
            "timeline.event",
            {
                "thread_id": thread_id,
                "run_id": run_id,
                "actor_id": primary_actor_id,
                "kind": "run",
                "label": "Provider error, retrying",
                "detail": retry_detail,
                "tone": "warning",
                "status": "running",
                "timestamp": _utcnow_iso(),
            },
        ),
    )


def _infer_actor_name(
    tool_name: str,
    tool_args: Any,
    metadata: dict[str, Any] | None,
    primary_actor_id: str = "atlas-architect",
) -> str | None:
    meta = metadata or {}
    actor = meta.get("lc_agent_name")
    if isinstance(actor, str) and actor.strip():
        return actor.strip()
    if tool_name == "task" and isinstance(tool_args, dict):
        subagent_type = tool_args.get("subagent_type")
        if isinstance(subagent_type, str) and subagent_type.strip():
            return subagent_type.strip()
    return primary_actor_id


async def _iter_sse_model_events(
    graph: Any,
    stream_input: Any,
    config: dict,
    *,
    thread_id: str,
    atlas_run_id: str,
    primary_actor_id: str = "atlas-architect",
) -> AsyncIterator[dict[str, str]]:
    """Map LangGraph v2 astream_events to Atlas SSE frames."""
    primary_stream_chunks: dict[str, list[str]] = {}
    stream_primary_chunks_immediately = primary_actor_id == "atlas-code"
    async for event in graph.astream_events(stream_input, config=config, version="v2"):
        kind = event.get("event", "")
        run_id = event.get("run_id", "")
        timestamp = _utcnow_iso()
        metadata = event.get("metadata", {}) or {}
        is_primary_model_event = _model_event_is_primary(metadata, primary_actor_id)

        if kind == "on_chat_model_start" and is_primary_model_event:
            yield _run_state_event(
                thread_id=thread_id,
                run_id=atlas_run_id,
                state="waiting_on_model",
            )

        elif kind == "on_chat_model_stream" and is_primary_model_event:
            chunk = event.get("data", {}).get("chunk")
            if chunk and hasattr(chunk, "content") and chunk.content:
                delta = _chat_chunk_text(chunk.content)
                if not delta:
                    continue
                primary_stream_chunks.setdefault(run_id, []).append(delta)
                if stream_primary_chunks_immediately:
                    yield {
                        "event": "messages/partial",
                        "data": json.dumps(
                            [
                                {
                                    "type": "AIMessageChunk",
                                    "content": delta,
                                    "id": run_id,
                                    "thread_id": thread_id,
                                    "run_id": atlas_run_id,
                                    "actor_id": primary_actor_id,
                                    "actor_label": _primary_actor_label(primary_actor_id),
                                }
                            ]
                        ),
                    }

        elif kind == "on_chat_model_end":
            msg = event.get("data", {}).get("output")
            if msg and hasattr(msg, "content"):
                tool_calls = [
                    {
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "args": tc.get("args", {}),
                    }
                    for tc in (msg.tool_calls or [])
                ]
                actor_name = metadata.get("lc_agent_name") if isinstance(metadata.get("lc_agent_name"), str) else None
                if is_primary_model_event:
                    yield _run_state_event(
                        thread_id=thread_id,
                        run_id=atlas_run_id,
                        state="running",
                    )
                    if not tool_calls:
                        buffered_content = "".join(primary_stream_chunks.pop(run_id, []))
                        if buffered_content and not stream_primary_chunks_immediately:
                            yield {
                                "event": "messages/partial",
                                "data": json.dumps(
                                    [
                                        {
                                            "type": "AIMessageChunk",
                                            "content": buffered_content,
                                            "id": run_id,
                                            "thread_id": thread_id,
                                            "run_id": atlas_run_id,
                                            "actor_id": primary_actor_id,
                                            "actor_label": _primary_actor_label(primary_actor_id),
                                        }
                                    ]
                                ),
                            }
                        yield {
                            "event": "messages/complete",
                            "data": json.dumps(
                                [
                                    {
                                        "type": "AIMessage",
                                        "content": msg.content,
                                        "id": run_id,
                                        "thread_id": thread_id,
                                        "run_id": atlas_run_id,
                                        "actor_id": primary_actor_id,
                                        "actor_label": _primary_actor_label(primary_actor_id),
                                        "tool_calls": tool_calls,
                                    }
                                ]
                            ),
                        }
                    else:
                        primary_stream_chunks.pop(run_id, None)
                else:
                    agent_message = await _semantic_agent_message_payload(
                        thread_id=thread_id,
                        run_id=atlas_run_id,
                        actor_name=actor_name,
                        primary_actor_id=primary_actor_id,
                        content=msg.content,
                        tool_calls=tool_calls,
                        message_id=run_id,
                        timestamp=timestamp,
                    )
                    if agent_message:
                        yield _sse("agent.message", agent_message)
                semantic_decision = _semantic_decision_event(
                    thread_id=thread_id,
                    run_id=atlas_run_id,
                    content=msg.content,
                    tool_calls=tool_calls,
                    timestamp=timestamp,
                    actor_name=actor_name,
                    primary_actor_id=primary_actor_id,
                )
                if semantic_decision:
                    yield _sse("timeline.event", semantic_decision)

        elif kind == "on_tool_start":
            tool_name = event.get("name", "")
            tool_args = event.get("data", {}).get("input", {})
            tool_meta = event.get("metadata", {}) or {}
            actor_name = _infer_actor_name(tool_name, tool_args, tool_meta, primary_actor_id)
            tool_payload = {
                "thread_id": thread_id,
                "run_id": atlas_run_id,
                "tool_run_id": run_id,
                "name": tool_name,
                "status": "running",
                "args": tool_args,
                "agent_name": actor_name,
                "graph_node": tool_meta.get("langgraph_node"),
                "checkpoint_ns": tool_meta.get("langgraph_checkpoint_ns")
                or tool_meta.get("checkpoint_ns"),
                "timestamp": timestamp,
            }
            yield _run_state_event(
                thread_id=thread_id,
                run_id=atlas_run_id,
                state="waiting_on_tool",
            )
            yield _sse(
                "timeline.event",
                _semantic_tool_event(
                    phase="start",
                    thread_id=thread_id,
                    run_id=atlas_run_id,
                    actor_name=actor_name,
                    primary_actor_id=primary_actor_id,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    timestamp=timestamp,
                ),
            )
            yield _sse("tool.started", tool_payload)
            if actor_name:
                yield _sse(
                    "subagent.status",
                    {
                        "thread_id": thread_id,
                        "run_id": atlas_run_id,
                        "agent_name": actor_name,
                        "status": "running",
                        "tool_name": tool_name,
                        "args": tool_args,
                        "timestamp": timestamp,
                    },
                )
            yield {
                "event": "messages/metadata",
                "data": json.dumps({"tool_call": tool_payload}),
            }

        elif kind == "on_tool_end":
            tool_name = event.get("name", "")
            output = event.get("data", {}).get("output", "")
            tool_args = event.get("data", {}).get("input", {})
            tool_meta = event.get("metadata", {}) or {}
            actor_name = _infer_actor_name(tool_name, tool_args, tool_meta, primary_actor_id)
            tool_payload = {
                "thread_id": thread_id,
                "run_id": atlas_run_id,
                "tool_run_id": run_id,
                "name": tool_name,
                "status": "complete",
                "args": tool_args,
                "output": str(output)[:2000],
                "agent_name": actor_name,
                "graph_node": tool_meta.get("langgraph_node"),
                "checkpoint_ns": tool_meta.get("langgraph_checkpoint_ns")
                or tool_meta.get("checkpoint_ns"),
                "timestamp": timestamp,
            }
            yield _sse(
                "timeline.event",
                _semantic_tool_event(
                    phase="complete",
                    thread_id=thread_id,
                    run_id=atlas_run_id,
                    actor_name=actor_name,
                    primary_actor_id=primary_actor_id,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    output=output,
                    timestamp=timestamp,
                ),
            )
            yield _sse("tool.completed", tool_payload)
            if actor_name:
                yield _sse(
                    "subagent.status",
                    {
                        "thread_id": thread_id,
                        "run_id": atlas_run_id,
                        "agent_name": actor_name,
                        "status": "completed" if tool_name == "task" else "running",
                        "tool_name": tool_name,
                        "args": tool_args,
                        "output": str(output)[:2000],
                        "timestamp": timestamp,
                    },
                )
            yield {
                "event": "messages/metadata",
                "data": json.dumps({"tool_call": tool_payload}),
            }
            yield _run_state_event(
                thread_id=thread_id,
                run_id=atlas_run_id,
                state="running",
            )


async def _finalize_thread_after_stream(
    graph: Any,
    config: dict,
    thread_id: uuid.UUID,
    run_id: str,
    graph_id: str,
    resolved_model: str,
) -> AsyncIterator[dict[str, str]]:
    """Emit interrupt / todos hooks; set thread status."""
    snap = await graph.aget_state(config)
    if snap.interrupts:
        await thread_store.update_status(thread_id, ThreadStatus.interrupted)
        intr = [{"id": i.id, "value": _json_safe(i.value)} for i in snap.interrupts]
        yield _run_state_event(
            thread_id=str(thread_id),
            run_id=run_id,
            state="interrupted",
            model_id=resolved_model,
        )
        yield {"event": "hitl_interrupt", "data": json.dumps({"interrupts": intr})}
    else:
        await thread_store.update_metadata(
            thread_id,
            _model_metadata_update(graph_id, resolved_model),
        )
        await thread_store.update_status(thread_id, ThreadStatus.idle)
        yield _run_state_event(
            thread_id=str(thread_id),
            run_id=run_id,
            state="completed",
            model_id=resolved_model,
        )

    vals = snap.values if isinstance(snap.values, dict) else {}
    if isinstance(vals, dict) and "todos" in vals:
        yield {
            "event": "state/todos",
            "data": json.dumps({"todos": _json_safe(vals["todos"])}),
        }

    yield {"event": "end", "data": ""}


@router.post("/threads/{thread_id}/runs")
async def create_run(thread_id: uuid.UUID, body: RunCreate):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    graph_id = _validate_graph_id(body.assistant_id)
    incoming = dict(body.config.get("configurable") or {})
    resolved_model = await resolve_model_for_run(graph_id, incoming)
    reasoning_effort = _reasoning_effort_from_config(incoming)
    invoke_cfg = {**incoming, "thread_id": str(thread_id)}
    invoke_cfg.pop("model", None)
    config = _graph_config(body, invoke_cfg)
    await get_graph(graph_id=graph_id, model_id=resolved_model, reasoning_effort=reasoning_effort)

    msgs = body.input.get("messages", [])
    first_text = ""
    if msgs:
        first_text = str(msgs[0].get("content", "") or "")[:60]

    created = await run_store.create(
        thread_id=thread_id,
        assistant_id=None,
        status=RunStatus.pending.value,
        metadata={**body.metadata, "assistant_graph_id": graph_id},
        kwargs={"kind": "input", "assistant_graph_id": graph_id},
        multitask_strategy=body.multitask_strategy.value,
    )
    metadata_update: dict[str, Any] = {
        "graph_id": graph_id,
        "assistant_graph_id": graph_id,
        **_model_metadata_update(graph_id, resolved_model),
    }
    if first_text and not thread.metadata.get("title"):
        metadata_update["title"] = first_text
    await thread_store.update_metadata(thread_id, metadata_update)

    session = await active_run_manager.get(str(thread_id))
    if (
        body.multitask_strategy.value == "interrupt"
        and session
        and session.current_run_id
    ):
        await get_runtime_event_bus().request_run_cancel(session.current_run_id)

    request = QueuedRunRequest(
        kind="input",
        payload=body.input,
        config=config,
        resolved_model=resolved_model,
        assistant_id=graph_id,
        run_id=str(created["run_id"]),
        metadata={**body.metadata, **({"title": first_text} if first_text else {})},
        multitask_strategy=body.multitask_strategy.value,
    )
    session = await active_run_manager.get(str(thread_id))
    if (
        body.multitask_strategy.value == "interrupt"
        and session
        and session.current_run_id
    ):
        await get_runtime_event_bus().request_run_cancel(session.current_run_id)
    await active_run_manager.enqueue(
        str(thread_id),
        request,
        lambda session: asyncio.create_task(
            _run_live_session(session), name=f"background-run-{str(thread_id)[:8]}"
        ),
    )
    await _wake_run_worker_after_enqueue()
    return created


@router.post("/threads/{thread_id}/runs/stream")
async def stream_run(thread_id: uuid.UUID, body: RunCreate):
    """Stream a run using SSE."""
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    graph_id = _validate_graph_id(body.assistant_id)
    incoming = dict(body.config.get("configurable") or {})
    resolved_model = await resolve_model_for_run(graph_id, incoming)
    reasoning_effort = _reasoning_effort_from_config(incoming)
    invoke_cfg = {**incoming, "thread_id": str(thread_id)}
    invoke_cfg.pop("model", None)
    config = _graph_config(body, invoke_cfg)
    graph = await get_graph(
        graph_id=graph_id,
        model_id=resolved_model,
        reasoning_effort=reasoning_effort,
    )
    run_id = str(uuid.uuid4())

    async def event_generator():
        await thread_store.update_status(thread_id, ThreadStatus.busy)
        await thread_store.update_operational_state(thread_id, ThreadOperationalState.active)

        msgs = body.input.get("messages", [])
        if msgs:
            first_text = msgs[0].get("content", "")[:60]
            if first_text and not thread.metadata.get("title"):
                await thread_store.update_metadata(thread_id, {"title": first_text})

        try:
            yield {
                "event": "metadata",
                "data": json.dumps(
                    {
                        "run_id": run_id,
                        "thread_id": str(thread_id),
                        "model_id": resolved_model,
                        "timestamp": _utcnow_iso(),
                    }
                ),
            }
            yield _run_state_event(
                thread_id=str(thread_id),
                run_id=run_id,
                state="starting",
                model_id=resolved_model,
            )
            yield _run_state_event(
                thread_id=str(thread_id),
                run_id=run_id,
                state="running",
                model_id=resolved_model,
            )

            async for frame in _iter_sse_model_events(
                graph,
                body.input,
                config,
                thread_id=str(thread_id),
                atlas_run_id=run_id,
                primary_actor_id=body.assistant_id,
            ):
                yield frame

            async for frame in _finalize_thread_after_stream(
                graph, config, thread_id, run_id, body.assistant_id, resolved_model
            ):
                yield frame

        except Exception as e:
            await thread_store.update_status(thread_id, ThreadStatus.error)
            await thread_store.update_operational_state(thread_id, ThreadOperationalState.active)
            yield _run_state_event(
                thread_id=str(thread_id),
                run_id=run_id,
                state="failed",
                model_id=resolved_model,
                detail=str(e),
            )
            yield {"event": "error", "data": json.dumps({"detail": str(e)})}

    return EventSourceResponse(event_generator())


@router.post("/threads/{thread_id}/runs/stream/resume")
async def stream_resume(thread_id: uuid.UUID, body: HITLResumeBody):
    """Resume after HITL interrupt; same SSE shape as `/runs/stream`."""
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    graph_id = "atlas-architect"
    if isinstance(thread.metadata, dict):
        candidate = thread.metadata.get("graph_id") or thread.metadata.get("assistant_graph_id")
        if isinstance(candidate, str) and candidate in list_graph_ids():
            graph_id = candidate
    resolved_model = await resolve_model_for_thread_state(graph_id, thread.metadata)
    invoke_cfg = {"thread_id": str(thread_id)}
    config = _graph_config(
        RunCreate(config={"configurable": {**invoke_cfg}}),
        invoke_cfg,
    )
    graph = await get_graph(graph_id=graph_id, model_id=resolved_model)
    run_id = str(uuid.uuid4())
    cmd = Command(resume={"decisions": body.decisions})

    async def event_generator():
        await thread_store.update_status(thread_id, ThreadStatus.busy)
        await thread_store.update_operational_state(thread_id, ThreadOperationalState.active)
        try:
            yield {
                "event": "metadata",
                "data": json.dumps(
                    {
                        "run_id": run_id,
                        "thread_id": str(thread_id),
                        "model_id": resolved_model,
                        "timestamp": _utcnow_iso(),
                    }
                ),
            }
            yield _run_state_event(
                thread_id=str(thread_id),
                run_id=run_id,
                state="running",
                model_id=resolved_model,
            )

            async for frame in _iter_sse_model_events(
                graph,
                cmd,
                config,
                thread_id=str(thread_id),
                atlas_run_id=run_id,
                primary_actor_id=graph_id,
            ):
                yield frame

            async for frame in _finalize_thread_after_stream(
                graph, config, thread_id, run_id, graph_id, resolved_model
            ):
                yield frame

        except Exception as e:
            await thread_store.update_status(thread_id, ThreadStatus.error)
            await thread_store.update_operational_state(thread_id, ThreadOperationalState.active)
            yield _run_state_event(
                thread_id=str(thread_id),
                run_id=run_id,
                state="failed",
                model_id=resolved_model,
                detail=str(e),
            )
            yield {"event": "error", "data": json.dumps({"detail": str(e)})}

    return EventSourceResponse(event_generator())


async def _publish_active_frame(thread_id: str, frame: dict[str, str]) -> None:
    persistable = _persistable_event(frame)
    if persistable:
        event_name, payload, actor_id = persistable
        run_id = payload.get("run_id")
        if run_id:
            try:
                await run_store.append_event(
                    run_id=uuid.UUID(str(run_id)),
                    thread_id=uuid.UUID(thread_id),
                    event_name=event_name,
                    payload=payload,
                    actor_id=actor_id,
                )
            except Exception:
                traceback.print_exc()
    try:
        await get_runtime_event_bus().publish_sse_frame(frame)
    except Exception:
        traceback.print_exc()
    await active_run_manager.publish(thread_id, frame)


async def _wake_run_worker_after_enqueue() -> None:
    try:
        await get_runtime_event_bus().wake_run_worker()
    except Exception:
        traceback.print_exc()


async def _execute_live_request(thread_id: uuid.UUID, request: QueuedRunRequest) -> str:
    thread_key = str(thread_id)
    if request.run_id:
        run_id = request.run_id
        await run_store.update_status(uuid.UUID(run_id), RunStatus.running.value)
    else:
        created = await run_store.create(
            thread_id=thread_id,
            assistant_id=None,
            status=RunStatus.running.value,
            metadata={**request.metadata, "assistant_graph_id": request.assistant_id},
            kwargs={"kind": request.kind, "assistant_graph_id": request.assistant_id},
            multitask_strategy=request.multitask_strategy,
        )
        run_id = str(created["run_id"])
    await active_run_manager.set_current_run_id(thread_key, run_id)
    await thread_store.update_status(thread_id, ThreadStatus.busy)
    await thread_store.update_operational_state(thread_id, ThreadOperationalState.active)

    await _publish_active_frame(
        thread_key,
        {
            "event": "metadata",
            "data": json.dumps(
                {
                    "run_id": run_id,
                    "thread_id": thread_key,
                    "model_id": request.resolved_model,
                    "timestamp": _utcnow_iso(),
                }
            ),
        },
    )
    await _publish_active_frame(
        thread_key,
        _run_state_event(
            thread_id=thread_key,
            run_id=run_id,
            state="starting" if request.kind == "input" else "running",
            model_id=request.resolved_model,
        ),
    )
    await _publish_active_frame(
        thread_key,
        _run_state_event(
            thread_id=thread_key,
            run_id=run_id,
            state="running",
            model_id=request.resolved_model,
        ),
    )

    stream_input: Any
    if request.kind == "resume":
        stream_input = Command(resume={"decisions": request.payload})
    else:
        stream_input = request.payload

    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        emitted_meaningful_progress = False
        try:
            graph = await get_graph(
                graph_id=request.assistant_id,
                model_id=request.resolved_model,
                reasoning_effort=_reasoning_effort_from_config(
                    request.config.get("configurable")
                    if isinstance(request.config, dict)
                    else None
                ),
            )
            async for frame in _iter_sse_model_events(
                graph,
                stream_input,
                request.config,
                thread_id=thread_key,
                atlas_run_id=run_id,
                primary_actor_id=request.assistant_id,
            ):
                if await get_runtime_event_bus().is_run_cancel_requested(run_id):
                    raise _RunCancelRequested
                if frame["event"] in {
                    "messages/partial",
                    "messages/complete",
                    "tool.started",
                    "tool.completed",
                    "hitl_interrupt",
                    "state/todos",
                }:
                    emitted_meaningful_progress = True
                await _publish_active_frame(thread_key, frame)
            break
        except _RunCancelRequested:
            await thread_store.update_status(thread_id, ThreadStatus.idle)
            await run_store.update_status(uuid.UUID(run_id), RunStatus.cancelled.value)
            await _publish_active_frame(
                thread_key,
                _run_state_event(
                    thread_id=thread_key,
                    run_id=run_id,
                    state="cancelled",
                    model_id=request.resolved_model,
                    detail="Cancelled by a newer run request",
                ),
            )
            await _publish_active_frame(thread_key, {"event": "end", "data": ""})
            return "cancelled"
        except Exception as exc:
            detail = _provider_error_detail(exc, request.resolved_model)
            should_retry = (
                attempt < max_attempts
                and not emitted_meaningful_progress
                and _is_retryable_provider_error(exc)
            )
            if not should_retry:
                raise RuntimeError(detail) from exc
            delay_seconds = 2 ** attempt
            await _publish_retry_notice(
                thread_key,
                run_id,
                model_id=request.resolved_model,
                attempt=attempt,
                delay_seconds=delay_seconds,
                detail=detail,
                primary_actor_id=request.assistant_id,
            )
            await asyncio.sleep(delay_seconds)

    snap = await graph.aget_state(request.config)
    if snap.interrupts:
        await thread_store.update_status(thread_id, ThreadStatus.interrupted)
        await run_store.update_status(uuid.UUID(run_id), RunStatus.interrupted.value)
        intr = [{"id": i.id, "value": _json_safe(i.value)} for i in snap.interrupts]
        await _publish_active_frame(
            thread_key,
            _run_state_event(
                thread_id=thread_key,
                run_id=run_id,
                state="interrupted",
                model_id=request.resolved_model,
            ),
        )
        await _publish_active_frame(
            thread_key,
            {"event": "hitl_interrupt", "data": json.dumps({"interrupts": intr})},
        )
        vals = snap.values if isinstance(snap.values, dict) else {}
        if isinstance(vals, dict) and "todos" in vals:
            await _publish_active_frame(
                thread_key,
                {
                    "event": "state/todos",
                    "data": json.dumps({"todos": _json_safe(vals["todos"])}),
                },
            )
        await _publish_active_frame(thread_key, {"event": "end", "data": ""})
        return "interrupted"

    await thread_store.update_metadata(
        thread_id,
        {
            "graph_id": request.assistant_id,
            "assistant_graph_id": request.assistant_id,
            **_model_metadata_update(request.assistant_id, request.resolved_model),
        },
    )
    await thread_store.update_status(thread_id, ThreadStatus.idle)
    await run_store.update_status(uuid.UUID(run_id), RunStatus.success.value)
    await _publish_active_frame(
        thread_key,
        _run_state_event(
            thread_id=thread_key,
            run_id=run_id,
            state="completed",
            model_id=request.resolved_model,
        ),
    )
    vals = snap.values if isinstance(snap.values, dict) else {}
    if isinstance(vals, dict) and "todos" in vals:
        await _publish_active_frame(
            thread_key,
            {
                "event": "state/todos",
                "data": json.dumps({"todos": _json_safe(vals["todos"])}),
            },
        )
    await _publish_active_frame(thread_key, {"event": "end", "data": ""})
    return "completed"


async def _run_live_session(session) -> None:
    thread_id = uuid.UUID(session.thread_id)
    final_status = "completed"
    last_assistant_id = "atlas-architect"
    try:
        while True:
            request = await active_run_manager.pop_next_request(session.thread_id)
            if request is None:
                break
            last_assistant_id = request.assistant_id
            status = await _execute_live_request(thread_id, request)
            final_status = status
            if status == "interrupted":
                break
    except asyncio.CancelledError:
        final_status = "stopped"
        current_run_id = session.current_run_id
        if current_run_id:
            try:
                await run_store.update_status(uuid.UUID(current_run_id), RunStatus.cancelled.value)
            except Exception:
                pass
        await thread_store.update_status(thread_id, ThreadStatus.idle)
        await thread_store.update_operational_state(thread_id, ThreadOperationalState.inactive)
        if current_run_id:
            await _publish_active_frame(
                session.thread_id,
                _run_state_event(
                    thread_id=session.thread_id,
                    run_id=current_run_id,
                    state="cancelled",
                    detail="Stopped by operator",
                ),
            )
            await _publish_active_frame(
                session.thread_id,
                {"event": "error", "data": json.dumps({"detail": "Stopped by operator"})},
            )
        await _publish_active_frame(session.thread_id, {"event": "end", "data": ""})
    except Exception as exc:
        final_status = "failed"
        current_run_id = session.current_run_id or str(uuid.uuid4())
        traceback.print_exc()
        await thread_store.update_status(thread_id, ThreadStatus.error)
        await thread_store.update_operational_state(thread_id, ThreadOperationalState.active)
        if session.current_run_id:
            try:
                await run_store.update_status(uuid.UUID(current_run_id), RunStatus.error.value)
            except Exception:
                pass
            await _publish_active_frame(
                session.thread_id,
                _run_state_event(
                    thread_id=session.thread_id,
                    run_id=current_run_id,
                    state="failed",
                    detail=str(exc),
                ),
            )
            await _publish_active_frame(
                session.thread_id,
                {"event": "error", "data": json.dumps({"detail": str(exc)})},
            )
        await _publish_active_frame(session.thread_id, {"event": "end", "data": ""})
    finally:
        if last_assistant_id == "atlas-architect":
            schedule_architect_memory_backup(
                f"run:{session.current_run_id or session.thread_id}:{final_status}"
            )
        await active_run_manager.finish(session.thread_id, final_status)
        await active_run_manager.close_streams(session.thread_id)


async def _ensure_live_request(thread_id: uuid.UUID, body: RunCreate) -> None:
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    graph_id = _validate_graph_id(body.assistant_id)
    incoming = dict(body.config.get("configurable") or {})
    resolved_model = await resolve_model_for_run(graph_id, incoming)
    invoke_cfg = {**incoming, "thread_id": str(thread_id)}
    invoke_cfg.pop("model", None)
    config = _graph_config(body, invoke_cfg)

    msgs = body.input.get("messages", [])
    first_text = ""
    if msgs:
        first_text = str(msgs[0].get("content", "") or "")[:60]
        if first_text and not thread.metadata.get("title"):
            await thread_store.update_metadata(thread_id, {"title": first_text})

    request = QueuedRunRequest(
        kind="input",
        payload=body.input,
        config=config,
        resolved_model=resolved_model,
        assistant_id=graph_id,
        metadata={**body.metadata, **({"title": first_text} if first_text else {})},
        multitask_strategy=body.multitask_strategy.value,
    )
    await active_run_manager.enqueue(
        str(thread_id),
        request,
        lambda session: asyncio.create_task(_run_live_session(session), name=f"live-run-{str(thread_id)[:8]}"),
    )
    await _wake_run_worker_after_enqueue()


async def _ensure_live_resume_request(thread_id: uuid.UUID, body: HITLResumeBody) -> None:
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    session = await active_run_manager.get(str(thread_id))
    if not _thread_should_accept_resume(thread, session):
        raise HTTPException(status_code=409, detail="No interrupted run to resume")

    graph_id = "atlas-architect"
    if isinstance(thread.metadata, dict):
        candidate = thread.metadata.get("graph_id") or thread.metadata.get("assistant_graph_id")
        if isinstance(candidate, str) and candidate in list_graph_ids():
            graph_id = candidate
    resolved_model = await resolve_model_for_thread_state(graph_id, thread.metadata)
    invoke_cfg = {"thread_id": str(thread_id)}
    config = _graph_config(
        RunCreate(config={"configurable": {**invoke_cfg}}),
        invoke_cfg,
    )

    request = QueuedRunRequest(
        kind="resume",
        payload=body.decisions,
        config=config,
        resolved_model=resolved_model,
        assistant_id=graph_id,
        metadata={"resume": True},
        multitask_strategy="enqueue",
    )
    await active_run_manager.enqueue(
        str(thread_id),
        request,
        lambda session: asyncio.create_task(_run_live_session(session), name='live-run-resume'),
    )
    await _wake_run_worker_after_enqueue()


@router.post("/threads/{thread_id}/runs/live")
async def stream_live_run(thread_id: uuid.UUID, body: RunCreate):
    await _ensure_live_request(thread_id, body)

    async def event_generator():
        async for frame in active_run_manager.stream(str(thread_id)):
            yield frame

    return EventSourceResponse(event_generator())


@router.get("/threads/{thread_id}/runs/live")
async def attach_live_run(thread_id: uuid.UUID):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    session = await active_run_manager.get(str(thread_id))
    if not _session_is_attachable(session):
        raise HTTPException(status_code=404, detail="No active run for thread")

    async def event_generator():
        async for frame in active_run_manager.stream(str(thread_id)):
            yield frame

    return EventSourceResponse(event_generator())


@router.post("/threads/{thread_id}/runs/live/resume")
async def resume_live_run(thread_id: uuid.UUID, body: HITLResumeBody):
    await _ensure_live_resume_request(thread_id, body)

    async def event_generator():
        async for frame in active_run_manager.stream(str(thread_id), replay_history=False):
            yield frame

    return EventSourceResponse(event_generator())


@router.post("/threads/{thread_id}/runs/live/steer")
async def steer_live_run(thread_id: uuid.UUID, body: RunCreate):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    session = await active_run_manager.get(str(thread_id))
    if not _thread_should_accept_steer(thread, session):
        raise HTTPException(status_code=409, detail="No active run to steer")

    graph_id = _validate_graph_id(body.assistant_id)
    await _ensure_live_request(thread_id, body)
    current_run_id = session.current_run_id or str(uuid.uuid4())
    await _publish_active_frame(
        str(thread_id),
        _sse(
            "timeline.event",
            {
                "thread_id": str(thread_id),
                "run_id": current_run_id,
                "actor_id": graph_id,
                "kind": "decision",
                "label": "Operator steer queued",
                "detail": _flatten_text(body.input.get("messages", []), max_chars=220),
                "tone": "info",
                "status": "started",
                "timestamp": _utcnow_iso(),
            },
        ),
    )
    return {"ok": True, "thread_id": str(thread_id), "status": "queued"}


@router.post("/threads/{thread_id}/runs/live/stop")
async def stop_live_run(thread_id: uuid.UUID):
    session = await active_run_manager.stop(str(thread_id))
    if not session:
        raise HTTPException(status_code=404, detail="No active run for thread")
    if session.current_run_id:
        await get_runtime_event_bus().request_run_cancel(session.current_run_id)
    return {"ok": True, "thread_id": str(thread_id), "status": "stopping"}


@router.post("/threads/{thread_id}/runs/{run_id}/cancel")
async def cancel_run(thread_id: uuid.UUID, run_id: uuid.UUID):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    result = await run_store.get(run_id)
    if not result or result["thread_id"] != str(thread_id):
        raise HTTPException(status_code=404, detail="Run not found")
    await get_runtime_event_bus().request_run_cancel(str(run_id))
    session = await active_run_manager.get(str(thread_id))
    if not session or session.current_run_id != str(run_id):
        await run_store.update_status(run_id, RunStatus.cancelled.value)
    return {
        "ok": True,
        "thread_id": str(thread_id),
        "run_id": str(run_id),
        "status": "cancelling",
    }


@router.get("/threads/{thread_id}/runs")
async def list_runs(
    thread_id: uuid.UUID, limit: int = 10, offset: int = 0, status: str | None = None
):
    thread = await thread_store.get(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return await run_store.list_for_thread(thread_id, limit=limit, offset=offset, status=status)


@router.get("/threads/{thread_id}/runs/{run_id}")
async def get_run(thread_id: uuid.UUID, run_id: uuid.UUID):
    result = await run_store.get(run_id)
    if not result or result["thread_id"] != str(thread_id):
        raise HTTPException(status_code=404, detail="Run not found")
    return result


@router.post("/runs/stateless")
async def create_stateless_run(body: RunCreate):
    graph_id = _validate_graph_id(body.assistant_id)
    incoming = dict(body.config.get("configurable") or {})
    resolved_model = await resolve_model_for_run(graph_id, incoming)
    reasoning_effort = _reasoning_effort_from_config(incoming)
    invoke_cfg = {**incoming, "thread_id": str(uuid.uuid4())}
    invoke_cfg.pop("model", None)
    config = _graph_config(body, invoke_cfg)
    graph = await get_graph(
        graph_id=graph_id,
        model_id=resolved_model,
        reasoning_effort=reasoning_effort,
    )
    result = await graph.ainvoke(body.input, config=config)
    last_msg = result.get("messages", [])[-1] if result.get("messages") else None
    return {
        "content": last_msg.content if last_msg and hasattr(last_msg, "content") else str(last_msg),
    }


@router.post("/runs/stateless/stream")
async def stream_stateless_run(body: RunCreate):
    graph_id = _validate_graph_id(body.assistant_id)
    incoming = dict(body.config.get("configurable") or {})
    resolved_model = await resolve_model_for_run(graph_id, incoming)
    reasoning_effort = _reasoning_effort_from_config(incoming)
    invoke_cfg = {**incoming, "thread_id": str(uuid.uuid4())}
    invoke_cfg.pop("model", None)
    config = _graph_config(body, invoke_cfg)
    graph = await get_graph(
        graph_id=graph_id,
        model_id=resolved_model,
        reasoning_effort=reasoning_effort,
    )
    run_id = str(uuid.uuid4())
    thread_id = str(uuid.uuid4())

    async def event_generator():
        yield {
            "event": "metadata",
            "data": json.dumps(
                {
                    "run_id": run_id,
                    "thread_id": thread_id,
                    "model_id": resolved_model,
                    "timestamp": _utcnow_iso(),
                }
            ),
        }
        yield _run_state_event(
            thread_id=thread_id,
            run_id=run_id,
            state="running",
            model_id=resolved_model,
        )
        async for frame in _iter_sse_model_events(
            graph,
            body.input,
            config,
            thread_id=thread_id,
            atlas_run_id=run_id,
            primary_actor_id=body.assistant_id,
        ):
            yield frame
        yield _run_state_event(
            thread_id=thread_id,
            run_id=run_id,
            state="completed",
            model_id=resolved_model,
        )
        yield {"event": "end", "data": ""}

    return EventSourceResponse(event_generator())
