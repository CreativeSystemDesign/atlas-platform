"""Continuation registry persistence (Shane's design, 2026-07-11).

A wire number is a machine-level identity — R502 on sheet 5 and sheet 6 is
ONE conductor. The per-page graphs hold the drawn continuation chips; this
document-scoped registry holds each page's SIGHTINGS (anchored continuations:
net + the sheet/zone they point at), keyed by page number so a page's
autosave replaces only its own entry — no cross-page clobber. "Resolved"
(the green chip) is never stored: it is DERIVED by pairing reciprocal
sightings, so it can't go stale when the other page changes. The same table
is the substrate for the 3D machine graph's continuation arcs and the
wire-trace story.
"""

from __future__ import annotations

import uuid
from typing import Any

from psycopg.types.json import Jsonb

from src.persistence.database import get_pool


def _as_uuid(value: str | uuid.UUID) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


async def sheet_ref_for_page(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
) -> str | None:
    """The page's printed sheet fraction ("5/207") from the canonical sheet
    index — sheet != page (front matter shifts the series), and refs name
    SHEETS, so every cross-page consumer needs this join. Backfilled by
    scripts/populate-sheet-refs.py from each title block."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT sheet_ref FROM schematic_sheet_index
            WHERE project_id = %s AND document_id = %s AND page_num = %s
            """,
            (_as_uuid(project_id), document_id, page_num),
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def load_continuation_registry(
    project_id: str | uuid.UUID,
    document_id: str,
) -> dict[str, Any]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT pages, updated_at
            FROM schematic_v2_continuation_registry
            WHERE project_id = %s AND document_id = %s
            """,
            (_as_uuid(project_id), document_id),
        )
        row = await cur.fetchone()
    if row is None:
        return {"pages": {}, "updatedAt": None}
    pages, updated_at = row
    return {
        "pages": pages or {},
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }


async def save_page_sightings(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
    entry: dict[str, Any],
) -> dict[str, Any]:
    """Merge ONE page's sightings into the registry (atomic per-page upsert —
    a canvas only ever writes its own page's key)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO schematic_v2_continuation_registry
                (project_id, document_id, pages, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (project_id, document_id) DO UPDATE SET
                pages = schematic_v2_continuation_registry.pages || EXCLUDED.pages,
                updated_at = now()
            RETURNING registry_id, updated_at
            """,
            (_as_uuid(project_id), document_id, Jsonb({str(page_num): entry})),
        )
        row = await cur.fetchone()
        await conn.commit()
    registry_id, updated_at = row
    return {
        "registryId": str(registry_id),
        "page": page_num,
        "sightings": len(entry.get("sightings") or []),
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }
