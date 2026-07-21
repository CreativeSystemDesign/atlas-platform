"""Field peek — sample real values for any table column, live from Neon.

What survives of the Schema-Builder store after the 2026-07-20 Data Map
remodel: the /peek endpoint (the right-click preview on Data Map cards, and
the Proving Bench's little sibling). The document_schemas CRUD is gone —
cards derive from the catalog now (routes/data_map.py); the hand-authored
card layer is archived in neon_archived/card_layer_pre_datamap__*.

Resolution is two-tier: (1) a real physical table/view by this name —
sampled directly (this is the primary path post-remodel; every card is
one); (2) an extraction row-set resolved from (document_id, table) — the
legacy pre-materialization path, kept because unnamed/legacy extractions
still answer through it. A field the source doesn't carry is reported as
DRIFT, exactly what you want caught before drawing a join on it.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from psycopg import sql as _pgsql

from src import relations_data
from src.canvas_copilot.schema_tools import _cell
from src.persistence.database import get_pool

router = APIRouter(prefix="/projects/{project_id}/schemas", tags=["Schemas"])


@router.get("/peek")
async def peek_field(
    project_id: uuid.UUID, table: str, column: str,
    document_id: str | None = None, limit: int = 6,
) -> dict[str, Any]:
    """Distinct, non-blank sample of a column's actual value shape — the
    value *vocabulary*, not six identical or empty rows."""
    table = (table or "").strip()
    column = (column or "").strip()
    limit = max(1, min(int(limit or 6), 20))
    pool = await get_pool()
    async with pool.connection() as conn:
        # --- tier 1: a real physical table or view by this name -------------
        cur = await conn.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = %s", (table,))
        is_physical = await cur.fetchone() is not None

        if is_physical:
            cur = await conn.execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s "
                "AND column_name = %s", (table, column))
            if await cur.fetchone() is None:
                cur = await conn.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = %s "
                    "ORDER BY ordinal_position", (table,))
                cols = [r[0] for r in await cur.fetchall()]
                return {"ok": False, "table": table, "column": column,
                        "columns": cols, "source": "table",
                        "note": f"{table!r} has no column {column!r} — the card "
                                "and its live table have drifted"}
            col, tbl = _pgsql.Identifier(column), _pgsql.Identifier(table)
            cur = await conn.execute(
                _pgsql.SQL("SELECT count(*), count(DISTINCT {c}) FROM {t}")
                .format(c=col, t=tbl))
            row_total, distinct_total = await cur.fetchone()
            cur = await conn.execute(
                _pgsql.SQL(
                    "SELECT DISTINCT {c} FROM {t} "
                    "WHERE {c} IS NOT NULL AND btrim({c}::text) <> '' "
                    "ORDER BY {c} LIMIT %s").format(c=col, t=tbl),
                (limit,))
            values = [_cell(r[0]) for r in await cur.fetchall()]
            return {"ok": True, "mode": "column", "source": "table",
                    "table": table, "column": column, "values": values,
                    "distinct_total": int(distinct_total or 0),
                    "row_total": int(row_total or 0)}

        if not document_id:
            return {"ok": False, "table": table, "column": column,
                    "note": f"no physical table {table!r} and no document to "
                            "resolve this card against"}

        # --- tier 2: the card is an extraction row-set ----------------------
        cur = await conn.execute(
            "SELECT extraction_id, fieldnames FROM document_extractions "
            "WHERE project_id = %s AND metadata->>'document_id' = %s "
            "AND COALESCE(metadata->>'table_name','') = %s "
            "ORDER BY created_at ASC LIMIT 1",
            (project_id, document_id, table))
        row = await cur.fetchone()
        if row is None:
            return {"ok": False, "table": table, "column": column,
                    "note": f"couldn't resolve {table!r} to live data — no "
                            "physical table and no extraction by that name "
                            "on this document"}
        eid, fieldnames = row[0], (row[1] or [])
        # tolerate a respaced/recased card field vs the stored row_data key
        key = column
        if fieldnames and column not in fieldnames:
            norm = relations_data._norm_field(column)
            key = next((f for f in fieldnames
                        if relations_data._norm_field(f) == norm), None)
            if key is None:
                return {"ok": False, "table": table, "column": column,
                        "columns": list(fieldnames), "source": "extraction",
                        "note": f"the extraction has no field {column!r} — the card "
                                "and its rows have drifted"}
        cur = await conn.execute(
            "SELECT count(*), count(DISTINCT row_data->>%s) "
            "FROM document_extraction_rows WHERE extraction_id = %s",
            (key, eid))
        row_total, distinct_total = await cur.fetchone()
        cur = await conn.execute(
            "SELECT DISTINCT row_data->>%s AS v FROM document_extraction_rows "
            "WHERE extraction_id = %s AND row_data->>%s IS NOT NULL "
            "AND btrim(row_data->>%s) <> '' ORDER BY v LIMIT %s",
            (key, eid, key, key, limit))
        values = [_cell(r[0]) for r in await cur.fetchall()]
    return {"ok": True, "mode": "column", "source": "extraction",
            "table": table, "column": column, "values": values,
            "distinct_total": int(distinct_total or 0),
            "row_total": int(row_total or 0)}
