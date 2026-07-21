"""Data Map relations engine — generic match surveys over real tables.

The board's law (vault: Schema Builder and Relations, remodeled 2026-07-20):
a drawn edge is a JOIN CONTRACT between columns of REAL Postgres tables or
views, and every contract gets tested against live data the moment it's
drawn — the match badge (k/N). Cards derive from the catalog, so the survey
does too: any (table, column) that exists in public is surveyable, scoped
by project_id wherever the relation's table carries that column. No static
bindings, no seeded proposals — Arc proposes live from its Data Map seat
(phase 2); the pre-remodel curated layer is archived in neon_archived/.

The normalization here (_norm/_tokens) is mirrored in SQL as atlas_norm /
atlas_tokens_norm (persistence DDL) — one matching engine for the survey,
the Proving Bench stitch, and the future twin compiler. Keep them identical.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from psycopg import sql as pgsql

from src.persistence.database import get_pool

logger = logging.getLogger(__name__)

# --- catalog ----------------------------------------------------------------


async def table_columns(conn, table: str) -> list[str] | None:
    """Ordered column names for a public table/view, or None if absent."""
    cur = await conn.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s "
        "ORDER BY ordinal_position", (table,))
    cols = [r[0] for r in await cur.fetchall()]
    return cols or None


def _norm_field(s: str) -> str:
    """Field-name key that survives a rename: 'Symbol Text', 'SymbolText',
    and 'symbol_text' all collapse to the same thing (Shane, 2026-07-18).
    Used by /peek to resolve a drifted field against extraction row keys."""
    return re.sub(r"[\s_]+", "", str(s)).lower()


# --- matching ---------------------------------------------------------------

_FW = str.maketrans(
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９－",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")


def _norm(v: str) -> str:
    """Vocabulary-grade normalization: full-width -> ASCII, upper, strip
    parens/whitespace — '(PP)' and 'PP' and '（ＰＰ）' all meet.
    SQL twin: atlas_norm (persistence DDL). Keep behavior identical."""
    s = str(v).translate(_FW).upper().strip()
    s = re.sub(r"[()（）\s]+", "", s)
    return s


def _tokens(v: str) -> list[str]:
    """Membership-grade cell split: 'F10, F11, F12' -> three tokens.
    SQL twin: atlas_tokens_norm (which also norms each token)."""
    return [t for t in re.split(r"[,、;/\s]+", str(v).strip()) if t]


def compute_match(from_values: list[str], to_values: list[str], semantics: str) -> tuple[int, int]:
    """The Python reference of the matching engine — the SQL survey below and
    the Proving Bench ON-clauses must agree with it (parity test in tests/).
    Blank guards mirror SQL: a value/token that normalizes to '' never
    matches. Return (matched, total), total = from-side DISTINCT non-blank."""
    a = {str(v).strip() for v in from_values if str(v).strip()}
    if not a:
        return (0, 0)
    if semantics == "membership":
        pool: set[str] = set()
        for cell in to_values:
            pool.update(_tokens(cell))
        pool_norm = {n for t in pool if (n := _norm(t))}
        hit = sum(1 for v in a
                  if any((n := _norm(t)) and n in pool_norm for t in _tokens(v)))
        return (hit, len(a))
    if semantics == "vocabulary":
        b = {_norm(v) for v in to_values}
        return (sum(1 for v in a if (n := _norm(v)) and n in b), len(a))
    b = {str(v).strip() for v in to_values}
    return (sum(1 for v in a if v in b), len(a))


def _side_scope(cols: list[str], alias: str) -> pgsql.Composed | pgsql.SQL:
    if "project_id" in cols:
        return pgsql.SQL(" WHERE {a}.project_id = %s").format(a=pgsql.Identifier(alias))
    return pgsql.SQL("")


async def survey(relation: dict[str, Any], project_id: str) -> dict[str, Any]:
    """Run the DISTINCT-overlap survey for one relation IN SQL, over the
    full tables (no sampling cap — the badge and the Proving Bench stitch
    read the same engine: atlas_trim/atlas_norm/atlas_tokens_norm). Scoped
    to the project wherever a side's table carries project_id. Returns
    {surveyed, num, den, unbacked_side} — unbacked sides survey to None;
    a timeout/failure surveys honestly as not-surveyed."""
    ft, ff = relation["from_table"], relation["from_field"]
    tt, tf = relation["to_table"], relation["to_field"]
    semantics = relation["semantics"]
    pool = await get_pool()
    async with pool.connection() as conn:
        fcols = await table_columns(conn, ft)
        tcols = await table_columns(conn, tt)
        if fcols is None or ff not in fcols:
            return {"surveyed": False, "num": None, "den": None, "unbacked_side": "from"}
        if tcols is None or tf not in tcols:
            return {"surveyed": False, "num": None, "den": None, "unbacked_side": "to"}

        fexpr = pgsql.SQL("{t}.{c}::text").format(t=pgsql.Identifier("f"), c=pgsql.Identifier(ff))
        texpr = pgsql.SQL("{t}.{c}::text").format(t=pgsql.Identifier("t"), c=pgsql.Identifier(tf))
        params: list[Any] = []
        fscope = _side_scope(fcols, "f")
        if "project_id" in fcols:
            params.append(project_id)
        tscope = _side_scope(tcols, "t")

        if semantics == "membership":
            # den = distinct non-blank from-values; num = those with any
            # normalized token found in the to-side token pool
            q = pgsql.SQL(
                "WITH a AS (SELECT DISTINCT atlas_trim({fe}) AS v FROM {ft} AS f{fs}), "
                "pool AS (SELECT DISTINCT tok FROM {tt} AS t{ts}, "
                "unnest(atlas_tokens_norm({te})) tok) "
                "SELECT count(*) FILTER (WHERE v <> '' AND EXISTS ("
                "SELECT 1 FROM unnest(atlas_tokens_norm(v)) x "
                "WHERE x IN (SELECT tok FROM pool))), "
                "count(*) FILTER (WHERE v <> '') FROM a"
            )
        elif semantics == "vocabulary":
            q = pgsql.SQL(
                "WITH a AS (SELECT DISTINCT atlas_trim({fe}) AS v FROM {ft} AS f{fs}), "
                "b AS (SELECT DISTINCT atlas_norm({te}) AS v FROM {tt} AS t{ts}) "
                "SELECT count(*) FILTER (WHERE v <> '' AND atlas_norm(v) <> '' "
                "AND atlas_norm(v) IN (SELECT v FROM b)), "
                "count(*) FILTER (WHERE v <> '') FROM a"
            )
        else:  # exact
            q = pgsql.SQL(
                "WITH a AS (SELECT DISTINCT atlas_trim({fe}) AS v FROM {ft} AS f{fs}), "
                "b AS (SELECT DISTINCT atlas_trim({te}) AS v FROM {tt} AS t{ts}) "
                "SELECT count(*) FILTER (WHERE v <> '' AND v IN (SELECT v FROM b)), "
                "count(*) FILTER (WHERE v <> '') FROM a"
            )
        query = q.format(fe=fexpr, te=texpr,
                         ft=pgsql.Identifier(ft), tt=pgsql.Identifier(tt),
                         fs=fscope, ts=tscope)
        if "project_id" in tcols:
            params.append(project_id)
        try:
            async with conn.transaction():
                await conn.execute("SET LOCAL transaction_read_only = on")
                await conn.execute("SET LOCAL statement_timeout = '10s'")
                cur = await conn.execute(query, params)
                num, den = await cur.fetchone()
        except Exception:
            logger.warning("survey failed for %s.%s -> %s.%s", ft, ff, tt, tf,
                           exc_info=True)
            return {"surveyed": False, "num": None, "den": None, "unbacked_side": None}
    return {"surveyed": True, "num": int(num or 0), "den": int(den or 0), "unbacked_side": None}


# --- boards -----------------------------------------------------------------


async def ensure_default_board(project_id: str) -> str:
    """First touch of a project's boards mints its default board ("Main").
    Idempotent, race-safe via the partial unique index (one default per
    project). Orphan relations always adopt Main. The pre-boards placement
    migration is gone with the remodel — placements live in data_map_cards
    now, written only by the Data Map UI/Arc. Returns the default board_id."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT board_id FROM relation_boards "
            "WHERE project_id = %s AND is_default", (project_id,))
        row = await cur.fetchone()
        if row is None:
            cur = await conn.execute(
                "INSERT INTO relation_boards (project_id, name, is_default) "
                "VALUES (%s, 'Main', true) "
                "ON CONFLICT (project_id) WHERE is_default DO NOTHING "
                "RETURNING board_id", (project_id,))
            row = await cur.fetchone()
            if row is None:  # lost a race — the winner exists now
                cur = await conn.execute(
                    "SELECT board_id FROM relation_boards "
                    "WHERE project_id = %s AND is_default", (project_id,))
                row = await cur.fetchone()
            else:
                logger.info("relations: minted default board for %s", project_id)
        board_id = row[0]
        # orphan relations (pre-boards, or any future NULL) always adopt Main
        await conn.execute(
            "UPDATE schema_relations SET board_id = %s "
            "WHERE project_id = %s AND board_id IS NULL", (board_id, project_id))
        await conn.commit()
    return str(board_id)
