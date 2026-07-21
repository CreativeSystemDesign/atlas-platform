"""Collaborative-extraction data layer — ONE data-extraction table per
document, designed and filled by Arc + Shane.

A DRAFT is a single `document_extractions` row per document, carrying
metadata {status:'draft', document_id, table_name, columns:[{name,type,
description}]}. Its COLUMNS are the schema Arc and Shane design together
while reading the document; its rows are the extracted data. This store is
entirely separate from `document_schemas` (the Schema-Builder) — downstream,
schema-builder tables load FROM these extraction outputs, but nothing here
touches them.

EVERY EXTRACTION IS A REAL POSTGRES TABLE (Shane, 2026-07-19). `table_name`
names an actual table in Neon: set_schema creates/alters/renames it,
write_rows refills it in the same transaction, delete_draft drops it. Before
this, rows lived ONLY as JSONB in document_extraction_rows while the code and
the UI described them as tables — a false claim that misled Shane and Arc into
reasoning about tables that did not exist. The JSONB rows remain the write
buffer for now and the real table is rebuilt from them on every write, so the
two cannot diverge; retiring the JSONB path is the next stage.

VERIFY banks the draft (status→verified, verified=true). COMPARE checks the
draft against the most recent NON-draft extraction OF THE SAME DOCUMENT (an
earlier verified pass) — the honest coverage check, never a gate.

Human-gated by construction: every write originates from a Shane-triggered
Arc turn or a grid action; nothing loops.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from psycopg import sql as _sql

from src.persistence.database import get_pool

logger = logging.getLogger(__name__)

# Field-name aliases → the typed columns some join bindings read, so a
# VERIFIED draft is join-ready. Matching is case/space/underscore-insensitive.
_TYPED_ALIASES: dict[str, tuple[str, ...]] = {
    "source_page": ("source page", "sourcepage", "page"),
    "row_number": ("number", "no", "item", "itemnumber", "rownumber"),
    "location": ("location",),
    "symbol_text": ("symbol text", "symboltext", "symbol", "mark", "cableno",
                    "cablenumber", "cablelabel", "wirelabel", "wire label"),
    "description": ("description", "designation"),
    "part_number": ("part number", "partnumber", "type", "cabletype"),
    "quantity": ("quantity", "qty"),
}


def _norm_key(s: str) -> str:
    return "".join(str(s).lower().split()).replace("_", "").replace("-", "")


def _typed_columns(row: dict[str, Any]) -> dict[str, Any]:
    """Best-effort map of a field-keyed row onto the typed columns."""
    norm = {_norm_key(k): v for k, v in row.items()}
    out: dict[str, Any] = {}
    for col, aliases in _TYPED_ALIASES.items():
        for a in aliases:
            v = norm.get(_norm_key(a))
            if v is not None and str(v).strip() != "":
                out[col] = v
                break
    return out


def _kind_for(document_id: str) -> str:
    """One stable extraction_kind per document — the draft is keyed by the
    document, not by a lane the user has to pick."""
    return f"extract:{document_id}"


# --- THE REAL TABLE ---------------------------------------------------------
# Shane's ruling 2026-07-19: "every table that is supposed to be a table needs
# to be a damn table." This store used to keep every extraction's rows ONLY as
# JSONB in document_extraction_rows while describing itself as a table — the
# claim was false, and it misled both Shane and Arc into reasoning about
# Postgres tables that did not exist.
#
# Now: set_schema CREATEs (and ALTERs/renames) an actual Postgres table,
# write_rows refills it in the SAME transaction as the JSONB write, and
# delete_draft drops it. The JSONB rows remain the write buffer this stage;
# the real table is rebuilt from them on every write, so the two can never
# diverge. (Stage 2 makes the table authoritative and retires the JSONB path.)
#
# Every column is text ON PURPOSE: the faithfulness law ("represent the exact
# print") means a column typed 'number' may legitimately hold "1A", a range,
# or a blank. Typing it integer would fail the insert or mangle the print.
_SYS_ROW_INDEX = "row_index"
_SYS_SOURCE_PAGE = "source_page"
_TABLE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


def valid_table_name(name: str) -> bool:
    """A table name must be a bare SQL identifier. Anything else is REFUSED
    loudly rather than skipped silently — silently not creating the table is
    the exact failure this whole change exists to kill."""
    return bool(_TABLE_NAME_RE.match(str(name or "").strip()))


async def _table_exists(conn, table_name: str) -> bool:
    cur = await conn.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = %s", (table_name,))
    return await cur.fetchone() is not None


async def _table_columns(conn, table_name: str) -> list[str]:
    cur = await conn.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s "
        "ORDER BY ordinal_position", (table_name,))
    return [r[0] for r in await cur.fetchall()]


async def ensure_table(conn, table_name: str, columns: list[str]) -> None:
    """Create the extraction's real table, or ALTER it to carry newly designed
    columns. Never drops a column: a column removed from the design keeps its
    data until the table is rebuilt — data loss is never a side effect."""
    if not valid_table_name(table_name):
        return
    sys_cols = [c for c in (_SYS_ROW_INDEX, _SYS_SOURCE_PAGE) if c not in columns]
    if not await _table_exists(conn, table_name):
        defs = []
        for c in sys_cols:
            # row_index is the PRIMARY KEY, and it is not optional: this
            # database runs a puballtables publication that publishes DELETEs
            # ('inngest'), so a table with no replica identity cannot have rows
            # deleted at all — resync would fail on every write after the first.
            pk = " PRIMARY KEY" if c == _SYS_ROW_INDEX else ""
            defs.append(_sql.SQL("{} integer" + pk).format(_sql.Identifier(c)))
        defs += [_sql.SQL("{} text").format(_sql.Identifier(c)) for c in columns]
        if not defs:
            return
        await conn.execute(_sql.SQL("CREATE TABLE {} ({})").format(
            _sql.Identifier(table_name), _sql.SQL(", ").join(defs)))
        logger.info("extraction: created real table %r (%d columns)",
                    table_name, len(columns))
        return
    existing = await _table_columns(conn, table_name)
    for c in sys_cols:
        if c not in existing:
            await conn.execute(_sql.SQL("ALTER TABLE {} ADD COLUMN {} integer").format(
                _sql.Identifier(table_name), _sql.Identifier(c)))
    for c in columns:
        if c not in existing:
            await conn.execute(_sql.SQL("ALTER TABLE {} ADD COLUMN {} text").format(
                _sql.Identifier(table_name), _sql.Identifier(c)))
            logger.info("extraction: added column %r to real table %r", c, table_name)
    await _ensure_replica_identity(conn, table_name)


async def _ensure_replica_identity(conn, table_name: str) -> None:
    """A pre-existing table may predate the primary key (or have been made by
    hand). Give it one so DELETEs are legal under the publication; fall back to
    REPLICA IDENTITY FULL if row_index can't carry a key."""
    cur = await conn.execute(
        "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relname = %s AND i.indisprimary",
        (table_name,))
    if await cur.fetchone() is not None:
        return
    tbl = _sql.Identifier(table_name)
    if _SYS_ROW_INDEX in await _table_columns(conn, table_name):
        try:
            await conn.execute(_sql.SQL("ALTER TABLE {} ADD PRIMARY KEY ({})").format(
                tbl, _sql.Identifier(_SYS_ROW_INDEX)))
            logger.info("extraction: added primary key to %r", table_name)
            return
        except Exception:
            logger.warning("extraction: primary key on %r failed; using REPLICA "
                           "IDENTITY FULL", table_name, exc_info=True)
    await conn.execute(_sql.SQL("ALTER TABLE {} REPLICA IDENTITY FULL").format(tbl))


