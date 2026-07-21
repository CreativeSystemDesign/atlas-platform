"""Thread persistence backed by Neon PostgreSQL."""

from __future__ import annotations

import json
import uuid

from src.persistence.database import get_pool
from src.persistence.projects import DEFAULT_PROJECT_ID
from src.schemas import Thread, ThreadOperationalState, ThreadStatus


class ThreadStore:
    async def create(
        self,
        thread_id: uuid.UUID | None = None,
        metadata: dict | None = None,
        project_id: uuid.UUID | None = None,
    ) -> Thread:
        tid = thread_id or uuid.uuid4()
        pid = project_id or DEFAULT_PROJECT_ID
        meta = metadata or {}
        pool = await get_pool()
        async with pool.connection() as conn:
            row = await conn.execute(
                """
                INSERT INTO threads (thread_id, project_id, metadata, status)
                VALUES (%s, %s, %s::jsonb, 'idle')
                RETURNING
                    thread_id,
                    project_id,
                    metadata,
                    status,
                    operational_state,
                    created_at,
                    updated_at
                """,
                (str(tid), str(pid), json.dumps(meta)),
            )
            r = await row.fetchone()
            await conn.commit()
            return Thread(
                thread_id=r[0],
                project_id=r[1],
                metadata=r[2],
                status=ThreadStatus(r[3]),
                operational_state=ThreadOperationalState(r[4]),
                created_at=r[5],
                updated_at=r[6],
            )

    async def get(self, thread_id: uuid.UUID) -> Thread | None:
        pool = await get_pool()
        async with pool.connection() as conn:
            row = await conn.execute(
                """
                SELECT
                    thread_id,
                    project_id,
                    metadata,
                    status,
                    operational_state,
                    created_at,
                    updated_at
                FROM threads
                WHERE thread_id = %s
                """,
                (str(thread_id),),
            )
            r = await row.fetchone()
            if not r:
                return None
            return Thread(
                thread_id=r[0],
                project_id=r[1],
                metadata=r[2],
                status=ThreadStatus(r[3]),
                operational_state=ThreadOperationalState(r[4]),
                created_at=r[5],
                updated_at=r[6],
            )

    async def update_status(self, thread_id: uuid.UUID, status: ThreadStatus) -> None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """UPDATE threads SET status = %s, updated_at = now()
                   WHERE thread_id = %s""",
                (status.value, str(thread_id)),
            )
            await conn.commit()

    async def update_operational_state(
        self, thread_id: uuid.UUID, operational_state: ThreadOperationalState
    ) -> None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """UPDATE threads SET operational_state = %s, updated_at = now()
                   WHERE thread_id = %s""",
                (operational_state.value, str(thread_id)),
            )
            await conn.commit()

    async def list_all(self, limit: int = 50, offset: int = 0) -> list[Thread]:
        pool = await get_pool()
        async with pool.connection() as conn:
            rows = await conn.execute(
                """
                SELECT
                    thread_id,
                    project_id,
                    metadata,
                    status,
                    operational_state,
                    created_at,
                    updated_at
                FROM threads
                ORDER BY updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            )
            results = await rows.fetchall()
            return [
                Thread(
                    thread_id=r[0],
                    project_id=r[1],
                    metadata=r[2],
                    status=ThreadStatus(r[3]),
                    operational_state=ThreadOperationalState(r[4]),
                    created_at=r[5],
                    updated_at=r[6],
                )
                for r in results
            ]

    async def list_by_metadata(
        self,
        metadata: dict,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Thread]:
        pool = await get_pool()
        async with pool.connection() as conn:
            rows = await conn.execute(
                """
                SELECT
                    thread_id,
                    project_id,
                    metadata,
                    status,
                    operational_state,
                    created_at,
                    updated_at
                FROM threads
                WHERE metadata @> %s::jsonb
                ORDER BY updated_at DESC
                LIMIT %s OFFSET %s
                """,
                (json.dumps(metadata), limit, offset),
            )
            results = await rows.fetchall()
            return [
                Thread(
                    thread_id=r[0],
                    project_id=r[1],
                    metadata=r[2],
                    status=ThreadStatus(r[3]),
                    operational_state=ThreadOperationalState(r[4]),
                    created_at=r[5],
                    updated_at=r[6],
                )
                for r in results
            ]

    async def update_metadata(self, thread_id: uuid.UUID, metadata: dict) -> None:
        pool = await get_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """UPDATE threads SET metadata = metadata || %s::jsonb, updated_at = now()
                   WHERE thread_id = %s""",
                (json.dumps(metadata), str(thread_id)),
            )
            await conn.commit()

    async def delete(self, thread_id: uuid.UUID) -> bool:
        pool = await get_pool()
        tid = str(thread_id)
        async with pool.connection() as conn:
            # Cascade delete checkpoints first (LangGraph tables use TEXT thread_id)
            await conn.execute(
                "DELETE FROM checkpoint_blobs WHERE thread_id = %s", (tid,)
            )
            await conn.execute(
                "DELETE FROM checkpoint_writes WHERE thread_id = %s", (tid,)
            )
            await conn.execute(
                "DELETE FROM checkpoints WHERE thread_id = %s", (tid,)
            )
            # Now delete the thread
            result = await conn.execute(
                "DELETE FROM threads WHERE thread_id = %s", (tid,)
            )
            await conn.commit()
            return result.rowcount > 0


thread_store = ThreadStore()
