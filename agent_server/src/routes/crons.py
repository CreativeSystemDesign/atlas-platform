"""Crons API — scheduled recurring runs."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any

from src.persistence.database import get_pool

router = APIRouter(tags=["Crons"])


class CronCreate(BaseModel):
    assistant_id: str
    schedule: str
    input: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/threads/{thread_id}/crons")
async def create_cron(thread_id: uuid.UUID, body: CronCreate):
    cron_id = uuid.uuid4()
    pool = await get_pool()
    async with pool.connection() as conn:
        row = await conn.execute(
            """INSERT INTO crons (cron_id, thread_id, assistant_id, schedule, input, metadata)
               VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
               RETURNING cron_id, thread_id, assistant_id, schedule, input, metadata, created_at, updated_at""",
            (str(cron_id), str(thread_id), body.assistant_id, body.schedule,
             json.dumps(body.input), json.dumps(body.metadata)),
        )
        r = await row.fetchone()
        await conn.commit()
        return _row_to_dict(r)


@router.get("/threads/{thread_id}/crons")
async def list_crons(thread_id: uuid.UUID):
    pool = await get_pool()
    async with pool.connection() as conn:
        rows = await conn.execute(
            """SELECT cron_id, thread_id, assistant_id, schedule, input, metadata, created_at, updated_at
               FROM crons WHERE thread_id = %s ORDER BY created_at DESC""",
            (str(thread_id),),
        )
        results = await rows.fetchall()
        return [_row_to_dict(r) for r in results]


@router.post("/crons/search")
async def search_crons():
    pool = await get_pool()
    async with pool.connection() as conn:
        rows = await conn.execute(
            """SELECT cron_id, thread_id, assistant_id, schedule, input, metadata, created_at, updated_at
               FROM crons ORDER BY created_at DESC LIMIT 50"""
        )
        results = await rows.fetchall()
        return [_row_to_dict(r) for r in results]


@router.delete("/crons/{cron_id}")
async def delete_cron(cron_id: uuid.UUID):
    pool = await get_pool()
    async with pool.connection() as conn:
        result = await conn.execute(
            "DELETE FROM crons WHERE cron_id = %s", (str(cron_id),)
        )
        await conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Cron not found")
        return {"ok": True}


def _row_to_dict(r) -> dict:
    return {
        "cron_id": str(r[0]),
        "thread_id": str(r[1]),
        "assistant_id": str(r[2]) if r[2] else None,
        "schedule": r[3],
        "input": r[4] or {},
        "metadata": r[5] or {},
        "created_at": r[6].isoformat(),
        "updated_at": r[7].isoformat(),
    }