async def assert_claimable(conn, table_name: str, extraction_id) -> None:
    """The OWNERSHIP GUARD (adversarial review 2026-07-20, critical): an
    extraction may only materialize into a table it owns. Without this,
    naming an extraction 'downtime_records' (or 'schema_relations') would
    ALTER the live platform table and DELETE-refill it from extraction
    rows — the resync's honesty becomes a weapon. Raises ValueError when:
    - the name is on the protected denylist (platform internals + the Data
      Map's curated sources), regardless of anything else; or
    - the table already exists but is claimed by a DIFFERENT extraction's
      metadata (a name collision must never wipe a sibling's table); or
    - the table exists and NO extraction claims it (a foreign table —
      pre-existing platform data is never claimable).
    A brand-new name unclaimed by any other extraction is fine."""
    from src.data_sources import PROTECTED_TABLES

    name = str(table_name or "").strip()
    if not name:
        return
    if name in PROTECTED_TABLES:
        raise ValueError(
            f"table name {name!r} is a protected platform table — an "
            "extraction can never claim it; pick another name")
    cur = await conn.execute(
        "SELECT extraction_id FROM document_extractions "
        "WHERE metadata->>'table_name' = %s AND extraction_id != %s LIMIT 1",
        (name, extraction_id))
    other = await cur.fetchone()
    if other is not None:
        raise ValueError(
            f"table name {name!r} already belongs to another extraction — "
            "table names are global; pick another name")
    if other is None and await _table_exists(conn, name):
        cur = await conn.execute(
            "SELECT 1 FROM document_extractions "
            "WHERE metadata->>'table_name' = %s AND extraction_id = %s",
            (name, extraction_id))
        if await cur.fetchone() is None:
            raise ValueError(
                f"table {name!r} already exists and is not this extraction's "
                "— pre-existing platform data is never claimable")


