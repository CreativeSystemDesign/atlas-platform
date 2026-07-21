"""Cable registry persistence (Shane's design, 2026-07-10).

A cable (CAB21) is a machine-level identity, like a wire number: drawn on any
page, the SAME NAME is the SAME CABLE. The per-page graphs hold the drawn
elements; this document-scoped registry holds the shared conductor roster —
one row per (project, document), the whole registry as JSONB keyed by cable
name. Rosters are evidence-grade (cable-lists-are-hints doctrine): labels,
cores, signal names — never electrical inference.
"""

from __future__ import annotations

import uuid
from typing import Any

from psycopg.types.json import Jsonb

from src.persistence.database import get_pool


def _as_uuid(value: str | uuid.UUID) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


async def load_cable_registry(
    project_id: str | uuid.UUID,
    document_id: str,
) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT cables, updated_at
            FROM schematic_v2_cable_registry
            WHERE project_id = %s AND document_id = %s
            """,
            (_as_uuid(project_id), document_id),
        )
        row = await cur.fetchone()
    if row is None:
        return {"cables": {}, "updatedAt": None}
    cables, updated_at = row
    return {
        "cables": cables or {},
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


async def save_cable_registry(
    project_id: str | uuid.UUID,
    document_id: str,
    cables: dict[str, Any],
) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO schematic_v2_cable_registry (project_id, document_id, cables, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (project_id, document_id) DO UPDATE SET
                cables = EXCLUDED.cables,
                updated_at = now()
            RETURNING registry_id, updated_at
            """,
            (_as_uuid(project_id), document_id, Jsonb(cables)),
        )
        row = await cur.fetchone()
        await conn.commit()
    registry_id, updated_at = row
    return {
        "registryId": str(registry_id),
        "cableCount": len(cables),
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }
