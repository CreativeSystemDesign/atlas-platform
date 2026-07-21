"""Data Map relations API — join contracts between REAL table columns.

Remodeled 2026-07-20: contracts join columns of real Postgres tables/views
(the derived cards), not schema-card fields. POST is Shane (or Arc, phase 2)
drawing a line (surveyed on creation); PUT accepts/dismisses/retags; POST
/survey re-runs the match badge; DELETE works on every status. The static
proposal seeder is gone — proposals arrive live from Arc's Data Map seat.
Edges are the digital twin's edges — the twin compiler consumes the drawn
ones as stitch instructions. document_id columns persist as optional
informational context (the extraction a table came from), no longer keys.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src import relations_data
from src.persistence.database import get_pool

router = APIRouter(prefix="/projects/{project_id}/relations", tags=["Relations"])

_COLS = ("relation_id, board_id, from_document_id, from_table, from_field, "
         "to_document_id, to_table, to_field, semantics, status, origin, basis, "
         "notes, match_num, match_den, matched_at, updated_at")


def _row(r: tuple) -> dict[str, Any]:
    d = dict(zip((
        "relation_id", "board_id", "from_document_id", "from_table", "from_field",
        "to_document_id", "to_table", "to_field", "semantics", "status",
        "origin", "basis", "notes", "match_num", "match_den", "matched_at",
        "updated_at"), r))
    d["relation_id"] = str(d["relation_id"])
    d["board_id"] = str(d["board_id"]) if d["board_id"] else None
    for k in ("matched_at", "updated_at"):
        d[k] = d[k].isoformat() if d[k] else None
    return d


async def _annotate_backed(conn, rows: list[dict[str, Any]]) -> None:
    """Stamp from_bound/to_bound generically: does the endpoint's (table,
    column) exist in the live catalog right now? One query for all rows."""
    pairs = {(r["from_table"], r["from_field"]) for r in rows} | \
            {(r["to_table"], r["to_field"]) for r in rows}
    if not pairs:
        return
    cur = await conn.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = ANY(%s)",
        ([t for t, _ in pairs],))
    live = {(t, c) for t, c in await cur.fetchall()}
    for r in rows:
        r["from_bound"] = (r["from_table"], r["from_field"]) in live
        r["to_bound"] = (r["to_table"], r["to_field"]) in live


async def _resolve_board(project_id: uuid.UUID, board_id: str | None) -> str:
    """A provided board must belong to the project; none means the default
    board (minted on first touch, adopting the pre-boards world)."""
    if board_id is None:
        return await relations_data.ensure_default_board(str(project_id))
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM relation_boards WHERE board_id = %s AND project_id = %s",
            (board_id, project_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="board not found")
    return board_id


class RelationCreate(BaseModel):
    board_id: str | None = None  # None -> the default board
    from_document_id: str = ""   # informational since the remodel — tables key
    from_table: str = Field(max_length=160)
    from_field: str = Field(max_length=120)
    to_document_id: str = ""
    to_table: str = Field(max_length=160)
    to_field: str = Field(max_length=120)
    semantics: str = Field(default="exact", pattern="^(exact|membership|vocabulary)$")
    notes: str | None = None


class RelationUpdate(BaseModel):
    semantics: str | None = Field(default=None, pattern="^(exact|membership|vocabulary)$")
    status: str | None = Field(default=None, pattern="^(proposed|drawn|dismissed)$")
    notes: str | None = None


async def _store_survey(conn, relation_id: uuid.UUID, res: dict[str, Any]) -> None:
    if res["surveyed"]:
        await conn.execute(
            "UPDATE schema_relations SET match_num = %s, match_den = %s, "
            "matched_at = now(), updated_at = now() WHERE relation_id = %s",
            (res["num"], res["den"], relation_id))
    else:
        await conn.execute(
            "UPDATE schema_relations SET match_num = NULL, match_den = NULL, "
            "matched_at = now(), updated_at = now() WHERE relation_id = %s",
            (relation_id,))


async def _fetch(conn, project_id: uuid.UUID, relation_id: uuid.UUID) -> dict[str, Any] | None:
    cur = await conn.execute(
        f"SELECT {_COLS} FROM schema_relations "
        "WHERE relation_id = %s AND project_id = %s", (relation_id, project_id))
    r = await cur.fetchone()
    if r is None:
        return None
    row = _row(r)
    await _annotate_backed(conn, [row])
    return row


@router.get("")
async def list_relations(project_id: uuid.UUID,
                         board_id: uuid.UUID | None = None) -> dict[str, Any]:
    board = await _resolve_board(project_id, str(board_id) if board_id else None)
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            f"SELECT {_COLS} FROM schema_relations WHERE project_id = %s "
            "AND board_id = %s ORDER BY created_at", (project_id, board))
        rows = [_row(r) for r in await cur.fetchall()]
        await _annotate_backed(conn, rows)
    return {"relations": rows, "board_id": board}


@router.post("")
async def create_relation(project_id: uuid.UUID, body: RelationCreate) -> dict[str, Any]:
    if (body.from_document_id, body.from_table, body.from_field) == \
       (body.to_document_id, body.to_table, body.to_field):
        raise HTTPException(status_code=422, detail="a field cannot join itself")
    board = await _resolve_board(project_id, body.board_id)
    pool = await get_pool()
    async with pool.connection() as conn:
        try:
            cur = await conn.execute(
                "INSERT INTO schema_relations (project_id, board_id, from_document_id, "
                "from_table, from_field, to_document_id, to_table, to_field, semantics, "
                "status, origin, notes) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'drawn','shane',%s) "
                "RETURNING relation_id",
                (project_id, board, body.from_document_id, body.from_table, body.from_field,
                 body.to_document_id, body.to_table, body.to_field, body.semantics,
                 (body.notes or "").strip() or None))
        except Exception as exc:
            if "unique" in str(exc).lower():
                raise HTTPException(status_code=409, detail="this relation already exists")
            raise
        relation_id = (await cur.fetchone())[0]
        await conn.commit()
        rel = await _fetch(conn, project_id, relation_id)
        res = await relations_data.survey(rel, str(project_id))
        await _store_survey(conn, relation_id, res)
        await conn.commit()
        out = await _fetch(conn, project_id, relation_id)
    return out


@router.put("/{relation_id}")
async def update_relation(project_id: uuid.UUID, relation_id: uuid.UUID,
                          body: RelationUpdate) -> dict[str, Any]:
    sets, params = ["updated_at = now()"], []
    if body.semantics is not None:
        sets.append("semantics = %s"); params.append(body.semantics)
    if body.status is not None:
        sets.append("status = %s"); params.append(body.status)
    if body.notes is not None:
        sets.append("notes = %s"); params.append(body.notes.strip() or None)
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE schema_relations SET " + ", ".join(sets) +  # noqa: S608 — sets are literals
            " WHERE relation_id = %s AND project_id = %s RETURNING relation_id",
            (*params, relation_id, project_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="relation not found")
        await conn.commit()
        rel = await _fetch(conn, project_id, relation_id)
        # accepting a proposal or retagging semantics re-runs the badge
        if body.status == "drawn" or body.semantics is not None:
            res = await relations_data.survey(rel, str(project_id))
            await _store_survey(conn, relation_id, res)
            await conn.commit()
            rel = await _fetch(conn, project_id, relation_id)
    return rel


@router.post("/{relation_id}/survey")
async def survey_relation(project_id: uuid.UUID, relation_id: uuid.UUID) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        rel = await _fetch(conn, project_id, relation_id)
        if rel is None:
            raise HTTPException(status_code=404, detail="relation not found")
        res = await relations_data.survey(rel, str(project_id))
        await _store_survey(conn, relation_id, res)
        await conn.commit()
        out = await _fetch(conn, project_id, relation_id)
    return {**out, "unbacked_side": res.get("unbacked_side")}


@router.delete("/{relation_id}")
async def delete_relation(project_id: uuid.UUID, relation_id: uuid.UUID) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "DELETE FROM schema_relations WHERE relation_id = %s AND project_id = %s "
            "RETURNING relation_id", (relation_id, project_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="relation not found")
        await conn.commit()
    return {"deleted": str(relation_id)}
