"""Extraction area — READ-ONLY feeds (R18: UI first).

Serves the Document Extraction UI two things that already exist:
  1. the routing-map worklist denominator (shane-confirmed lanes only), and
  2. the deep-agent-era extraction datasets (document_extractions /
     document_extraction_rows) for read-only provenance browsing.

Nothing here interprets document contents, runs parsers, or writes — the
extraction machinery itself is ON HOLD per R18 and arrives in joint design
sessions, one capability at a time. Rows are labeled by the UI as
legacy/unverified per the atlas-dir trust policy: displaying recorded data
is not endorsing it.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src import extraction_data
from src.persistence.database import get_pool

router = APIRouter(prefix="/projects/{project_id}/extractions", tags=["Extractions"])


@router.get("")
async def list_extractions(project_id: uuid.UUID) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT e.extraction_id, e.extraction_kind, e.source_pdf_path, e.output_contract, "
            "e.row_count, e.fieldnames, e.created_at, e.metadata "
            "FROM document_extractions e WHERE e.project_id = %s "
            "ORDER BY e.created_at DESC",
            (project_id,))
        rows = await cur.fetchall()
    out = []
    for r in rows:
        meta = r[7] or {}
        # A collaborative draft/certified carries its document + status in
        # metadata; legacy deep-agent extractions have neither (source only).
        # Under the dynamic-verification ruling (2026-07-16) the raw status IS
        # honest: 'draft' | 'certified' | None(legacy). The old derive_status
        # call died with the per-page verify machinery; its dangling reference
        # 500'd this route (fixed 2026-07-17).
        out.append({
            "extraction_id": str(r[0]), "extraction_kind": r[1],
            "source_pdf_path": r[2], "output_contract": r[3],
            "row_count": r[4], "fieldnames": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
            "document_id": meta.get("document_id"),
            "status": meta.get("status")
            or ("verified" if meta.get("verified") else None),
        })
    return {"extractions": out}


@router.get("/{extraction_id}/rows")
async def extraction_rows(
    project_id: uuid.UUID,
    extraction_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM document_extractions "
            "WHERE extraction_id = %s AND project_id = %s",
            (extraction_id, project_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="extraction not found")
        cur = await conn.execute(
            "SELECT row_index, source_page, row_number, location, symbol_text, "
            "description, part_number, quantity, row_data, extraction_row_id "
            "FROM document_extraction_rows WHERE extraction_id = %s "
            "ORDER BY row_index LIMIT %s OFFSET %s",
            (extraction_id, limit, offset))
        rows = await cur.fetchall()
        cur = await conn.execute(
            "SELECT COUNT(*) FROM document_extraction_rows WHERE extraction_id = %s",
            (extraction_id,))
        total = (await cur.fetchone())[0]
    return {
        "total": int(total),
        "offset": offset,
        "rows": [
            {
                "row_index": r[0], "source_page": r[1], "row_number": r[2],
                "location": r[3], "symbol_text": r[4], "description": r[5],
                "part_number": r[6], "quantity": r[7], "row_data": r[8] or {},
                "extraction_row_id": r[9],
            }
            for r in rows
        ],
    }


# --- Collaborative-extraction draft lifecycle (2026-07-15) -----------------
# The Extraction workbench: get-or-create a document/table's DRAFT extraction,
# edit/add/delete its rows in the grid, VERIFY (bank as trusted), and COMPARE
# it against the interim data. Arc designs columns via document_set_schema and
# writes rows via document_write_rows; these routes are the grid's read/edit surface.

class DraftBody(BaseModel):
    document_id: str
    # A new document's table has no name until Arc and Shane design it.
    table_name: str | None = Field(default=None, max_length=160)
    source_pdf_path: str | None = None


class SchemaBody(BaseModel):
    # The one table's designed schema: its name + ordered columns.
    table_name: str | None = None
    columns: list[dict[str, Any]] = Field(default_factory=list)


class RowBody(BaseModel):
    row_data: dict[str, Any]
    source_page: int | None = None


async def _own_extraction(conn, project_id: uuid.UUID, extraction_id: uuid.UUID):
    cur = await conn.execute(
        "SELECT extraction_id FROM document_extractions "
        "WHERE extraction_id = %s AND project_id = %s", (extraction_id, project_id))
    return await cur.fetchone() is not None


async def _refuse_if_certified(conn, extraction_id: uuid.UUID) -> None:
    """A CERTIFIED table is sealed read-only (Shane's certification describes
    the rows exactly as they are). Every mutation route checks this — the seal
    must hold at the API, not just in Arc's tool (probe 2026-07-16 proved the
    grid route was an open side door)."""
    cur = await conn.execute(
        "SELECT metadata->>'status' FROM document_extractions WHERE extraction_id = %s",
        (extraction_id,))
    row = await cur.fetchone()
    if row and row[0] in ("certified", "verified"):
        raise HTTPException(status_code=409, detail="table is CERTIFIED (sealed read-only) "
                            "— unseal it first (POST /unseal) to edit")


async def _refresh_count(conn, extraction_id: uuid.UUID) -> int:
    cur = await conn.execute(
        "SELECT COUNT(*) FROM document_extraction_rows WHERE extraction_id = %s",
        (extraction_id,))
    total = int((await cur.fetchone())[0])
    await conn.execute("UPDATE document_extractions SET row_count = %s "
                       "WHERE extraction_id = %s", (total, extraction_id))
    return total


@router.post("/draft")
async def get_or_create_draft(project_id: uuid.UUID, body: DraftBody) -> dict[str, Any]:
    """Get-or-create the draft for (document, table_name). A new table_name
    mints a new table for the document."""
    return await extraction_data.get_or_create_draft(
        project_id, body.document_id, (body.table_name or "").strip(),
        body.source_pdf_path or "")


@router.get("/drafts")
async def list_document_drafts(project_id: uuid.UUID,
                              document_id: str = Query(...)) -> dict[str, Any]:
    """All of a document's tables (0..N) — the panel lays them out
    horizontally. Empty list = no tables designed yet."""
    return {"tables": await extraction_data.list_drafts(project_id, document_id)}


@router.delete("/{extraction_id}")
async def delete_draft(project_id: uuid.UUID, extraction_id: uuid.UUID) -> dict[str, Any]:
    """Remove a draft table (and its rows). Drafts only."""
    ok = await extraction_data.delete_draft(project_id, extraction_id)
    if not ok:
        raise HTTPException(status_code=404, detail="draft not found (or already banked)")
    return {"ok": True, "deleted": str(extraction_id)}


@router.put("/{extraction_id}/schema")
async def set_schema(project_id: uuid.UUID, extraction_id: uuid.UUID,
                     body: SchemaBody) -> dict[str, Any]:
    """Save the columns Arc and Shane designed for this table (+ its name)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await _refuse_if_certified(conn, extraction_id)
    out = await extraction_data.set_schema(
        project_id, extraction_id, body.table_name, body.columns)
    if out is None:
        raise HTTPException(status_code=404, detail="extraction not found")
    return out


