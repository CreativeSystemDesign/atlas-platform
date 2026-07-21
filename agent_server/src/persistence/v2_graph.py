"""Neon persistence for the Experimental v2 logic-graph (its own workspace table).

Deliberately kept separate from the schematic_annotations / _training / yolocolab
annotation workspaces: v2 stores a *native* logic graph (nodes / ports / edges /
continuations) per page, not flat annotation rows. Neon is the source of truth;
the browser keeps a localStorage copy only as an offline cache.
"""

from __future__ import annotations

import uuid
from typing import Any

from psycopg.types.json import Jsonb

from src.persistence.database import get_pool

_GRAPH_KEYS = ("nodes", "ports", "edges", "continuations", "grounds", "cables")


def _as_uuid(value: str | uuid.UUID) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def empty_graph() -> dict[str, list]:
    return {key: [] for key in _GRAPH_KEYS}


def _normalize_graph(graph: dict[str, Any] | None) -> dict[str, list]:
    graph = graph or {}
    out: dict[str, list] = {}
    for key in _GRAPH_KEYS:
        value = graph.get(key)
        out[key] = list(value) if isinstance(value, list) else []
    return out


async def load_v2_graph(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
) -> dict[str, Any] | None:
    """Return the saved per-page v2 graph, or None if none has been saved yet."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT nodes, ports, edges, continuations, grounds, cables, source, updated_at
            FROM schematic_v2_graph
            WHERE project_id = %s AND document_id = %s AND page_num = %s
            """,
            (_as_uuid(project_id), document_id, page_num),
        )
        row = await cur.fetchone()
    if row is None:
        return None
    nodes, ports, edges, continuations, grounds, cables, source, updated_at = row
    return {
        "nodes": nodes or [],
        "ports": ports or [],
        "edges": edges or [],
        "continuations": continuations or [],
        "grounds": grounds or [],
        "cables": cables or [],
        "source": source,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


async def save_v2_graph(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
    graph: dict[str, Any],
    *,
    source: str = "human",
) -> dict[str, Any]:
    """Upsert the whole per-page v2 graph. One row per (project, document, page)."""
    normalized = _normalize_graph(graph)
    counts = {key: len(normalized[key]) for key in _GRAPH_KEYS}
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO schematic_v2_graph (
                project_id, document_id, page_num,
                nodes, ports, edges, continuations, grounds, cables,
                node_count, port_count, edge_count, continuation_count, ground_count, cable_count,
                source, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (project_id, document_id, page_num) DO UPDATE SET
                nodes = EXCLUDED.nodes,
                ports = EXCLUDED.ports,
                edges = EXCLUDED.edges,
                continuations = EXCLUDED.continuations,
                grounds = EXCLUDED.grounds,
                cables = EXCLUDED.cables,
                node_count = EXCLUDED.node_count,
                port_count = EXCLUDED.port_count,
                edge_count = EXCLUDED.edge_count,
                continuation_count = EXCLUDED.continuation_count,
                ground_count = EXCLUDED.ground_count,
                cable_count = EXCLUDED.cable_count,
                source = EXCLUDED.source,
                updated_at = now()
            RETURNING graph_id, updated_at
            """,
            (
                _as_uuid(project_id),
                document_id,
                page_num,
                Jsonb(normalized["nodes"]),
                Jsonb(normalized["ports"]),
                Jsonb(normalized["edges"]),
                Jsonb(normalized["continuations"]),
                Jsonb(normalized["grounds"]),
                Jsonb(normalized["cables"]),
                counts["nodes"],
                counts["ports"],
                counts["edges"],
                counts["continuations"],
                counts["grounds"],
                counts["cables"],
                source,
            ),
        )
        row = await cur.fetchone()
        await conn.commit()
    graph_id, updated_at = row
    return {
        "graphId": str(graph_id),
        "counts": counts,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }
