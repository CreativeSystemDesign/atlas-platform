"""Async Redis memory snapshot backup to Neon."""

from __future__ import annotations

import asyncio
import hashlib
import json
import traceback
from datetime import datetime, timezone
from typing import Any

from psycopg.types.json import Jsonb

from src.persistence.database import get_pool
from src.persistence.langgraph_store import get_store
from src.runtime_event_bus import get_runtime_event_bus

ARCHITECT_MEMORY_NAMESPACE = ("atlas-architect", "memories")
_backup_lock = asyncio.Lock()
_queued_backup_source: str | None = None


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _checksum(value: Any) -> str:
    encoded = json.dumps(_jsonable(value), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


async def _set_backup_state(
    *,
    status: str,
    source: str,
    count: int = 0,
    error: str | None = None,
) -> None:
    try:
        await get_runtime_event_bus().set_memory_backup_state(
            status=status,
            source=source,
            count=count,
            error=error,
            updated_at=_utcnow_iso(),
        )
    except Exception:
        traceback.print_exc()


async def snapshot_architect_memories_to_neon(source: str = "manual") -> dict[str, Any]:
    """Snapshot live Redis Architect memories into Neon for off-VM recovery."""
    global _queued_backup_source
    if _backup_lock.locked():
        _queued_backup_source = source
        await _set_backup_state(status="queued", source=source)
        return {"status": "queued", "reason": "backup already running", "source": source}

    async with _backup_lock:
        current_source = source
        runs_completed = 0
        latest_result: dict[str, Any] | None = None
        while True:
            _queued_backup_source = None
            latest_result = await _snapshot_architect_memories_once(current_source)
            runs_completed += 1
            if _queued_backup_source is None:
                latest_result["runs_completed"] = runs_completed
                return latest_result
            current_source = _queued_backup_source


async def _snapshot_architect_memories_once(source: str) -> dict[str, Any]:
    await _set_backup_state(status="running", source=source)
    try:
        store = await get_store()
        items = []
        limit = 250
        offset = 0
        while True:
            batch = await store.asearch(
                ARCHITECT_MEMORY_NAMESPACE,
                limit=limit,
                offset=offset,
            )
            items.extend(batch)
            if len(batch) < limit:
                break
            offset += limit

        current_keys = [str(item.key) for item in items]
        pool = await get_pool()
        async with pool.connection() as conn:
            existing_result = await conn.execute(
                "SELECT COUNT(*) FROM architect_memory_backups WHERE namespace = %s",
                (list(ARCHITECT_MEMORY_NAMESPACE),),
            )
            existing_row = await existing_result.fetchone()
            existing_backup_count = int(existing_row[0]) if existing_row and existing_row[0] else 0

            # An empty Redis namespace can mean data loss or a reset; do not let an automated
            # snapshot erase the last off-VM recovery copy.
            if not current_keys and existing_backup_count > 0:
                result = {
                    "status": "completed",
                    "count": existing_backup_count,
                    "source": source,
                    "live_count": 0,
                    "preserved_previous_snapshot": True,
                }
                await _set_backup_state(
                    status="completed",
                    source=source,
                    count=existing_backup_count,
                    error="Redis memory namespace was empty; preserved previous Neon snapshot.",
                )
                return result

            if current_keys:
                await conn.execute(
                    """
                    DELETE FROM architect_memory_backups
                    WHERE namespace = %s
                      AND NOT (key = ANY(%s))
                    """,
                    (list(ARCHITECT_MEMORY_NAMESPACE), current_keys),
                )
            for item in items:
                value = item.value if isinstance(item.value, dict) else {"value": item.value}
                safe_value = _jsonable(value)
                redis_updated_at = getattr(item, "updated_at", None)
                await conn.execute(
                    """
                    INSERT INTO architect_memory_backups
                        (namespace, key, value, redis_updated_at, source, checksum)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (namespace, key) DO UPDATE SET
                        value = EXCLUDED.value,
                        redis_updated_at = EXCLUDED.redis_updated_at,
                        snapshotted_at = now(),
                        source = EXCLUDED.source,
                        checksum = EXCLUDED.checksum
                    """,
                    (
                        list(item.namespace),
                        str(item.key),
                        Jsonb(safe_value),
                        redis_updated_at,
                        source,
                        _checksum(safe_value),
                    ),
                )
            await conn.commit()

        result = {"status": "completed", "count": len(items), "source": source}
        await _set_backup_state(status="completed", source=source, count=len(items))
        return result
    except Exception as exc:
        await _set_backup_state(status="failed", source=source, error=str(exc))
        raise


def schedule_architect_memory_backup(source: str) -> None:
    """Start a non-blocking backup task from runtime code."""

    async def _runner() -> None:
        try:
            await snapshot_architect_memories_to_neon(source)
        except Exception:
            traceback.print_exc()

    asyncio.create_task(_runner(), name="architect-memory-backup")
