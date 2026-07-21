"""Data Map API — derived cards over real tables + the Proving Bench.

The remodel's law (Shane, 2026-07-20): a card IS a real Postgres table or
view. Nothing schema-shaped is stored — the card row (data_map_cards) holds
only placement + curated prose, and everything else (columns, row counts,
extraction status) derives from the catalog at read time, so a card can
never disagree with its table.

The Proving Bench (/preview) is the QBE surface: picked columns are the
SELECT, drawn contracts are the JOIN clauses. LEFT joins only — a missing
partner is a finding, never a dropped row. Unreachable columns come back
NULL + joined:false so the UI can teach ("draw a join to populate").
Matching runs through atlas_norm/atlas_tokens_norm — the same engine the
survey badge uses, so the badge, the bench, and the future twin compiler
can never disagree about what matched.
"""

from __future__ import annotations

import json
import uuid
from collections import deque
from typing import Any

from fastapi import APIRouter, HTTPException
from psycopg import sql as pgsql
from pydantic import BaseModel, Field

from src.extraction_data import _SYS_ROW_INDEX, _SYS_SOURCE_PAGE
from src.persistence.database import get_pool
from src.routes.relations import _resolve_board

router = APIRouter(prefix="/projects/{project_id}/data-map", tags=["Data Map"])

# The curated allowlist of non-extraction sources lives in src/data_sources
# (shared with the extraction layer's ownership denylist so they can never
# drift — review 2026-07-20). Extraction tables are discovered dynamically.
from src.data_sources import EXTRA_SOURCES  # noqa: E402

_PREVIEW_ROW_CAP = 500
_PREVIEW_DEFAULT = 100


# --- catalog helpers --------------------------------------------------------


async def _catalog(conn) -> dict[str, dict[str, Any]]:
    """public tables/views -> {type, columns(ordered)} in two queries."""
    cur = await conn.execute(
        "SELECT table_name, table_type FROM information_schema.tables "
        "WHERE table_schema = 'public'")
    out = {r[0]: {"type": "view" if r[1] == "VIEW" else "table", "columns": []}
           for r in await cur.fetchall()}
    cur = await conn.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position")
    for tname, col in await cur.fetchall():
        if tname in out:
            out[tname]["columns"].append(col)
    return out


def _display_columns(cols: list[str]) -> list[str]:
    """Card-facing columns: drop the extraction system columns (imported
    from extraction_data so the names can never drift — review 2026-07-20:
    a '__' prefix filter matched nothing; the real names are unprefixed)."""
    return [c for c in cols if c not in (_SYS_ROW_INDEX, _SYS_SOURCE_PAGE)]


async def _row_estimate(conn, table: str, is_view: bool) -> int:
    """Fast row count: pg_class estimate for tables, exact for views (views
    have no reltuples) and for never-analyzed tables (reltuples = -1)."""
    if not is_view:
        cur = await conn.execute(
            "SELECT reltuples::bigint FROM pg_class "
            "WHERE relname = %s AND relkind IN ('r','p')", (table,))
        row = await cur.fetchone()
        if row is not None and row[0] is not None and row[0] >= 0:
            return int(row[0])
    cur = await conn.execute(
        pgsql.SQL("SELECT count(*) FROM {t}").format(t=pgsql.Identifier(table)))
    return int((await cur.fetchone())[0])