@router.post("/{extraction_id}/verify")
async def verify(project_id: uuid.UUID, extraction_id: uuid.UUID) -> dict[str, Any]:
    """CERTIFY the table — Shane's explicit act (the verification protocol
    itself is agreed at extraction time, not dictated here). Seals the table
    read-only until unsealed."""
    out = await extraction_data.verify_draft(project_id, extraction_id)
    if out is None:
        raise HTTPException(status_code=404, detail="extraction not found")
    return out


@router.post("/{extraction_id}/unseal")
async def unseal(project_id: uuid.UUID, extraction_id: uuid.UUID) -> dict[str, Any]:
    """Shane lifts a certification — the table returns to draft, writable."""
    out = await extraction_data.unverify_draft(project_id, extraction_id)
    if out is None:
        raise HTTPException(status_code=404, detail="extraction not found")
    return out


@router.get("/{extraction_id}/compare")
async def compare(project_id: uuid.UUID, extraction_id: uuid.UUID) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        if not await _own_extraction(conn, project_id, extraction_id):
            raise HTTPException(status_code=404, detail="extraction not found")
    return await extraction_data.compare_draft(project_id, extraction_id)


@router.post("/{extraction_id}/rows")
async def add_row(project_id: uuid.UUID, extraction_id: uuid.UUID,
                  body: RowBody) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        if not await _own_extraction(conn, project_id, extraction_id):
            raise HTTPException(status_code=404, detail="extraction not found")
        await _refuse_if_certified(conn, extraction_id)
        cur = await conn.execute(
            "SELECT COALESCE(MAX(row_index),0) FROM document_extraction_rows "
            "WHERE extraction_id = %s", (extraction_id,))
        nxt = (await cur.fetchone())[0] + 1
        tc = extraction_data._typed_columns(body.row_data)
        page = body.source_page if body.source_page is not None else tc.get("source_page")
        try:
            page = int(page) if page is not None and str(page).strip() != "" else None
        except (TypeError, ValueError):
            page = None
        cur = await conn.execute(
            "INSERT INTO document_extraction_rows (extraction_id, row_index, source_page, "
            "row_number, location, symbol_text, description, part_number, quantity, row_data) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb) RETURNING extraction_row_id",
            (extraction_id, nxt, page,
             extraction_data._s(tc.get("row_number")), extraction_data._s(tc.get("location")),
             extraction_data._s(tc.get("symbol_text")), extraction_data._s(tc.get("description")),
             extraction_data._s(tc.get("part_number")), extraction_data._s(tc.get("quantity")),
             json.dumps(body.row_data, ensure_ascii=False)))
        rid = (await cur.fetchone())[0]
        total = await _refresh_count(conn, extraction_id)
        # keep the extraction's REAL table in step with this edit (same txn)
        await extraction_data.resync_from_extraction(conn, extraction_id)
        await conn.commit()
    return {"extraction_row_id": rid, "row_index": nxt, "row_count": total}


