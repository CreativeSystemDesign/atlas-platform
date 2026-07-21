"""Relation boards API — named, saved views over the Data Map.

A board owns its card placements (data_map_cards, managed by the data_map
routes since the 2026-07-20 remodel) and its join contracts
(schema_relations rows carry board_id), never the tables: deleting a board
deletes the view and cascades its placements + relations, and no table is
ever touched. The default board ("Main") is minted lazily; it cannot be
deleted. New boards start blank.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src import relations_data
from src.persistence.database import get_pool

router = APIRouter(prefix="/projects/{project_id}/boards", tags=["Relation boards"])

_COLS = "board_id, name, is_default, seed_arc, settings, created_at, updated_at"


def _row(r: tuple) -> dict[str, Any]:
    d = dict(zip(("board_id", "name", "is_default", "seed_arc", "settings",
                  "created_at", "updated_at"), r))
    d["board_id"] = str(d["board_id"])
    for k in ("created_at", "updated_at"):
        d[k] = d[k].isoformat() if d[k] else None
    return d


class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class BoardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    settings: dict[str, Any] | None = None


@router.get("")
async def list_boards(project_id: uuid.UUID) -> dict[str, Any]:
    default_id = await relations_data.ensure_default_board(str(project_id))
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            f"SELECT {_COLS} FROM relation_boards WHERE project_id = %s "
            "ORDER BY is_default DESC, created_at", (project_id,))
        rows = [_row(r) for r in await cur.fetchall()]
    return {"boards": rows, "default_board_id": default_id}


@router.post("")
async def create_board(project_id: uuid.UUID, body: BoardCreate) -> dict[str, Any]:
    await relations_data.ensure_default_board(str(project_id))
    pool = await get_pool()
    async with pool.connection() as conn:
        try:
            # Shane's ruling (2026-07-15): "the document schemas are supposed
            # to clear with the board" — a new board opens with the tray
            # shield ON, so only what he builds there is in view. Main keeps
            # the family; the toggle stays in the tray footer either way.
            cur = await conn.execute(
                "INSERT INTO relation_boards (project_id, name, settings) "
                "VALUES (%s, %s, '{\"hide_unplaced\": true}') "
                f"RETURNING {_COLS}", (project_id, body.name.strip()))
        except Exception as exc:
            if "unique" in str(exc).lower():
                raise HTTPException(status_code=409,
                                    detail=f"a board named '{body.name.strip()}' already exists")
            raise
        row = await cur.fetchone()
        await conn.commit()
    return _row(row)


@router.put("/{board_id}")
async def update_board(project_id: uuid.UUID, board_id: uuid.UUID,
                       body: BoardUpdate) -> dict[str, Any]:
    sets, params = ["updated_at = now()"], []
    if body.name is not None:
        sets.append("name = %s"); params.append(body.name.strip())
    if body.settings is not None:
        sets.append("settings = %s"); params.append(json.dumps(body.settings))
    pool = await get_pool()
    async with pool.connection() as conn:
        try:
            cur = await conn.execute(
                "UPDATE relation_boards SET " + ", ".join(sets) +  # noqa: S608 — sets are literals
                f" WHERE board_id = %s AND project_id = %s RETURNING {_COLS}",
                (*params, board_id, project_id))
        except Exception as exc:
            if "unique" in str(exc).lower():
                raise HTTPException(status_code=409, detail="that board name is taken")
            raise
        row = await cur.fetchone()
        await conn.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="board not found")
    return _row(row)


@router.delete("/{board_id}")
async def delete_board(project_id: uuid.UUID, board_id: uuid.UUID) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT is_default FROM relation_boards "
            "WHERE board_id = %s AND project_id = %s", (board_id, project_id))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="board not found")
        if row[0]:
            raise HTTPException(
                status_code=422,
                detail="the default board can't be deleted — it's the family's home")
        # counts first so the response can say what the cascade took
        cur = await conn.execute(
            "SELECT count(*) FROM schema_relations WHERE board_id = %s", (board_id,))
        relations_gone = (await cur.fetchone())[0]
        cur = await conn.execute(
            "SELECT count(*) FROM data_map_cards WHERE board_id = %s", (board_id,))
        cards_gone = (await cur.fetchone())[0]
        await conn.execute(
            "DELETE FROM relation_boards WHERE board_id = %s AND project_id = %s",
            (board_id, project_id))
        await conn.commit()
    return {"deleted": str(board_id), "relations_deleted": relations_gone,
            "cards_deleted": cards_gone}