async def rename_table(conn, old: str, new: str) -> None:
    """Follow a table_name change so the real table keeps the card's name."""
    if old == new or not valid_table_name(old) or not valid_table_name(new):
        return
    if await _table_exists(conn, old) and not await _table_exists(conn, new):
        await conn.execute(_sql.SQL("ALTER TABLE {} RENAME TO {}").format(
            _sql.Identifier(old), _sql.Identifier(new)))
        logger.info("extraction: renamed real table %r -> %r", old, new)


async def resync_from_extraction(conn, extraction_id) -> int | None:
    """Refill an extraction's real table from its rows, resolving the name and
    columns from the extraction itself. Every path that mutates
    document_extraction_rows MUST call this in its own transaction — the grid's
    add/edit/delete row routes bypassed the table entirely at first, which would
    have let it drift silently (the exact failure this change exists to end)."""
    cur = await conn.execute(
        "SELECT metadata->>'table_name', metadata->'columns', fieldnames "
        "FROM document_extractions WHERE extraction_id = %s", (extraction_id,))
    row = await cur.fetchone()
    if row is None:
        return None
    table_name = (row[0] or "").strip()
    names = [c.get("name") for c in (row[1] or []) if c.get("name")] or list(row[2] or [])
    if not table_name or not names:
        return None
    return await resync_table(conn, extraction_id, table_name, names)