@router.put("/{extraction_id}/rows/{row_id}")
async def edit_row(project_id: uuid.UUID, extraction_id: uuid.UUID, row_id: int,
                   body: RowBody) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        if not await _own_extraction(conn, project_id, extraction_id):
            raise HTTPException(status_code=404, detail="extraction not found")
        await _refuse_if_certified(conn, extraction_id)
        # re-derive typed columns from the edited row_data so a verified draft
        # stays join-ready and the legacy browser stays consistent
        tc = extraction_data._typed_columns(body.row_data)
        page = body.source_page if body.source_page is not None else tc.get("source_page")
        try:
            page = int(page) if page is not None and str(page).strip() != "" else None
        except (TypeError, ValueError):
            page = None
        cur = await conn.execute(
            "UPDATE document_extraction_rows SET row_data = %s::jsonb, source_page = %s, "
            "row_number = %s, location = %s, symbol_text = %s, description = %s, "
            "part_number = %s, quantity = %s "
            "WHERE extraction_row_id = %s AND extraction_id = %s RETURNING extraction_row_id",
            (json.dumps(body.row_data, ensure_ascii=False), page,
             extraction_data._s(tc.get("row_number")), extraction_data._s(tc.get("location")),
             extraction_data._s(tc.get("symbol_text")), extraction_data._s(tc.get("description")),
             extraction_data._s(tc.get("part_number")), extraction_data._s(tc.get("quantity")),
             row_id, extraction_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="row not found")
        # keep the extraction's REAL table in step with this edit (same txn)
        await extraction_data.resync_from_extraction(conn, extraction_id)
        await conn.commit()
    return {"ok": True, "extraction_row_id": row_id}


@router.delete("/{extraction_id}/rows/{row_id}")
async def delete_row(project_id: uuid.UUID, extraction_id: uuid.UUID,
                     row_id: int) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        if not await _own_extraction(conn, project_id, extraction_id):
            raise HTTPException(status_code=404, detail="extraction not found")
        await _refuse_if_certified(conn, extraction_id)
        cur = await conn.execute(
            "DELETE FROM document_extraction_rows WHERE extraction_row_id = %s "
            "AND extraction_id = %s RETURNING extraction_row_id", (row_id, extraction_id))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="row not found")
        total = await _refresh_count(conn, extraction_id)
        # keep the extraction's REAL table in step with this edit (same txn)
        await extraction_data.resync_from_extraction(conn, extraction_id)
        await conn.commit()
    return {"ok": True, "row_count": total}
