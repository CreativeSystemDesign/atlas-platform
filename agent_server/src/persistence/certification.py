"""certification-sealed annotation snapshots (Shane's design, 2026-07-08).

When Shane seals a page as a gold master, the page's entire v2 graph is
archived here — APPEND-ONLY. Nothing in this codebase updates or deletes a
row; re-sealing a page mints the next version alongside the old. Each snapshot
carries a SHA-256 checksum of the canonical graph JSON:

- tamper-evidence: any later mutation of a snapshot is detectable by re-hash;
- the drift tripwire: a sealed page's LIVE graph is compared against its latest
  snapshot — any difference is an alarm (the live row changed after Shane
  certified it), surfaced on the seal status endpoint.

Restore is deliberately NOT implemented: recovering gold over live data is a
conscious, journaled act (manual SQL / a future Shane-only endpoint), never a
button press.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from psycopg.types.json import Jsonb

from src.persistence.database import get_pool
from src.persistence.v2_graph import _GRAPH_KEYS, _normalize_graph, load_v2_graph


def _as_uuid(value: str | uuid.UUID) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


# The exact key set the ORIGINAL seals hashed over. Frozen here on purpose:
# importing the live _GRAPH_KEYS let the cables schema addition (2026-07-10)
# silently change hashing semantics, and every gold page alarmed at once with
# zero real drift. Never let a stored checksum's meaning drift with the schema.
_LEGACY_CHECKSUM_KEYS = ("nodes", "ports", "edges", "continuations", "grounds")


def canonical_checksum(graph: dict[str, Any] | None) -> str:
    """SHA-256 over the canonical JSON of the graph's NON-EMPTY element lists.
    Canonical = normalized keys, sorted-key JSON, no whitespace. Skipping empty
    collections makes the hash stable across ADDITIVE schema evolution: a page
    with no cables hashes identically whether the graph schema knows about
    cables or not."""
    normalized = _normalize_graph(graph)
    payload = json.dumps(
        {key: normalized[key] for key in _GRAPH_KEYS if normalized[key]},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def legacy_checksum(graph: dict[str, Any] | None) -> str:
    """The pre-2026-07-10 canonical form: exactly the original five lists,
    empties included. Kept so seals minted under that form still verify."""
    normalized = _normalize_graph(graph)
    payload = json.dumps(
        {key: normalized[key] for key in _LEGACY_CHECKSUM_KEYS},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def snapshot_certification_seal(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
    provenance: str,
) -> dict[str, Any] | None:
    """Archive the page's current Neon graph as the next gold version.
    Returns the snapshot meta, or None when the page has no saved graph."""
    graph = await load_v2_graph(project_id, document_id, page_num)
    if graph is None:
        return None
    normalized = _normalize_graph(graph)
    counts = {key: len(normalized[key]) for key in _GRAPH_KEYS}
    checksum = canonical_checksum(normalized)
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO gold_sealed_annotations (
                project_id, document_id, page_num, version,
                provenance, graph, counts, checksum
            )
            VALUES (
                %s, %s, %s,
                COALESCE((
                    SELECT MAX(version) FROM gold_sealed_annotations
                    WHERE project_id = %s AND document_id = %s AND page_num = %s
                ), 0) + 1,
                %s, %s, %s, %s
            )
            RETURNING version, checksum, sealed_at
            """,
            (
                _as_uuid(project_id), document_id, page_num,
                _as_uuid(project_id), document_id, page_num,
                str(provenance)[:400],
                Jsonb({key: normalized[key] for key in _GRAPH_KEYS}),
                Jsonb(counts),
                checksum,
            ),
        )
        row = await cur.fetchone()
        await conn.commit()
    version, checksum_db, sealed_at = row
    return {
        "version": int(version),
        "checksum": checksum_db,
        "counts": counts,
        "sealed_at": sealed_at.isoformat() if sealed_at else None,
    }


async def latest_certification_seal(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
) -> dict[str, Any] | None:
    """Newest snapshot meta for the page (no graph payload), or None."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT version, checksum, counts, sealed_at, provenance
            FROM gold_sealed_annotations
            WHERE project_id = %s AND document_id = %s AND page_num = %s
            ORDER BY version DESC LIMIT 1
            """,
            (_as_uuid(project_id), document_id, page_num),
        )
        row = await cur.fetchone()
    if row is None:
        return None
    version, checksum, counts, sealed_at, provenance = row
    return {
        "version": int(version),
        "checksum": checksum,
        "counts": counts or {},
        "sealed_at": sealed_at.isoformat() if sealed_at else None,
        "provenance": provenance,
    }


async def verify_certification_seal(
    project_id: str | uuid.UUID,
    document_id: str,
    page_num: int,
) -> dict[str, Any] | None:
    """The drift tripwire: compare the LIVE graph's checksum against the latest
    gold snapshot. match=False means the live row changed after Shane sealed —
    an alarm, never routine. None when the page has no snapshot."""
    latest = await latest_certification_seal(project_id, document_id, page_num)
    if latest is None:
        return None
    live = await load_v2_graph(project_id, document_id, page_num)
    live_checksum = canonical_checksum(live)
    # Seals minted before 2026-07-10 hashed the legacy form (five lists,
    # empties included) — a live graph matching EITHER form is undrifted.
    # A cables-bearing page can only match the new form, so cable drift on
    # newly sealed pages is still caught.
    match = live_checksum == latest["checksum"] or legacy_checksum(live) == latest["checksum"]
    return {
        "version": latest["version"],
        "match": match,
        "live_checksum": live_checksum,
        "gold_checksum": latest["checksum"],
        "sealed_at": latest["sealed_at"],
    }
