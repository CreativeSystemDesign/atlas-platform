"""Data Map seat tools — Arc as the describer-seat AI (phase 2, 2026-07-20).

The trust model at this seat (Shane's ruling lineage: proposals are
proposals): Arc PROPOSES join contracts with survey evidence — dashed amber
edges on Shane's board — and Shane rules. Arc never draws, accepts, or
dismisses a ruled contract. Cards derive live from real tables, so there is
no schema to write; the writes here are board placement + proposals only,
all SEAT-SCOPED to data-map via the _SEAT_EXCLUSIVE pattern.

Tools:
- data_map_overview  (read)  — boards, the board's cards + contracts + badges
- data_map_survey    (read)  — ad-hoc match survey: evidence BEFORE proposing
- data_map_place_card (write) — place/move/remove/describe a card
- data_map_propose   (write) — create/withdraw an Arc proposal (never draw)
- data_map_bench     (show)  — drive Shane's Proving Bench (picks/clear/toast)
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from claude_agent_sdk import tool
from fastapi import HTTPException
from pydantic import ValidationError

from src import relations_data
from src.canvas_copilot.extraction_tools import require_seat
from src.persistence.database import get_pool
from src.routes import data_map as data_map_routes
from src.routes.relations import _COLS as _REL_COLS
from src.routes.relations import _annotate_backed, _resolve_board, _row as _rel_row


def _text(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text",
                         "text": json.dumps(payload, ensure_ascii=False)}]}


def _seat_ctx() -> dict[str, Any]:
    from src.canvas_copilot.copilot import copilot_session
    return getattr(copilot_session, "_area_context", {}) or {}


async def _broadcast_map(command: dict[str, Any], board: str) -> int:
    """Send a board-stamped command down the shared bench_command channel.
    board_id scoping (review 2026-07-20): a second Data Map tab on another
    board must ignore it, and the extraction viewer ignores anything
    carrying board_id. Returns sockets reached after pruning."""
    from src.canvas_copilot.copilot import copilot_session
    if len(copilot_session._sockets) == 0:
        return 0
    await copilot_session._broadcast(
        {"kind": "bench_command", "command": {**command, "board_id": board}})
    return len(copilot_session._sockets)


async def _resolve_seat_board(args: dict[str, Any]) -> tuple[uuid.UUID, str] | str:
    """(project_id, board_id) from args or the live seat context."""
    ctx = _seat_ctx()
    project_id = str(args.get("project_id") or ctx.get("project_id") or "").strip()
    board_id = str(args.get("board_id") or ctx.get("board_id") or "").strip() or None
    if not project_id:
        return "no project in seat context — is the Data Map open?"
    try:
        board = await _resolve_board(uuid.UUID(project_id), board_id)
    except HTTPException as exc:
        return f"board resolution failed: {exc.detail}"
    except ValueError:
        return f"invalid project id {project_id!r}"
    return uuid.UUID(project_id), board


@tool(
    name="data_map_overview",
    description=(
        "Data Map: the board's world in one read — every card (real table: "
        "kind, live row count, certified/draft status, columns) and every "
        "contract (endpoints, semantics, status, survey badge k/N, basis). "
        "Call FIRST when seated at the Data Map. The archived pre-remodel "
        "contract layer (14 Shane-drawn contracts with his notes) lives in "
        "neon_archived/card_layer_pre_datamap__schema_relations__*.json — "
        "read it with Read when re-proposing old law against new cards."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "board_id": {"type": "string",
                         "description": "defaults to the board open in the seat"},
        },
        "additionalProperties": False,
    },
)
async def data_map_overview(args: dict[str, Any]) -> dict[str, Any]:
    resolved = await _resolve_seat_board(args)
    if isinstance(resolved, str):
        return _text({"ok": False, "note": resolved})
    project_id, board = resolved
    cards = await data_map_routes.list_cards(project_id, uuid.UUID(board))
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            f"SELECT {_REL_COLS} FROM schema_relations "
            "WHERE project_id = %s AND board_id = %s ORDER BY created_at",
            (project_id, board))
        rels = [_rel_row(r) for r in await cur.fetchall()]
        await _annotate_backed(conn, rels)
    slim_cards = [
        {k: c.get(k) for k in ("table_name", "kind", "status", "row_count",
                               "columns", "provenance", "missing", "x", "y")}
        for c in cards["cards"]]
    slim_rels = [
        {k: r.get(k) for k in ("relation_id", "from_table", "from_field",
                               "to_table", "to_field", "semantics", "status",
                               "origin", "basis", "match_num", "match_den",
                               "from_bound", "to_bound")}
        for r in rels]
    return _text({"ok": True, "board_id": board,
                  "cards": slim_cards, "contracts": slim_rels})


@tool(
    name="data_map_survey",
    description=(
        "Data Map: ad-hoc match survey — measure a candidate join BEFORE "
        "proposing it. Runs the DISTINCT-overlap survey (same engine as the "
        "badge and the Proving Bench: atlas_trim/atlas_norm/atlas_tokens_norm) "
        "over the FULL live tables. semantics: exact (trimmed equality) | "
        "vocabulary (normalized: (PP)=PP=ＰＰ) | membership (token overlap: "
        "'F10, F11, F12'). Returns matched/total distinct from-side values. "
        "Nothing is created — evidence only."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "from_table": {"type": "string"}, "from_field": {"type": "string"},
            "to_table": {"type": "string"}, "to_field": {"type": "string"},
            "semantics": {"type": "string",
                          "enum": ["exact", "membership", "vocabulary"]},
        },
        "required": ["from_table", "from_field", "to_table", "to_field", "semantics"],
        "additionalProperties": False,
    },
)
async def data_map_survey(args: dict[str, Any]) -> dict[str, Any]:
    ctx = _seat_ctx()
    project_id = str(ctx.get("project_id") or "").strip()
    if not project_id:
        return _text({"ok": False, "note": "no project in seat context"})
    res = await relations_data.survey(
        {"from_table": str(args["from_table"]), "from_field": str(args["from_field"]),
         "to_table": str(args["to_table"]), "to_field": str(args["to_field"]),
         "semantics": str(args["semantics"])}, project_id)
    if res["surveyed"]:
        note = "surveyed live, full tables, no sampling"
    elif res.get("unbacked_side"):
        note = "unbacked — that table/column doesn't exist live"
    else:
        # honesty over optimism: a timeout/SQL failure is NOT evidence
        note = ("survey FAILED (timeout or SQL error) — not evidence; retry, "
                "or pick a narrower column")
    return _text({"ok": bool(res["surveyed"]) or bool(res.get("unbacked_side")),
                  **res, "note": note})


@tool(
    name="data_map_place_card",
    description=(
        "Data Map seat ONLY: act on the board's CARDS. Actions: place "
        "{table_name, x?, y?} (a real table/view onto the board) · move "
        "{table_name, x, y} · remove {table_name} (placement only — the "
        "table is untouched) · describe {table_name, description?, "
        "provenance?} (the curated prose overlay — the ONLY stored card "
        "content; columns/rows/status always derive live). Propose board "
        "changes in chat first; keep the board Shane's room."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {"type": "string",
                       "enum": ["place", "move", "remove", "describe"]},
            "table_name": {"type": "string"},
            "x": {"type": "number"}, "y": {"type": "number"},
            "description": {"type": "string", "maxLength": 2000},
            "provenance": {"type": "string", "maxLength": 1000},
            "board_id": {"type": "string"},
        },
        "required": ["action", "table_name"],
        "additionalProperties": False,
    },
)
async def data_map_place_card(args: dict[str, Any]) -> dict[str, Any]:
    denial = require_seat("data_map_place_card")
    if denial:
        return _text({"ok": False, "note": denial})
    resolved = await _resolve_seat_board(args)
    if isinstance(resolved, str):
        return _text({"ok": False, "note": resolved})
    project_id, board = resolved
    action = str(args["action"])
    name = str(args["table_name"]).strip()
    try:
        if action == "place":
            # explicit None checks — 0 is a legitimate coordinate, `or` eats it
            await data_map_routes.add_card(project_id, data_map_routes.CardCreate(
                board_id=board, table_name=name,
                x=float(args["x"]) if args.get("x") is not None else 60.0,
                y=float(args["y"]) if args.get("y") is not None else 60.0))
        elif action == "move":
            if args.get("x") is None or args.get("y") is None:
                return _text({"ok": False, "note": "move needs x and y"})
            await data_map_routes.patch_card(project_id, name, data_map_routes.CardPatch(
                board_id=board, x=float(args["x"]), y=float(args["y"])))
        elif action == "remove":
            await data_map_routes.remove_card(project_id, name, uuid.UUID(board))
        else:  # describe
            await data_map_routes.patch_card(project_id, name, data_map_routes.CardPatch(
                board_id=board,
                description=(str(args["description"]) if args.get("description") is not None else None),
                provenance=(str(args["provenance"]) if args.get("provenance") is not None else None)))
    except HTTPException as exc:
        return _text({"ok": False, "note": f"{action} refused: {exc.detail}"})
    except ValidationError as exc:
        return _text({"ok": False, "note": f"{action} refused: {exc.errors()[0].get('msg', 'invalid input')}"})
    # nudge the open board to refetch — without this the write is invisible
    # until a manual reload (review 2026-07-20)
    reached = await _broadcast_map({"action": "map_refresh"}, board)
    return _text({"ok": True, "action": action, "table_name": name,
                  "note": ("board refreshed on screen" if reached
                           else "saved — no Data Map panel open to refresh")})


@tool(
    name="data_map_propose",
    description=(
        "Data Map seat ONLY: PROPOSE a join contract — a dashed amber edge "
        "awaiting Shane's ruling. You NEVER draw, accept, or dismiss "
        "contracts; ruling is Shane's alone. Survey FIRST (data_map_survey) "
        "and propose only what the evidence supports; basis carries the WHY "
        "(cite the survey k/N + the doctrinal ground, e.g. the archived "
        "contract it re-proposes). The proposal is auto-surveyed on creation "
        "so its badge is live immediately. Action withdraw {relation_id} "
        "deletes YOUR OWN still-proposed row only."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["propose", "withdraw"],
                       "description": "default propose"},
            "from_table": {"type": "string"}, "from_field": {"type": "string"},
            "to_table": {"type": "string"}, "to_field": {"type": "string"},
            "semantics": {"type": "string",
                          "enum": ["exact", "membership", "vocabulary"]},
            "basis": {"type": "string", "maxLength": 600,
                      "description": "the why — survey evidence + doctrine"},
            "relation_id": {"type": "string", "description": "withdraw only"},
            "board_id": {"type": "string"},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
)
async def data_map_propose(args: dict[str, Any]) -> dict[str, Any]:
    denial = require_seat("data_map_propose")
    if denial:
        return _text({"ok": False, "note": denial})
    resolved = await _resolve_seat_board(args)
    if isinstance(resolved, str):
        return _text({"ok": False, "note": resolved})
    project_id, board = resolved
    action = str(args.get("action") or "propose")
    pool = await get_pool()

    if action == "withdraw":
        rid = str(args.get("relation_id") or "").strip()
        if not rid:
            return _text({"ok": False, "note": "withdraw needs relation_id"})
        try:
            uuid.UUID(rid)
        except ValueError:
            return _text({"ok": False,
                          "note": f"{rid!r} is not a relation id — pass the "
                                  "relation_id from data_map_overview"})
        async with pool.connection() as conn:
            cur = await conn.execute(
                "DELETE FROM schema_relations WHERE relation_id = %s "
                "AND project_id = %s AND origin = 'arc' AND status = 'proposed' "
                "RETURNING relation_id", (rid, project_id))
            gone = await cur.fetchone()
            await conn.commit()
        if gone is None:
            return _text({"ok": False,
                          "note": "not withdrawn — only YOUR OWN still-proposed "
                                  "contracts can be withdrawn (ruled/dismissed "
                                  "rows are Shane's)"})
        await _broadcast_map({"action": "map_refresh"}, board)
        return _text({"ok": True, "withdrawn": rid})

    needed = ("from_table", "from_field", "to_table", "to_field", "semantics")
    missing = [k for k in needed if not str(args.get(k) or "").strip()]
    if missing:
        return _text({"ok": False, "note": f"propose needs {', '.join(missing)}"})
    if not str(args.get("basis") or "").strip():
        return _text({"ok": False,
                      "note": "propose needs a basis — the why, with survey "
                              "evidence (run data_map_survey first)"})
    ft, ff = str(args["from_table"]).strip(), str(args["from_field"]).strip()
    tt, tf = str(args["to_table"]).strip(), str(args["to_field"]).strip()
    if (ft, ff) == (tt, tf):
        return _text({"ok": False, "note": "a column cannot join itself"})
    async with pool.connection() as conn:
        cur = await conn.execute(
            "INSERT INTO schema_relations (project_id, board_id, from_document_id, "
            "from_table, from_field, to_document_id, to_table, to_field, semantics, "
            "status, origin, basis) "
            "VALUES (%s,%s,'',%s,%s,'',%s,%s,%s,'proposed','arc',%s) "
            "ON CONFLICT (board_id, from_document_id, from_table, from_field, "
            "to_document_id, to_table, to_field) DO NOTHING RETURNING relation_id",
            (project_id, board, ft, ff, tt, tf, str(args["semantics"]),
             str(args["basis"]).strip()))
        row = await cur.fetchone()
        await conn.commit()
    if row is None:
        return _text({"ok": False,
                      "note": "a contract with these endpoints already exists "
                              "on this board (any status) — check "
                              "data_map_overview"})
    rid = str(row[0])
    res = await relations_data.survey(
        {"from_table": ft, "from_field": ff, "to_table": tt, "to_field": tf,
         "semantics": str(args["semantics"])}, str(project_id))
    async with pool.connection() as conn:
        if res["surveyed"]:
            await conn.execute(
                "UPDATE schema_relations SET match_num = %s, match_den = %s, "
                "matched_at = now(), updated_at = now() WHERE relation_id = %s",
                (res["num"], res["den"], rid))
            await conn.commit()
    reached = await _broadcast_map({"action": "map_refresh"}, board)
    return _text({"ok": True, "relation_id": rid, "status": "proposed",
                  "survey": {"num": res.get("num"), "den": res.get("den"),
                             "surveyed": res.get("surveyed")},
                  "note": "dashed amber on Shane's board — his ruling decides"
                          + ("" if reached else " (no panel open to refresh)")})


@tool(
    name="data_map_bench",
    description=(
        "Data Map seat ONLY: drive SHANE'S PROVING BENCH — show, don't "
        "describe. Actions: bench_pick {columns: [{table, column}...]} "
        "(REPLACES the bench picks — the stitched result renders on his "
        "screen; pick the evidence columns for the seam you're discussing) · "
        "bench_clear · toast {text} (brief notice). Use bench_pick when "
        "citing join evidence: put the two key columns on the bench so Shane "
        "SEES the stitch (or the blanks) instead of reading numbers."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {"type": "string",
                       "enum": ["bench_pick", "bench_clear", "toast"]},
            "columns": {
                "type": "array", "maxItems": 24,
                "items": {
                    "type": "object",
                    "properties": {"table": {"type": "string"},
                                   "column": {"type": "string"}},
                    "required": ["table", "column"],
                },
            },
            "text": {"type": "string", "maxLength": 200},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
)
async def data_map_bench(args: dict[str, Any]) -> dict[str, Any]:
    denial = require_seat("data_map_bench")
    if denial:
        return _text({"ok": False, "note": denial})
    resolved = await _resolve_seat_board(args)
    if isinstance(resolved, str):
        return _text({"ok": False, "note": resolved})
    _project_id, board = resolved
    action = str(args["action"])
    cmd: dict[str, Any] = {"action": action}
    if action == "bench_pick":
        cols = args.get("columns")
        if not isinstance(cols, list) or not cols:
            return _text({"ok": False, "note": "bench_pick needs columns"})
        # dedupe — duplicate picks would collide as React keys on the bench
        seen: set[tuple[str, str]] = set()
        out: list[dict[str, str]] = []
        for c in cols:
            if not isinstance(c, dict):
                continue
            key = (str(c.get("table")), str(c.get("column")))
            if key in seen:
                continue
            seen.add(key)
            out.append({"table": key[0], "column": key[1]})
        cmd["columns"] = out[:24]
    elif action == "toast":
        if not str(args.get("text") or "").strip():
            return _text({"ok": False, "note": "toast needs text"})
        cmd["text"] = str(args["text"]).strip()[:200]
    reached = await _broadcast_map(cmd, board)
    if reached == 0:
        return _text({"ok": False, "note": "no Data Map panel connected — nothing rendered"})
    return _text({"ok": True, "action": action, "delivered_to_sockets": reached,
                  "note": "lands only on the Data Map showing this board"})
