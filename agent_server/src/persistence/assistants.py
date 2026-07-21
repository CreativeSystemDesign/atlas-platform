"""Assistant persistence backed by Neon PostgreSQL."""

from __future__ import annotations

import json
import uuid

from src.persistence.database import get_pool


class AssistantStore:
    async def create(
        self,
        graph_id: str,
        assistant_id: uuid.UUID | None = None,
        name: str = "Untitled",
        description: str | None = None,
        config: dict | None = None,
        metadata: dict | None = None,
    ) -> dict:
        aid = assistant_id or uuid.uuid4()
        pool = await get_pool()
        async with pool.connection() as conn:
            row = await conn.execute(
                """INSERT INTO assistants (assistant_id, graph_id, name, description, config, metadata)
                   VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                   RETURNING assistant_id, graph_id, name, description, config, metadata, version, created_at, updated_at""",
                (str(aid), graph_id, name, description, json.dumps(config or {}), json.dumps(metadata or {})),
            )
            r = await row.fetchone()
            await conn.commit()
            return self._row_to_dict(r)

    async def get(self, assistant_id: uuid.UUID) -> dict | None:
        pool = await get_pool()
        async with pool.connection() as conn:
            row = await conn.execute(
                """SELECT assistant_id, graph_id, name, description, config, metadata, version, created_at, updated_at
                   FROM assistants WHERE assistant_id = %s""",
                (str(assistant_id),),
            )
            r = await row.fetchone()
            return self._row_to_dict(r) if r else None

    async def update(self, assistant_id: uuid.UUID, **kwargs) -> dict | None:
        pool = await get_pool()
        sets = []
        vals = []
        for key in ("name", "description"):
            if key in kwargs:
                sets.append(f"{key} = %s")
                vals.append(kwargs[key])
        if "config" in kwargs:
            sets.append("config = %s::jsonb")
            vals.append(json.dumps(kwargs["config"]))
        if "metadata" in kwargs:
            sets.append("metadata = %s::jsonb")
            vals.append(json.dumps(kwargs["metadata"]))
        if not sets:
            return await self.get(assistant_id)
        sets.append("version = version + 1")
        sets.append("updated_at = now()")
        vals.append(str(assistant_id))
        async with pool.connection() as conn:
            row = await conn.execute(
                f"""UPDATE assistants SET {', '.join(sets)}
                    WHERE assistant_id = %s
                    RETURNING assistant_id, graph_id, name, description, config, metadata, version, created_at, updated_at""",
                tuple(vals),
            )
            r = await row.fetchone()
            await conn.commit()
            return self._row_to_dict(r) if r else None

    async def delete(self, assistant_id: uuid.UUID) -> bool:
        pool = await get_pool()
        async with pool.connection() as conn:
            result = await conn.execute(
                "DELETE FROM assistants WHERE assistant_id = %s", (str(assistant_id),)
            )
            await conn.commit()
            return result.rowcount > 0

    async def search(self, limit: int = 50, offset: int = 0, graph_id: str | None = None) -> list[dict]:
        pool = await get_pool()
        async with pool.connection() as conn:
            if graph_id:
                rows = await conn.execute(
                    """SELECT assistant_id, graph_id, name, description, config, metadata, version, created_at, updated_at
                       FROM assistants WHERE graph_id = %s ORDER BY updated_at DESC LIMIT %s OFFSET %s""",
                    (graph_id, limit, offset),
                )
            else:
                rows = await conn.execute(
                    """SELECT assistant_id, graph_id, name, description, config, metadata, version, created_at, updated_at
                       FROM assistants ORDER BY updated_at DESC LIMIT %s OFFSET %s""",
                    (limit, offset),
                )
            results = await rows.fetchall()
            return [self._row_to_dict(r) for r in results]

    def _row_to_dict(self, r) -> dict:
        return {
            "assistant_id": str(r[0]),
            "graph_id": r[1],
            "name": r[2],
            "description": r[3],
            "config": r[4] or {},
            "metadata": r[5] or {},
            "version": r[6],
            "created_at": r[7].isoformat(),
            "updated_at": r[8].isoformat(),
        }


assistant_store = AssistantStore()
