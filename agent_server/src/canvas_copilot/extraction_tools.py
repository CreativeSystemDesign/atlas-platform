"""Data-extraction seat tools — Arc's write doors for the collaborative
extraction workbench.

Reading is already covered by the schema_* tools (schema_page_text for the
exact printed words under a region, schema_page_view to see/crop a page),
which are available to every seat. Two WRITE capabilities live here, both
SEAT-SCOPED to data-extraction:

- document_set_schema — DESIGN the one table: name it + define its columns
  (name/type/description). The deliberate design door that lets Arc create
  the table, not just fill it.
- document_write_rows — FILL the table: append field-keyed rows to the draft.

Together they are the full loop Arc runs with Shane: name + design columns
FIRST, then extract rows. Both are Shane-gated (propose in chat, write on his
go) and confined to document_extractions — the Data Map layer derives from
the resulting real tables automatically and is never written from here.
document_bench (re-homed from the retired schema bench, 2026-07-20) drives
Shane's viewer on this seat: goto_page/mark/region/clear_marks/toast.

Per-seat tool scoping (Shane's earned generalization, 2026-07-15): the
declarative _SEAT_EXCLUSIVE map + require_seat() enforce it inside the tool
body, so it holds in EVERY permission mode (can_use_tool is skipped under
bypassPermissions — enforcement must live here, not only there). Future
seat-exclusive tools reuse this same pattern.
"""

from __future__ import annotations

import json
from typing import Any

from claude_agent_sdk import tool

from src import extraction_data
from src.persistence.database import get_pool


def _text(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text",
                         "text": json.dumps(payload, ensure_ascii=False)}]}


# tool_name (bare) -> the set of seats it may run on. Absent = every seat.
_SEAT_EXCLUSIVE: dict[str, set[str]] = {
    "document_set_schema": {"data-extraction"},
    "document_write_rows": {"data-extraction"},
    "document_bench": {"data-extraction"},
    "data_map_place_card": {"data-map"},
    "data_map_propose": {"data-map"},
    "data_map_bench": {"data-map"},
}


def require_seat(tool_name: str) -> str | None:
    """Return a denial note if the active seat may not run this tool, else
    None. Reads the live seat off the session (lazy import — copilot.py
    imports this module, so a top-level import would cycle)."""
    seats = _SEAT_EXCLUSIVE.get(tool_name)
    if seats is None:
        return None
    from src.canvas_copilot.copilot import copilot_session
    area = getattr(copilot_session, "_area", "canvas")
    if area in seats:
        return None
    return (f"{tool_name} is only available on the {'/'.join(sorted(seats))} "
            f"seat — you are on the {area} seat. It did nothing.")


async def _broadcast_bench(action: str, document_id: str, table_name: str) -> None:
    """Nudge the open workbench to repaint. action 'rows_written' reloads the
    grid rows; 'schema_written' re-fetches the draft so new columns appear."""
    from src.canvas_copilot.copilot import copilot_session
    if getattr(copilot_session, "_sockets", None):
        await copilot_session._broadcast({
            "kind": "bench_command",
            "command": {"action": action, "document_id": document_id,
                        "table_name": table_name},
        })


async def _resolve_target(args: dict[str, Any]) -> tuple[str, Any, str, str] | str:
    """Resolve (document_id, project_id, source_pdf_path, table_name) from the
    tool args + the live seat context, or return a human note string on failure.
    Both write tools default their target from the data-extraction seat, so Arc
    normally passes neither document_id nor table_name."""
    from src.canvas_copilot.copilot import copilot_session
    ctx = getattr(copilot_session, "_area_context", {}) or {}
    document_id = str(args.get("document_id") or ctx.get("document_id") or "").strip()
    table_name = str(args.get("table_name") or ctx.get("active_table") or "").strip()
    if not document_id:
        return ("no active document — open a document in the Extraction "
                "workbench first")
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT project_id, working_path, original_path FROM documents "
            "WHERE document_id = %s", (document_id,))
        drow = await cur.fetchone()
    if drow is None:
        return f"no document {document_id!r}"
    project_id, working_path, original_path = drow
    return document_id, project_id, working_path or original_path or "", table_name


