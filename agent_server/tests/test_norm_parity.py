"""Parity: the Python matching engine vs its SQL twins.

The survey badge (SQL, relations_data.survey), the Proving Bench stitch
(SQL, routes/data_map._join_condition), and the documented Python reference
(relations_data._norm/_tokens/compute_match) must agree — a badge that
counts a match the bench refuses to stitch is the class of lie this remodel
exists to kill. This test runs the fixture corpus through both engines.

Needs a database (the SQL functions live there): reads DATABASE_URI from
agent_server/.env and SKIPS when absent/unreachable. Read-only — the only
SQL executed is SELECT atlas_trim/atlas_norm/atlas_tokens_norm(literal).

Known, accepted divergence (documented, not tested): German ß — Python
.upper() folds it to 'SS', Postgres upper() keeps 'ß' under C.UTF-8. The
corpus (Japanese industrial prints) contains no ß; revisit if a German
doc set ever onboards.
"""

from __future__ import annotations

import pathlib
import subprocess

import pytest

from src.relations_data import _norm, _tokens

FIXTURES = [
    # full-width letters/digits/hyphen (the the manufacturer prints' character set)
    "ＰＰ－Ｍ４０", "ｐｐ", "１２３", "ＡＢＣ-123",
    # parens both widths, the vocabulary case
    "(PP)", "（ＰＰ）", "( PP )", "()", "（）", "((PP))",
    # whitespace varieties: ASCII, tab, newline, NBSP, ideographic space
    "  PP  ", "\tPP\n", " PP ", "　PP　", "P P",
    # C0 separators Python's whitespace class eats
    "a\x1cb", "a\x1db", "a\x1eb", "a\x1fb",
    # token splits: comma, ideographic comma, semicolon, slash, mixed
    "F10, F11, F12", "F10、F11", "a;b/c", "U1 V1 W1", ", ,", "x,,y",
    # blanks and blank-normalizing cells
    "", " ", "()", "（）", "(),()",
    # real corpus shapes
    "PP-M1-P1-1", "T~CONT~R1", "5402", "SOL0802=(SOL-V1)", "MR-J3CDL05M",
]


def _dburl() -> str | None:
    env = pathlib.Path(__file__).resolve().parents[1] / ".env"
    if not env.is_file():
        return None
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URI="):
            return line.split("=", 1)[1].strip()
    return None


def _psql_rows(url: str, sql: str) -> list[str]:
    out = subprocess.run(
        ["psql", url, "-At", "-c", sql],
        capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        pytest.skip(f"database unreachable: {out.stderr.strip()[:120]}")
    return out.stdout.splitlines()


@pytest.fixture(scope="module")
def dburl() -> str:
    url = _dburl()
    if not url:
        pytest.skip("no DATABASE_URI — SQL twins unreachable")
    return url


def _quote(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def test_atlas_norm_matches_python(dburl: str) -> None:
    selects = " UNION ALL ".join(
        f"SELECT {i} AS ord, atlas_norm({_quote(v)}) AS n"
        for i, v in enumerate(FIXTURES))
    rows = _psql_rows(dburl, f"SELECT n FROM ({selects}) t ORDER BY ord")
    assert len(rows) == len(FIXTURES)
    for value, sql_norm in zip(FIXTURES, rows):
        assert sql_norm == _norm(value), (
            f"atlas_norm({value!r}) = {sql_norm!r} but Python _norm gives "
            f"{_norm(value)!r} — the badge and the bench disagree")


def test_atlas_tokens_norm_matches_python(dburl: str) -> None:
    # Python's membership pool = non-blank-normalizing tokens, normalized —
    # exactly what atlas_tokens_norm returns (order-insensitive compare;
    # the SQL array order follows split order but only SET semantics matter
    # to both the survey and the && overlap join).
    selects = " UNION ALL ".join(
        f"SELECT {i} AS ord, array_to_string(atlas_tokens_norm({_quote(v)}), chr(31)) AS n"
        for i, v in enumerate(FIXTURES))
    rows = _psql_rows(dburl, f"SELECT n FROM ({selects}) t ORDER BY ord")
    assert len(rows) == len(FIXTURES)
    for value, joined in zip(FIXTURES, rows):
        sql_tokens = set(joined.split("\x1f")) - {""}
        py_tokens = {n for t in _tokens(value) if (n := _norm(t))}
        assert sql_tokens == py_tokens, (
            f"atlas_tokens_norm({value!r}) = {sorted(sql_tokens)!r} but Python "
            f"gives {sorted(py_tokens)!r}")


def test_atlas_trim_matches_python_strip(dburl: str) -> None:
    # hex-encode: trimmed values can retain interior newlines, which would
    # break line-based psql output parsing
    selects = " UNION ALL ".join(
        f"SELECT {i} AS ord, encode(convert_to(atlas_trim({_quote(v)}), 'UTF8'), 'hex') AS n"
        for i, v in enumerate(FIXTURES))
    rows = _psql_rows(dburl, f"SELECT n FROM ({selects}) t ORDER BY ord")
    assert len(rows) == len(FIXTURES)
    for value, hexed in zip(FIXTURES, rows):
        sql_trim = bytes.fromhex(hexed).decode("utf-8")
        # Python reference for the exact-semantics key: str.strip()
        assert sql_trim == value.strip(), (
            f"atlas_trim({value!r}) = {sql_trim!r} but str.strip() gives "
            f"{value.strip()!r}")
