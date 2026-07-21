"""Join-walk queries — the data model's payoff, read-only by construction.

Assembles "everything the machine knows" about one entity by walking the
join contracts drawn on the Relations board: schematic occurrences from
the annotation graph, the parts list via mark membership (the list groups
siblings — "F10, F11, F12"), and the cable lists via conductor wire
labels. Powers the smart canvas hover card (Shane's tooltip ask,
2026-07-14) and, later, the technician-facing query at the dead machine.

Every result is interim-data evidence, not truth — the card presents what
the documents say, it never gates anything (the standing law).
"""

from __future__ import annotations

import re
from typing import Any

from src.persistence.database import get_pool

_LIMIT = 50

# Mirror of the canvas's NET_SLOT_RE (v2-graph-ops.ts): only convention-named
# terminals (T~<owner>~[<pin>~]<net>) carry a real net. Auto-minted
# placeholders like "T-39" are a NORMAL in-progress annotation state and must
# never surface as wire numbers (adversarial review, 2026-07-14).
_NET_SLOT_RE = re.compile(r"^T~[^~]+~(?:[^~]+~)?([^~]+)$")


def _mark_pattern(mark: str) -> str:
    """Membership regex for a grouped parts-list cell ('F10, F11, F12')."""
    return r"(^|,\s*)" + re.escape(mark) + r"(\s*,|$)"


async def _parts_rows(conn, project_id: str, mark: str) -> list[dict[str, Any]]:
    cur = await conn.execute(
        "SELECT r.location, r.symbol_text, r.description, r.part_number, r.quantity "
        "FROM document_extractions e "
        "JOIN document_extraction_rows r ON r.extraction_id = e.extraction_id "
        "WHERE e.project_id = %s AND e.extraction_kind = 'electrical_parts_list' "
        "AND r.symbol_text ~ %s ORDER BY r.extraction_row_id LIMIT %s",
        (project_id, _mark_pattern(mark), _LIMIT))
    return [dict(zip(("location", "symbol_text", "description",
                      "part_number", "quantity"), r))
            for r in await cur.fetchall()]


async def _cables_for_wires(conn, project_id: str, nets: list[str]) -> list[dict[str, Any]]:
    if not nets:
        return []
    cur = await conn.execute(
        "SELECT DISTINCT r.row_data->>'Cable Number', "
        "r.row_data->>'Originating Point', r.row_data->>'Termination Point' "
        "FROM document_extractions e "
        "JOIN document_extraction_rows r ON r.extraction_id = e.extraction_id "
        "WHERE e.project_id = %s AND e.extraction_kind LIKE %s "
        "AND r.row_data->>'Wire Label' = ANY(%s) "
        "ORDER BY 1 LIMIT %s",
        (project_id, "%cable_list_wire_labels", nets, _LIMIT))
    return [dict(zip(("cable_number", "origination", "termination"), r))
            for r in await cur.fetchall()]


async def component_joins(project_id: str, document_id: str, mark: str) -> dict[str, Any]:
    """One component mark → its whole joined record."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute("SET TRANSACTION READ ONLY")
        cur = await conn.execute(
            "SELECT DISTINCT g.page_num, n->'identity'->>'location', "
            "n->'identity'->>'partNumber' "
            "FROM schematic_v2_graph g, jsonb_array_elements(g.nodes) n "
            "WHERE g.project_id = %s AND g.document_id = %s AND n->>'label' = %s "
            "ORDER BY 1 LIMIT %s",
            (project_id, document_id, mark, _LIMIT))
        occurrences = [dict(zip(("page", "location", "part_number"), r))
                       for r in await cur.fetchall()]
        # its terminals (ports parented to this mark's nodes) → landing nets
        cur = await conn.execute(
            "SELECT DISTINCT port->>'label' "
            "FROM schematic_v2_graph g, jsonb_array_elements(g.nodes) n, "
            "jsonb_array_elements(g.ports) port "
            "WHERE g.project_id = %s AND g.document_id = %s AND n->>'label' = %s "
            "AND port->>'parentId' = n->>'id' LIMIT 400",
            (project_id, document_id, mark))
        tnames = [r[0] for r in await cur.fetchall() if r[0]]
        nets = sorted({m.group(1) for t in tnames if (m := _NET_SLOT_RE.match(t))})
        parts = await _parts_rows(conn, project_id, mark)
        cables = await _cables_for_wires(conn, project_id, nets)
    return {
        "mark": mark,
        "occurrences": occurrences,
        "terminal_count": len(tnames),
        "nets": nets,
        "parts_rows": parts,
        "cables": cables,
    }


async def wire_joins(project_id: str, document_id: str, label: str) -> dict[str, Any]:
    """One wire label → every endpoint and place the documents give it."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute("SET TRANSACTION READ ONLY")
        cur = await conn.execute(
            """
            WITH hits AS (
              SELECT g.graph_id, p.pid
              FROM schematic_v2_graph g, jsonb_array_elements(g.edges) e,
                   LATERAL (VALUES (e->>'sourcePortId'), (e->>'targetPortId')) p(pid)
              WHERE g.project_id = %s AND g.document_id = %s AND e->>'label' = %s
            ),
            term AS (
              SELECT DISTINCT port->>'label' AS tname, port->>'parentId' AS nid,
                     g2.graph_id, g2.page_num
              FROM schematic_v2_graph g2, jsonb_array_elements(g2.ports) port, hits
              WHERE hits.pid = port->>'id' AND hits.graph_id = g2.graph_id
            )
            SELECT term.page_num, term.tname, o.n->>'label',
                   o.n->'identity'->>'location'
            FROM term
            LEFT JOIN LATERAL (
              SELECT n FROM schematic_v2_graph g3, jsonb_array_elements(g3.nodes) n
              WHERE g3.graph_id = term.graph_id AND n->>'id' = term.nid
            ) o(n) ON true
            ORDER BY term.page_num, term.tname LIMIT %s
            """,
            (project_id, document_id, label, _LIMIT * 4))
        endpoints = [
            {"page": p, "terminal": t, "owner": m, "owner_location": loc,
             "continuation": m is None}
            for p, t, m, loc in await cur.fetchall()]
        cables = await _cables_for_wires(conn, project_id, [label])
    locations = sorted(
        {e["owner_location"] for e in endpoints if e["owner_location"]}
        | {c[k] for c in cables for k in ("origination", "termination") if c[k]})
    return {
        "label": label,
        "endpoints": endpoints,
        "cables": cables,
        "locations": locations,
    }