@tool(
    name="document_set_schema",
    description=(
        "Data-extraction seat ONLY: DESIGN the loaded document's one table — "
        "name it and define its columns. This is how you CREATE the table before "
        "extracting any rows. Pass the full column list each time (it replaces "
        "the current design): columns are objects {name, type, description}, "
        "where type is one of text/identifier/code/number/reference/date/boolean "
        "and description says what the column holds (it helps you extract). "
        "table_name is optional; omit it to leave the current name. The target "
        "document comes from the seat automatically. Propose the columns in chat "
        "FIRST; write them on Shane's go. Writing rows into an undesigned column "
        "still works (it is auto-added as text), but design deliberately here so "
        "columns carry a real type + description. This is the extraction's own "
        "table (document_extractions), materialized as a REAL Postgres table — "
        "the Data Map's card for it derives automatically."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "columns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "type": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["name"],
                },
            },
            "table_name": {"type": "string"},
            "document_id": {"type": "string"},
        },
        "required": ["columns"],
        "additionalProperties": False,
    },
)
async def document_set_schema(args: dict[str, Any]) -> dict[str, Any]:
    denial = require_seat("document_set_schema")
    if denial:
        return _text({"ok": False, "note": denial})

    columns = args.get("columns")
    if not isinstance(columns, list) or not columns:
        return _text({"ok": False, "note": "columns must be a non-empty array of "
                      "{name, type, description} objects"})

    resolved = await _resolve_target(args)
    if isinstance(resolved, str):
        return _text({"ok": False, "note": resolved})
    document_id, project_id, source_pdf_path, table_name = resolved

    # A table_name arg overrides; otherwise keep the draft's current name.
    name_arg = args.get("table_name")
    draft = await extraction_data.get_or_create_draft(
        project_id, document_id, table_name or "", source_pdf_path)
    next_name = str(name_arg).strip() if name_arg is not None else (draft.get("table_name") or table_name or "")

    summary = await extraction_data.set_schema(
        project_id, draft["extraction_id"], next_name, columns)
    if summary is None:
        return _text({"ok": False, "note": "could not save the table design"})

    await _broadcast_bench("schema_written", document_id, summary.get("table_name") or "")
    cols = summary.get("columns") or []
    return _text({"ok": True, "table": summary.get("table_name") or "",
                  "columns": [c.get("name") for c in cols], "column_count": len(cols),
                  "note": "table design saved — the columns now show in the panel; "
                          "extract rows with document_write_rows when Shane is ready"})


@tool(
    name="document_write_rows",
    description=(
        "Data-extraction seat ONLY: write extracted rows into the loaded "
        "document's DRAFT extraction for the active table. Design the columns "
        "first with document_set_schema. Rows are objects keyed by the table's "
        "COLUMN NAMES (e.g. {\"SymbolText\": \"MCB10\", \"Description\": "
        "\"CIRCUIT BREAKER\", ...}); include a Source Page field or pass "
        "source_page. mode: 'replace_page' (default when source_page is given — "
        "idempotent re-extraction of one page) · 'append' · 'replace_all'. The "
        "target document/table come from the seat automatically; you normally "
        "pass only rows + source_page. Rows land as a DRAFT (unverified) — Shane "
        "reviews them in the grid and clicks Verify. Propose in chat first; write "
        "on his go; keep batches to a page at a time."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "rows": {"type": "array", "items": {"type": "object"}},
            "source_page": {"type": "integer", "minimum": 1},
            "mode": {"type": "string", "enum": ["append", "replace_page", "replace_all"]},
            "document_id": {"type": "string"},
            "table_name": {"type": "string"},
            "extraction_kind": {"type": "string"},
        },
        "required": ["rows"],
        "additionalProperties": False,
    },
)
async def document_write_rows(args: dict[str, Any]) -> dict[str, Any]:
    denial = require_seat("document_write_rows")
    if denial:
        return _text({"ok": False, "note": denial})

    rows = args.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return _text({"ok": False, "note": "rows must be a non-empty array of objects"})
    rows = [r for r in rows if isinstance(r, dict)]

    resolved = await _resolve_target(args)
    if isinstance(resolved, str):
        return _text({"ok": False, "note": resolved})
    document_id, project_id, source_pdf_path, table_name = resolved
    if not table_name:
        return _text({"ok": False, "note": "no active table — design it first with "
                      "document_set_schema, then write rows"})

    from src.canvas_copilot.copilot import copilot_session
    ctx = getattr(copilot_session, "_area_context", {}) or {}
    extraction_kind = str(args.get("extraction_kind") or ctx.get("active_kind") or "").strip()
    if not extraction_kind:
        extraction_kind = f"extract:{document_id}:{table_name}"

    source_page = args.get("source_page")
    mode = str(args.get("mode") or ("replace_page" if source_page else "append"))

    # union of field names across the batch, for the extraction's fieldnames
    fieldnames: list[str] = []
    for r in rows:
        for k in r:
            if k not in fieldnames:
                fieldnames.append(k)

    result = await extraction_data.write_rows(
        project_id, document_id, table_name, extraction_kind, rows,
        fieldnames=fieldnames, source_page=int(source_page) if source_page else None,
        mode=mode, source_pdf_path=source_pdf_path)
    if result.get("refused"):
        return _text({"ok": False, "table": table_name, "note": result["refused"]})
    await _broadcast_bench("rows_written", document_id, table_name)
    return _text({"ok": True, "table": table_name, **result,
                  "note": "draft rows written — Shane reviews in the grid and certifies "
                          "when the agreed verification protocol is complete"})