async def resync_table(conn, extraction_id, table_name: str,
                       columns: list[str]) -> int:
    """Rebuild the real table from this extraction's rows, in the caller's
    transaction. Rebuilding wholesale (rather than mirroring each write mode)
    means append / replace_page / replace_all all land correctly and the table
    can never drift from its source. Extraction tables are small (the largest
    is ~1.8k rows), so the rewrite is cheap. Returns rows written."""
    if not valid_table_name(table_name) or not columns:
        return 0
    # ownership guard at the chokepoint: every resync path (set_schema,
    # write_rows, the grid's row routes) flows through here
    await assert_claimable(conn, table_name, extraction_id)
    await ensure_table(conn, table_name, columns)
    tbl = _sql.Identifier(table_name)
    sys_cols = [c for c in (_SYS_ROW_INDEX, _SYS_SOURCE_PAGE) if c not in columns]
    await conn.execute(_sql.SQL("DELETE FROM {}").format(tbl))
    target = [_sql.Identifier(c) for c in sys_cols] + [_sql.Identifier(c) for c in columns]
    src = [_sql.Identifier(c) for c in sys_cols] + [
        _sql.SQL("row_data->>{}").format(_sql.Literal(c)) for c in columns]
    await conn.execute(
        _sql.SQL("INSERT INTO {} ({}) SELECT {} FROM document_extraction_rows "
                 "WHERE extraction_id = %s ORDER BY row_index").format(
            tbl, _sql.SQL(", ").join(target), _sql.SQL(", ").join(src)),
        (extraction_id,))
    cur = await conn.execute(_sql.SQL("SELECT count(*) FROM {}").format(tbl))
    return int((await cur.fetchone())[0])


async def _draft_id(conn, project_id, document_id: str,
                    table_name: str = "") -> str | None:
    """The extraction for a document's ONE named table. A document may carry
    more than one table (one per counted printed grain — cables vs conductors);
    each is keyed by (document_id, table_name). table_name '' matches a
    not-yet-named table.

    Deliberately NOT filtered by status: verification is PER PAGE (see
    verify_page), so a table that already has verified pages must keep
    accepting the next one. Filtering on status='draft' here made a verified
    table invisible to the next write, which then forked a sibling table with
    the same name — page 4 banked in one extraction, page 5 minted into
    another (2026-07-16)."""
    cur = await conn.execute(
        "SELECT extraction_id FROM document_extractions "
        "WHERE project_id = %s "
        "AND metadata->>'document_id' = %s "
        "AND COALESCE(metadata->>'table_name','') = %s "
        "ORDER BY created_at ASC LIMIT 1",
        (project_id, document_id, table_name or ""))
    row = await cur.fetchone()
    return str(row[0]) if row else None


async def get_or_create_draft(project_id, document_id: str, table_name: str = "",
                              source_pdf_path: str = "") -> dict[str, Any]:
    """Get-or-create the draft for (document, table_name); created empty (no
    columns) if absent. A new table_name mints a new table for the document."""
    pool = await get_pool()
    async with pool.connection() as conn:
        eid = await _draft_id(conn, project_id, document_id, table_name)
        if eid is None:
            meta = {"status": "draft", "document_id": document_id,
                    "table_name": table_name or "", "columns": [],
                    "pipeline": "collaborative-arc"}
            cur = await conn.execute(
                "INSERT INTO document_extractions (project_id, extraction_kind, "
                "source_pdf_path, output_contract, row_count, fieldnames, metadata) "
                "VALUES (%s,%s,%s,'expanded',0,'[]'::jsonb,%s::jsonb) "
                "RETURNING extraction_id",
                (project_id, _kind_for(document_id), source_pdf_path or "", json.dumps(meta)))
            eid = str((await cur.fetchone())[0])
            await conn.commit()
        return await _draft_summary(conn, eid)


