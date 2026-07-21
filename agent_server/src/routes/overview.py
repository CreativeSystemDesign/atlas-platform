"""Atlas-Platform Overview — the fleet feed (Overview Data Contract).

The Overview is a VIEW: this endpoint computes nothing of its own — every
figure is a direct aggregate over an authoritative table, and figures whose
feeds don't exist yet are simply absent (the client renders named pending
chips, never fake zeros). Feeds compose here so the client makes ONE request
and can cache ONE user-keyed offline snapshot (R17).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from src.persistence.database import get_pool

router = APIRouter(prefix="/overview", tags=["Overview"])


def compose_fleet(
    projects: list[tuple[Any, ...]],
    doc_rows: list[tuple[Any, ...]],
    seal_rows: list[tuple[Any, ...]],
    lane_rows: list[tuple[Any, ...]] | None = None,
) -> dict[str, Any]:
    """Pure composition (unit-tested without a DB).

    projects: (project_id, machine_id, display_name, slug, status)
    doc_rows: (project_id, document_id, pages_indexed)          [sheet index]
    seal_rows: (project_id, document_id, pages_sealed, last_sealed_at)
    lane_rows: (project_id, document_id, lane, pages)           [routing map, R11]
    """
    docs_by_project: dict[str, list[dict[str, Any]]] = {}
    for pid, document_id, pages in doc_rows:
        docs_by_project.setdefault(str(pid), []).append(
            {"document_id": document_id, "pages_indexed": int(pages)})
    seals = {(str(pid), doc): (int(n), ts) for pid, doc, n, ts in seal_rows}
    lanes: dict[tuple[str, str], dict[str, int]] = {}
    for pid, doc, lane, pages in lane_rows or []:
        if lane:
            lanes.setdefault((str(pid), doc), {})[str(lane)] = int(pages)

    out = []
    for pid, machine_id, display_name, slug, status in projects:
        pid = str(pid)
        documents = docs_by_project.get(pid, [])
        last_sealed = None
        for d in documents:
            n, ts = seals.get((pid, d["document_id"]), (0, None))
            d["pages_sealed"] = n
            d["last_sealed_at"] = ts.isoformat() if ts else None
            d["lanes"] = lanes.get((pid, d["document_id"]), {})
            if ts and (last_sealed is None or ts > last_sealed):
                last_sealed = ts
        out.append({
            "project_id": pid,
            "machine_id": machine_id,
            "display_name": display_name,
            "slug": slug,
            "status": status,
            "documents_total": len(documents),
            "pages_indexed": sum(d["pages_indexed"] for d in documents),
            "pages_sealed": sum(d["pages_sealed"] for d in documents),
            # The R17 denominator: routing map, never page count. None when
            # a document has no routing yet (renders as an honest gap).
            "pages_canvas_routed": (
                sum(d["lanes"].get("schematic-canvas", 0) for d in documents)
                if any(d["lanes"] for d in documents) else None),
            "last_sealed_at": last_sealed.isoformat() if last_sealed else None,
            "documents": documents,
        })
    return {"projects": out}


@router.get("/fleet")
async def fleet() -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT project_id, machine_id, display_name, slug, status "
            "FROM projects ORDER BY created_at")
        projects = await cur.fetchall()
        cur = await conn.execute(
            "SELECT project_id, document_id, COUNT(*) FROM schematic_sheet_index "
            "GROUP BY project_id, document_id")
        doc_rows = await cur.fetchall()
        cur = await conn.execute(
            "SELECT project_id, document_id, COUNT(DISTINCT page_num), MAX(sealed_at) "
            "FROM gold_sealed_annotations GROUP BY project_id, document_id")
        seal_rows = await cur.fetchall()
        cur = await conn.execute(
            # R17 denominator honesty: only shane-confirmed routing counts here.
            # Classification is an ungraduated Arc domain (R0) — an unconfirmed
            # proposal must not grow the fleet's coverage denominators.
            "SELECT project_id, document_id, lane, COUNT(*) FROM schematic_sheet_index "
            "WHERE lane IS NOT NULL AND lane_source = 'shane-confirmed' "
            "GROUP BY project_id, document_id, lane")
        lane_rows = await cur.fetchall()
    return compose_fleet(list(projects), list(doc_rows), list(seal_rows), list(lane_rows))