@tool(
    name="document_bench",
    description=(
        "Data-Extraction: act on SHANE'S VIEWER at the workbench — show, "
        "don't describe. Actions: goto_page {page} (flip his PDF) · mark "
        "{page, x, y, label?} (drop YOUR amber mark — your counterpart to "
        "his cyan ones) · region {page, x, y, w, h, label?} (your amber "
        "box) · clear_marks (remove your marks) · toast {text} (a brief "
        "notice on his screen). Coordinates in page px. Marks land on the "
        "page they name and persist until cleared. Extraction-seat only — "
        "this never touches the Smart Canvas. (Re-homed from the retired "
        "Schema-Builder bench, 2026-07-20 — same viewer, same channel.)"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {"type": "string",
                       "enum": ["goto_page", "mark", "region", "clear_marks", "toast"]},
            "page": {"type": "integer", "minimum": 1},
            "x": {"type": "number"}, "y": {"type": "number"},
            "w": {"type": "number"}, "h": {"type": "number"},
            "label": {"type": "string", "maxLength": 24},
            "text": {"type": "string", "maxLength": 200},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
)
async def document_bench(args: dict[str, Any]) -> dict[str, Any]:
    # Lazy import — copilot.py imports tools.py imports this module; a
    # top-level import back into copilot would be a cycle.
    from src.canvas_copilot.copilot import copilot_session

    denial = require_seat("document_bench")
    if denial:
        return _text({"ok": False, "note": denial})
    action = str(args["action"])
    cmd: dict[str, Any] = {"action": action}
    if action == "goto_page":
        if not args.get("page"):
            return _text({"ok": False, "note": "goto_page needs page"})
        cmd["page"] = int(args["page"])
    elif action in ("mark", "region"):
        needed = ("page", "x", "y") if action == "mark" else ("page", "x", "y", "w", "h")
        missing = [k for k in needed if args.get(k) is None]
        if missing:
            return _text({"ok": False, "note": f"{action} needs {', '.join(missing)}"})
        for k in needed:
            cmd[k] = float(args[k]) if k != "page" else int(args[k])
        if args.get("label"):
            cmd["label"] = str(args["label"])[:24]
    elif action == "toast":
        if not str(args.get("text") or "").strip():
            return _text({"ok": False, "note": "toast needs text"})
        cmd["text"] = str(args["text"]).strip()[:200]
    if len(copilot_session._sockets) == 0:
        return _text({"ok": False, "note": "no panel connected — nothing to show it on"})
    # Scope to the document the seat is looking at — a second workbench tab
    # on a DIFFERENT document must ignore commands aimed at this one.
    seat_ctx = getattr(copilot_session, "_area_context", {}) or {}
    if seat_ctx.get("document_id"):
        cmd["document_id"] = str(seat_ctx["document_id"])
    await copilot_session._broadcast({"kind": "bench_command", "command": cmd})
    # _broadcast prunes sockets that die on send — count AFTER, honestly.
    remaining = len(copilot_session._sockets)
    if remaining == 0:
        return _text({"ok": False,
                      "note": "panel socket(s) dropped mid-send — nothing rendered"})
    return _text({"ok": True, "action": action, "delivered_to_sockets": remaining,
                  "note": "lands only if the Document Extraction workbench is open"})