async def _extraction_index(conn, project_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """table_name -> {status, document_id, extraction_id} for this project's
    named extractions (the certified/draft chip + document grouping)."""
    cur = await conn.execute(
        "SELECT metadata->>'table_name', metadata->>'status', "
        "metadata->>'document_id', extraction_id FROM document_extractions "
        "WHERE project_id = %s AND metadata->>'table_name' IS NOT NULL",
        (project_id,))
    return {r[0]: {"status": r[1], "document_id": r[2], "extraction_id": str(r[3])}
            for r in await cur.fetchall()}


def _source_entry(name: str, cat: dict[str, Any], kind: str,
                  ext: dict[str, Any] | None, rows: int) -> dict[str, Any]:
    return {
        "table_name": name,
        "source_type": cat["type"],
        "kind": kind,
        "status": (ext or {}).get("status"),
        "document_id": (ext or {}).get("document_id"),
        "columns": _display_columns(cat["columns"]),
        "row_count": rows,
    }


# --- sources + cards --------------------------------------------------------


@router.get("/sources")
async def list_sources(project_id: uuid.UUID) -> dict[str, Any]:
    """Everything the board can offer as a card: this project's extraction
    tables (dynamic) + the curated extras that actually exist."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cat = await _catalog(conn)
        ext = await _extraction_index(conn, project_id)
        sources: list[dict[str, Any]] = []
        for name, info in ext.items():
            if name in cat:
                rows = await _row_estimate(conn, name, cat[name]["type"] == "view")
                sources.append(_source_entry(name, cat[name], "extraction", info, rows))
        for name, kind in EXTRA_SOURCES.items():
            if name in cat:
                rows = await _row_estimate(conn, name, cat[name]["type"] == "view")
                sources.append(_source_entry(name, cat[name], kind, None, rows))
    sources.sort(key=lambda s: (s["kind"], s["table_name"]))
    return {"sources": sources}


@router.get("/cards")
async def list_cards(project_id: uuid.UUID, board_id: uuid.UUID | None = None) -> dict[str, Any]:
    board = await _resolve_board(project_id, str(board_id) if board_id else None)
    pool = await get_pool()
    async with pool.connection() as conn:
        cat = await _catalog(conn)
        ext = await _extraction_index(conn, project_id)
        cur = await conn.execute(
            "SELECT table_name, x, y, collapsed, description, field_notes, "
            "provenance, updated_at FROM data_map_cards "
            "WHERE board_id = %s AND project_id = %s ORDER BY table_name",
            (board, project_id))
        cards: list[dict[str, Any]] = []
        for name, x, y, collapsed, desc, notes, prov, updated in await cur.fetchall():
            info = cat.get(name)
            if info is None:
                # the table vanished under the card — an honest ghost, the
                # UI renders it as missing rather than silently dropping it
                cards.append({"table_name": name, "x": x, "y": y,
                              "collapsed": collapsed, "missing": True,
                              "description": desc, "provenance": prov,
                              "field_notes": notes or {}, "columns": [],
                              "row_count": 0, "source_type": None,
                              "kind": None, "status": None, "document_id": None})
                continue
            kind = "extraction" if name in ext else EXTRA_SOURCES.get(name, "table")
            rows = await _row_estimate(conn, name, info["type"] == "view")
            cards.append({
                **_source_entry(name, info, kind, ext.get(name), rows),
                "x": x, "y": y, "collapsed": collapsed, "missing": False,
                "description": desc, "provenance": prov,
                "field_notes": notes or {},
                "updated_at": updated.isoformat() if updated else None,
            })
    return {"cards": cards, "board_id": board}


class CardCreate(BaseModel):
    board_id: str | None = None
    table_name: str = Field(max_length=160)
    x: float = 0
    y: float = 0


@router.post("/cards")
async def add_card(project_id: uuid.UUID, body: CardCreate) -> dict[str, Any]:
    board = await _resolve_board(project_id, body.board_id)
    pool = await get_pool()
    async with pool.connection() as conn:
        cat = await _catalog(conn)
        if body.table_name not in cat:
            raise HTTPException(status_code=404, detail="no such table or view")
        ext = await _extraction_index(conn, project_id)
        if body.table_name not in ext and body.table_name not in EXTRA_SOURCES:
            raise HTTPException(
                status_code=422,
                detail="not an offered source — extraction tables and the "
                       "curated data tables only")
        cur = await conn.execute(
            "INSERT INTO data_map_cards (board_id, project_id, table_name, x, y) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (board_id, table_name) DO NOTHING RETURNING table_name",
            (board, project_id, body.table_name, body.x, body.y))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=409, detail="already on this board")
        await conn.commit()
    return {"ok": True, "board_id": board, "table_name": body.table_name}


class CardPatch(BaseModel):
    board_id: str | None = None
    x: float | None = None
    y: float | None = None
    collapsed: bool | None = None
    description: str | None = None
    provenance: str | None = None
    field_notes: dict[str, str] | None = None


@router.put("/cards/{table_name}")
async def patch_card(project_id: uuid.UUID, table_name: str, body: CardPatch) -> dict[str, Any]:
    board = await _resolve_board(project_id, body.board_id)
    sets, params = ["updated_at = now()"], []
    for col in ("x", "y", "collapsed", "description", "provenance"):
        val = getattr(body, col)
        if val is not None:
            sets.append(f"{col} = %s")  # noqa: S608 — col names are literals above
            params.append(val)
    if body.field_notes is not None:
        sets.append("field_notes = %s")
        params.append(json.dumps(body.field_notes))
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE data_map_cards SET " + ", ".join(sets) +  # noqa: S608
            " WHERE board_id = %s AND project_id = %s AND table_name = %s "
            "RETURNING table_name",
            (*params, board, project_id, table_name))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="card not on this board")
        await conn.commit()
    return {"ok": True}


@router.delete("/cards/{table_name}")
async def remove_card(project_id: uuid.UUID, table_name: str,
                      board_id: uuid.UUID | None = None) -> dict[str, Any]:
    board = await _resolve_board(project_id, str(board_id) if board_id else None)
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "DELETE FROM data_map_cards WHERE board_id = %s AND project_id = %s "
            "AND table_name = %s RETURNING table_name",
            (board, project_id, table_name))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="card not on this board")
        await conn.commit()
    return {"ok": True}


# --- the Proving Bench ------------------------------------------------------


class PreviewColumn(BaseModel):
    table: str = Field(max_length=160)
    column: str = Field(max_length=160)


class PreviewRequest(BaseModel):
    board_id: str | None = None
    columns: list[PreviewColumn] = Field(min_length=1, max_length=24)
    limit: int = Field(default=_PREVIEW_DEFAULT, ge=1, le=_PREVIEW_ROW_CAP)


def _join_condition(parent: pgsql.Identifier, pf: str,
                    child: pgsql.Identifier, cf: str, semantics: str) -> pgsql.Composed:
    """The ON clause for one drawn contract — same matching engine as the
    survey (atlas_trim / atlas_norm / atlas_tokens_norm), LEFT-join safe:
    blank cells never stitch (empty=empty would fabricate connections;
    atlas_tokens_norm drops blank-normalizing tokens itself)."""
    p = pgsql.SQL("{t}.{c}::text").format(t=parent, c=pgsql.Identifier(pf))
    c = pgsql.SQL("{t}.{c}::text").format(t=child, c=pgsql.Identifier(cf))
    if semantics == "membership":
        return pgsql.SQL(
            "atlas_tokens_norm({p}) && atlas_tokens_norm({c})").format(p=p, c=c)
    if semantics == "vocabulary":
        return pgsql.SQL(
            "atlas_norm({p}) = atlas_norm({c}) AND atlas_norm({p}) <> ''"
        ).format(p=p, c=c)
    return pgsql.SQL(
        "atlas_trim({p}) = atlas_trim({c}) AND atlas_trim({p}) <> ''"
    ).format(p=p, c=c)


@router.post("/preview")
async def preview(project_id: uuid.UUID, body: PreviewRequest) -> dict[str, Any]:
    """Stitch picked columns along drawn contracts. Base table = the first
    pick's table; every other table LEFT-joins in along the shortest path of
    drawn edges (multi-hop through unpicked intermediates allowed — a trace
    in miniature). Truthful fan-out: the row grain is whatever the joins
    make it, and row_total says so."""
    board = await _resolve_board(project_id, body.board_id)
    pool = await get_pool()
    async with pool.connection() as conn:
        cat = await _catalog(conn)
        for pc in body.columns:
            if pc.table not in cat:
                raise HTTPException(status_code=422, detail=f"no such table {pc.table!r}")
            if pc.column not in cat[pc.table]["columns"]:
                raise HTTPException(
                    status_code=422, detail=f"{pc.table!r} has no column {pc.column!r}")

        picked_tables: list[str] = []
        for pc in body.columns:
            if pc.table not in picked_tables:
                picked_tables.append(pc.table)
        base = picked_tables[0]

        # drawn contracts on this board -> undirected adjacency over tables.
        # ORDER BY created_at: with parallel contracts between one pair, the
        # OLDEST drawn edge stitches, deterministically (review 2026-07-20).
        # Self-join contracts are skipped (one alias per table in v1).
        # UNBACKED edges — an endpoint column the live table no longer
        # carries — are skipped like unbacked tables, and reported: a 500 on
        # a drifted contract would poison every preview through that edge
        # (the same predicate relations.py _annotate_backed uses).
        cur = await conn.execute(
            "SELECT from_table, from_field, to_table, to_field, semantics "
            "FROM schema_relations WHERE project_id = %s AND board_id = %s "
            "AND status = 'drawn' ORDER BY created_at", (project_id, board))
        adj: dict[str, list[tuple[str, str, str, str]]] = {}
        skipped_unbacked: list[str] = []
        for ft, ff, tt, tf, sem in await cur.fetchall():
            if ft == tt:
                continue
            if (ft not in cat or ff not in cat[ft]["columns"]
                    or tt not in cat or tf not in cat[tt]["columns"]):
                skipped_unbacked.append(f"{ft}.{ff} → {tt}.{tf}")
                continue
            adj.setdefault(ft, []).append((tt, ff, tf, sem))
            adj.setdefault(tt, []).append((ft, tf, ff, sem))

        # BFS from base: parent-pointers give each reachable table its join
        parent: dict[str, tuple[str, str, str, str]] = {}  # t -> (parent, pf, cf, sem)
        seen = {base}
        q: deque[str] = deque([base])
        while q:
            t = q.popleft()
            for (nxt, pf, cf, sem) in adj.get(t, []):
                if nxt in seen or nxt not in cat:
                    continue
                seen.add(nxt)
                parent[nxt] = (t, pf, cf, sem)
                q.append(nxt)

        # tables the query needs: path nodes for every reachable picked table
        needed: list[str] = [base]
        unreachable: list[str] = []
        for t in picked_tables[1:]:
            if t not in seen:
                unreachable.append(t)
                continue
            path: list[str] = []
            walk = t
            while walk != base:
                path.append(walk)
                walk = parent[walk][0]
            for node in reversed(path):
                if node not in needed:
                    needed.append(node)

        alias = {t: pgsql.Identifier(f"t{i}") for i, t in enumerate(needed)}

        # FROM base LEFT JOIN ... (BFS parent order = valid join order);
        # project scoping rides each table's ON/WHERE when it has the column
        frm = pgsql.SQL("{t} AS {a}").format(t=pgsql.Identifier(base), a=alias[base])
        joins_meta: list[dict[str, Any]] = []
        for t in needed[1:]:
            p, pf, cf, sem = parent[t]
            cond = _join_condition(alias[p], pf, alias[t], cf, sem)
            if "project_id" in cat[t]["columns"]:
                cond = cond + pgsql.SQL(" AND {a}.project_id = {pid}").format(
                    a=alias[t], pid=pgsql.Literal(str(project_id)))
            frm = frm + pgsql.SQL(" LEFT JOIN {t} AS {a} ON {c}").format(
                t=pgsql.Identifier(t), a=alias[t], c=cond)
            joins_meta.append({"table": t, "via": f"{p}.{pf} → {t}.{cf}",
                               "semantics": sem})

        sel_parts: list[pgsql.Composed] = []
        col_meta: list[dict[str, Any]] = []
        for i, pc in enumerate(body.columns):
            joined = pc.table in needed
            out_name = pgsql.Identifier(f"c{i}")
            if joined:
                sel_parts.append(pgsql.SQL("{a}.{c}::text AS {o}").format(
                    a=alias[pc.table], c=pgsql.Identifier(pc.column), o=out_name))
            else:
                sel_parts.append(pgsql.SQL("NULL::text AS {o}").format(o=out_name))
            col_meta.append({"table": pc.table, "column": pc.column, "joined": joined})

        # count(*) OVER () would force full join materialization before the
        # LIMIT could stream — a membership join over the big plant tables
        # blows the 10s cap (review 2026-07-20). Rows stream with LIMIT; the
        # total is a second, capped count (LIMIT {cap}+1 inside — "capped"
        # means the true total is larger than reported).
        where = pgsql.SQL("")
        if "project_id" in cat[base]["columns"]:
            where = pgsql.SQL(" WHERE {a}.project_id = {pid}").format(
                a=alias[base], pid=pgsql.Literal(str(project_id)))
        query = pgsql.SQL("SELECT {sel} FROM {frm}{w} LIMIT {n}").format(
            sel=pgsql.SQL(", ").join(sel_parts), frm=frm, w=where,
            n=pgsql.Literal(body.limit))
        count_cap = 10000
        count_q = pgsql.SQL(
            "SELECT count(*) FROM (SELECT 1 FROM {frm}{w} LIMIT {n}) s").format(
            frm=frm, w=where, n=pgsql.Literal(count_cap + 1))

        async with conn.transaction():
            await conn.execute("SET LOCAL transaction_read_only = on")
            await conn.execute("SET LOCAL statement_timeout = '10s'")
            cur = await conn.execute(query)
            raw = await cur.fetchall()
            cur = await conn.execute(count_q)
            counted = int((await cur.fetchone())[0])

    return {
        "board_id": board,
        "base_table": base,
        "columns": col_meta,
        "rows": [list(r) for r in raw],
        "row_total": min(counted, count_cap),
        "row_total_capped": counted > count_cap,
        "joins": joins_meta,
        "unreachable": unreachable,
        "skipped_unbacked": skipped_unbacked,
    }
