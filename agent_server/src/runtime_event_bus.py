"""Redis-backed live Agent Server communication and event surfaces.

This module mirrors the official Agent Server Redis role: worker wake-up,
streaming pub/sub, cancellation signaling, and short-lived operational state.
LangGraph Redis checkpointer/store support is handled separately by the
official ``langgraph-checkpoint-redis`` package.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as redis
from redis.exceptions import RedisError

from src.config import settings


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return str(value)


def _loads_frame_data(frame: dict[str, str]) -> dict[str, Any]:
    raw = frame.get("data", "")
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {"message": raw}
    return value if isinstance(value, dict) else {"payload": value}


def _message_from_payload(payload: dict[str, Any]) -> str:
    for key in ("message", "label", "detail", "state", "status"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _status_from_payload(event_type: str, payload: dict[str, Any]) -> str:
    value = payload.get("status") or payload.get("state")
    if isinstance(value, str) and value.strip():
        return value.strip()
    if event_type == "error":
        return "failed"
    if event_type == "end":
        return "completed"
    return "emitted"


def _decode_stream_event(stream_id: str, raw: dict[str, str]) -> dict[str, Any]:
    payload_raw = raw.get("payload") or "{}"
    try:
        payload = json.loads(payload_raw)
    except Exception:
        payload = {"raw": payload_raw}
    if not isinstance(payload, dict):
        payload = {"value": payload}
    try:
        sequence: int | None = int(str(raw.get("sequence") or ""))
    except ValueError:
        sequence = None
    return {
        "stream_id": stream_id,
        "event_id": raw.get("event_id") or "",
        "sequence": sequence,
        "thread_id": raw.get("thread_id") or "",
        "run_id": raw.get("run_id") or "",
        "source": raw.get("source") or "",
        "event_type": raw.get("event_type") or "",
        "status": raw.get("status") or "",
        "message": raw.get("message") or "",
        "payload": payload,
        "created_at": raw.get("created_at") or "",
    }


def _first_payload_item(payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("payload")
    if isinstance(items, list) and items and isinstance(items[0], dict):
        return items[0]
    return payload


def _json_object_from_text(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str) or not value.strip().startswith("{"):
        return None
    try:
        parsed = json.loads(value)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _reasoning_text_from_payload(body: dict[str, Any]) -> str:
    for key in (
        "reasoning",
        "reasoning_content",
        "reasoning_summary",
        "thinking",
        "thought",
        "thoughts",
    ):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, list):
            text = "\n".join(str(item) for item in value if str(item).strip())
            if text.strip():
                return text
    return ""


def _transcript_item_from_event(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = str(event.get("event_type") or "")
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    body = _first_payload_item(payload)
    actor_id = str(body.get("actor_id") or body.get("agent_name") or event.get("source") or "")
    actor_label = str(body.get("actor_label") or actor_id or "Atlas Runtime")
    base = {
        "id": event.get("event_id") or event.get("stream_id"),
        "stream_id": event.get("stream_id"),
        "event_id": event.get("event_id"),
        "event_type": event_type,
        "sequence": event.get("sequence"),
        "thread_id": event.get("thread_id"),
        "run_id": event.get("run_id"),
        "actor_id": actor_id,
        "actor_label": actor_label,
        "status": event.get("status"),
        "created_at": event.get("created_at"),
        "raw_event": event,
    }

    if event_type in {
        "reasoning.delta",
        "reasoning.complete",
        "thinking.delta",
        "thinking.complete",
    }:
        content = _reasoning_text_from_payload(body) or str(body.get("content") or "")
        if not content.strip():
            return None
        return {
            **base,
            "kind": "reasoning",
            "reasoning_id": body.get("reasoning_id") or body.get("id") or event.get("event_id"),
            "content": content,
        }

    if event_type in {"agent.message", "messages/complete", "messages/partial"}:
        content = body.get("content")
        if not isinstance(content, str) or not content.strip():
            return None
        parsed_content = _json_object_from_text(content)
        reasoning = _reasoning_text_from_payload(body)
        return {
            **base,
            "kind": "message",
            "message_id": body.get("message_id") or body.get("id") or event.get("event_id"),
            "content": content,
            "parsed_content": parsed_content,
            "reasoning": reasoning or None,
            "tool_calls": body.get("tool_calls") if isinstance(body.get("tool_calls"), list) else [],
        }

    tool_call = payload.get("tool_call") if isinstance(payload, dict) else None
    tool_body = tool_call if isinstance(tool_call, dict) else body
    if event_type in {"tool.started", "tool.completed", "messages/metadata"} and isinstance(
        tool_body, dict
    ):
        tool_name = tool_body.get("name")
        if not isinstance(tool_name, str) or not tool_name:
            return None
        return {
            **base,
            "kind": "tool",
            "tool_run_id": tool_body.get("tool_run_id"),
            "tool_name": tool_name,
            "args": tool_body.get("args") if isinstance(tool_body.get("args"), dict) else {},
            "output": tool_body.get("output"),
        }

    if event_type in {"run.state", "subagent.status", "timeline.event", "error", "end"}:
        return {
            **base,
            "kind": "status",
            "message": event.get("message") or body.get("label") or body.get("detail") or "",
        }

    return None


def _message_transcript_key(item: dict[str, Any]) -> str | None:
    message_id = item.get("message_id")
    return str(message_id) if message_id else None


def _reasoning_transcript_key(item: dict[str, Any]) -> str | None:
    reasoning_id = item.get("reasoning_id")
    return str(reasoning_id) if reasoning_id else None


def _tool_transcript_key(item: dict[str, Any]) -> str | None:
    tool_run_id = item.get("tool_run_id")
    if tool_run_id:
        return str(tool_run_id)
    tool_name = item.get("tool_name")
    run_id = item.get("run_id")
    sequence = item.get("sequence")
    if tool_name and run_id and sequence:
        return f"{run_id}:{tool_name}:{sequence}"
    return None


def _tool_transcript_rank(item: dict[str, Any]) -> int:
    event_type = item.get("event_type")
    status = item.get("status")
    if event_type == "tool.completed":
        return 4
    if event_type == "messages/metadata" and status in {"complete", "completed"}:
        return 3
    if event_type == "tool.started":
        return 2
    if event_type == "messages/metadata":
        return 1
    return 0


def _project_transcript_items(
    events: list[dict[str, Any]],
    *,
    newest_first: bool,
) -> list[dict[str, Any]]:
    chronological_events = list(reversed(events)) if newest_first else list(events)
    items: list[dict[str, Any]] = []
    message_indexes: dict[str, int] = {}
    final_messages: set[str] = set()
    reasoning_indexes: dict[str, int] = {}
    final_reasoning: set[str] = set()
    tool_indexes: dict[str, int] = {}
    tool_ranks: dict[str, int] = {}

    for event in chronological_events:
        item = _transcript_item_from_event(event)
        if item is None:
            continue

        if item["kind"] == "message":
            key = _message_transcript_key(item)
            is_final = item["event_type"] in {"agent.message", "messages/complete"}
            if key and key in message_indexes:
                index = message_indexes[key]
                if is_final or key not in final_messages:
                    items[index] = item
                if is_final:
                    final_messages.add(key)
                continue
            if key:
                message_indexes[key] = len(items)
                if is_final:
                    final_messages.add(key)
            items.append(item)
            continue

        if item["kind"] == "reasoning":
            key = _reasoning_transcript_key(item)
            is_final = item["event_type"] in {"reasoning.complete", "thinking.complete"}
            if key and key in reasoning_indexes:
                index = reasoning_indexes[key]
                if is_final or key not in final_reasoning:
                    items[index] = item
                if is_final:
                    final_reasoning.add(key)
                continue
            if key:
                reasoning_indexes[key] = len(items)
                if is_final:
                    final_reasoning.add(key)
            items.append(item)
            continue

        if item["kind"] == "tool":
            key = _tool_transcript_key(item)
            rank = _tool_transcript_rank(item)
            if key and key in tool_indexes:
                if rank >= tool_ranks.get(key, 0):
                    items[tool_indexes[key]] = item
                    tool_ranks[key] = rank
                continue
            if key:
                tool_indexes[key] = len(items)
                tool_ranks[key] = rank
            items.append(item)
            continue

        items.append(item)

    return list(reversed(items)) if newest_first else items


def _parse_redis_major(version: str) -> int | None:
    try:
        return int(version.split(".", 1)[0])
    except (TypeError, ValueError):
        return None


class RuntimeEventBus:
    def __init__(self, uri: str) -> None:
        self._client = redis.Redis.from_url(uri, decode_responses=True)

    async def ping(self) -> None:
        await self._client.ping()

    async def runtime_info(self) -> dict[str, Any]:
        info = await self._client.info("server")
        version = str(info.get("redis_version") or "")
        return {
            "version": version,
            "major_version": _parse_redis_major(version),
            "json": await self._probe_json(),
            "search": await self._probe_search(),
        }

    async def require_ready(self) -> None:
        await self.ping()

        info = await self.runtime_info()
        major = info["major_version"]
        if not isinstance(major, int) or major < settings.redis_min_major_version:
            raise RuntimeError(
                "Redis "
                f"{settings.redis_min_major_version}+ required; "
                f"found {info['version'] or 'unknown'}"
            )

        if settings.redis_require_json_search:
            missing = [
                name
                for name, ok in (("RedisJSON", info["json"]), ("RediSearch", info["search"]))
                if not ok
            ]
            if missing:
                raise RuntimeError(f"Redis missing required capabilities: {', '.join(missing)}")

    async def close(self) -> None:
        await self._client.aclose()

    async def _probe_json(self) -> bool:
        key = "atlas:redis:capability:json"
        try:
            await self._client.execute_command("JSON.SET", key, "$", "{}")
            await self._client.delete(key)
        except RedisError:
            return False
        return True

    async def _probe_search(self) -> bool:
        try:
            await self._client.execute_command("FT._LIST")
        except RedisError:
            return False
        return True

    async def publish_sse_frame(self, frame: dict[str, str]) -> str:
        payload = _loads_frame_data(frame)
        identity_payload = payload
        tool_call = payload.get("tool_call")
        if isinstance(tool_call, dict):
            identity_payload = tool_call
        elif isinstance(payload.get("payload"), list) and payload["payload"]:
            first_payload = payload["payload"][0]
            if isinstance(first_payload, dict):
                identity_payload = first_payload
        event_type = frame.get("event", "unknown")
        run_id = str(identity_payload.get("run_id") or "")
        thread_id = str(identity_payload.get("thread_id") or "")
        source = str(
            identity_payload.get("actor_id")
            or identity_payload.get("agent_name")
            or "atlas-runtime"
        )
        status = _status_from_payload(event_type, identity_payload)
        created_at = str(identity_payload.get("timestamp") or _utcnow_iso())
        sequence = await self._client.incr("atlas:runtime:sequence")
        event = {
            "event_id": str(uuid.uuid4()),
            "sequence": str(sequence),
            "thread_id": thread_id,
            "run_id": run_id,
            "source": source,
            "event_type": event_type,
            "status": status,
            "message": _message_from_payload(identity_payload),
            "payload": json.dumps(_json_safe(payload), ensure_ascii=False),
            "created_at": created_at,
        }
        stream_id = await self._client.xadd(
            settings.redis_runtime_stream_key,
            event,
            maxlen=settings.redis_runtime_stream_maxlen,
            approximate=True,
        )
        if thread_id:
            await self._publish_thread_frame(thread_id, frame)
        if run_id:
            await self._client.xadd(
                f"atlas:run:{run_id}:events",
                event,
                maxlen=settings.redis_runtime_stream_maxlen,
                approximate=True,
            )
            if event_type == "run.state":
                await self.set_run_state(
                    run_id=run_id,
                    thread_id=thread_id,
                    status=status,
                    payload=payload,
                    updated_at=created_at,
                )
        if event_type == "subagent.status":
            worker_id = str(payload.get("agent_name") or source)
            if worker_id != "atlas-architect":
                await self.set_worker_state(
                    worker_id=worker_id,
                    run_id=run_id,
                    thread_id=thread_id,
                    status=status,
                    payload=payload,
                    updated_at=created_at,
                )
        return str(stream_id)

    async def _publish_thread_frame(self, thread_id: str, frame: dict[str, str]) -> None:
        await self._client.publish(
            self.thread_stream_channel(thread_id),
            json.dumps(_json_safe(frame), ensure_ascii=False),
        )

    def thread_stream_channel(self, thread_id: str) -> str:
        return f"atlas:thread:{thread_id}:stream"

    def run_cancel_key(self, run_id: str) -> str:
        return f"atlas:run:{run_id}:cancel"

    def run_cancel_channel(self, run_id: str) -> str:
        return f"atlas:run:{run_id}:cancel"

    async def wake_run_worker(self) -> None:
        # Mirrors LangGraph Agent Server's Redis wake-up role: a sentinel value
        # wakes workers, while durable run details remain in Postgres.
        await self._client.lpush(settings.redis_run_wake_list_key, "1")
        await self._client.ltrim(
            settings.redis_run_wake_list_key,
            0,
            max(0, settings.redis_run_wake_list_maxlen - 1),
        )

    async def request_run_cancel(self, run_id: str, *, reason: str = "operator") -> None:
        payload = json.dumps({"run_id": run_id, "reason": reason, "requested_at": _utcnow_iso()})
        await self._client.set(
            self.run_cancel_key(run_id),
            payload,
            ex=settings.redis_run_cancel_ttl_seconds,
        )
        await self._client.publish(self.run_cancel_channel(run_id), payload)

    async def is_run_cancel_requested(self, run_id: str) -> bool:
        return await self._client.get(self.run_cancel_key(run_id)) is not None

    async def set_run_state(
        self,
        *,
        run_id: str,
        thread_id: str,
        status: str,
        payload: dict[str, Any],
        updated_at: str | None = None,
    ) -> None:
        await self._client.hset(
            f"atlas:run:{run_id}:state",
            mapping={
                "run_id": run_id,
                "thread_id": thread_id,
                "status": status,
                "updated_at": updated_at or _utcnow_iso(),
                "payload": json.dumps(_json_safe(payload), ensure_ascii=False),
            },
        )

    async def set_worker_state(
        self,
        *,
        worker_id: str,
        run_id: str,
        thread_id: str,
        status: str,
        payload: dict[str, Any],
        updated_at: str | None = None,
    ) -> None:
        await self._client.hset(
            f"atlas:worker:{worker_id}:state",
            mapping={
                "worker_id": worker_id,
                "run_id": run_id,
                "thread_id": thread_id,
                "status": status,
                "updated_at": updated_at or _utcnow_iso(),
                "payload": json.dumps(_json_safe(payload), ensure_ascii=False),
            },
        )

    async def set_benchmark_state(
        self,
        *,
        name: str,
        status: str,
        payload: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        now = _utcnow_iso()
        state = {
            "name": name,
            "status": status,
            "updated_at": now,
            "payload": payload or {},
            "error": error,
            **(payload or {}),
        }
        await self._client.hset(
            f"atlas:benchmark:{name}:state",
            mapping={
                "name": name,
                "status": status,
                "updated_at": now,
                "payload": json.dumps(_json_safe(payload or {}), ensure_ascii=False),
                "error": error or "",
            },
        )
        return state

    async def get_benchmark_state(self, name: str) -> dict[str, Any]:
        raw = await self._client.hgetall(f"atlas:benchmark:{name}:state")
        if not raw:
            return {
                "name": name,
                "status": "idle",
                "updated_at": None,
                "payload": {},
                "error": None,
            }
        payload_raw = raw.get("payload") or "{}"
        try:
            payload = json.loads(payload_raw)
        except Exception:
            payload = {}
        state = {
            "name": raw.get("name") or name,
            "status": raw.get("status") or "idle",
            "updated_at": raw.get("updated_at") or None,
            "payload": payload if isinstance(payload, dict) else {},
            "error": raw.get("error") or None,
        }
        if isinstance(payload, dict):
            state.update(payload)
        return state

    async def set_memory_backup_state(
        self,
        *,
        status: str,
        source: str,
        count: int,
        updated_at: str,
        error: str | None = None,
    ) -> None:
        await self._client.hset(
            "atlas:memory:backup:state",
            mapping={
                "status": status,
                "source": source,
                "count": str(count),
                "updated_at": updated_at,
                "error": error or "",
            },
        )

    async def get_memory_backup_state(self) -> dict[str, Any]:
        raw = await self._client.hgetall("atlas:memory:backup:state")
        if not raw:
            return {
                "status": "idle",
                "source": None,
                "count": 0,
                "updated_at": None,
                "error": None,
            }
        try:
            count = int(str(raw.get("count") or "0"))
        except ValueError:
            count = 0
        return {
            "status": raw.get("status") or "idle",
            "source": raw.get("source") or None,
            "count": count,
            "updated_at": raw.get("updated_at") or None,
            "error": raw.get("error") or None,
        }

    async def list_runtime_events(
        self,
        *,
        limit: int = 100,
        run_id: str | None = None,
        thread_id: str | None = None,
        source: str | None = None,
        event_type: str | None = None,
        newest_first: bool = True,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 500))
        max_scan = max(limit, settings.redis_runtime_event_replay_max_scan)
        stream_key = f"atlas:run:{run_id}:events" if run_id else settings.redis_runtime_stream_key
        rows = await self._client.xrevrange(stream_key, count=max_scan)
        events: list[dict[str, Any]] = []
        scanned = 0
        for stream_id, raw in rows:
            scanned += 1
            event = _decode_stream_event(str(stream_id), raw)
            if run_id and event["run_id"] != run_id:
                continue
            if thread_id and event["thread_id"] != thread_id:
                continue
            if source and event["source"] != source:
                continue
            if event_type and event["event_type"] != event_type:
                continue
            events.append(event)
            if len(events) >= limit:
                break
        if not newest_first:
            events.reverse()
        return {
            "ok": True,
            "stream_key": stream_key,
            "events": events,
            "count": len(events),
            "scanned": scanned,
            "truncated": scanned >= max_scan and len(events) < limit,
            "newest_first": newest_first,
        }

    async def list_runtime_transcript(
        self,
        *,
        limit: int = 100,
        run_id: str | None = None,
        thread_id: str | None = None,
        source: str | None = None,
        newest_first: bool = True,
    ) -> dict[str, Any]:
        replay = await self.list_runtime_events(
            limit=limit,
            run_id=run_id,
            thread_id=thread_id,
            source=source,
            newest_first=newest_first,
        )
        items = _project_transcript_items(replay["events"], newest_first=newest_first)
        return {
            **replay,
            "items": items,
            "count": len(items),
        }


_runtime_event_bus: RuntimeEventBus | None = None


def get_runtime_event_bus() -> RuntimeEventBus:
    global _runtime_event_bus
    if _runtime_event_bus is None:
        _runtime_event_bus = RuntimeEventBus(settings.redis_uri)
    return _runtime_event_bus


async def require_redis_ready() -> None:
    if not settings.redis_required:
        return
    await get_runtime_event_bus().require_ready()