async def list_drafts(project_id, document_id: str) -> list[dict[str, Any]]:
    """All of a document's extraction tables (0..N), in creation order — the
    panel lays them out left-to-right and scrolls horizontally.

    Not filtered by status: verification is per page, so a table with banked
    pages is still the live table and must stay in the panel."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT extraction_id FROM document_extractions "
            "WHERE project_id = %s "
            "AND metadata->>'document_id' = %s "
            "ORDER BY created_at ASC",
            (project_id, document_id))
        ids = [str(r[0]) for r in await cur.fetchall()]
        return [await _draft_summary(conn, eid) for eid in ids]


async def delete_draft(project_id, extraction_id) -> bool:
    """Remove a draft table and its rows entirely. Drafts only — under the
    dynamic-verification ruling (2026-07-16) status='certified' IS the seal,
    so the raw-status filter below is the whole guard (the old derived-status
    check died with the per-page verify machinery; its dangling call crashed
    every delete with a NameError, fixed 2026-07-17)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT metadata FROM document_extractions "
            "WHERE extraction_id = %s AND project_id = %s "
            "AND metadata->>'status' = 'draft'", (extraction_id, project_id))
        row = await cur.fetchone()
        if row is None:
            return False
        # The real table goes with the draft — otherwise deleting a draft would
        # leave an orphan table that nothing owns and nothing updates. The
        # protected denylist holds even here: a poisoned metadata name must
        # never DROP a platform table (ownership guard, review 2026-07-20).
        from src.data_sources import PROTECTED_TABLES
        real_name = ((row[0] or {}).get("table_name") or "").strip()
        if real_name and valid_table_name(real_name) and real_name not in PROTECTED_TABLES:
            await conn.execute(
                _sql.SQL("DROP TABLE IF EXISTS {}").format(_sql.Identifier(real_name)))
            logger.info("extraction: dropped real table %r with its draft", real_name)
        await conn.execute("DELETE FROM document_extraction_rows WHERE extraction_id = %s",
                           (extraction_id,))
        await conn.execute("DELETE FROM document_extractions WHERE extraction_id = %s "
                           "AND project_id = %s", (extraction_id, project_id))
        await conn.commit()
        return True


# Verification model (Shane's ruling, 2026-07-16): the SYSTEM does not dictate
# the verification protocol. How a document gets verified — per page, per
# section, whole-table — is agreed between Shane and Arc AT EXTRACTION TIME,
# dynamically, per document. The data records only the outcome: a table is a
# 'draft' until Shane CERTIFIES it (status='certified'), at which point it is
# sealed read-only. The earlier per-page verify machinery (verified_pages as
# the certification record) was removed by this ruling; any leftover
# verified_pages metadata on old rows is inert history.


async def _draft_summary(conn, extraction_id: str) -> dict[str, Any]:
    cur = await conn.execute(
        "SELECT extraction_id, extraction_kind, row_count, fieldnames, metadata, created_at "
        "FROM document_extractions WHERE extraction_id = %s", (extraction_id,))
    r = await cur.fetchone()
    meta = r[4] or {}
    return {
        "extraction_id": str(r[0]), "extraction_kind": r[1], "row_count": r[2],
        "fieldnames": r[3] or [], "metadata": meta,
        # 'verified' is the legacy value some rows carry; read it as certified.
        "status": ("certified" if meta.get("status") in ("certified", "verified")
                   else meta.get("status")),
        "table_name": meta.get("table_name") or "",
        "columns": meta.get("columns") or [],
        "document_id": meta.get("document_id"),
        "created_at": r[5].isoformat() if r[5] else None,
    }


