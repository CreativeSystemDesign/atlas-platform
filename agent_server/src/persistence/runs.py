"""Run persistence backed by Neon PostgreSQL."""

from __future__ import annotations

import json
import uuid

from src.persistence.database import get_pool


class RunStore:
    async def create(
        self,
        thread_id: uuid.UUID,
        assistant_id: str | None = None,
        status: str = "pending",
        metadata: dict | None = None,
        kwargs: dict | None = None,
        multitask_strategy: str = "enqueue",
    ) -> dict:
        run_id = uuid.uuid4()
        pool = await get_pool()
        async with pool.connection() as conn:
            row = await conn.execute(
                """
                INSERT INTO runs (
                    run_id,
                    project_id,
                    thread_id,
                    assistant_id,
                    status,
                    metadata,
                    kwargs,
                    multitask_strategy
                )
                SELECT %s, t.project_id, t.thread_id, %s, %s, %s::jsonb, %s::jsonb, %s
                FROM threads t
                WHERE t.thread_id = %s
                RETURNING
                    run_id,
                    project_id,
                    thread_id,
                    assistant_id,
                    status,
                    metadata,
                    kwargs,
                    multitask_strategy,
                    created_at,
                    updated_at
                """,
                (
                    str(run_id),
                    assistant_id,
                    status,
                    json.dumps(metadata or {}),
                    json.dumps(kwargs or {}),
                    multitask_strategy,
                    str(thread_id),
                ),
            )
            r = await row.fetchone()
            if r is None:
                raise ValueError(f"thread not found for run creation: {thread_id}")
            await conn.commit()
            return self._row_to_dict(r)

    async def get(self, run_id: uuid.UUID) -> dict | None:
        pool = await get_pool()
        async with pool.connection() as conn:
            row = await conn.execute(
                """
                SELECT
                    run_id,
                    project_id,
                    thread_id,
                    assistant_id,
                    status,
                    metadata,
                    kwargs,
                    multitask_strategy,
                    created_at,
                    updated_at
                FROM runs
                WHERE run_id = %s
                """,
                (str(run_id),),
            )
            r = await row.fetchone()
            return self._row_to_dict(r) if r else None

    async def update_status(self, run_id: uuid.UUID, status: str) -> None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE runs SET status = %s, updated_at = now() WHERE run_id = %s",
                (status, str(run_id)),
            )
            await conn.commit()

    async def append_event(
        self,
        *,
        run_id: uuid.UUID,
        thread_id: uuid.UUID,
        event_name: str,
        payload: dict | None = None,
        actor_id: str | None = None,
    ) -> None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """INSERT INTO run_events (run_id, thread_id, event_name, actor_id, payload)
                   VALUES (%s, %s, %s, %s, %s::jsonb)""",
                (str(run_id), str(thread_id), event_name, actor_id, json.dumps(payload or {})),
            )
            await conn.commit()

    async def list_events_for_run(
        self,
        run_id: uuid.UUID,
        *,
        limit: int = 500,
    ) -> list[dict]:
        pool = await get_pool()
        async with pool.connection() as conn:
            rows = await conn.execute(
                """SELECT event_id, run_id, thread_id, event_name, actor_id, payload, created_at
                   FROM run_events
                   WHERE run_id = %s
                   ORDER BY event_id ASC
                   LIMIT %s""",
                (str(run_id), limit),
            )
            results = await rows.fetchall()
            return [self._event_row_to_dict(r) for r in results]

    async def list_events_for_thread(
        self,
        thread_id: uuid.UUID,
        *,
        run_id: uuid.UUID | None = None,
        limit: int = 500,
    ) -> list[dict]:
        pool = await get_pool()
        async with pool.connection() as conn:
            if run_id is not None:
                rows = await conn.execute(
                    """SELECT event_id, run_id, thread_id, event_name, actor_id, payload, created_at
                       FROM run_events
                       WHERE thread_id = %s AND run_id = %s
                       ORDER BY event_id ASC
                       LIMIT %s""",
                    (str(thread_id), str(run_id), limit),
                )
            else:
                rows = await conn.execute(
                    """SELECT event_id, run_id, thread_id, event_name, actor_id, payload, created_at
                       FROM run_events
                       WHERE thread_id = %s
                       ORDER BY event_id DESC
                       LIMIT %s""",
                    (str(thread_id), limit),
                )
            results = await rows.fetchall()
            ordered = list(reversed(results)) if run_id is None else results
            return [self._event_row_to_dict(r) for r in ordered]

    async def latest_for_thread(self, thread_id: uuid.UUID) -> dict | None:
        runs = await self.list_for_thread(thread_id, limit=1, offset=0)
        return runs[0] if runs else None

    async def list_for_thread(
        self, thread_id: uuid.UUID, limit: int = 10, offset: int = 0, status: str | None = None
    ) -> list[dict]:
        pool = await get_pool()
        async with pool.connection() as conn:
            if status:
                rows = await conn.execute(
                    """
                    SELECT
                        run_id,
                        project_id,
                        thread_id,
                        assistant_id,
                        status,
                        metadata,
                        kwargs,
                        multitask_strategy,
                        created_at,
                        updated_at
                    FROM runs
                    WHERE thread_id = %s AND status = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (str(thread_id), status, limit, offset),
                )
            else:
                rows = await conn.execute(
                    """
                    SELECT
                        run_id,
                        project_id,
                        thread_id,
                        assistant_id,
                        status,
                        metadata,
                        kwargs,
                        multitask_strategy,
                        created_at,
                        updated_at
                    FROM runs
                    WHERE thread_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (str(thread_id), limit, offset),
                )
            results = await rows.fetchall()
            return [self._row_to_dict(r) for r in results]

    def _row_to_dict(self, r) -> dict:
        return {
            "run_id": str(r[0]),
            "project_id": str(r[1]) if r[1] else None,
            "thread_id": str(r[2]),
            "assistant_id": str(r[3]) if r[3] else None,
            "status": r[4],
            "metadata": r[5] or {},
            "kwargs": r[6] or {},
            "multitask_strategy": r[7],
            "created_at": r[8].isoformat(),
            "updated_at": r[9].isoformat(),
        }

    def _event_row_to_dict(self, r) -> dict:
        return {
            "event_id": int(r[0]),
            "run_id": str(r[1]),
            "thread_id": str(r[2]),
            "event_name": r[3],
            "actor_id": r[4],
            "payload": r[5] or {},
            "created_at": r[6].isoformat(),
        }


run_store = RunStore()
