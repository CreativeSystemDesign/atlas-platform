"""Cross-seat document + Neon evidence tools (né Schema-Builder tools).

What survives of the Schema-Builder seat after the 2026-07-20 Data Map
remodel: the page readers (schema_page_text / schema_page_view — vector
text + visual crops, used from every data seat) and the read-only Neon
data tools (schema_data_tables / schema_data_peek / schema_data_query).
The write door (schema_write), the bench driver (schema_bench), and the
doc-info reader (schema_doc_info) retired with the bench — cards derive
from real tables now (routes/data_map.py); Arc's Data Map seat tools are
the phase-2 build. Names keep their schema_ prefix (Arc's muscle memory +
COPILOT_RULES references); the prefix now just means "document study".

Registered on the same canvas MCP server: one Arc, one tool belt, the
[… now] context block says which seat it's in.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from claude_agent_sdk import tool

from src.config import settings
from src.persistence.database import get_pool


def _text(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text",
                         "text": json.dumps(payload, ensure_ascii=False)}]}


def _data_root() -> Path:
    return Path(settings.atlas_data_root or str(Path.home() / "atlas-data"))


@tool(
    name="schema_page_text",
    description=(
        "Schema-Builder: the extracted text blocks of one page (text + "
        "position in page pixels) — the vector evidence for column headers, "
        "units, code formats. Positions let you reconstruct table structure: "
        "same-y blocks are a row, same-x blocks are a column."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "document_id": {"type": "string"},
            "page": {"type": "integer", "minimum": 1},
            "offset": {"type": "integer", "minimum": 0, "default": 0,
                       "description": "skip this many blocks (reading order) — "
                                      "dense table pages exceed the 400-block window"},
        },
        "required": ["document_id", "page"],
        "additionalProperties": False,
    },
)
async def schema_page_text(args: dict[str, Any]) -> dict[str, Any]:
    document_id, page = str(args["document_id"]), int(args["page"])
    offset = max(0, int(args.get("offset") or 0))
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT text, bbox_px FROM schematic_page_text_blocks "
            "WHERE document_id = %s AND page_num = %s "
            "ORDER BY (bbox_px->>'y')::float, (bbox_px->>'x')::float",
            (document_id, page))
        rows = await cur.fetchall()
    if not rows:
        return _text({"ok": True, "page": page, "blocks": [],
                      "note": "no text layer on this page (likely a scan) — "
                              "use schema_page_view to SEE it"})
    blocks = [
        {"text": t, "x": round(float(b["x"])), "y": round(float(b["y"])),
         "w": round(float(b["width"])), "h": round(float(b["height"]))}
        for t, b in rows
    ]
    window = blocks[offset:offset + 400]
    remaining = len(blocks) - (offset + len(window))
    return _text({
        "ok": True, "page": page,
        "blocks": window,
        "total_blocks": len(blocks),
        **({"note": f"{remaining} more blocks — call again with offset={offset + 400}"}
           if remaining > 0 else {}),
    })


@tool(
    name="schema_page_view",
    description=(
        "Schema-Builder: SEE a page — returns the 300dpi workspace render as "
        "an image. Use it to read table layouts, headers, and anything the "
        "text layer can't carry (scans, stamps, layout)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "document_id": {"type": "string"},
            "page": {"type": "integer", "minimum": 1},
            "marks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"},
                                   "n": {"type": "integer"},
                                   "page": {"type": "integer"},
                                   "label": {"type": "string"}},
                    "required": ["x", "y"],
                },
                "description": "Shane's marks from [schema-builder now] — pass n "
                               "and page as given; marks from OTHER pages are "
                               "filtered out, never painted at phantom spots",
            },
            "regions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"},
                                   "w": {"type": "number"}, "h": {"type": "number"},
                                   "n": {"type": "integer"},
                                   "page": {"type": "integer"},
                                   "label": {"type": "string"}},
                    "required": ["x", "y", "w", "h"],
                },
                "description": "Shane's dragged boxes — numbered dashed rectangles; "
                               "same page filtering as marks",
            },
            "crop": {
                "type": "object",
                "properties": {"x": {"type": "number"}, "y": {"type": "number"},
                               "w": {"type": "number"}, "h": {"type": "number"}},
                "required": ["x", "y", "w", "h"],
                "description": "Return ONLY this page-px rectangle (plus a small "
                               "margin) — the close-read zoom for one region",
            },
        },
        "required": ["document_id", "page"],
        "additionalProperties": False,
    },
)
async def schema_page_view(args: dict[str, Any]) -> dict[str, Any]:
    document_id, page = str(args["document_id"]), int(args["page"])
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT p.slug FROM documents d JOIN projects p ON p.project_id = d.project_id "
            "WHERE d.document_id = %s", (document_id,))
        row = await cur.fetchone()
    if row is None:
        return _text({"ok": False, "note": f"no document {document_id!r}"})
    path = _data_root() / row[0] / "workspace" / document_id / f"page-{page:04d}.png"
    if not path.is_file():
        return _text({"ok": False, "note": f"no render for page {page}"})
    # A mark carrying a page field belongs to THAT page only — painting it
    # elsewhere shows Arc pointing Shane never did (audit 2026-07-13, #7).
    def _this_page(items: list) -> list:
        return [it for it in items
                if isinstance(it, dict) and int(it.get("page") or page) == page]

    marks = _this_page(args.get("marks") or [])[:8]
    regions = _this_page(args.get("regions") or [])[:6]
    dropped = (len([m for m in (args.get("marks") or []) if isinstance(m, dict)]) - len(marks)
               + len([r for r in (args.get("regions") or []) if isinstance(r, dict)]) - len(regions))
    crop = args.get("crop") if isinstance(args.get("crop"), dict) else None
    if marks or regions or crop:
        # Draw Shane's pins so Arc sees exactly where he pointed — the
        # schema bench's ask-mark (same idea as the canvas capture).
        import io

        from PIL import Image, ImageDraw

        img = Image.open(path).convert("RGB")
        draw = ImageDraw.Draw(img)
        for i, m in enumerate(marks):
            x, y = float(m.get("x", 0)), float(m.get("y", 0))
            r = 26
            draw.ellipse([x - r, y - r, x + r, y + r], outline=(220, 38, 38), width=6)
            draw.line([x - r * 1.6, y, x + r * 1.6, y], fill=(220, 38, 38), width=3)
            draw.line([x, y - r * 1.6, x, y + r * 1.6], fill=(220, 38, 38), width=3)
            draw.text((x + r + 8, y - r - 4), str(m.get("label") or m.get("n") or i + 1),
                      fill=(220, 38, 38))
        for i, rg in enumerate(regions):
            x, y = float(rg.get("x", 0)), float(rg.get("y", 0))
            w, h = float(rg.get("w", 0)), float(rg.get("h", 0))
            # dashed rectangle
            step = 18
            for edge in ((x, y, x + w, y), (x, y + h, x + w, y + h)):
                cx = edge[0]
                while cx < edge[2]:
                    draw.line([cx, edge[1], min(cx + step * 0.6, edge[2]), edge[1]],
                              fill=(220, 38, 38), width=5)
                    cx += step
            for edge in ((x, y, x, y + h), (x + w, y, x + w, y + h)):
                cy = edge[1]
                while cy < edge[3]:
                    draw.line([edge[0], cy, edge[0], min(cy + step * 0.6, edge[3])],
                              fill=(220, 38, 38), width=5)
                    cy += step
            draw.text((x + 8, y + 6), str(rg.get("label") or rg.get("n") or i + 1),
                      fill=(220, 38, 38))
        if crop:
            pad = 60
            cx, cy = float(crop.get("x", 0)), float(crop.get("y", 0))
            cw, ch = float(crop.get("w", 0)), float(crop.get("h", 0))
            box = (max(0, int(cx - pad)), max(0, int(cy - pad)),
                   min(img.width, int(cx + cw + pad)), min(img.height, int(cy + ch + pad)))
            if box[2] > box[0] and box[3] > box[1]:
                img = img.crop(box)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = base64.standard_b64encode(buf.getvalue()).decode("ascii")
    else:
        data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return {"content": [
        {"type": "text",
         "text": json.dumps({"ok": True, "document_id": document_id, "page": page,
                             **({"marks_drawn": len(marks)} if marks else {}),
                             **({"regions_drawn": len(regions)} if regions else {}),
                             **({"skipped_other_page": dropped} if dropped else {}),
                             **({"cropped": True} if crop else {})})},
        {"type": "image", "data": data, "mimeType": "image/png"},
    ]}


# --- Arc's down-channel to the bench viewer (Batch B, 2026-07-13) ----------
# --- Neon data-grounding tools (Shane, 2026-07-13) -------------------------
# Schema design must be grounded in what the platform ALREADY stores — the
# canvas annotation graph, extractions (parts/cable lists), sheet index, gold
# seals. Three read-only steps: discover the tables, peek real rows, query.


def _cell(v: Any) -> Any:
    if v is None:
        return None
    s = str(v).replace("\x00", "")
    return s if len(s) <= 240 else s[:240] + "…"


@tool(
    name="schema_data_tables",
    description=(
        "Schema-Builder: EVERY table in Neon — name, estimated rows, and "
        "columns (name:type). The map of what the platform already stores: "
        "canvas annotation graphs, extractions (parts/cable lists), sheet "
        "index, documents, seals. Call before designing a schema so the new "
        "contract joins cleanly with data that already exists."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name_filter": {"type": "string",
                            "description": "optional substring to filter table names"},
        },
        "additionalProperties": False,
    },
)
async def schema_data_tables(args: dict[str, Any]) -> dict[str, Any]:
    flt = str(args.get("name_filter") or "").strip().lower()
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT c.relname, c.reltuples::bigint FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname")
        counts = {r[0]: max(0, int(r[1])) for r in await cur.fetchall()}
        cur = await conn.execute(
            "SELECT table_name, column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position")
        cols: dict[str, list[str]] = {}
        for t, c, d in await cur.fetchall():
            cols.setdefault(t, []).append(f"{c}:{d}")
    tables = [
        {"table": t, "est_rows": counts.get(t, 0), "columns": cs}
        for t, cs in cols.items() if not flt or flt in t.lower()
    ]
    return _text({"ok": True, "tables": tables,
                  "note": "est_rows is the planner estimate — cheap, not exact"})


@tool(
    name="schema_data_peek",
    description=(
        "Schema-Builder: sample real rows from one Neon table (SELECT * "
        "LIMIT n). See actual stored values — annotation graphs, extraction "
        "rows, cable/parts data — before shaping a schema around them."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "table": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
        },
        "required": ["table"],
        "additionalProperties": False,
    },
)
async def schema_data_peek(args: dict[str, Any]) -> dict[str, Any]:
    from psycopg import sql as _pgsql

    table = str(args["table"]).strip()
    limit = min(int(args.get("limit") or 8), 20)
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = %s", (table,))
        if await cur.fetchone() is None:
            return _text({"ok": False,
                          "note": f"no table {table!r} — schema_data_tables lists them"})
        cur = await conn.execute(
            _pgsql.SQL("SELECT * FROM {} LIMIT %s").format(_pgsql.Identifier(table)),
            (limit,))
        rows = await cur.fetchall()
        columns = [d.name for d in (cur.description or [])]
    return _text({
        "ok": True, "table": table, "columns": columns,
        "rows": [[_cell(v) for v in r] for r in rows],
    })


@tool(
    name="schema_data_query",
    description=(
        "Schema-Builder: run a read-only SQL SELECT against Neon — DISTINCT "
        "value surveys, format checks, text-layer sweeps over THIS "
        "document's stored data (its extraction rows, text blocks, "
        "annotations). SELECT/WITH only; enforced read-only transaction, "
        "10s timeout, 200-row cap."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "sql": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
        "required": ["sql"],
        "additionalProperties": False,
    },
)
async def schema_data_query(args: dict[str, Any]) -> dict[str, Any]:
    import re as _re

    sql_text = str(args["sql"]).strip().rstrip(";").strip()
    limit = min(int(args.get("limit") or 50), 200)
    if not _re.match(r"^(select|with)\b", sql_text, _re.IGNORECASE):
        return _text({"ok": False, "note": "SELECT/WITH statements only"})
    if ";" in sql_text:
        return _text({"ok": False, "note": "one statement only"})
    pool = await get_pool()
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                # SET LOCAL scopes both guards to this transaction — the
                # pooled connection goes back clean.
                await conn.execute("SET LOCAL transaction_read_only = on")
                await conn.execute("SET LOCAL statement_timeout = '10s'")
                cur = await conn.execute(sql_text)  # type: ignore[arg-type]
                rows = await cur.fetchmany(limit)
                columns = [d.name for d in (cur.description or [])]
    except Exception as exc:
        return _text({"ok": False, "note": f"query failed: {str(exc).splitlines()[0][:300]}"})
    return _text({
        "ok": True, "columns": columns,
        "rows": [[_cell(v) for v in r] for r in rows],
        "row_count": len(rows),
        **({"note": f"capped at {limit} rows"} if len(rows) == limit else {}),
    })