def _clean_columns(columns: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Normalize a designed column list: unique non-empty names, typed."""
    clean: list[dict[str, str]] = []
    seen: set[str] = set()
    for c in columns or []:
        name = str((c or {}).get("name", "")).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        clean.append({
            "name": name,
            "type": str((c or {}).get("type") or "text"),
            "description": str((c or {}).get("description") or ""),
        })
    return clean


async def set_schema(project_id, extraction_id, table_name: str | None,
                     columns: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """Save the one table's schema — the columns Arc and Shane designed — plus
    its name. fieldnames stays in sync as the flat name list."""
    clean = _clean_columns(columns)
    names = [c["name"] for c in clean]
    new_name = (table_name or "").strip()
    if new_name and not valid_table_name(new_name):
        raise ValueError(
            f"table name {new_name!r} is not a valid SQL identifier — it must "
            "start with a letter/underscore and contain only letters, digits "
            "and underscores. Rename it so a real Neon table can be created.")
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT metadata->>'table_name' FROM document_extractions "
            "WHERE extraction_id = %s AND project_id = %s",
            (extraction_id, project_id))
        prior = await cur.fetchone()
        old_name = (prior[0] or "").strip() if prior else ""
        # Refuse a foreign/protected name BEFORE it lands in metadata —
        # otherwise the claim itself would fake ownership for later resyncs.
        if new_name and new_name != old_name:
            await assert_claimable(conn, new_name, extraction_id)
        cur = await conn.execute(
            "UPDATE document_extractions SET fieldnames = %s::jsonb, "
            "metadata = jsonb_set(jsonb_set(metadata, '{columns}', %s::jsonb), "
            "'{table_name}', %s::jsonb) "
            "WHERE extraction_id = %s AND project_id = %s RETURNING extraction_id",
            (json.dumps(names), json.dumps(clean), json.dumps(new_name),
             extraction_id, project_id))
        if await cur.fetchone() is None:
            return None
        # The design IS the table: follow a rename, then create/extend it and
        # refill from whatever rows already exist.
        if new_name:
            if old_name and old_name != new_name:
                await rename_table(conn, old_name, new_name)
            await resync_table(conn, extraction_id, new_name, names)
        await conn.commit()
        return await _draft_summary(conn, str(extraction_id))


async def write_rows(project_id, document_id: str, table_name: str, extraction_kind: str,
                     rows: list[dict[str, Any]], fieldnames: list[str] | None = None,
                     source_page: int | None = None, mode: str = "append",
                     source_pdf_path: str = "") -> dict[str, Any]:
    """Arc's write door. Finds the document's one draft (creates it if none),
    inserts rows keyed by column names, and extends the designed columns with
    any new keys Arc introduces (a collaborative column proposal). mode:
    'append' | 'replace_page' | 'replace_all'.

    A CERTIFIED table is sealed: writes refuse (Shane's certification described
    the rows as they are; only he unseals by setting status back to draft)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        eid = await _draft_id(conn, project_id, document_id, table_name)
        if eid is None:
            summary = await get_or_create_draft(
                project_id, document_id, table_name or "", source_pdf_path)
            eid = summary["extraction_id"]
        cur = await conn.execute(
            "SELECT metadata->>'status' FROM document_extractions WHERE extraction_id = %s", (eid,))
        srow = await cur.fetchone()
        if srow and srow[0] in ("certified", "verified"):
            return {"extraction_id": eid, "rows_written": 0, "mode": mode,
                    "refused": "this table is CERTIFIED (sealed read-only) — "
                               "Shane certified every row; ask him to unseal before writing"}
        if mode == "replace_all":
            await conn.execute("DELETE FROM document_extraction_rows WHERE extraction_id = %s", (eid,))
        elif mode == "replace_page" and source_page is not None:
            await conn.execute(
                "DELETE FROM document_extraction_rows WHERE extraction_id = %s AND source_page = %s",
                (eid, source_page))
        cur = await conn.execute(
            "SELECT COALESCE(MAX(row_index), 0) FROM document_extraction_rows WHERE extraction_id = %s",
            (eid,))
        base = (await cur.fetchone())[0]
        for i, row in enumerate(rows, start=1):
            tc = _typed_columns(row)
            page = tc.get("source_page", source_page)
            try:
                page = int(page) if page is not None and str(page).strip() != "" else None
            except (TypeError, ValueError):
                page = None
            await conn.execute(
                "INSERT INTO document_extraction_rows (extraction_id, row_index, source_page, "
                "row_number, location, symbol_text, description, part_number, quantity, row_data) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)",
                (eid, base + i, page,
                 _s(tc.get("row_number")), _s(tc.get("location")), _s(tc.get("symbol_text")),
                 _s(tc.get("description")), _s(tc.get("part_number")), _s(tc.get("quantity")),
                 json.dumps(row, ensure_ascii=False)))
        cur = await conn.execute(
            "SELECT COUNT(*) FROM document_extraction_rows WHERE extraction_id = %s", (eid,))
        total = (await cur.fetchone())[0]
        # Extend the designed columns with any new keys the batch introduced.
        cur = await conn.execute(
            "SELECT metadata FROM document_extractions WHERE extraction_id = %s", (eid,))
        meta = (await cur.fetchone())[0] or {}
        cols = list(meta.get("columns") or [])
        have = {c.get("name") for c in cols if isinstance(c, dict)}
        for row in rows:
            for k in row:
                if k not in have:
                    have.add(k)
                    cols.append({"name": k, "type": "text", "description": ""})
        names = [c["name"] for c in cols]
        await conn.execute(
            "UPDATE document_extractions SET row_count = %s, fieldnames = %s::jsonb, "
            "metadata = jsonb_set(metadata, '{columns}', %s::jsonb) WHERE extraction_id = %s",
            (total, json.dumps(names), json.dumps(cols), eid))
        # The real table is refilled in THIS transaction — the write and the
        # table can never disagree, and the platform's claim to have made a
        # table is now true rather than aspirational.
        real_name = (meta.get("table_name") or table_name or "").strip()
        table_rows = None
        if real_name and valid_table_name(real_name):
            table_rows = await resync_table(conn, eid, real_name, names)
        await conn.commit()
        return {"extraction_id": eid, "rows_written": len(rows),
                "row_count": int(total), "mode": mode,
                "table": real_name or None, "table_rows": table_rows}


def _s(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


async def verify_draft(project_id, extraction_id) -> dict[str, Any] | None:
    """CERTIFY the table — Shane's explicit act, whatever verification protocol
    he and Arc agreed on for this document (per page, per section, whole-table
    — decided at extraction time, never dictated by the system). Sets
    status='certified': the table is sealed read-only (write_rows refuses)
    until Shane unseals it (unverify_draft)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE document_extractions "
            "SET metadata = jsonb_set(jsonb_set(metadata, '{status}', '\"certified\"'), "
            "'{verified}', 'true') "
            "WHERE extraction_id = %s AND project_id = %s RETURNING extraction_id",
            (extraction_id, project_id))
        if await cur.fetchone() is None:
            return None
        # Certifying GUARANTEES the real table: "certified" and "is a table"
        # are the same statement now, not two things that can disagree.
        await resync_from_extraction(conn, extraction_id)
        await conn.commit()
        return await _draft_summary(conn, str(extraction_id))


async def adopt_table_name(project_id, extraction_id, table_name: str) -> dict[str, Any] | None:
    """Give an extraction that never had a table_name its real table — and
    allow it on a CERTIFIED extraction, because it modifies no row: the sealed
    rows are copied out verbatim and the seal is untouched.

    Legacy extractions were certified before table_name existed. Shane
    hand-verified all 618 electrical-parts rows; refusing them a table because
    of a metadata field that didn't exist back then would strand precisely the
    data that cost the most to produce. Only fills an EMPTY name — it will
    never silently rename a table someone already certified under one."""
    if not valid_table_name(table_name):
        raise ValueError(f"table name {table_name!r} is not a valid SQL identifier")
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT COALESCE(metadata->>'table_name','') FROM document_extractions "
            "WHERE extraction_id = %s AND project_id = %s", (extraction_id, project_id))
        row = await cur.fetchone()
        if row is None:
            return None
        if (row[0] or "").strip():
            raise ValueError("this extraction already has a table_name — use set_schema")
        await assert_claimable(conn, table_name, extraction_id)
        await conn.execute(
            "UPDATE document_extractions "
            "SET metadata = jsonb_set(metadata, '{table_name}', %s::jsonb) "
            "WHERE extraction_id = %s AND project_id = %s",
            (json.dumps(table_name), extraction_id, project_id))
        n = await resync_from_extraction(conn, extraction_id)
        await conn.commit()
        logger.info("extraction: adopted table name %r (%s rows)", table_name, n)
        return await _draft_summary(conn, str(extraction_id))


async def unverify_draft(project_id, extraction_id) -> dict[str, Any] | None:
    """Shane unseals a certified table — back to draft, writable again. The
    certification described the rows as they were; editing requires lifting it."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE document_extractions "
            "SET metadata = jsonb_set(jsonb_set(metadata, '{status}', '\"draft\"'), "
            "'{verified}', 'false') "
            "WHERE extraction_id = %s AND project_id = %s RETURNING extraction_id",
            (extraction_id, project_id))
        if await cur.fetchone() is None:
            return None
        await conn.commit()
        return await _draft_summary(conn, str(extraction_id))


async def compare_draft(project_id, extraction_id) -> dict[str, Any]:
    """Per-column DISTINCT overlap of the draft vs the most recent non-draft
    extraction OF THE SAME DOCUMENT. Honest coverage, never a gate."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT metadata->>'document_id', metadata->>'table_name' "
            "FROM document_extractions WHERE extraction_id = %s AND project_id = %s",
            (extraction_id, project_id))
        row = await cur.fetchone()
        if row is None:
            return {"compared": False, "reason": "draft not found"}
        doc_id, table = row[0], row[1]
        cur = await conn.execute(
            "SELECT extraction_id, row_count, metadata->>'verified' FROM document_extractions "
            "WHERE project_id = %s AND metadata->>'document_id' = %s AND extraction_id <> %s "
            "AND COALESCE(metadata->>'table_name','') = %s "
            "AND COALESCE(metadata->>'status','') <> 'draft' "
            # COALESCE→false so an unverified interim (NULL) never outranks a
            # verified pass under DESC's NULLS-FIRST default.
            "ORDER BY COALESCE((metadata->>'verified' = 'true'), false) DESC, "
            "created_at DESC LIMIT 1",
            (project_id, doc_id, extraction_id, table or ""))
        other = await cur.fetchone()
        draft_rows = await _row_data(conn, extraction_id)
        if other is None:
            return {"compared": False, "reason": "no earlier extraction of this document",
                    "draft_rows": len(draft_rows), "table": table}
        other_id = str(other[0])
        other_rows = await _row_data(conn, other_id)
    # Column-wise DISTINCT overlap, aligned on NORMALIZED field keys.
    d_norm = [{_norm_key(k): v for k, v in r.items()} for r in draft_rows]
    o_norm = [{_norm_key(k): v for k, v in r.items()} for r in other_rows]
    label_for: dict[str, str] = {}
    for r in draft_rows:
        for k in r:
            label_for.setdefault(_norm_key(k), k)
    for r in other_rows:
        for k in r:
            label_for.setdefault(_norm_key(k), k)
    shared = sorted({k for r in d_norm for k in r} & {k for r in o_norm for k in r})
    columns = []
    for nk in shared:
        dvals = {_norm_val(r.get(nk)) for r in d_norm if _norm_val(r.get(nk))}
        ovals = {_norm_val(r.get(nk)) for r in o_norm if _norm_val(r.get(nk))}
        if not dvals and not ovals:
            continue
        inter = dvals & ovals
        columns.append({
            "field": label_for.get(nk, nk),
            "draft_distinct": len(dvals), "other_distinct": len(ovals),
            "overlap": len(inter),
            "only_in_draft": sorted(list(dvals - ovals))[:8],
            "only_in_other": sorted(list(ovals - dvals))[:8],
        })
    return {
        "compared": True, "other_extraction_id": other_id,
        "other_verified": other[2] == "true", "draft_rows": len(draft_rows),
        "other_rows": len(other_rows), "columns": columns,
    }


async def _row_data(conn, extraction_id) -> list[dict[str, Any]]:
    cur = await conn.execute(
        "SELECT row_data FROM document_extraction_rows WHERE extraction_id = %s "
        "ORDER BY row_index", (extraction_id,))
    return [r[0] or {} for r in await cur.fetchall()]


def _norm_val(v: Any) -> str:
    if v is None:
        return ""
    return "".join(str(v).split()).upper()
