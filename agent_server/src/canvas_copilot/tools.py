"""In-process MCP tools the copilot uses to see and drive the smart canvas.

These run inside agent_server (no HTTP hop): reads hit bridge state directly,
writes fan out as commands the canvas executes. Tool names resolve as
mcp__canvas__<name> (see ALLOWED_CANVAS_TOOLS).

`annotate` intentionally emits a *command* rather than writing Neon directly:
graph mutations go through the canvas's updateGraph path so undo/redo and the
existing Neon persistence (and Shane's eyes) stay in the loop.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from src.canvas_copilot import bridge

logger = logging.getLogger(__name__)


def _text(payload: Any) -> dict[str, Any]:
    body = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    return _with_midturn({"content": [{"type": "text", "text": body}]})


def _with_midturn(result: dict[str, Any]) -> dict[str, Any]:
    """Slate 6.5: queued Shane messages inject at tool-result boundaries as
    labeled blocks — visually distinct from executor receipt notes — so
    corrections land before the turn commits more ops on stale premises
    ("those are terminal" sat queued ~130s while a wrong tangent ran).
    Stop-class messages are never drained here (interrupt owns them)."""
    try:
        from src.canvas_copilot.copilot import copilot_session

        msgs = copilot_session.drain_midturn_messages()
        if msgs:
            note = "\n\n".join(
                "[Shane, mid-turn — this arrived while you were working; it "
                f"outranks your current plan]: {m}" for m in msgs
            )
            result.setdefault("content", []).append({"type": "text", "text": note})
    except Exception:
        logger.warning("mid-turn drain unavailable", exc_info=True)
    return result


def _clean_reason(reason: Any) -> str | None:
    """Reasons are display-only one-liners; the model has a tic of emitting a
    stray edge quote (5/7 polluted in the 2026-07-03 transcripts) — strip them."""
    if not isinstance(reason, str):
        return None
    cleaned = reason.strip().strip("\"'“”‘’").strip()
    return cleaned or None


# --- Issues panel (Shane's design, 2026-07-07) --------------------------------
# A parked issue carries a CROP of the disputed region so Shane can rule
# yes/no from the panel without hunting the canvas. Crops live on disk, page-
# scoped; the routes serve them by (rule, element_id).

_ISSUE_CROP_DIR = Path(__file__).resolve().parents[3] / ".atlas" / "copilot-issues"
_ISSUE_CROP_PAD = 110.0


def _issue_element_context(snap: dict[str, Any], eid: str) -> tuple[str | None, str | None]:
    """(element_label, crop_path) for an issue park. Renders a small overlay-on
    crop centered on the element; every failure degrades to no-crop (the issue
    still parks — a missing image must never block the raise)."""
    label: str | None = None
    region: dict[str, float] | None = None
    for n in snap.get("nodes") or []:
        if str(n.get("id")) == eid:
            b = n.get("bbox") or {}
            label = n.get("label")
            region = {"x": float(b.get("x", 0)) - _ISSUE_CROP_PAD,
                      "y": float(b.get("y", 0)) - _ISSUE_CROP_PAD,
                      "width": float(b.get("width", 0)) + 2 * _ISSUE_CROP_PAD,
                      "height": float(b.get("height", 0)) + 2 * _ISSUE_CROP_PAD}
            break
    if region is None:
        for coll, pt_key in (("ports", "point"), ("continuations", "point")):
            for p in snap.get(coll) or []:
                if str(p.get("id")) == eid:
                    pt = p.get(pt_key) or {}
                    label = p.get("label") or label
                    region = {"x": float(pt.get("x", 0)) - 2 * _ISSUE_CROP_PAD,
                              "y": float(pt.get("y", 0)) - 2 * _ISSUE_CROP_PAD,
                              "width": 4 * _ISSUE_CROP_PAD, "height": 4 * _ISSUE_CROP_PAD}
                    break
    if region is None:
        for e in snap.get("edges") or []:
            if str(e.get("id")) == eid:
                path = e.get("path") or []
                if path:
                    mid = path[len(path) // 2]
                    label = e.get("label") or label
                    region = {"x": float(mid.get("x", 0)) - 2.5 * _ISSUE_CROP_PAD,
                              "y": float(mid.get("y", 0)) - 2 * _ISSUE_CROP_PAD,
                              "width": 5 * _ISSUE_CROP_PAD, "height": 4 * _ISSUE_CROP_PAD}
                break
    if region is None:
        return label, None
    try:
        from src.canvas_copilot.capture import render_capture

        packet = render_capture(region=region, max_px=560, show_grid_overlay=False,
                                show_graph_overlay=True, show_ask_marks=False,
                                include_text_layer=False, encode_b64=False)
        src = Path(str(packet.get("debug_path") or ""))
        if not src.is_file():
            return label, None
        _ISSUE_CROP_DIR.mkdir(parents=True, exist_ok=True)
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in f"{eid}")[:80]
        # Timestamped: crops are TRAINING CORPUS (Shane 2026-07-07 — issue
        # rulings feed the code-annotator doctrine); a re-raise on the same
        # element must never overwrite the prior ruling's evidence.
        dest = _ISSUE_CROP_DIR / f"{int(time.time() * 1000)}-{safe}.png"
        dest.write_bytes(src.read_bytes())
        return label, str(dest)
    except Exception:
        logger.warning("issue crop render failed — parking without a crop", exc_info=True)
        return label, None


async def _broadcast_issues(page: Any) -> None:
    """Push the page's issue list to every attached panel (crops ride as
    separate HTTP fetches — the WS payload stays light)."""
    from src.canvas_copilot import blockers
    from src.canvas_copilot.copilot import copilot_session

    try:
        pg = int(page) if page is not None else None
    except (TypeError, ValueError):
        pg = None
    items = [{k: v for k, v in it.items() if k != "crop_path"}
             | {"has_crop": bool(it.get("crop_path"))}
             for it in blockers.list_issues(pg)]
    await copilot_session._broadcast({"kind": "issues", "page": pg, "items": items})


@tool(
    name="get_state",
    description=(
        "Live smart-canvas state: current page, viewport (zoom/pan), active tool, "
        "selection, net-color-mode summary, graph stats, and how fresh the snapshot is. "
        "Call this first whenever Shane refers to what's on his screen. "
        "SCOPE IT — full dumps are 20-47KB and you rarely need one: "
        "region {x,y,width,height} keeps only elements intersecting it; "
        "kinds ['components','wires','terminals','continuations','grounds'] keeps those layers; "
        "label 'CN6' keeps label substring matches (case-insensitive); "
        "fields 'stats' (counts only) | 'ids' (id/label/type/point-or-bbox) | 'full'. "
        "A scoped query ('what's around CN6') is <2KB. No args = full snapshot as before. "
        "Each continuation carries status {state, detail, counterpart_page?, dest_page?} — "
        "the SAME cross-page state Shane sees as the chip color (resolved=green, "
        "waiting=amber, mismatch=violet, unanchored=rose, unlabeled=slate, "
        "symbol=quiet print annotation). Read the data, never guess from capture colors."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "region": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                },
                "required": ["x", "y", "width", "height"],
                "additionalProperties": False,
            },
            "kinds": {
                "type": "array",
                "items": {"type": "string", "enum": ["components", "wires", "terminals", "continuations", "grounds"]},
            },
            "label": {"type": "string"},
            "fields": {"type": "string", "enum": ["stats", "ids", "full"]},
        },
        "additionalProperties": False,
    },
)
async def get_state(args: dict[str, Any]) -> dict[str, Any]:
    state = bridge.get_state()
    snap = state["snapshot"]
    scoped = any(args.get(k) is not None for k in ("region", "kinds", "label", "fields"))
    if snap is None or not scoped:
        return _text({"snapshot": snap, "snapshot_age_s": state["snapshot_age_s"]})

    region = args.get("region")
    label = (args.get("label") or "").strip().lower()
    kinds = set(args.get("kinds") or ["components", "wires", "terminals", "continuations", "grounds"])
    fields = args.get("fields") or "full"

    def _in_region(pt: dict[str, Any] | None) -> bool:
        if not region:
            return True
        if not isinstance(pt, dict):
            return False
        return (
            region["x"] <= float(pt.get("x", -1)) <= region["x"] + region["width"]
            and region["y"] <= float(pt.get("y", -1)) <= region["y"] + region["height"]
        )

    def _bbox_hits(b: dict[str, Any] | None) -> bool:
        if not region:
            return True
        if not isinstance(b, dict):
            return False
        return not (
            b["x"] + b["width"] < region["x"]
            or b["x"] > region["x"] + region["width"]
            or b["y"] + b["height"] < region["y"]
            or b["y"] > region["y"] + region["height"]
        )

    def _label_hits(value: Any) -> bool:
        return not label or label in str(value or "").lower()

    nodes = [n for n in snap.get("nodes") or [] if _bbox_hits(n.get("bbox")) and _label_hits(n.get("label"))]
    ports = [p for p in snap.get("ports") or [] if _in_region(p.get("point")) and _label_hits(p.get("label"))]
    edges = [
        e for e in snap.get("edges") or []
        if _label_hits(e.get("label"))
        and (not region or any(_in_region(pt) for pt in e.get("path") or []))
    ]
    conts = [
        c for c in snap.get("continuations") or []
        if _in_region(c.get("point")) and _label_hits(c.get("rawRef") or c.get("sheet"))
    ]
    grounds = [
        g for g in snap.get("grounds") or []
        if _bbox_hits(g.get("bbox")) and _label_hits(g.get("label"))
    ]

    out: dict[str, Any] = {
        "page": snap.get("page"),
        "scope": {k: args[k] for k in ("region", "kinds", "label", "fields") if args.get(k) is not None},
        "counts": {
            "components": len(nodes) if "components" in kinds else None,
            "wires": len(edges) if "wires" in kinds else None,
            "terminals": len(ports) if "terminals" in kinds else None,
            "continuations": len(conts) if "continuations" in kinds else None,
            "grounds": len(grounds) if "grounds" in kinds else None,
        },
        "snapshot_age_s": state["snapshot_age_s"],
    }
    if fields != "stats":
        def _slim(items: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
            if fields == "full":
                return items
            return [{k: it.get(k) for k in keys if it.get(k) is not None} for it in items]

        if "components" in kinds:
            out["components"] = _slim(nodes, ("id", "label", "bbox"))
        if "wires" in kinds:
            out["wires"] = _slim(edges, ("id", "label"))
        if "terminals" in kinds:
            out["terminals"] = _slim(ports, ("id", "label", "type", "point", "parentId", "parentId2"))
        if "continuations" in kinds:
            out["continuations"] = _slim(conts, ("id", "rawRef", "point"))
        if "grounds" in kinds:
            out["grounds"] = _slim(grounds, ("id", "label", "bbox"))
    return _text(out)


@tool(
    name="get_pointed",
    description=(
        "What Shane is pointing at: recent pen/pointer events with page coordinates and "
        "the canvas-resolved target, plus any point-and-ask questions. Newest last. "
        "Targets carry: segment {x1,y1,x2,y2} — the PRINTED line's exact endpoints "
        "(ground your geometry on these, no capture needed); net_id; component_id/label "
        "(drawn box he's inside); and element_id/kind/label/distance_px when he touches "
        "one of YOUR drawn wires/terminals/junctions — 'this is wrong' then names the "
        "exact graph element to fix."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "Max events to return (default 10)"},
        },
        "additionalProperties": False,
    },
)
async def get_pointed(args: dict[str, Any]) -> dict[str, Any]:
    limit = int(args.get("limit") or 10)
    events = bridge.recent_events(kinds={"pen", "ask", "select"}, limit=limit)
    if not events:
        return _text("No recent pointer activity. Ask Shane to touch the canvas (or check the bridge is connected via get_state).")
    return _text({"events": events})


@tool(
    name="highlight",
    description=(
        "Paint a highlight on the canvas overlay. Target one of: a net (netId), explicit "
        "segment indices, a graph element id, or a point. Optional color (CSS) and ttl_ms "
        "(default 6000; 0 = until cleared). PAINT HYGIENE (2026-07-08): never paint audit "
        "flags with ttl 0 — fixed/disposed flags left ghost-paint on Shane's canvas while "
        "the Table read clean. Flag walk-through paint takes a finite ttl (≤60000); the "
        "server also wipes ALL highlights when an audit completes clean."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "net_id": {"type": "integer"},
            "segments": {"type": "array", "items": {"type": "integer"}},
            "element_id": {"type": "string"},
            "point": {
                "type": "object",
                "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                "required": ["x", "y"],
                "additionalProperties": False,
            },
            "color": {"type": "string"},
            "ttl_ms": {"type": "integer"},
            "note": {"type": "string", "description": "Short label rendered beside the highlight"},
        },
        "additionalProperties": False,
    },
)
async def highlight(args: dict[str, Any]) -> dict[str, Any]:
    ids = bridge.send_commands([{"type": "highlight", **args}])
    return _text({"ok": True, "command_id": ids[0], **bridge.bridge_stats()})


@tool(
    name="clear_highlights",
    description="Remove all copilot highlights from the canvas overlay.",
    input_schema={"type": "object", "properties": {}, "additionalProperties": False},
)
async def clear_highlights(args: dict[str, Any]) -> dict[str, Any]:
    bridge.send_commands([{"type": "clear_highlights"}])
    return _text({"ok": True})


@tool(
    name="clear_ask_marks",
    description=(
        "Clear Shane's numbered ask-marks from the canvas — all, or specific numbers via "
        "marks:[...]. Marks are PERSISTENT reference points Shane reuses across fixes: "
        "clear them ONLY when he says he's done with them or asks for a clear — never as "
        "routine tidying after a fix."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "marks": {"type": "array", "items": {"type": "integer"}, "description": "Mark numbers to clear; omit for all"},
        },
        "additionalProperties": False,
    },
)
async def clear_ask_marks(args: dict[str, Any]) -> dict[str, Any]:
    cmd: dict[str, Any] = {"type": "clear_ask_marks"}
    if args.get("marks"):
        cmd["marks"] = [int(n) for n in args["marks"]]
    bridge.send_commands([cmd])
    return _text({"ok": True, "cleared": args.get("marks") or "all"})


@tool(
    name="view",
    description=(
        "Drive the viewport/UI: center on a page point (optionally set zoom), switch page, "
        "switch active tool (select|component|wire|terminal|continuation), toggle net color "
        "mode, or select an element by id. Provide only the fields you want changed."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "center": {
                "type": "object",
                "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                "required": ["x", "y"],
                "additionalProperties": False,
            },
            "zoom": {"type": "number"},
            "page": {"type": "integer"},
            "tool": {"type": "string"},
            "net_color_mode": {"type": "boolean"},
            "select_id": {"type": ["string", "null"]},
        },
        "additionalProperties": False,
    },
)
async def view(args: dict[str, Any]) -> dict[str, Any]:
    ids = bridge.send_commands([{"type": "view", **args}])
    if args.get("page") is not None:
        _bind_page(int(args["page"]))  # slate 6.6: navigation rebinds
    return _text({"ok": True, "command_id": ids[0]})


@tool(
    name="annotate",
    description=(
        "Mutate the schematic graph on Shane's behalf via the canvas (goes through "
        "updateGraph -> undo/redo + Neon persistence). ops is a list of operations: "
        "{op:'add_component', bbox:{x,y,width,height}, label?, auto_terminals?:true} — "
        "auto_terminals mints a terminal at EVERY printed conductor crossing the box "
        "border, named T~<label>~[<pin>~]<net> — net from the printed wire number "
        "(walks up to ~220px along each conductor), pin from the printed designator "
        "just inside the border when one is there (FWD, X1, 13); unnamed ones need "
        "your read. Same engine as Shane's drag-box ghost terminals — one op replaces "
        "the whole add_terminal sequence for wired components; verify the receipt's "
        "minted/named/pinned/adopted counts. Pre-existing wire endpoints near the "
        "border are ADOPTED (kept with their wires, reparented, renamed per "
        "convention) — never delete endpoints to make room for a box. TERMINAL STRIPS: a box enclosing a printed pin "
        "table (PIN No./NAME columns, >=4 rows) auto-classifies as kind:'strip' with "
        "parsed rows — the ROW's pin number names each terminal's pin slot "
        "(T~TB30~20~N24; the signal NAME like DICOM is row metadata, never the pin "
        "slot), and a row's left+right ports auto-join with an internal conduction "
        "edge (one circuit through the screw; rows never conduct to each other). "
        "The receipt names the classification and row count. | "
        "{op:'add_component', from_detection:'<detection id>', label} — SEEDED BOXING, the "
        "FASTEST correct path for any component the roster lists: the server resolves the "
        "detection's bbox and refines its edges to the printed walls; the receipt reports "
        "per-side wall coverage (every side >=0.5 = verified by construction, skip the "
        "capture-judge loop; low-coverage sides still need your eyes). You supply the "
        "printed label; the detector supplies size/shape. | "
        "{op:'add_wire', path:[{x,y},...], label?, snap?:'artwork'} | "
        "{op:'add_terminal', component_id, point:{x,y}, label?, snap?:'artwork'} | "
        "MATE TERMINALS (Shane 2026-07-09 — touching terminals CONDUCT): a point on TWO "
        "flush component borders (≤6px each) mints ONE mate terminal owned by BOTH "
        "(type 'mate', parentId+parentId2) — connection by MATING, no wire (CON20 plug ⇔ "
        "INV1 socket). A second cross-parent add_terminal onto an existing terminal "
        "UPGRADES it to a mate instead of the old silent reuse. The receipt announces "
        "'A ⇔ B conduct'. Use mates ONLY for flush contact; separated terminals joined "
        "by a printed conductor stay wires. | "
        "{op:'add_connector_pair', point:{x,y}, connector_id?, label?} — CONNECTOR "
        "PAIRS (Shane 2026-07-09, the CON23/CN23A + FAN-connector pattern as ONE op per "
        "pin): aim `point` at the INPUT pin on the connector's border. Mints the input "
        "terminal there, projects across the box to the opposite border, ADOPTS an "
        "existing aligned terminal on the out side when one is within 4px of the pin row "
        "(upgrading it to a MATE — its exact point wins over the projection), else mints "
        "fresh (auto-mating if another component's border abuts), and records the "
        "internal conduction as a wire segment between the pair. TWO candidates near the "
        "row = AMBIGUOUS — the op refuses entirely (dense pin strips are never guessed); "
        "read the note and pair manually. Mates render as MAGENTA diamonds in close-ups. | "
        "snap:'artwork' projects your coordinates onto the nearest printed vector "
        "geometry (junction > endpoint > on-line, within 28px) — USE IT for every wire/"
        "terminal that should sit on artwork; your 5-10px eyeball error becomes exact. "
        "Receipt notes report the snap ('snapped 2/2 points, max shift 8px') and warn "
        "when a point had no artwork in range. | "
        "{op:'rename', id, label} | {op:'delete', id} | "
        "{op:'resize', id?, at?:{x,y}, bbox:{x,y,width,height}} (border terminals RIDE a "
        "moved edge by default and their wires follow — interior pins never move; the "
        "canvas setting 'Terminals ride resized borders' can switch resize to shell-only, "
        "and the receipt note says which semantics applied; grounds AND cables resize by id too — a resized cable auto-links whatever it now touches) | "
        "{op:'clear', layers?:['wires','terminals','grounds',...], keep?:['components']} "
        "(no args = whole page; layers = wipe just those; keep = wipe everything else; "
        "receipt notes include a post-wipe invariant check per layer) | "
        "{op:'delete_prefix', prefix:'port-legacy-'} (delete every id with that prefix, "
        "cascades included) | "
        "{op:'normalize_taps'} (repair legacy dangling junctions: splits trunks through them so taps are degree-3; new taps do this automatically — a tap = trunk SPLIT at the junction, one net encoded in the data) | "
        "{op:'add_continuation', point?:{x,y}, sheet?, zone?, raw_ref?, target_id?} — boxed "
        "(point optional ONLY with target_id: the chip anchors to the target; give point "
        "whenever you have the printed mark's coordinates) — "
        "sheet/zone refs and device cross-refs. THE REF-STRING PARAM IS raw_ref (snake_case, "
        "e.g. raw_ref:'3/2'; rawRef/ref spellings are accepted as aliases since 2026-07-13 and "
        "'N/Z' fractions auto-parse into sheet+zone; an unlabeled chip now draws a LOUD receipt "
        "warning — read your receipts). "
        "target_id attaches it to a component/port/CABLE; otherwise it auto-targets a wire-end "
        "port within reach, else the containing component box, else the containing cable box "
        "(a ref on a cable bar means THE CABLE continues at that sheet — cables never conduct, "
        "so cable refs bind to the box, never an endpoint). Check the snapshot's continuations "
        "array FIRST — legacy badges duplicate silently | "
        "{op:'add_ground', point:{x,y}, label?} — a FIRST-CLASS ground/earth reference (its "
        "own element, NOT a component and NOT a terminal): aim `point` at the printed earth "
        "glyph and the server snaps a snug box to it. Label auto-reads the printed "
        "ground token (G/FG/PE/E…) near the glyph, else 'GND' — pass label to override. "
        "The conductor entering the glyph auto-mints a BORDER TERMINAL on the ground box "
        "(T~<glabel>~<net>, net = the printed run's number else the ground's own label) — "
        "receipt notes report it; no separate add_terminal needed for the glyph end. "
        "Grounds are in the snapshot's grounds[] and get_state kind 'grounds'. Component "
        "terminals on conductors that RUN TO a labeled earth glyph auto-net the earth "
        "token too (T~INV70~G~G style — both slots print facts). | "
        "{op:'add_cable', bbox:{x,y,width,height}, label?} — a CABLE: a BBOX hugging "
        "the printed bundle symbol (the hatched bar), YOLO-honest like every element. "
        "Cables NEVER conduct — continuity flows through wire numbers; the cable is "
        "the named physical carrier. Label auto-reads the printed cable name (CAB21) "
        "on/beside the symbol. TOUCH-TO-LINK: a cable bbox touching a terminal strip's "
        "bbox auto-adopts the strip's row triples {core=pin, signal, net} into the "
        "DOCUMENT-level registry roster (same cable name on any page IS the same "
        "cable; unwired rows ride as SPARE; deduped by core). Draw the box so it "
        "touches the strip it feeds — never guess rosters by hand. | "
        "{op:'move_continuation', id, point:{x,y}} — move a continuation symbol; within "
        "25px of a drawn wire ENDPOINT it snaps onto it and target-binds to that wire's "
        "port (Shane's placement doctrine: continuations sit ON endpoints, lesson "
        "ls-20260709-210529); open-space points move it and clear stale bindings — the "
        "receipt says which happened. Use this to fix bracket-placed symbols instead of "
        "delete + re-add. | "
        "{op:'reparent', id, component_id} — attach an orphaned terminal to its box, "
        "PRESERVING every attached wire (wires follow by port id; the receipt note "
        "proves it with the preserved count — read it). Junctions refuse — taps are "
        "wire topology, never component pins. NEVER re-parent by delete + re-add: "
        "the delete cascades the terminal's wires away (that recipe silently dropped "
        "3 of ELB50's conductors on page 11). | "
        "{op:'move_terminal', id, point:{x,y}} — slide a terminal/mate (same engine as "
        "Shane's canvas pin-drag): the point PROJECTS onto its parent's border (mates "
        "chain through BOTH parents — they cannot leave the shared flush face; parentless "
        "terminals move freely). Attached wire endpoints follow by port id, kept H/V (a "
        "straight wire gets a corner inserted; the far terminal never moves). Junctions "
        "refuse — wire topology moves by rewiring. Use this instead of delete+re-add, "
        "which cascades the wires away. | "
        "{op:'set_page_meta', meta:{...}} (title block / drawing number / descriptions) | "
        "{op:'attach', component_id, text, bbox, kind?} — attach printed-text EVIDENCE "
        "(pick it from the scene packet's texts layer) to a component, digital-twin style: "
        "kind auto-classifies (part_number when it matches the parts list / spec / text) "
        "and the component's identity DERIVES from evidence via the parts-list join. "
        "Never assert identity by hand — attach the printed part number you can see. "
        "{op:'detach', attachment_id} removes bad evidence (identity re-derives from the rest; "
        "attachment ids are in get_state's nodes[].attachments). "
        "Coordinates are page-space pixels (2481x3509). "
        "DELIVERY IS ACKNOWLEDGED: this tool blocks until the canvas confirms it applied "
        "your ops (apply-receipt), then returns applied:true with graph_stats before/after, "
        "the executor's per-op notes (skips/dedupes/warnings — read them before claiming "
        "an op landed), and a minted array parallel to your ops (role->id of every element "
        "created; wires include their endpoint port ids even when reused). Use minted ids "
        "for follow-up ops directly — never capture just to harvest ids. "
        "applied:false means the canvas hasn't acked (page closed/reloading): the command "
        "auto-replays for up to 10 minutes when it reconnects — do NOT re-dispatch, just "
        "tell Shane or check later. DELIVERED IS NOT CORRECT: the receipt only proves the "
        "ops landed. Correctness comes from the POST-APPLY IMAGES this tool returns inline — "
        "close-ups of each added/resized box, plus the edited region for wire/terminal/delete "
        "batches (drawn wires appear as MAGENTA paths, ground boxes as solid MAGENTA rings). LOOK at them: wire on the printed "
        "line? terminal on the lead? tap on the dot? Never claim 'fixed' from the receipt "
        "or your coordinates alone."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "ops": {"type": "array", "items": {"type": "object"}},
            "reason": {"type": "string", "description": "One line shown to Shane about why"},
            "page_ack": {"type": "integer",
                         "description": "Rebind this session to the page the canvas is on "
                                        "(slate 6.6): required once after an intentional page "
                                        "flip; must equal the canvas's current page"},
        },
        "required": ["ops"],
        "additionalProperties": False,
    },
)
async def annotate(args: dict[str, Any]) -> dict[str, Any]:
    import asyncio
    import uuid

    from src.canvas_copilot.capture import render_capture

    ops: list[dict[str, Any]] = args["ops"]

    # Slate 4.1 audit-first gate: a handoff/crash-born session mutates nothing
    # until one audit_page COMPLETES (the prose FIRST-ACTION mandate was
    # violated in 2/3 handoffs of a segment; compliant sessions reconciled in
    # 2-7s). Binary, content-blind; read-only tools are unrestricted.
    try:
        from src.canvas_copilot.copilot import copilot_session as _cs_gate

        if _cs_gate.needs_audit:
            return _text({
                "ok": False, "applied": False, "refused": "audit-first",
                "note": "REFUSED (nothing applied): this session is handoff-born and has "
                        "not completed its boot audit. Run mcp__canvas__audit_page and "
                        "reconcile it against your handoff note FIRST — then mutate. "
                        "(If the canvas is closed, audit_page says so; tell Shane.)",
            })
    except Exception:
        logger.debug("audit-first gate unavailable", exc_info=True)

    # Scoped-ask confirm gate (Shane, 2026-07-08): a pen/lasso mark + instruction
    # in collaborative mode is CONFIRM-BEFORE-ACT. Until Shane replies, editing
    # the graph is refused — gather context (read-only), restate the plan, WAIT.
    # This is the mechanism behind the "it took off using tool after tool"
    # correction: prose asking the model to wait decays; this refuses.
    try:
        from src.canvas_copilot.copilot import copilot_session as _cs_confirm

        if _cs_confirm._scoped_confirm_pending:
            return _text({
                "ok": False, "applied": False, "refused": "awaiting-confirmation",
                "note": "REFUSED (nothing applied): Shane marked an area and told you what "
                        "he needs — this is confirm-before-act. Gather context with "
                        "READ-ONLY tools (capture the marked region, read the page), then "
                        "restate in ONE short message exactly what you understand he wants "
                        "and how you'll do it, and WAIT for his go. He confirms, THEN you edit.",
            })
    except Exception:
        logger.debug("confirm gate unavailable", exc_info=True)

    # Slate 4.6(b): the PAGE-LEVEL lock — the only hard-refusing tier
    # (pre-approved: the sealed gold master must never be scribbled on by a
    # future session). Per-component refusal stays unshipped: it recreates
    # the law-vs-lock deadlock the stamps exist to treat.
    try:
        from src.canvas_copilot.blockers import page_locked

        _cur_page = (bridge.get_state()["snapshot"] or {}).get("page")
        _lock = page_locked(int(_cur_page)) if _cur_page is not None else None
        if _lock:
            return _text({
                "ok": False, "applied": False, "refused": "page-locked",
                "note": (f"REFUSED (nothing applied): page {_cur_page} is LOCKED "
                         f"({_lock.get('provenance', 'sealed')}). This is a sealed/"
                         "gold page — only Shane unlocks it (panel endpoint "
                         "/experimental-v2/copilot/page-lock). Tell him what you "
                         "wanted to change and why."),
            })
    except Exception:
        logger.debug("page lock check unavailable", exc_info=True)

    # Slate 4.6(b) authorizer field, BORN WARN (log/flag, never refuse):
    # formalizes the organic "Shane:" reason prefix. Recency proves a human
    # message EXISTS, not that it authorized THIS op — so an unbacked claim
    # draws a receipt note, and cross-session directives legitimately fail
    # recency (WARN, never reject; keep his quote in the reason).
    _auth_warn: list[str] = []
    if str(args.get("reason") or "").strip().lower().startswith("shane"):
        try:
            from src.canvas_copilot.copilot import copilot_session as _cs_a

            recent_human = any(
                h.get("kind") == "user" and h.get("source") in ("panel", "queue")
                for h in list(_cs_a._history)[-12:]
            )
            if not recent_human:
                _auth_warn.append(
                    "warning: reason claims Shane's authorization but no recent Shane "
                    "message exists in this session — cross-session directives need his "
                    "QUOTED words in the reason (recency proves existence, not consent)")
        except Exception:
            logger.debug("authorizer cross-check unavailable", exc_info=True)

    # Slate 4.5 guided-mode budget: ONE geometric batch per Shane message —
    # a batch is one intent (the cascade-companion exemption by construction:
    # the mandated delete+re-add+wire repair rides one batch). The walkthrough
    # evidence: "i said one thing at a time", unrequested add_wire bundled
    # into a directed batch (L81). Non-geometric batches (rename/attach/meta)
    # stay unlimited.
    try:
        from src.canvas_copilot.copilot import copilot_session as _cs_g

        if _cs_g.settings.get("guided"):
            _GEO = {"add_component", "add_wire", "add_terminal", "resize",
                    "delete", "reparent", "move_terminal", "move_continuation",
                    "add_connector_pair", "add_continuation", "clear", "normalize_taps"}
            if any(op.get("op") in _GEO for op in ops):
                if _cs_g._geo_batch_used:
                    return _text({
                        "ok": False, "applied": False, "refused": "guided-mode-budget",
                        "note": "REFUSED (nothing applied): GUIDED MODE — one geometric "
                                "batch per Shane message, and this message's batch is "
                                "spent. Wait for his next instruction (cascade repairs "
                                "belong in the SAME batch as their primary op).",
                    })
                _cs_g._geo_batch_used = True
    except Exception:
        logger.debug("guided budget unavailable", exc_info=True)

    # Slate 6.6: page binding outranks everything — no op inspection matters
    # if the batch would land on the wrong page.
    _flip = _page_guard(args)
    if _flip is not None:
        return _text(_flip)

    # Slate 6.3 geometry lock: elements parked awaiting Shane's verdict are
    # frozen against agent geometry ops — a successor once violated "do NOT
    # resize into that cell" 27 seconds into its life. Unlock = Shane's
    # disposition, or raise_to_shane action:'reopen' quoting his chat reply.
    try:
        from src.canvas_copilot.blockers import parked_elements

        _parked = parked_elements()
    except Exception:
        _parked = {}
        logger.debug("parked-element lookup unavailable", exc_info=True)
    if _parked:
        for opl in ops:
            if opl.get("op") in ("resize", "delete", "reparent", "move_terminal") and str(opl.get("id")) in _parked:
                # Slate 3.3 tier split: auto-parked suspected-FPs do NOT
                # freeze geometry at birth (promoted only after calibration);
                # only Shane-facing manual parks lock.
                if str(_parked[str(opl.get("id"))].get("provenance", "")).startswith("three-strike"):
                    continue
                q = _parked[str(opl.get("id"))].get("question", "")
                return _text({
                    "ok": False, "applied": False, "refused": "awaiting-shane-lock",
                    "note": (f"REFUSED (nothing applied): element {opl.get('id')} is PARKED "
                             f"awaiting Shane's verdict ({q[:160]}). Geometry on disputed "
                             "elements is locked — wait for his answer/disposition, or if he "
                             "already replied in chat, reopen with raise_to_shane "
                             "action:'reopen' quoting his exact words."),
                })

    # Slate 2.3 executor gate — cables connect by MATING, never by wires
    # (Shane multipath ruling 2026-07-06). An add_wire ENDPOINT landing in/on
    # a CAB* component box is refused before dispatch: both measured
    # violations had endpoints exactly at the mating faces. Wires CROSSING a
    # cable box stay legal (a cable bar spanning the inter-module gap has
    # conductors passing over it) — only endpoints convict. Plug boxes
    # (CN*/CON*) never refuse — CON41 carries Shane-approved wired terminals —
    # but an endpoint landing on a plug box away from the plug's own
    # terminals draws a receipt note instead.
    from src.canvas_copilot.audit import CABLE_RE as _cab_re
    from src.canvas_copilot.audit import PLUG_RE as _plug_re

    _snap0 = bridge.get_state()["snapshot"] or {}

    def _in_or_on(pt: dict[str, Any], bb: dict[str, Any], eps: float = 1.0) -> bool:
        return (float(bb.get("x", 0)) - eps <= float(pt.get("x", 0))
                <= float(bb.get("x", 0)) + float(bb.get("width", 0)) + eps
                and float(bb.get("y", 0)) - eps <= float(pt.get("y", 0))
                <= float(bb.get("y", 0)) + float(bb.get("height", 0)) + eps)

    for opg in ops:
        if opg.get("op") != "add_wire":
            continue
        pthg = opg.get("path") or []
        if len(pthg) < 2:
            continue
        for endpt in (pthg[0], pthg[-1]):
            for nd in _snap0.get("nodes") or []:
                bb, ndlbl = nd.get("bbox") or {}, str(nd.get("label") or "")
                if not bb or not _in_or_on(endpt, bb):
                    continue
                if _cab_re.match(ndlbl):
                    return _text({
                        "ok": False, "applied": False, "refused": "cable-mating-doctrine",
                        "note": (
                            f"REFUSED (nothing applied): add_wire endpoint ({endpt.get('x', 0):.0f},"
                            f"{endpt.get('y', 0):.0f}) lands on cable {ndlbl}'s box. Cables connect by "
                            "MATING at module faces, never by wires — the cable conductor itself is a "
                            "labeled EDGE between the two modules' mating terminals (a CAB* component "
                            "is interim state; migrate it, don't wire it). Wires may CROSS a cable box; "
                            "no endpoint may land in or on one. Re-issue the batch without this "
                            "endpoint, or ask Shane if this cable genuinely needs drawn work."
                        ),
                    })
                if _plug_re.match(ndlbl) and not any(
                    p.get("parentId") == nd.get("id") and p.get("type") == "terminal"
                    and abs(float((p.get("point") or {}).get("x", 0)) - float(endpt.get("x", 0))) <= 12
                    and abs(float((p.get("point") or {}).get("y", 0)) - float(endpt.get("y", 0))) <= 12
                    for p in _snap0.get("ports") or []
                ):
                    opg["_plug_face"] = ndlbl

    # BOX GATE (Shane 2026-07-07): "all bboxes must be positioned correctly
    # because that will change the location of terminals placed on the border
    # of the bbox for each wire... bboxes should be gated before wiring."
    # Terminals are DEFINED as bbox-border crossings, so box error multiplies
    # through every terminal and wire drawn after it — and the page-12 run
    # wired over nine flagged boxes despite the REBUILD ORDER prose. Wiring
    # now requires a CLEAN, FRESH box certificate: a completed audit on this
    # page, no component geometry mutated after it, zero open bbox-geometry
    # flags (unwired-node and terminal-placement classes never gate — wiring
    # is their cure/feedback). Deletion of a box does not stale the
    # certificate in v1 (its orphaned terminals flag on the next audit).
    # Escape: a "Shane"-prefixed reason, same channel as the see-do exemption.
    if (any(op.get("op") == "add_wire" for op in ops)
            and not str(args.get("reason") or "").strip().lower().startswith("shane")):
        _gate_page = int(_snap0.get("page") or 0)
        if any(op.get("op") in ("add_component", "resize") for op in ops):
            return _text({
                "ok": False, "applied": False, "refused": "box-gate",
                "note": ("REFUSED (nothing applied): this batch mixes box geometry "
                         "(add_component/resize) with add_wire. Boxes settle FIRST: "
                         "land the boxes, run audit_page until the box flags are clean, "
                         "then wire. (Box borders define terminal positions — a box "
                         "moving after wiring strands every terminal and wire on it.)"),
            })
        _cert = _last_audit_flag_list
        if int(_cert.get("page") or -1) != _gate_page or not _cert.get("ts"):
            return _text({
                "ok": False, "applied": False, "refused": "box-gate",
                "note": ("REFUSED (nothing applied): no completed audit certifies this "
                         "page's boxes yet. Run audit_page after boxing — wiring opens "
                         "when the audit shows zero open bbox-geometry flags."),
            })
        _live_node_ids = [str(n.get("id")) for n in _snap0.get("nodes") or []]
        if bridge.newest_node_mutation_ts(_live_node_ids) > float(_cert["ts"]):
            return _text({
                "ok": False, "applied": False, "refused": "box-gate",
                "note": ("REFUSED (nothing applied): component geometry changed AFTER "
                         "the last audit — the box certificate is stale. Re-run "
                         "audit_page, clear any box flags, then wire."),
            })
        from src.canvas_copilot.blockers import _violation_state as _v_state

        # Shane-disposed flags never gate (geometry-bound: a later box move
        # resurrects them); parked-awaiting-Shane flags STILL gate — accuracy
        # outranks speed here by his ruling, and his verdict is the unblock.
        _open_geo = [e for e in _cert.get("entries") or []
                     if e.get("rule") in _BOX_GATE_RULES
                     and _v_state({"rule": e.get("rule"), "ids": e.get("ids")},
                                  _snap0) != "disposed"]
        if _open_geo:
            return _text({
                "ok": False, "applied": False, "refused": "box-gate",
                "flags": [{"n": e.get("n"), "rule": e.get("rule"),
                           "ids": e.get("ids"), "detail": e.get("detail")}
                          for e in _open_geo[:8]],
                "note": (f"REFUSED (nothing applied): {len(_open_geo)} open bbox-geometry "
                         "flag(s) on this page — every box must sit correctly before "
                         "wiring (terminals inherit their coordinates from box borders). "
                         "Fix the flagged boxes (or park with raise_to_shane and get his "
                         "verdict), re-audit clean, then wire."),
            })

    # Slate 4.2 see-do freshness — BORN WARN, warn-and-ledger, no refusal.
    # Surviving predicates only: a covering look exists, the look postdates
    # the node's own last geometry change (zombie kill), and the 2nd resize
    # wants an intervening look. Killed and staying dead: the 180s wall
    # clock (0/59 instances) and global event-count staleness. Mark
    # exemption v1: a "Shane"-prefixed reason suppresses (his explicit
    # coordinates; gameable, but this whole surface is WARN-only at birth).
    _seedo_warns: list[str] = []
    if not str(args.get("reason") or "").strip().lower().startswith("shane"):
        _nodes_by_id0 = {str(n.get("id")): n for n in _snap0.get("nodes") or []}
        _page0 = _snap0.get("page")
        for opf in ops:
            kind = opf.get("op")
            checks: list[tuple[str | None, float, float]] = []
            if kind == "resize" and opf.get("id") and str(opf["id"]) in _nodes_by_id0:
                b = _nodes_by_id0[str(opf["id"])].get("bbox") or {}
                checks.append((str(opf["id"]),
                               float(b.get("x", 0)) + float(b.get("width", 0)) / 2,
                               float(b.get("y", 0)) + float(b.get("height", 0)) / 2))
            elif kind == "add_terminal" and opf.get("point"):
                checks.append((str(opf.get("component_id") or "") or None,
                               float(opf["point"].get("x", 0)), float(opf["point"].get("y", 0))))
            elif kind == "add_wire" and (opf.get("path") or []):
                p0, p1 = opf["path"][0], opf["path"][-1]
                checks.append((None, float(p0.get("x", 0)), float(p0.get("y", 0))))
                checks.append((None, float(p1.get("x", 0)), float(p1.get("y", 0))))
            elif kind == "add_component" and opf.get("bbox"):
                b = opf["bbox"]
                checks.append((None, float(b.get("x", 0)) + float(b.get("width", 0)) / 2,
                               float(b.get("y", 0)) + float(b.get("height", 0)) / 2))
            for nid, cx, cy in checks:
                verdict = bridge.freshness_verdict(_page0, nid, cx, cy)
                if verdict:
                    _seedo_warns.append(f"warning: {verdict}")
                    break  # one see-do note per op is enough

    # Slate 3.4 delete-memorial check (born WARN, receipt note): re-creating
    # what Shane ordered deleted gets his deletion quoted back. Same-batch
    # restores are exempt by construction — memorials are recorded AFTER this
    # matching pass, post-apply.
    _memorial_warns: list[str] = []
    for opm in ops:
        kind = opm.get("op")
        hit = None
        if kind == "add_component" and opm.get("bbox"):
            b = opm["bbox"]
            hit = bridge.match_delete_memorial("component", opm.get("label"), {
                "center": {"x": float(b.get("x", 0)) + float(b.get("width", 0)) / 2,
                           "y": float(b.get("y", 0)) + float(b.get("height", 0)) / 2}})
        elif kind == "add_terminal" and opm.get("point"):
            hit = bridge.match_delete_memorial("terminal", opm.get("label"),
                                               {"point": opm["point"]})
        elif kind == "add_wire" and len(opm.get("path") or []) >= 2:
            hit = bridge.match_delete_memorial("wire", opm.get("label"), {
                "a": opm["path"][0], "b": opm["path"][-1]})
        if hit:
            age_min = max(0, int((__import__("time").time() - float(hit.get("ts", 0))) / 60))
            _memorial_warns.append(
                f"warning: this {kind} re-creates an entity deleted under Shane's authority "
                f"{age_min}min ago (delete reason: \"{str(hit.get('reason') or '')[:100]}\") — "
                "if Shane now wants it back, cite his NEW instruction verbatim in the reason; "
                "otherwise do not re-add what he removed")

    # R2.3: naming is a MECHANISM. For unlabeled/non-compliant add_terminal ops,
    # compose T~<owner>~[<pin>~]<net> server-side (naming v3, Shane-ruled
    # 2026-07-07): owner = the parent component's printed designator, pin =
    # nearest printed short designator (omitted when unprinted), net =
    # same-batch wire touching the point (else nearest existing edge label).
    # 0/135 at max effort proved prose can't do string assembly — data can.
    try:
        import re as _re

        from src.canvas_copilot import vectors as _vec
        from src.canvas_copilot.audit import fabricated_name_tokens as _fab_tokens
        from src.canvas_copilot.audit import terminal_name_ok as _name_ok

        _snap_now = bridge.get_state()["snapshot"] or {}
        _page_now = int(_snap_now.get("page") or 1)
        _texts = await _vec.page_texts(_page_now)
        _pin_re = _re.compile(r"^[A-Za-z]{0,3}[0-9]{0,4}$")
        _snapshot_edges = _snap_now.get("edges") or []
        _snapshot_nodes = _snap_now.get("nodes") or []
        _nodes_by_id2 = {str(n.get("id")): n for n in _snapshot_nodes}

        def _owner_of(pt: dict[str, Any], component_id: str | None) -> str | None:
            """Owner slot source: the explicit parent, else the box under the
            point. Never fabricated — no box, no owner (stub vocabulary is the
            agent's call: CONT vs TAP needs judgment)."""
            if component_id and str(component_id) in _nodes_by_id2:
                return str(_nodes_by_id2[str(component_id)].get("label") or "") or None
            for n in _snapshot_nodes:
                b = n.get("bbox") or {}
                if b and b.get("x", 0) - 2 <= pt.get("x", 0) <= b["x"] + b.get("width", 0) + 2 \
                        and b.get("y", 0) - 2 <= pt.get("y", 0) <= b["y"] + b.get("height", 0) + 2:
                    return str(n.get("label") or "") or None
            return None

        def _near_net(pt: dict[str, Any]) -> str | None:
            for op2 in ops:
                if op2.get("op") == "add_wire" and op2.get("label"):
                    pth = op2.get("path") or []
                    if pth and any(abs(q["x"] - pt["x"]) < 14 and abs(q["y"] - pt["y"]) < 14 for q in (pth[0], pth[-1])):
                        return str(op2["label"])
            best, bd = None, 40.0
            for e in _snapshot_edges:
                if not e.get("label"):
                    continue
                for q in e.get("path") or []:
                    d = ((q["x"] - pt["x"]) ** 2 + (q["y"] - pt["y"]) ** 2) ** 0.5
                    if d < bd:
                        bd, best = d, str(e["label"])
            return best

        for op0 in ops:
            if op0.get("op") != "add_terminal":
                continue
            lbl = str(op0.get("label") or "")
            if _name_ok(lbl):
                continue
            pt = op0.get("point") or {}
            pin = None
            bd = 38.0
            for tx in _texts:
                d = ((tx["cx"] - pt.get("x", 0)) ** 2 + (tx["cy"] - pt.get("y", 0)) ** 2) ** 0.5
                if d < bd and 1 <= len(tx["text"]) <= 5 and _pin_re.match(tx["text"]):
                    bd, pin = d, tx["text"]
            # Grading rec #2 (arm 2S): NEVER launder an invented pin into a
            # convention-shaped name. The print is the only pin source; an
            # agent-supplied fallback that is purely numeric (creation-index
            # smell: T-81/82/83 where BU/BV/BW were printed) is refused.
            fallback = lbl if lbl and "-" not in lbl else None
            if pin is None and fallback is not None and not fallback.isdigit():
                pin = fallback
            net = _near_net(pt)
            owner = _owner_of(pt, op0.get("component_id"))
            if owner and net:
                # v3 composition: the pin rides along only when printed and
                # distinct (pin==net was v2's designator-repeat class; pin==
                # owner is the same repeat smell — v3 just omits the slot).
                op0["label"] = (f"T~{owner}~{pin}~{net}"
                                if pin and pin not in (net, owner)
                                else f"T~{owner}~{net}")
                op0["_autonamed"] = True
            elif pin and not net:
                # Grader finding (arm 2S'): build order is box->terminal->wire,
                # so net is None at every mint and the old net-requiring guard
                # was STRUCTURALLY INERT. Record the print-verified pin now;
                # the wire-time composer below finishes the name.
                op0["_pin_verified"] = pin
            elif pin is None:
                op0["_nopin"] = True  # print check needs no net — warn regardless

        # Wire-time composer: when a wire lands on an existing non-compliant
        # terminal that has a printed pin nearby, both ingredients finally
        # exist — append the rename mechanically.
        _ports_now = (bridge.get_state()["snapshot"] or {}).get("ports") or []
        for opw in list(ops):
            if opw.get("op") != "add_wire" or not opw.get("label"):
                continue
            pthw = opw.get("path") or []
            if not pthw:
                continue
            for endpt in (pthw[0], pthw[-1]):
                for prt in _ports_now:
                    if prt.get("type") != "terminal" or _name_ok(str(prt.get("label") or "")):
                        continue
                    pp = prt.get("point") or {}
                    if abs(pp.get("x", 0) - endpt["x"]) > 14 or abs(pp.get("y", 0) - endpt["y"]) > 14:
                        continue
                    wpin, wbd = None, 38.0
                    for tx in _texts:
                        d = ((tx["cx"] - pp.get("x", 0)) ** 2 + (tx["cy"] - pp.get("y", 0)) ** 2) ** 0.5
                        if d < wbd and 1 <= len(tx["text"]) <= 5 and _pin_re.match(tx["text"]):
                            wbd, wpin = d, tx["text"]
                    wowner = None
                    if prt.get("parentId") and str(prt["parentId"]) in _nodes_by_id2:
                        wowner = (str(_nodes_by_id2[str(prt["parentId"])].get("label") or "")
                                  or None)
                    wnet = str(opw["label"])
                    if wowner:
                        ops.append({"op": "rename", "id": prt["id"],
                                    "label": (f"T~{wowner}~{wpin}~{wnet}"
                                              if wpin and wpin not in (wnet, wowner)
                                              else f"T~{wowner}~{wnet}"),
                                    "_autonamed": True})
                        break
                    if wpin and wpin != wnet:
                        # Unparented (stub-class) terminal: no owner to compose —
                        # legacy v2 shape, agent upgrades via stub vocabulary.
                        ops.append({"op": "rename", "id": prt["id"],
                                    "label": f"T~{wpin}~{wnet}", "_autonamed": True})
                        break

        # Rename guard: renames bypass the mint-time check (how MS349's
        # T-101/102/103 recurred). A renamed terminal pin that is numeric
        # with no printed backing near the port earns a ledger warning.
        _ports_by_id = {p.get("id"): p for p in _ports_now}
        for opr in ops:
            if opr.get("op") != "rename" or opr.get("_autonamed"):
                continue
            _rlbl = str(opr.get("label") or "")
            m = (_re.match(r"^T~[^~]+~([^~]+)~[^~]+$", _rlbl)  # v3 pin slot
                 or _re.match(r"^T-([A-Za-z0-9]+)-[A-Za-z0-9]+$", _rlbl))  # legacy
            prt = _ports_by_id.get(opr.get("id"))
            if not m or not prt or prt.get("type") != "terminal":
                continue
            rpin = m.group(1)
            if not rpin.isdigit():
                continue
            pp = prt.get("point") or {}
            backed = any(
                tx["text"] == rpin
                and ((tx["cx"] - pp.get("x", 0)) ** 2 + (tx["cy"] - pp.get("y", 0)) ** 2) ** 0.5 < 38.0
                for tx in _texts
            )
            if not backed:
                opr["_unbacked_pin"] = rpin

        # Owner-rename cascade (naming v3): the owner slot duplicates what
        # parentId knows, and duplicated facts drift — renaming a component
        # mechanically renames its terminals' owner slots in the SAME batch
        # (ELB53→ELB54 must never leave forty stale names behind).
        for opc in list(ops):
            if opc.get("op") != "rename" or opc.get("_autonamed"):
                continue
            cnode = _nodes_by_id2.get(str(opc.get("id") or ""))
            if not cnode:
                continue  # not a component rename
            old_owner = str(cnode.get("label") or "")
            new_owner = str(opc.get("label") or "")
            if not old_owner or not new_owner or old_owner == new_owner:
                continue
            for prt in _ports_now:
                if prt.get("type") != "terminal" or str(prt.get("parentId")) != str(opc["id"]):
                    continue
                plbl = str(prt.get("label") or "")
                if plbl.startswith(f"T~{old_owner}~"):
                    ops.append({"op": "rename", "id": prt["id"],
                                "label": f"T~{new_owner}~" + plbl[len(f"T~{old_owner}~"):],
                                "_autonamed": True, "_owner_cascade": True})

        # Run-2 forensics (rule 22's mint-time twin): convention-SHAPED labels
        # with invented tokens (T~junction~403, T~1~FR40out) pass _name_ok and
        # skip the auto-namer entirely — .27 name accuracy cold. Tag them here
        # so the receipt carries same-turn feedback; server-composed
        # (_autonamed) labels are print-sourced by construction and exempt.
        for opf in ops:
            if opf.get("op") not in ("add_terminal", "rename") or opf.get("_autonamed"):
                continue
            fab = _fab_tokens(str(opf.get("label") or ""))
            if fab:
                opf["_fabricated_tokens"] = fab
    except Exception:
        logger.warning("terminal auto-naming unavailable", exc_info=True)

    # from_detection seeded boxing (Shane's speed directive, 2026-07-06): the
    # detector suggests overall size/shape; the agent supplies identity from
    # print. Resolved SERVER-SIDE (the canvas has no sidecar): det id → bbox,
    # edges refined against printed walls, op rewritten to a plain
    # add_component before dispatch. Verify-by-exception rides the receipt:
    # per-side VECTOR coverage (not detector confidence) is what excuses
    # skipping the capture-judge loop — a seeded box agrees with its
    # detection by construction, so 17b is blind to it; the print witnesses
    # (wall coverage, box-text-integrity, wall-continuation) carry that case.
    _seed_drops: list[str] = []
    try:
        from src.canvas_copilot import vectors as _vec3
        from src.canvas_copilot import yolo as _yolo_seed
        from src.canvas_copilot.extents import refine_bbox_to_walls as _refine

        _seed_ops = [op for op in ops
                     if op.get("op") == "add_component" and op.get("from_detection")]
        if _seed_ops:
            _pg3 = int((bridge.get_state()["snapshot"] or {}).get("page") or 1)
            _dets3 = {str(d.get("id")): d for d in _yolo_seed.page_detections(_pg3)}
            _segs3 = await _vec3.page_segments(_pg3)
            for ops_i, opd in enumerate(list(ops)):
                if opd.get("op") != "add_component" or not opd.get("from_detection"):
                    continue
                det_id = str(opd.pop("from_detection"))
                det = _dets3.get(det_id)
                if det is None or not det.get("bbox"):
                    ops.remove(opd)
                    _seed_drops.append(
                        f"warning: from_detection {det_id} not found in the page-{_pg3} "
                        "sidecar — op DROPPED, nothing minted for it; use "
                        "detect_components for current detection ids")
                    continue
                refined, cov = _refine(det["bbox"], _segs3)
                moved = {k: round(abs(float(refined[k2]) - float(det["bbox"][k2])), 1)
                         for k, k2 in (("x", "x"), ("y", "y"), ("w", "width"), ("h", "height"))}
                opd["bbox"] = refined
                opd["_seeded"] = {
                    "det_id": det_id,
                    "class_name": str(det.get("class_name")),
                    "confidence": round(float(det.get("confidence") or 0.0), 2),
                    "tier": str(det.get("tier")),
                    "coverage": cov,
                    "moved": moved,
                }
    except Exception:
        logger.warning("from_detection seeding unavailable", exc_info=True)

    # Mint-time placement feedback (un-shelved by Shane 2026-07-06, with his
    # enclosure discriminator). Same-turn receipt notes ONLY — gates nothing,
    # persists nothing. Two complementary witnesses, calibrated on gold v1.4
    # (0 fires) + run-2 (each catches exactly its class):
    #  (a) wall-continuation (vectors): the drawn edge sits on a printed wall
    #      that anchors an ENCLOSURE (perpendicular corners at BOTH wall ends
    #      rising on the box-interior side — a wire is a solitary run and can
    #      never fire) and continues past the box end. Catches CNV40-at-93%,
    #      which 17b's fractional thresholds cannot see. Connector-family
    #      boxes are exempt (plugs straddle module walls by design).
    #  (b) 17b detection-coverage at op time (yolo): the new box covers a
    #      fraction of a strong detection. Catches the M40 class, whose
    #      printed cell never closes — the detector is the only witness.
    try:
        from src.canvas_copilot import vectors as _vec2
        from src.canvas_copilot.audit import _CONNECTOR_FAMILY as _conn_fam
        from src.canvas_copilot.audit import detection_coverage_gaps as _det_gaps
        from src.canvas_copilot.extents import wall_continuation_findings as _wall_chk

        _snap_g = bridge.get_state()["snapshot"] or {}
        _pg2 = int(_snap_g.get("page") or 1)
        _geo_ops = [op for op in ops if op.get("op") in ("add_component", "resize")
                    and op.get("bbox")]
        if _geo_ops:
            _segs2 = await _vec2.page_segments(_pg2)
            try:
                from src.canvas_copilot import yolo as _yolo2

                _dets2 = _yolo2.page_detections(_pg2)
            except Exception:
                _dets2 = []
            _nodes_by_id = {str(n.get("id")): n for n in _snap_g.get("nodes") or []}
            from src.canvas_copilot.audit import detection_testimony as _det_testimony

            for opb in _geo_ops:
                bb = opb.get("bbox") or {}
                lab = str(opb.get("label")
                          or (_nodes_by_id.get(str(opb.get("id"))) or {}).get("label") or "")
                if not _conn_fam.match(lab):
                    wf = _wall_chk(bb, _segs2)
                    if wf:
                        opb["_wall_findings"] = wf
                gaps = _det_gaps(bb, _dets2)
                if gaps:
                    opb["_det_gaps"] = gaps
                # Answer-sheet accountability (Shane 2026-07-06): every
                # FREEHAND component mint states the detector's testimony —
                # agreement, disagreement, or absence. Seeded mints are
                # reconciled by construction and carry provenance instead.
                if opb.get("op") == "add_component" and not opb.get("_seeded"):
                    opb["_testimony"] = _det_testimony(bb, _dets2)
                # Playbook injection (Shane's bless tool, 2026-07-06): when a
                # blessed play exists for this situation's class/label family,
                # its one-liner rides the receipt — evidence in the field of
                # view at the moment of decision, never a drawer to remember.
                if opb.get("op") == "add_component":
                    try:
                        from src.canvas_copilot import playbook as _pb
                        from src.canvas_copilot.audit import _FAMILY_RE as _fam_re

                        _fam_m = _fam_re.match(lab)
                        plays = _pb.lookup({
                            "label_family": _fam_m.group(1) if _fam_m else None,
                            "class_name": ((opb.get("_seeded") or {}).get("class_name")
                                           or ((opb.get("_testimony") or {}).get("class_name"))),
                        })
                        if plays:
                            opb["_plays"] = plays
                    except Exception:
                        logger.debug("playbook lookup unavailable", exc_info=True)
    except Exception:
        logger.debug("mint-time placement feedback unavailable", exc_info=True)

    key = uuid.uuid4().hex
    state0 = bridge.get_state()
    seq_before = state0["snapshot_seq"]
    stats_before = (state0["snapshot"] or {}).get("graph_stats")
    # Page stamp (run-3 prep, 2026-07-06): replays can drain minutes later on a
    # canvas showing a DIFFERENT page — run 2 landed correctly by luck. The
    # canvas refuses-and-acks a stamped batch on a mismatched page, so a stale
    # replay can never draw onto the wrong sheet. Stamp = the page this batch
    # was authored against (the guard above already matched it to bound_page).
    _stamp_page = (state0["snapshot"] or {}).get("page")
    cmd = {"type": "annotate", "ops": ops, "reason": _clean_reason(args.get("reason")),
           "idempotency_key": key,
           **({"page": int(_stamp_page)} if _stamp_page is not None else {})}
    ids = bridge.send_commands([cmd])

    # Block on the canvas's apply-receipt (arrives via the events channel, which
    # is plain POSTs — it works even when the SSE command stream just died).
    receipt = await bridge.wait_for_annotate_applied(key, timeout_s=6.0)
    resent = False
    if receipt is None and bridge.bridge_stats()["canvases_connected"] > 0:
        # A canvas looks alive but nothing acked: the stream likely dropped right
        # at dispatch. One resend under the same idempotency key is safe — the
        # canvas applies each key once and acks duplicates without re-applying.
        resent = True
        ids += bridge.send_commands([cmd])
        receipt = await bridge.wait_for_annotate_applied(key, timeout_s=6.0)
    if receipt is None:
        connected = bridge.bridge_stats()["canvases_connected"]
        return _text(
            {
                "ok": False,
                "applied": False,
                "command_id": ids[0],
                "canvases_connected": connected,
                "note": (
                    "No apply-receipt from the canvas. "
                    + (
                        "No canvas is connected (page closed or reloading) — the command replays "
                        "automatically when it reconnects (up to 10 min). "
                        if connected == 0
                        else "A canvas is connected but did not ack (mid-reload?); the command stays "
                        "eligible for replay. "
                    )
                    + "Do NOT re-dispatch these ops; redelivery is already handled. Check get_state "
                    "in a moment or tell Shane the canvas looks disconnected."
                ),
            }
        )

    if receipt.get("refused"):
        # Canvas-layer page-stamp refusal: the batch reached a canvas showing a
        # different page (mid-flight flip or a replay after one). Nothing drew.
        return _text({
            "ok": False, "applied": False, "refused": str(receipt.get("refused")),
            "command_id": ids[0],
            "stamped_page": receipt.get("stamped_page"),
            "canvas_page": receipt.get("page"),
            "note": (f"The canvas REFUSED this batch: authored for page "
                     f"{receipt.get('stamped_page')} but the canvas shows page "
                     f"{receipt.get('page')} — nothing was applied (the run-2 "
                     "replay-after-flip class). goto_page back to your work page "
                     "and re-issue if the ops still stand."),
        })

    # Applied. Wait briefly for the post-apply snapshot echo so stats reflect it
    # (posts are throttled ~600ms; count-neutral ops like rename won't move them).
    fresh: dict[str, Any] = bridge.get_state()["snapshot"] or {}
    for _ in range(8):
        state = bridge.get_state()
        snap = state["snapshot"] or {}
        if state["snapshot_seq"] > seq_before and snap.get("graph_stats") != stats_before:
            fresh = snap
            break
        await asyncio.sleep(0.3)
        fresh = bridge.get_state()["snapshot"] or {}

    summary: dict[str, Any] = {
        "ok": True,
        "applied": True,
        "command_id": ids[0],
        "applied_on_page": receipt.get("page"),
        "resent": resent,
        "duplicate": bool(receipt.get("duplicate")),
        # Per-op ground truth from the canvas executor: what was added, what
        # was SKIPPED (dedupe, degenerate, too-small) and what got minted.
        # Read these before claiming an op landed.
        "notes": (receipt.get("notes") or [])
        + [("owner cascade: " if op.get("_owner_cascade") else "auto-named terminal ")
           + f"{op.get('label')} (owner from the parent box; verify pin designator)"
           for op in ops if op.get("_autonamed")]
        + [f"warning: no printed pin designator within 38px of ({(op.get('point') or {}).get('x', 0):.0f},"
           f"{(op.get('point') or {}).get('y', 0):.0f}) — terminal label unverified against the print"
           for op in ops if op.get("_nopin")]
        + [f"printed pin '{op.get('_pin_verified')}' verified at mint — name completes when wired"
           for op in ops if op.get("_pin_verified")]
        + [f"warning: renamed terminal pin '{op.get('_unbacked_pin')}' has NO printed text within "
           "38px of the port — invented-pin suspect (renames are not verification)"
           for op in ops if op.get("_unbacked_pin")]
        + [f"warning: label {op.get('label')} carries invented-looking token(s) "
           f"{', '.join(repr(t) for t in (op.get('_fabricated_tokens') or [])[:3])} — print is the "
           "only source. Shape is T~<owner>~[<pin>~]<net>: owner = parent component designator "
           "(pseudo-owners CONT/TAP for stubs); no printed pin → omit the slot; unwired spare "
           "pins take SPARE as net; the net slot is the net's PRINTED label — trace the "
           "conductor to it, never coin in/out variants. Fix with a rename now"
           for op in ops if op.get("_fabricated_tokens")]
        + [f"placement feedback ({op.get('op')}): the {w['edge']} edge sits on a printed wall "
           f"spanning {w['wall_span'][0]:.0f}..{w['wall_span'][1]:.0f} that anchors enclosure "
           f"corners and continues {max(w['extends_px']):.0f}px past your box "
           f"({w['wall_over_edge']:.1f}x the edge) — the printed enclosure keeps going (the "
           "CNV40 class); LOOK (capture) and re-derive the extent before wiring. Wall evidence "
           "only speaks when present — absence proves nothing"
           for op in ops for w in (op.get("_wall_findings") or [])[:2]]
        + [f"placement feedback ({op.get('op')}): your box covers only {g['frac']:.0%} of a "
           f"strong {g['class_name']} detection (conf {g['confidence']:.2f}) at "
           f"({g['det_bbox'].get('x', 0):.0f},{g['det_bbox'].get('y', 0):.0f} "
           f"{g['det_bbox'].get('width', 0):.0f}x{g['det_bbox'].get('height', 0):.0f}) — the "
           "component likely extends FAR beyond the drawn extent (the M40 class); capture "
           "show_yolo:true and re-derive before wiring"
           for op in ops for g in (op.get("_det_gaps") or [])[:2]]
        + [(lambda s: (
            f"seeded {op.get('label') or 'component'} from {s['tier']} {s['class_name']} "
            f"detection {s['det_id']} (conf {s['confidence']:.2f}); edges refined to printed "
            f"walls (moved x{s['moved']['x']}/y{s['moved']['y']}/w{s['moved']['w']}/h{s['moved']['h']}px); "
            "side coverage "
            + " ".join(f"{k[0].upper()}{v:.2f}" for k, v in s["coverage"].items())
            + (" — ALL SIDES print-backed: verified by construction, no capture-judge "
               "loop needed" if min(s["coverage"].values()) >= 0.5 else
               " — LOW-coverage side(s) "
               + ",".join(k for k, v in s["coverage"].items() if v < 0.5)
               + " have no printed wall in reach: verify those edges with your eyes")
           ))(op["_seeded"])
           for op in ops if op.get("_seeded")]
        + [(f"detector testimony: matches strong {t['class_name']} detection "
            f"(conf {t['confidence']:.2f}, IoU {t['iou']:.2f})" if t.get("kind") == "match"
            else "detector testimony: no detection here — absence proves nothing; "
                 "proceed on print")
           for op in ops for t in [op.get("_testimony")] if t]
        + [f"playbook: Shane blessed a play for this situation ({p['id']}) — "
           f"\"{str(p.get('shane_text'))[:140]}\" — playbook tool with card_id for the image"
           for op in ops for p in (op.get("_plays") or [])[:1]]
        + _seed_drops
        + [f"warning: add_wire endpoint lands on plug {op.get('_plug_face')}'s box away from its "
           "terminals — plugs mate by contact; verify this is a real drawn conductor, not a wire "
           "standing in for the mating connection"
           for op in ops if op.get("_plug_face")]
        + [f"warning: {op.get('op')} touches element under active audit violation "
           f"({_last_audit_flagged.get(str(op.get('id')))}) — renames/deletes are NOT fixes; "
           "repair reality or disposition with a reason"
           for op in ops
           if op.get("op") in ("rename", "delete") and str(op.get("id")) in _last_audit_flagged]
        + _seedo_warns
        + _auth_warn
        + _memorial_warns
        + _ctx_band_note(),
        # Parallel to your ops: role->id of everything each op minted (or the
        # port ids a wire reused). Use these directly for rename/attach/
        # reparent follow-ups — no capture-to-harvest-ids round-trip needed.
        "minted": receipt.get("minted") or [],
        "graph_stats_before": stats_before,
        "graph_stats": fresh.get("graph_stats"),
        "applied_snapshot_seq": bridge.get_state()["snapshot_seq"],
    }

    # Slate 6.11: receipts feed the session receipt log — the handoff's
    # RECEIPTS summary is server arithmetic, never prose (hand counts drifted:
    # "2 mislabeled terminals" vs 3 rename receipts).
    try:
        from src.canvas_copilot.copilot import copilot_session as _sess

        for op in ops:
            _sess.receipt_log.append({
                "op": str(op.get("op") or "?"),
                "ref": str(op.get("label") or op.get("id") or op.get("component_id") or "")[:40],
            })
        del _sess.receipt_log[:-400]
        _sess.unaudited_ops += len(ops)  # 4.1: zeroed by the next completed audit
        _sess._persist()
        _sess.note_first_op_after_handoff()  # slate 7.1: measurement only
    except Exception:
        logger.debug("receipt log unavailable", exc_info=True)

    # Slate 4.2: stamp geometry mutations (your own edit stales your own
    # picture — the zombie predicate is derived from these), and ledger the
    # in-session staleness warns (zombie/interlock classes; the no-covering-
    # look note stays receipt-only so a server restart can't mint ledger
    # debt out of an empty capture log).
    try:
        for op in ops:
            if op.get("op") == "resize" and op.get("id"):
                bridge.note_geometry_mutation(str(op["id"]), resize=True)
                # Slate 3.3: a resize under live geometry-clearable flags is a
                # clearing ATTEMPT — judged at the next audit.
                bridge.note_resize_under_flags(
                    str(op["id"]),
                    _last_audit_flagged.get(str(op["id"])) in bridge.GEO_CLEARABLE_RULES)
            elif op.get("op") == "delete" and op.get("id"):
                bridge.note_geometry_mutation(str(op["id"]))
        for m in receipt.get("minted") or []:
            for mid in (m or {}).values():
                bridge.note_geometry_mutation(str(mid))
        for w in _seedo_warns:
            if "no capture on record" not in w:
                bridge.add_warning(receipt.get("page"), w)
    except Exception:
        logger.debug("see-do stamping unavailable", exc_info=True)

    # Slate 3.4: record Shane-attributed DIRECT delete targets (never
    # cascades) into the memorial ledger — after matching, so same-batch
    # restores stay exempt.
    try:
        if str(args.get("reason") or "").strip().lower().startswith("shane"):
            _pre_nodes = {str(n.get("id")): n for n in _snap0.get("nodes") or []}
            _pre_ports = {str(p.get("id")): p for p in _snap0.get("ports") or []}
            _pre_edges = {str(e.get("id")): e for e in _snap0.get("edges") or []}
            for opd in ops:
                if opd.get("op") != "delete":
                    continue
                did = str(opd.get("id"))
                if did in _pre_nodes:
                    b = _pre_nodes[did].get("bbox") or {}
                    bridge.add_delete_memorial({
                        "kind": "component", "label": _pre_nodes[did].get("label"),
                        "center": {"x": float(b.get("x", 0)) + float(b.get("width", 0)) / 2,
                                   "y": float(b.get("y", 0)) + float(b.get("height", 0)) / 2},
                        "reason": args.get("reason")})
                elif did in _pre_ports:
                    bridge.add_delete_memorial({
                        "kind": "terminal", "label": _pre_ports[did].get("label"),
                        "point": _pre_ports[did].get("point") or {},
                        "reason": args.get("reason")})
                elif did in _pre_edges:
                    path = _pre_edges[did].get("path") or []
                    if len(path) >= 2:
                        bridge.add_delete_memorial({
                            "kind": "wire", "label": _pre_edges[did].get("label"),
                            "a": path[0], "b": path[-1], "reason": args.get("reason")})
    except Exception:
        logger.debug("delete memorial recording unavailable", exc_info=True)

    # Slate 3.5 cascade-delta differ: graph_stats before/after already ride
    # every receipt — the diff didn't. Unexplained DECREASES in entity types
    # this batch never named get a receipt note (explicitly NOT a gate; the
    # measured case: a rewiring batch silently dropped continuations 2->0 and
    # the handoff recorded "0 continuations" as normal).
    _cascade_notes: list[str] = []
    try:
        _sb, _sa = stats_before or {}, (fresh.get("graph_stats") or {})
        _touched = {op.get("op") for op in ops}
        _type_ops = {"components": {"add_component", "delete", "clear"},
                     "terminals": {"add_terminal", "delete", "clear", "normalize_taps"},
                     "wires": {"add_wire", "delete", "clear", "normalize_taps"},
                     "continuations": {"add_continuation", "delete", "clear"}}
        for typ, expl in _type_ops.items():
            b0, a0 = int(_sb.get(typ) or 0), int(_sa.get(typ) or 0)
            if a0 < b0 and not (_touched & expl):
                _cascade_notes.append(
                    f"cascade: {b0 - a0} {typ} dropped by this batch though no op named "
                    f"{typ} — deletions cascade to dependents; verify this was intended "
                    "(a silent 2->0 continuation drop once evaporated at reset)")
        if _cascade_notes:
            summary["notes"] = list(summary["notes"]) + _cascade_notes
    except Exception:
        logger.debug("cascade differ unavailable", exc_info=True)

    # Visual proof, not just delivery proof (Shane, 2026-07-03): geometry ops
    # come back with POST-APPLY close-ups so "fixed" claims are grounded in
    # pixels the model has actually seen —
    #   add_component/resize -> a close-up per affected box (fit judging)
    #   wire/terminal/continuation/delete -> close-up(s) of the edited region
    spatial = [op for op in ops if op.get("op") in ("add_component", "resize")]
    region_ops = [op for op in ops if op.get("op") in ("add_wire", "add_terminal", "add_continuation", "delete")]
    if not spatial and not region_ops:
        return _text(summary)  # rename/attach/meta/clear — nothing spatial to show

    nodes: list[dict[str, Any]] = fresh.get("nodes") or []

    def _affected(op: dict[str, Any]) -> dict[str, Any] | None:
        b = op.get("bbox") or {}
        # Match by exact bbox first (authoritative for both add + resize)...
        for n in nodes:
            nb = n.get("bbox") or {}
            if all(abs(float(nb.get(k, -1)) - float(b.get(k, -2))) < 2 for k in ("x", "y", "width", "height")):
                return n
        # ...else by label (add) or id (resize).
        if op.get("label"):
            for n in reversed(nodes):
                if n.get("label") == op["label"]:
                    return n
        if op.get("id"):
            for n in nodes:
                if n.get("id") == op["id"]:
                    return n
        return None

    try:
        from src.canvas_copilot import vectors

        page_segs = await vectors.page_segments(int(receipt.get("page") or 1))
        page_circles_cache = await asyncio.to_thread(
            vectors.page_circles, int(receipt.get("page") or 1)
        )
    except Exception:
        logger.warning("page vectors unavailable for close-up manifests", exc_info=True)
        page_segs = []
        page_circles_cache = []

    def _closeup_manifest(r: dict[str, Any]) -> dict[str, Any]:
        """Compact in-frame manifest for a post-apply close-up: page-space
        geometry only (drop *_px) so endpoint checks are numeric, not eyeballed.
        Includes the printed artwork's vector segments — drawn-vs-printed offset
        is a subtraction, not a pixel judgment."""
        def _strip(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [{k: v for k, v in it.items() if not k.endswith("_px")} for it in items]
        out = {
            "region": r.get("region"),
            "components": _strip(r.get("components") or []),
            "wires": _strip(r.get("wires") or []),
            "terminals": _strip(r.get("terminals") or []),
        }
        if page_segs:
            from src.canvas_copilot import vectors

            segs, dropped = vectors.segments_in_region(page_segs, r.get("region") or {}, limit=60)
            out["artwork_segments"] = segs
            if dropped:
                out["artwork_note"] = f"{dropped} shorter artwork segments in frame not listed"
        if page_circles_cache:
            from src.canvas_copilot import vectors

            circles, _ = vectors.circles_in_region(page_circles_cache, r.get("region") or {}, limit=40)
            out["printed_circles"] = circles
        return out

    def _resize_delta_region(old: dict[str, Any], new: dict[str, Any]) -> dict[str, float] | None:
        """Frame just the moved edge(s) of a resize, high zoom — a 4-unit nudge
        must be VISIBLE (whole-box framing once made a real error sub-pixel).
        EXCEPT big growth: CNV40 grew 3.67x and was reviewed via a 96px sliver
        that hid the swallow (grading rec #4) — >2x area change gets the WHOLE
        box so 'does it now contain another named symbol?' is answerable."""
        area_old = max(1.0, old["width"] * old["height"])
        area_new = max(1.0, new["width"] * new["height"])
        if area_new > 2.0 * area_old or area_new < 0.5 * area_old:
            return None  # whole-box framing
        moved: list[dict[str, float]] = []
        pad = 30.0
        edges = [
            ("left", old["x"], new["x"], True), ("right", old["x"] + old["width"], new["x"] + new["width"], True),
            ("top", old["y"], new["y"], False), ("bottom", old["y"] + old["height"], new["y"] + new["height"], False),
        ]
        for _name, was, now, vertical in edges:
            if abs(now - was) < 0.5:
                continue
            if vertical:
                moved.append({"x": min(was, now) - pad, "y": new["y"] - pad,
                              "width": abs(now - was) + 2 * pad, "height": new["height"] + 2 * pad})
            else:
                moved.append({"x": new["x"] - pad, "y": min(was, now) - pad,
                              "width": new["width"] + 2 * pad, "height": abs(now - was) + 2 * pad})
        if not moved or len(moved) >= 4:
            return None  # nothing moved, or the whole box moved — whole-box framing is right
        x0 = min(m["x"] for m in moved)
        y0 = min(m["y"] for m in moved)
        x1 = max(m["x"] + m["width"] for m in moved)
        y1 = max(m["y"] + m["height"] for m in moved)
        return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}

    nodes0 = {n.get("id"): n.get("bbox") for n in (state0["snapshot"] or {}).get("nodes") or []}

    content: list[dict[str, Any]] = []
    shown: list[str] = []
    for op in spatial[:3]:
        node = _affected(op)
        if not node:
            continue
        render_kwargs: dict[str, Any] = {"component_id": node["id"], "pad": 60.0, "max_px": 520}
        caption = f"close-up of {node.get('label')} bbox={node.get('bbox')}"
        if op.get("op") == "resize":
            old_bbox = nodes0.get(node.get("id"))
            delta = _resize_delta_region(old_bbox, node.get("bbox")) if old_bbox and node.get("bbox") else None
            if delta:
                # >=4 px per page-unit so single-digit nudges are visible.
                render_kwargs = {
                    "region": delta,
                    "max_px": int(max(480, min(1100, 4 * max(delta["width"], delta["height"])))),
                }
                caption = f"changed-edge close-up of {node.get('label')} (old bbox {old_bbox} -> new {node.get('bbox')})"
        try:
            r = await asyncio.to_thread(
                render_capture, include_text_layer=False, encode_b64=True, **render_kwargs,
            )
        except Exception:
            continue
        if r.get("b64"):
            shown.append(str(node.get("label") or node["id"]))
            content.append(
                {"type": "text",
                 "text": f"{caption} (region {r['region']}):"}
            )
            content.append({"type": "image", "data": r["b64"], "mimeType": "image/png"})
            content.append(
                {"type": "text",
                 "text": "in-frame manifest (page coords — check endpoints numerically): "
                 + json.dumps(_closeup_manifest(r), ensure_ascii=False)}
            )
            await _mirror_image_to_panel(
                "annotate", f"post-apply close-up: {node.get('label')}", r["b64"], r.get("debug_path")
            )

    # Region close-ups: union of every coordinate the ops touched (deleted
    # elements are located via the pre-dispatch snapshot), split in two when
    # the batch spans too much page to read at close zoom.
    snap0 = state0["snapshot"] or {}
    port_pts0 = {p.get("id"): p.get("point") for p in snap0.get("ports") or []}

    def _op_points(op: dict[str, Any]) -> list[dict[str, Any]]:
        o = op.get("op")
        if o == "add_wire":
            return [p for p in op.get("path") or [] if isinstance(p, dict)]
        if o in ("add_terminal", "add_continuation"):
            return [op["point"]] if isinstance(op.get("point"), dict) else []
        if o in ("add_component", "resize"):
            b = op.get("bbox") or {}
            if not b:
                return []
            return [{"x": b["x"], "y": b["y"]},
                    {"x": b["x"] + b["width"], "y": b["y"] + b["height"]}]
        if o == "delete":
            did = op.get("id")
            pts: list[dict[str, Any]] = []
            pp = port_pts0.get(did)
            if isinstance(pp, dict):
                pts.append(pp)
            for n in snap0.get("nodes") or []:
                if n.get("id") == did and n.get("bbox"):
                    b = n["bbox"]
                    pts += [{"x": b["x"], "y": b["y"]},
                            {"x": b["x"] + b["width"], "y": b["y"] + b["height"]}]
            for e in snap0.get("edges") or []:
                if e.get("id") == did:
                    for pid in (e.get("sourcePortId"), e.get("targetPortId")):
                        ep = port_pts0.get(pid)
                        if isinstance(ep, dict):
                            pts.append(ep)
            return pts
        return []

    region_meta: list[dict[str, Any]] = []
    if region_ops:
        pts = [p for op in ops for p in _op_points(op)]
        regions: list[dict[str, float]] = []
        if pts:
            def _rbox(ps: list[dict[str, Any]]) -> dict[str, float]:
                xs = [float(p["x"]) for p in ps]
                ys = [float(p["y"]) for p in ps]
                pad_ = 50.0
                return {"x": min(xs) - pad_, "y": min(ys) - pad_,
                        "width": (max(xs) - min(xs)) + 2 * pad_,
                        "height": (max(ys) - min(ys)) + 2 * pad_}
            union = _rbox(pts)
            if max(union["width"], union["height"]) > 1600 and len(pts) > 1:
                key = "y" if union["height"] >= union["width"] else "x"
                mid = (min(float(p[key]) for p in pts) + max(float(p[key]) for p in pts)) / 2
                lo = [p for p in pts if float(p[key]) <= mid]
                hi = [p for p in pts if float(p[key]) > mid]
                regions = [_rbox(g) for g in (lo, hi) if g]
            else:
                regions = [union]
        for reg in regions[:2]:
            try:
                r = await asyncio.to_thread(
                    render_capture, region=reg, max_px=900,
                    include_text_layer=False, encode_b64=True,
                )
            except Exception:
                continue
            if r.get("b64"):
                region_meta.append(r["region"])
                content.append(
                    {"type": "text",
                     "text": (f"POST-APPLY close-up of the edited region {r['region']} — judge the geometry "
                              "against the artwork (wire on the printed line? terminal on the lead? tap on "
                              "the dot?) before claiming anything is fixed:")}
                )
                content.append({"type": "image", "data": r["b64"], "mimeType": "image/png"})
                content.append(
                    {"type": "text",
                     "text": "in-frame manifest (page coords — check endpoints numerically): "
                     + json.dumps(_closeup_manifest(r), ensure_ascii=False)}
                )
                await _mirror_image_to_panel(
                    "annotate", f"post-apply region {r['region']}", r["b64"], r.get("debug_path")
                )

    summary["closeups"] = shown
    summary["region_closeups"] = region_meta
    # Mid-turn ctx visibility (arm 2S': a long turn crossed soft->hard entirely
    # between nudges and fell back to asking Shane). The reading is one turn
    # stale but the trend is monotonic within a session — seeing 'HARD' mid-turn
    # is enough to trigger the handoff rule.
    try:
        from src.canvas_copilot.copilot import _ctx_nudge, copilot_session

        nudge = _ctx_nudge(copilot_session.last_context)
        if nudge and ("HARD" in nudge or "handoff" in nudge):
            summary["ctx"] = nudge + " [reading from last turn-end; it only grows]"
    except Exception:
        pass
    if len(spatial) > 3:
        summary["note"] = f"{len(spatial) - 3} more spatial ops not shown — capture to review them"
    return {"content": [{"type": "text", "text": json.dumps(summary, ensure_ascii=False)}, *content]}


# element id -> rule from the most recent audit (audit-gaming counter, arm 2S':
# BAT40 was erased/relabeled to clear a box-overlap WARN instead of repaired).
_last_audit_flagged: dict[str, str] = {}
# Box gate (Shane 2026-07-07): the bbox-GEOMETRY flag classes that hold wiring
# closed. Strictly box extent/position rules — never unwired-node (wiring is
# its cure), never terminal-placement classes (mid-wiring feedback with their
# own rails), never label/naming classes (position-irrelevant).
# yolo-extent-mismatch REMOVED 2026-07-09 (Shane: "the yolo data is just
# evidence, not a gate") — detector evidence says LOOK HERE; it still fires as
# a WARN needing fix-or-disposition, but it never holds wiring closed. Gating
# on it deadlocked page 8: evidence flags nobody could 'fix' (boxes were
# correct) blocked every wire behind Shane-verdict round-trips.
_BOX_GATE_RULES = frozenset({
    "bbox-truncation-floor", "box-overlap", "sibling-overlap",
    "box-swallows-enclosures",
    "box-text-integrity", "box-includes-continuation",
})
# Numbered flag layer (Shane's idea, 2026-07-06): every ERROR+WARN violation
# with resolvable elements from the LAST completed audit, numbered — captures
# render them as crimson flags with a manifest legend, and Shane's canvas
# gets them as highlights. Cached here (never recomputed at look time:
# compute_page_audit has side effects — strike judgment, ledger moots).
_last_audit_flag_list: dict[str, Any] = {}
_last_flag_push_sig: list[str] = [""]


_FLAG_SIG_RESET = "\x00reset"  # non-empty sentinel — see reset_flag_push_sig


def reset_flag_push_sig() -> None:
    """Force the next audit to re-assert the flag layer. Called when a canvas
    (re)subscribes: a freshly (re)loaded canvas starts with no flags, but the
    sig-gate would skip re-pushing an unchanged flag SET — leaving the reloaded
    page blank until the set next changes. Closes the reload/reconnect arm of
    'flags vanish and stay gone'.

    A NON-EMPTY sentinel (not "") is deliberate: it differs from every real sig so
    the push branch fires, AND it differs from "" so the clean-page clear branch
    (guarded by `!= ""`) ALSO fires — otherwise a reconnect followed by the page
    going clean would leave a resolved defect's pill stranded (ttl_ms:0 never
    reaps it). The next audit overwrites the sentinel with a real sig or ""."""
    _last_flag_push_sig[0] = _FLAG_SIG_RESET


def _flags_for_render(snap: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve cached numbered flags to CURRENT element positions; elements
    deleted/moved since the audit drop out or move with the graph (honest
    staleness — the manifest stamps the audit's snapshot_seq)."""
    entries = _last_audit_flag_list.get("entries") or []
    if not entries:
        return []
    if int(_last_audit_flag_list.get("page") or -1) != int(snap.get("page") or -2):
        return []
    nodes = {str(n.get("id")): n for n in snap.get("nodes") or []}
    ports = {str(p.get("id")): p for p in snap.get("ports") or []}
    edges = {str(e.get("id")): e for e in snap.get("edges") or []}
    conts = {str(c.get("id")): c for c in snap.get("continuations") or []}
    out: list[dict[str, Any]] = []
    for e in entries:
        pts: list[dict[str, Any]] = []
        for i in e.get("ids") or []:
            if i in nodes:
                b = nodes[i].get("bbox") or {}
                if b:
                    pts.append({"x": b["x"], "y": b["y"]})
            elif i in ports:
                p = ports[i].get("point") or {}
                if p:
                    pts.append(dict(p))
            elif i in edges:
                path = edges[i].get("path") or []
                if path:
                    pts.append(dict(path[len(path) // 2]))
            elif i in conts:
                p = conts[i].get("point") or {}
                if p:
                    pts.append(dict(p))
        if pts:
            out.append({**e, "points": pts})
    return out


async def compute_page_audit() -> dict[str, Any] | None:
    """Assemble + run the full audit for the current page. Shared by the
    audit_page tool and queue_reset's server-side handoff attach (grading
    rec #5: violations ride the handoff note verbatim, never paraphrased)."""
    from src.canvas_copilot.audit import audit_graph

    import asyncio

    state = bridge.get_state()
    snap = state["snapshot"] or {}
    if not snap:
        return None
    page = snap.get("page")
    circles = enclosures = segments = texts = None
    try:
        from src.canvas_copilot import vectors

        segments = await vectors.page_segments(int(page))
        circles = await asyncio.to_thread(vectors.page_circles, int(page))
        enclosures = await asyncio.to_thread(vectors.page_enclosures, int(page))
        texts = await vectors.page_texts(int(page))
    except Exception:
        logger.warning("audit v2 geometry unavailable — running v1 rules only", exc_info=True)
    yolo_dets = None
    try:
        from src.canvas_copilot import yolo

        yolo_dets = yolo.page_detections(int(page))
    except Exception:
        logger.warning("yolo sidecar unavailable — audit runs without evidence rule", exc_info=True)
    # Slate 6.10: per-audit re-verification moots ledger entries whose entity
    # is gone or whose condition cleared — logged as reviewable dispositions
    # (the sanctioned clearing path; without it "port-4ad1aeb9" warnings
    # persisted a whole segment after the port was deleted).
    moots = bridge.moot_stale_warnings(snap)
    result = audit_graph(snap, bridge.warning_ledger(page),
                         circles=circles, enclosures=enclosures, segments=segments,
                         texts=texts, yolo_detections=yolo_dets)
    result["page"] = page
    if moots:
        result["ledger_moots"] = (f"{moots} stale ledger warning(s) auto-mooted on "
                                  "re-verification (entity gone / condition cleared) — "
                                  "reviewable via the server disposition log")
    # Slate 3.3: judge pending resize strikes — a 3rd resize that cleared
    # nothing auto-files a suspected-FP ticket and PARKS it awaiting-shane
    # (the parked ticket STILL blocks done — three token nudges must not
    # become a blocker-laundering channel). Born WARN: the auto-park does
    # NOT freeze geometry (that is the promoted executor tier — see the
    # provenance exemption in the annotate lock).
    try:
        from src.canvas_copilot import blockers as _blk

        node_flags: dict[str, set[str]] = {}
        for v in result.get("violations") or []:
            for vid in v.get("ids") or []:
                node_flags.setdefault(str(vid), set()).add(str(v.get("rule")))
        strike_notes = []
        for nid in bridge.pending_strike_nodes():
            geo_now = node_flags.get(nid, set()) & bridge.GEO_CLEARABLE_RULES
            n = bridge.judge_resize_strike(nid, bool(geo_now))
            if n >= 3 and geo_now:
                rule0 = sorted(geo_now)[0]
                if not _blk.element_state(rule0, nid):
                    _blk.park_ticket(rule0, nid,
                                     f"{n} consecutive resizes cleared nothing — suspected "
                                     "false positive (law vs measurement); Shane please rule",
                                     provenance="three-strike auto-park")
                strike_notes.append(
                    {"rule": "three-strike-fp-escalation", "severity": "WARN", "ids": [nid],
                     "detail": f"element {nid}: {n} consecutive resizes cleared no "
                               f"geometry flag ({', '.join(sorted(geo_now))}) — auto-parked "
                               "as suspected false positive AWAITING SHANE; further "
                               "attempts need a genuinely NEW evidence class (fresh tight "
                               "overlay-off capture or extent derivation)"})
        if strike_notes:
            result["violations"] = list(result.get("violations") or []) + strike_notes
            result.setdefault("counts", {})["WARN"] = (
                int(result.get("counts", {}).get("WARN") or 0) + len(strike_notes))
            result["clean"] = False
    except Exception:
        logger.warning("three-strike escalation unavailable", exc_info=True)

    # Slate 4.6(a): extent-verified stamps — fixes to already-calibrated rules
    # (same family as the shipped detector-corroboration exemption). Truncation
    # checks SKIP stamped nodes (the audit once demanded reverting Shane's
    # ev165 correction forever — ticket b62336c6 rode 4+ handoffs); fix-hints
    # on stamped nodes INVERT: the box is law, the terminal is stale.
    try:
        from src.canvas_copilot.blockers import extent_stamp

        bbox_by_node = {str(n.get("id")): n.get("bbox") for n in snap.get("nodes") or []}
        parent_of = {str(p.get("id")): str(p.get("parentId"))
                     for p in snap.get("ports") or [] if p.get("parentId")}
        kept_v = []
        for v in result.get("violations") or []:
            ids = [str(i) for i in (v.get("ids") or [])]
            stamped_node = next(
                (i for i in ids
                 if i in bbox_by_node and extent_stamp(i, bbox_by_node.get(i))), None)
            stamped_parent = next(
                (parent_of[i] for i in ids
                 if i in parent_of and extent_stamp(parent_of[i], bbox_by_node.get(parent_of[i]))),
                None)
            if v.get("rule") in ("bbox-truncation-floor", "box-swallows-enclosures") and stamped_node:
                continue  # the extent is Shane-verified: the cell hypothesis loses
            if (v.get("rule") in ("terminal-outside-parent", "terminal-interior",
                                  "terminal-off-border") and stamped_parent):
                v = {**v, "detail": str(v.get("detail")) +
                     " [EXTENT-VERIFIED parent: the box is law — the TERMINAL is stale; "
                     "move the terminal, never the border]"}
            kept_v.append(v)
        if len(kept_v) != len(result.get("violations") or []) or kept_v != result.get("violations"):
            result["violations"] = kept_v
            counts: dict[str, int] = {}
            for v in kept_v:
                counts[str(v.get("severity"))] = counts.get(str(v.get("severity")), 0) + 1
            result["counts"] = counts
            result["clean"] = not any(v.get("severity") in ("ERROR", "WARN") for v in kept_v)
    except Exception:
        logger.warning("extent-stamp post-filter unavailable", exc_info=True)
    # Disposition-aware tallies (2026-07-09, the CON23 double-count): disposed
    # flags stay in the violations list (the raw dump is still the truth) but
    # leave the COUNTS — Shane's checked-off ERROR must not haunt counts.ERROR
    # nor force clean:false ("the flag is suppressed but the count display
    # keeps showing ERROR:1"). Parked (awaiting-Shane) still counts as open —
    # parked still gates by doctrine. An explicit `disposed` field keeps the
    # suppression visible instead of silent.
    try:
        from src.canvas_copilot.blockers import _violation_state as _vs_counts

        _open_counts: dict[str, int] = {}
        _disposed_n = 0
        for v in result.get("violations") or []:
            _st = _vs_counts(v, snap)
            if _st == "disposed":
                # Stamp the state ON the violation so every downstream reader
                # (handoff composer, full view, logs) sees it — a bare list
                # under an ERROR:0 header ordered successors to re-fix flags
                # Shane had already ruled on (verify pass, 2026-07-09).
                v["disposition"] = ("shane-disposed (suppressed — Shane's "
                                    "verdict; do not re-fix; a geometry change "
                                    "resurrects it)")
                _disposed_n += 1
                continue
            if _st == "parked":
                v["disposition"] = "awaiting-shane"
            sev = str(v.get("severity"))
            _open_counts[sev] = _open_counts.get(sev, 0) + 1
        result["counts"] = _open_counts
        if _disposed_n:
            result["disposed"] = _disposed_n
        result["clean"] = not (_open_counts.get("ERROR") or _open_counts.get("WARN"))
    except Exception:
        logger.debug("disposition-aware counts unavailable", exc_info=True)
    # Cache flagged element ids -> rule for the audit-gaming counter: a
    # violation must die by REPAIR or disposition, never by rename/delete.
    _last_audit_flagged.clear()
    for v in result.get("violations") or []:
        for vid in v.get("ids") or []:
            if vid:
                _last_audit_flagged[str(vid)] = v.get("rule", "?")
    # Numbered flag layer (Shane 2026-07-06): cache ERROR+WARN violations with
    # elements, numbered ERRORs-first, and mirror them to Shane's live canvas
    # as crimson highlights — pushed only when the flag SET changes (audits
    # run every turn; re-pushing identical flags would pile duplicates).
    try:
        from src.canvas_copilot.blockers import _violation_state as _v_state

        flagged = sorted(
            (v for v in result.get("violations") or []
             if v.get("severity") in ("ERROR", "WARN") and v.get("ids")
             # Shane checked these off as false positives from the pill — they
             # never re-paint. Geometry-bound: _violation_state resurrects the
             # flag the instant the disposed element's box moves (same rule the
             # box-gate obeys), so a real defect can't hide behind a stale verdict.
             and _v_state({"rule": v.get("rule"), "ids": v.get("ids")}, snap) != "disposed"),
            key=lambda v: 0 if v.get("severity") == "ERROR" else 1)
        entries = [{"n": i + 1, "rule": str(v.get("rule")),
                    "severity": str(v.get("severity")),
                    "detail": str(v.get("detail"))[:160],
                    "ids": [str(x) for x in (v.get("ids") or []) if x][:4]}
                   for i, v in enumerate(flagged)]
        import time as _t_gate

        _last_audit_flag_list.clear()
        _last_audit_flag_list.update({
            "page": page, "snapshot_seq": bridge.get_state()["snapshot_seq"],
            "ts": _t_gate.time(),  # box gate: certificate freshness anchor
            "entries": entries})
        sig = "|".join(f"{e['n']}:{e['rule']}:{','.join(e['ids'])}" for e in entries)
        if entries and sig != _last_flag_push_sig[0]:
            _last_flag_push_sig[0] = sig
            # Replace the flag layer WHOLESALE: clear the old flags, then push the
            # new set. Flags carry ttl_ms:0 (never expire) so they can't vanish
            # mid-review the way the old 10-min TTL let them (Shane: "flags vanish
            # and stay gone"); the trade is that stale paint must be cleared here.
            # kind:"flag" scopes both the clear and the push to the audit layer,
            # leaving net-color highlights untouched. rule/severity ride along so
            # the pill can offer check/hide without parsing the note.
            import re as _re_flags

            def _flag_cmd(e: dict[str, Any]) -> dict[str, Any]:
                cmd: dict[str, Any] = {
                    "type": "highlight", "kind": "flag", "element_id": e["ids"][0],
                    "rule": e["rule"], "severity": e["severity"], "color": "#e11d48",
                    "ttl_ms": 0, "note": f"flag {e['n']}: {e['rule']}"}
                # Print-anchored synthetic ids (jdot-x-y / contref-x-y) resolve
                # to no canvas element, so without an explicit point the flag
                # painted NOTHING — numbers skipped on screen, nothing to check
                # off (verify pass, 2026-07-09). Their id IS their coordinate.
                m = _re_flags.match(r"^(?:jdot|contref)-(\d+)-(\d+)$", str(e["ids"][0]))
                if m:
                    cmd["point"] = {"x": int(m.group(1)), "y": int(m.group(2))}
                return cmd

            bridge.send_commands(
                [{"type": "clear_highlights", "kind": "flag"}]
                + [_flag_cmd(e) for e in entries[:12]])
        elif not entries and _last_flag_push_sig[0] != "":
            # Page went clean (or every flag was disposed): wipe the flag layer
            # once. Guarded so a clean page doesn't re-clear every audit.
            _last_flag_push_sig[0] = ""
            bridge.send_commands([{"type": "clear_highlights", "kind": "flag"}])
    except Exception:
        logger.debug("flag layer cache unavailable", exc_info=True)
    # Run-2 escape closure: a page auditing CLEAN settles any departure debt
    # recorded for it (the agent came back and fixed the blockers goto_page
    # let it leave behind — the done-gate stops refusing on this page).
    try:
        from src.canvas_copilot.blockers import open_blockers as _open_blockers
        from src.canvas_copilot.copilot import copilot_session as _sess_debt

        if str(page) in _sess_debt.page_debts:
            g = _open_blockers(result, snap)
            if not g.get("live") and not g.get("end_state"):
                _sess_debt.page_debts.pop(str(page), None)
                _sess_debt._persist()
                result["page_debt_settled"] = (
                    f"page {page}'s recorded departure debt is settled — it audits clean")
    except Exception:
        logger.debug("page-debt settlement unavailable", exc_info=True)
    return result


@tool(
    name="audit_page",
    description=(
        "The graph grades itself, served as a WORK QUEUE: you get ONE blocker "
        "ticket at a time (fully detailed, spatially ordered), the rest as counts. "
        "Fix the ticket, re-audit to verify it cleared, and the next is served. "
        "BLOCKER LAW: tickets are human-calibrated (zero false positives, Shane-"
        "reviewed) — they clear ONLY by geometry change verified on re-audit, or "
        "ride your handoff as OPEN. 'False positive' is not a disposition you can "
        "grant; if you believe a ticket is wrong, say so to Shane and leave it "
        "open. end_state_gaps (unwired/naming/ledger) are legal mid-build but "
        "must be ZERO before any done/complete claim — the done-gate refuses "
        "done claims mechanically while anything is open. Milliseconds, numeric, "
        "no pixels. RUN IT before ANY done/area-complete claim and before asking "
        "Shane a modeling question about a region. dispose_warnings:true "
        "acknowledges the receipt-warning ledger (WARNs only) — state WHY. "
        "full:true returns the raw violation dump (debugging with Shane)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "dispose_warnings": {"type": "boolean"},
            "full": {"type": "boolean"},
        },
        "additionalProperties": False,
    },
)
async def audit_page(args: dict[str, Any]) -> dict[str, Any]:
    result = await compute_page_audit()
    if result is None:
        return _text({"ok": False, "note": "no canvas snapshot — is the page open?"})
    # Slate 4.1: COMPLETION (not issuance) clears the audit-first gate and
    # zeroes the unaudited-ops counter — both observable in-process.
    try:
        from src.canvas_copilot.copilot import copilot_session as _cs_gate

        if _cs_gate.needs_audit or _cs_gate.unaudited_ops:
            _cs_gate.needs_audit = False
            _cs_gate.unaudited_ops = 0
            _cs_gate._persist()
    except Exception:
        logger.debug("audit-first gate clear unavailable", exc_info=True)
    if args.get("dispose_warnings"):
        n = bridge.dispose_warnings(result.get("page"))
        result["dispositions"] = f"{n} receipt warning(s) acknowledged — justify this in your reply"
    if args.get("full"):
        # The raw dump stays the truth (every violation, disposed or not) but
        # each violation now CARRIES its disposition state, and `clean` agrees
        # with the summary view (2026-07-08: the copilot read raw-inclusion as
        # "Shane's drawer clears didn't propagate" — they had; the view was
        # just unannotated and its `clean` was computed pre-disposition).
        from src.canvas_copilot.blockers import _violation_state

        snap_full = (bridge.get_state() or {}).get("snapshot") or {}
        open_warns = 0
        for v in result.get("violations") or []:
            st = _violation_state(v, snap_full)
            if st == "disposed":
                v["disposition"] = "shane-disposed (suppressed — do not re-fix; a geometry change resurrects it)"
            elif st == "parked":
                v["disposition"] = "awaiting-shane"
            elif v.get("severity") == "WARN":
                open_warns += 1
        counts_full = result.get("counts") or {}
        result["clean"] = not (counts_full.get("ERROR") or 0) and not open_warns
        return _text(result)
    from src.canvas_copilot.blockers import blocker_response

    snap = (bridge.get_state() or {}).get("snapshot") or {}
    shaped = blocker_response(result, snap)
    if result.get("dispositions"):
        shaped["dispositions"] = result["dispositions"]
    # The numbered flag layer rides the response (2026-07-09): Shane's canvas
    # pills and chat dispositions must share ONE key-space. Without this the
    # copilot saw only warnings_by_rule COUNTS, guessed element ids from the
    # elements it had touched, and wrote ok:true no-op dispositions that never
    # dropped the count (the SHLD-dot class). n here == the painted flag number.
    try:
        _fl = _last_audit_flag_list.get("entries") or []
        if _fl:
            shaped["flags"] = [{"n": e.get("n"), "rule": e.get("rule"),
                                "severity": e.get("severity"),
                                "ids": (e.get("ids") or [])[:2]} for e in _fl[:12]]
    except Exception:
        logger.debug("flag id attach failed", exc_info=True)
    # Lessons (Shane 2026-07-08): when a rule you've already solved fires again,
    # the codified fix rides the audit — right-time recall, no rediscovery.
    try:
        from src.canvas_copilot import lessons as _lessons

        rules_present = sorted({str(v.get("rule")) for v in result.get("violations") or []})
        matched = _lessons.for_rules(rules_present)
        if matched:
            shaped["lessons"] = matched
    except Exception:
        logger.debug("lesson attach failed", exc_info=True)
    # The Table mirrors parked issues; refresh it whenever an audit completes.
    # And when the page reads CLEAN post-disposition, wipe the overlay — stale
    # flag paint outliving its flags is how 'says clean but looks red' happens
    # (Shane, 2026-07-08).
    try:
        await _broadcast_issues(result.get("page"))
        if shaped.get("clean"):
            # kind:"flag" — a bare clear no longer touches the flag layer (so the
            # copilot's scratch clear_highlights can't wipe Shane's flags), so the
            # clean-page wipe must name the flag layer explicitly.
            bridge.send_commands([{"type": "clear_highlights", "kind": "flag"}])
    except Exception:
        logger.debug("issue broadcast failed", exc_info=True)
    return _text(shaped)


@tool(
    name="capture",
    description=(
        "SEE the canvas: returns a SCENE PACKET — the image inline plus a manifest of "
        "(IMAGE COST = pixel area: every capture adds ~(w*h)/750 tokens to context FOREVER. Ration: one overview per page, tight component_id close-ups for detail, manifests/vectors for numbers you already have — never recapture what a manifest answers.) "
        "everything in frame. Frame it your way: component_id (surgical close-up, "
        "auto-padded), region {x,y,width,height} in page-space (2481x3509), or whole page "
        "(default overview), or frame_ask_marks:true — ONE zoomed crop fitting ALL of Shane's "
        "current marks (union + padding; use when he marks several spots and asks about them "
        "together). The image carries a coordinate GRID (labels ARE page coords — "
        "interpolate between gridlines to locate raw artwork). The manifest carries every "
        "in-frame component/terminal/ask-mark with page coords AND image-pixel coords "
        "(bbox_px/point_px), plus the PDF TEXT LAYER (texts: wire numbers, ratings, "
        "designators with exact coords — prefer these over reading pixels), plus "
        "vectors_in_region: the printed artwork's line segments as {x1,y1,x2,y2} data — "
        "compare drawn geometry against these numerically instead of eyeballing pixels, "
        "plus circles_in_region: printed circles classed as junction (~17px dots — nets "
        "JOIN here; wires crossing WITHOUT a dot do NOT connect) or terminal (~45px "
        "connection points) — crossing-vs-connecting and terminal placement are lookups. "
        "Layer toggles: "
        "show_grid_overlay / show_graph_overlay / show_ask_marks (all default true) — e.g. "
        "recapture with show_graph_overlay:false when a painted box hides artwork under it; "
        "include_text_layer:false to slim the packet. The manifest always ships. "
        "expected_page:N fails loudly (no image) if the canvas is on a different page — use it "
        "whenever your work targets a specific page. pair:true returns overlay-ON + overlay-OFF "
        "of the same frame in ONE call (atomic — use instead of two captures when you need the "
        "artwork beneath your drawing). "
        "NOTE: frame_ask_marks ALWAYS renders the graph overlay — Shane's marks point at "
        "drawn-overlay problems, and framing them overlay-off is how 'your marks are in blank "
        "space' happens. Interpret marks from an overlay-ON image first; take overlay-off as a "
        "second view of the same region when you need the artwork beneath."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "component_id": {"type": "string",
                             "description": "Node id OR printed label (CNV40, elb41 — "
                                            "case-insensitive). Unknown/ambiguous refs return "
                                            "a typed error with candidates, never a silent "
                                            "full-page frame"},
            "region": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                },
                "required": ["x", "y", "width", "height"],
                "additionalProperties": False,
            },
            "pad": {"type": "number"},
            "max_px": {"type": "integer"},
            "frame_ask_marks": {"type": "boolean"},
            "show_grid_overlay": {"type": "boolean"},
            "show_graph_overlay": {"type": "boolean"},
            "show_ask_marks": {"type": "boolean"},
            "include_text_layer": {"type": "boolean"},
            "expected_page": {
                "type": "integer",
                "description": "Guard: fail loudly (no image) if the canvas is on a different page",
            },
            "show_enclosures": {
                "type": "boolean",
                "description": "Tint closed printed regions (module interiors) — extent visibly bleeds past the frame edge when a component continues beyond your crop",
            },
            "pair": {
                "type": "boolean",
                "description": "Return TWO images of the same frame in one call: overlay ON then overlay OFF (atomic — no overlay-off warning)",
            },
            "show_yolo": {
                "type": "boolean",
                "description": "Paint the detector's evidence layer: precomputed YOLO detections as short-dash EMERALD boxes with class+confidence (unreviewed proposals, NOT committed work — graph overlay stays amber). Works at any zoom; manifest gains yolo_evidence.",
            },
            "yolo_min_conf": {
                "type": "number",
                "description": "With show_yolo: hide detections below this confidence (dense pages)",
            },
            "show_flags": {
                "type": "boolean",
                "description": "Numbered CRIMSON flags at every element the LAST audit flagged "
                               "(default true) — the manifest's flags legend maps each number to "
                               "rule + cause. Problem N is standing on its element; no need to "
                               "re-derive id→location→why. show_flags:false for a clean frame.",
            },
        },
        "additionalProperties": False,
    },
)
async def capture(args: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    from src.canvas_copilot.capture import render_capture

    # Wrong-page guard: a capture silently returning another page's pixels once
    # cost a whole diagnosis round — check before rendering anything.
    if args.get("expected_page") is not None:
        snap_now = bridge.get_state()["snapshot"] or {}
        actual = snap_now.get("page")
        if actual != int(args["expected_page"]):
            return _text(
                {
                    "ok": False,
                    "wrong_page": True,
                    "note": f"WRONG PAGE: canvas is on page {actual}, you expected {args['expected_page']}. "
                    "Use view(page=...) or ask Shane before capturing.",
                }
            )

    # Slate 7.2: full-page frames are refused — tiling multiplies pixel-token
    # cost above the frame it replaces (the 305,592-char ask-marks full-pager
    # preceded a 31s error and a 95.5s first-op; regional captures in the
    # same workflow ran 5-7s). Page overviews come from goto_page/view, once.
    _refuse_full = False
    if not args.get("region") and not args.get("component_id") and not args.get("frame_ask_marks"):
        _refuse_full = True
    elif args.get("region"):
        _rr = args["region"]
        try:
            if (float(_rr.get("width", 0)) * float(_rr.get("height", 0))
                    >= 0.8 * 2481 * 3509):
                _refuse_full = True
        except (TypeError, ValueError):
            pass
    if _refuse_full:
        return _text({
            "ok": False, "refused": "narrow-the-region",
            "note": "REFUSED: this frame is (near-)full-page. Narrow it: component_id "
                    "(label works), a tight region, or frame_ask_marks. The page "
                    "overview you already have from goto_page/view is the sanctioned "
                    "full frame — one per page.",
        })

    # Slate 6.6: resolve component references (node id OR label) BEFORE
    # rendering — unknown/ambiguous refs return a typed error with candidates
    # instead of the silent ~257KB full-page fallback (ELB41/MC347/MC34A were
    # real printed designators the old id-only match dropped on the floor).
    comp_ref = args.get("component_id")
    if comp_ref:
        from src.canvas_copilot.capture import resolve_component_ref

        nodes_now = (bridge.get_state()["snapshot"] or {}).get("nodes") or []
        node_hit, ref_err = resolve_component_ref(nodes_now, str(comp_ref))
        if ref_err:
            return _text({"ok": False, "unknown_component": True, "note": ref_err})
        args = {**args, "component_id": node_hit["id"]}

    # Shane's marks point at overlay-vs-artwork problems; a mark-framed capture
    # without the drawn overlay hides the very geometry he's flagging (the
    # "your marks are in blank space" failure). Forced on; take a separate
    # region capture with the overlay off if raw artwork is also needed.
    frame_marks = bool(args.get("frame_ask_marks", False))
    pair = bool(args.get("pair", False))
    show_graph = True if (frame_marks or pair) else bool(args.get("show_graph_overlay", True))
    enclosures_arg: list[dict[str, Any]] | None = None
    if args.get("show_enclosures"):
        try:
            from src.canvas_copilot import vectors

            snap_page = int((bridge.get_state()["snapshot"] or {}).get("page") or 1)
            await vectors.page_segments(snap_page)  # prime the segment cache
            enclosures_arg = await asyncio.to_thread(vectors.page_enclosures, snap_page)
        except Exception:
            logger.warning("enclosure tint unavailable", exc_info=True)
    try:
        packet = await asyncio.to_thread(
            render_capture,
            region=args.get("region"),
            component_id=args.get("component_id"),
            pad=float(args["pad"]) if args.get("pad") is not None else (40.0 if frame_marks else 70.0),
            max_px=int(args["max_px"]) if args.get("max_px") is not None else 1000,
            frame_ask_marks=frame_marks,
            show_grid_overlay=bool(args.get("show_grid_overlay", True)),
            show_graph_overlay=show_graph,
            show_ask_marks=bool(args.get("show_ask_marks", True)),
            include_text_layer=bool(args.get("include_text_layer", True)),
            encode_b64=True,
            enclosures=enclosures_arg,
            show_yolo=bool(args.get("show_yolo", False)),
            yolo_min_conf=float(args.get("yolo_min_conf") or 0.0),
            flags=(_flags_for_render(bridge.get_state()["snapshot"] or {})
                   if bool(args.get("show_flags", True)) else None),
        )
    except Exception as exc:  # degrade to a readable tool error, never a dead session
        return {"content": [{"type": "text", "text": f"capture failed: {type(exc).__name__}: {exc}"}], "is_error": True}
    b64 = packet.pop("b64", None)
    # Slate 7.2 byte cap (~150KB b64, artwork-verified legible at that size):
    # oversized frames re-render downscaled instead of billing the context
    # forever (drops clustered after 305-650KB image exchanges).
    if b64 and len(b64) > 150_000:
        try:
            import math as _math

            cur_px = int(args.get("max_px") or 1000)
            for _ in range(3):
                if not b64 or len(b64) <= 150_000 or cur_px <= 500:
                    break
                # PNG line art doesn't scale linearly with area — shave an
                # extra 15% per pass and iterate.
                cur_px = max(500, int(cur_px * _math.sqrt(150_000 / len(b64)) * 0.85))
                packet2 = await asyncio.to_thread(
                    render_capture,
                    region=packet.get("region"), pad=0.0, max_px=cur_px,
                    show_grid_overlay=bool(args.get("show_grid_overlay", True)),
                    show_graph_overlay=show_graph,
                    show_ask_marks=bool(args.get("show_ask_marks", True)),
                    include_text_layer=bool(args.get("include_text_layer", True)),
                    encode_b64=True, enclosures=enclosures_arg,
                    show_yolo=bool(args.get("show_yolo", False)),
                    yolo_min_conf=float(args.get("yolo_min_conf") or 0.0),
                )
                b64 = packet2.pop("b64", None) or b64
                packet2.pop("drew", None)
                packet = packet2
                packet["byte_cap_note"] = (f"downscaled to max_px={cur_px} to fit the "
                                           "150KB cap — re-frame tighter if detail is lost")
        except Exception:
            logger.warning("byte-cap downscale failed — original frame kept", exc_info=True)
    packet.pop("drew", None)
    # Slate 6.6: captures never BLOCK on a page flip (looking is how a flip
    # gets noticed) — but they carry the mismatch loudly.
    try:
        from src.canvas_copilot.copilot import copilot_session as _cs

        if (_cs.bound_page is not None and packet.get("page") is not None
                and int(packet["page"]) != int(_cs.bound_page)):
            packet["page_note"] = (
                f"CANVAS PAGE {packet['page']} != this session's bound page "
                f"{_cs.bound_page} — these pixels are NOT your working page; "
                "mutating ops will refuse until you goto_page back or page_ack")
    except Exception:
        logger.debug("capture page note unavailable", exc_info=True)
    # The printed artwork as data: every vector segment in frame (px space,
    # longest first). Geometry checks against these are numeric — no eyeballing.
    try:
        from src.canvas_copilot import vectors

        page_no = int(packet.get("page") or 1)
        segs, dropped = vectors.segments_in_region(
            await vectors.page_segments(page_no), packet["region"]
        )
        packet["vectors_in_region"] = segs
        if dropped:
            packet["vectors_note"] = f"{dropped} shorter segments in frame not listed — narrow the region for full detail"
        # Printed circles: junction dots (nets JOIN here) + terminal circles
        # (connection points). Crossing-vs-connecting is a lookup, not a judgment.
        circles, c_dropped = vectors.circles_in_region(
            await asyncio.to_thread(vectors.page_circles, page_no), packet["region"]
        )
        packet["circles_in_region"] = circles
        if c_dropped:
            packet["circles_note"] = f"{c_dropped} more circles in frame not listed"
        encl, _e_drop = vectors.enclosures_in_region(
            await asyncio.to_thread(vectors.page_enclosures, page_no), packet["region"]
        )
        if encl:
            packet["enclosures_in_region"] = encl
    except Exception:
        logger.warning("vectors_in_region unavailable", exc_info=True)
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(packet, ensure_ascii=False)}
    ]
    if not show_graph and packet.get("ask_marks"):
        content.append(
            {"type": "text",
             "text": (f"⚠ {len(packet['ask_marks'])} of Shane's ask marks are in this frame but the GRAPH "
                      "OVERLAY IS OFF — his marks usually point at drawn-overlay problems (wires/terminals), "
                      "which are INVISIBLE in this image. Recapture this region with show_graph_overlay:true "
                      "before interpreting the marks.")}
        )
    if b64:
        content.append({"type": "image", "data": b64, "mimeType": "image/png"})
        await _mirror_image_to_panel(
            "capture",
            f"p{packet.get('page')} {packet.get('region')}"
            + (" (ask marks)" if frame_marks else "")
            + (" [pair: overlay ON]" if pair else ("" if show_graph else " [overlay OFF]")),
            b64,
            packet.get("debug_path"),
        )
    if pair and b64:
        # Second frame of the atomic pair: identical region, overlay off — the
        # artwork beneath, without a separate call or a false-positive warning.
        try:
            off = await asyncio.to_thread(
                render_capture,
                region=packet["region"],
                max_px=int(args["max_px"]) if args.get("max_px") is not None else 1000,
                show_grid_overlay=bool(args.get("show_grid_overlay", True)),
                show_graph_overlay=False,
                show_ask_marks=bool(args.get("show_ask_marks", True)),
                include_text_layer=False,
                encode_b64=True,
            )
        except Exception:
            off = {}
        if off.get("b64"):
            content.append({"type": "text", "text": "same frame, overlay OFF (raw artwork):"})
            content.append({"type": "image", "data": off["b64"], "mimeType": "image/png"})
            await _mirror_image_to_panel(
                "capture", f"p{packet.get('page')} {packet.get('region')} [pair: overlay OFF]",
                off["b64"], off.get("debug_path"),
            )
    return _with_midturn({"content": content})


async def _mirror_image_to_panel(tool_name: str, label: str, b64: str, debug_path: Any = None) -> None:
    """Every image a tool feeds the model also prints to the chat stream —
    Shane can't repair what he can't see. Late import avoids the circular
    tools<->copilot dependency; failures never break the tool itself."""
    try:
        from src.canvas_copilot.copilot import copilot_session

        await copilot_session.broadcast_tool_image(tool_name, label, b64, str(debug_path or "") or None)
    except Exception:
        pass


@tool(
    name="goto_page",
    description=(
        "Flip the canvas to another page and SEE it: sends the page switch, waits for the "
        "canvas to load + echo that page's graph (Neon-backed), then returns a whole-page "
        "overview SCENE PACKET (same layers/manifest as capture). Use when work moves to a "
        "new sheet — one call instead of view + poll + capture. Optional max_px (default 1400). "
        "DEPARTING-BLOCKERS GATE: leaving a page with open blockers/end-state gaps is refused "
        "(navigation is never disposal — the run-2 escape class). If departing is genuinely "
        "intentional (Shane's instruction, a cross-page verification errand), re-issue with "
        "blockers_ack:<open count>; the debt is recorded and the done-gate keeps refusing "
        "until that page audits clean. The overview carries the detector's evidence layer BY "
        "DEFAULT (emerald short-dash = unreviewed proposals; manifest yolo_evidence has "
        "coordinates; yolo_roster counts your unworked work-list) — verify against print, "
        "never trust a box you haven't looked at; show_yolo:false for a clean overview."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "page": {"type": "integer"},
            "max_px": {"type": "integer"},
            "blockers_ack": {"type": "integer"},
            "show_yolo": {"type": "boolean"},
            "yolo_min_conf": {"type": "number"},
            "show_flags": {"type": "boolean"},
        },
        "required": ["page"],
        "additionalProperties": False,
    },
)
async def goto_page(args: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    from src.canvas_copilot.capture import render_capture

    page = int(args["page"])
    # Run-2 finding (2026-07-06): NAVIGATION IS A DONE-GATE ESCAPE — the gate
    # audits only the CURRENT page, so a flip sheds blockers (run 2's
    # successor declared page 10 "done-enough" and began page 11 with 9 open
    # WARNs behind it). Departures are gated BEFORE the view command goes out;
    # an acknowledged departure records a persistent debt the done-gate keeps
    # refusing on until the departed page audits clean. Fails open on
    # infrastructure errors (a broken audit must not brick navigation).
    try:
        import time as _time

        from src.canvas_copilot.blockers import open_blockers as _ob
        from src.canvas_copilot.copilot import copilot_session as _sess_nav

        _snap0 = bridge.get_state()["snapshot"] or {}
        _cur = _snap0.get("page")
        if _cur is not None and int(_cur) != page:
            _audit0 = await compute_page_audit()
            _gate0 = _ob(_audit0, _snap0) if _audit0 else {"live": 0, "end_state": 0}
            _n_open = int(_gate0.get("live") or 0) + int(_gate0.get("end_state") or 0)
            if _n_open:
                _top0 = _gate0.get("top") or {}
                if int(args.get("blockers_ack") if args.get("blockers_ack") is not None else -1) != _n_open:
                    return _text({
                        "ok": False, "applied": False, "refused": "departing-blockers",
                        "departing_page": int(_cur), "open_blockers": _n_open,
                        "live": _gate0.get("live"), "end_state": _gate0.get("end_state"),
                        "top": {"rule": (_top0 or {}).get("rule"),
                                "detail": str(((_top0 or {}).get("details") or ["?"])[0])[:180]},
                        "note": (
                            f"REFUSED (page not flipped): page {_cur} has {_n_open} open "
                            "blocker(s)/end-state gap(s) — NAVIGATION IS NEVER DISPOSAL "
                            "(the run-2 escape class). Fix them and re-audit before moving "
                            f"on, or re-issue with blockers_ack:{_n_open} if departing is "
                            "genuinely intentional (Shane's instruction or a cross-page "
                            "verification errand): the debt is then RECORDED and the "
                            "done-gate keeps refusing until this page audits clean."),
                    })
                _sess_nav.page_debts[str(int(_cur))] = {
                    "live": int(_gate0.get("live") or 0),
                    "end_state": int(_gate0.get("end_state") or 0),
                    "top_rule": str((_top0 or {}).get("rule") or "?"),
                    "ts": _time.time(),
                }
                _sess_nav._persist()
    except Exception:
        logger.warning("departing-blockers gate unavailable", exc_info=True)
    bridge.send_commands([{"type": "view", "page": page}])
    # Wait for the canvas to render the page and echo a fresh snapshot for it.
    loop = asyncio.get_event_loop()
    deadline = loop.time() + 10.0
    while loop.time() < deadline:
        snap = bridge.get_state()["snapshot"] or {}
        if int(snap.get("page") or 0) == page:
            break
        await asyncio.sleep(0.25)
    else:
        return _text({
            "ok": False,
            "note": f"canvas did not echo page {page} within 10s — is the tab open? Try get_state.",
        })
    # Slate 6.6: explicit navigation IS the intentional rebind path.
    _bind_page(page)
    # Shane 2026-07-06 (Option B): arrival is the DISCOVERY moment — the
    # overview carries the detector's evidence layer by default (emerald,
    # clearly non-committed; manifest gains yolo_evidence coordinates), so a
    # cold agent lands already holding the roster instead of capturing around
    # to find work. Close-up captures stay clean-artwork by default.
    _show_yolo = bool(args.get("show_yolo", True))
    try:
        packet = await asyncio.to_thread(
            render_capture, max_px=int(args.get("max_px") or 1400), encode_b64=True,
            show_yolo=_show_yolo,
            yolo_min_conf=float(args.get("yolo_min_conf") or 0.0),
            flags=(_flags_for_render(bridge.get_state()["snapshot"] or {})
                   if bool(args.get("show_flags", True)) else None),
        )
    except Exception as exc:
        return {"content": [{"type": "text", "text": f"goto_page capture failed: {type(exc).__name__}: {exc}"}], "is_error": True}
    b64 = packet.pop("b64", None)
    packet.pop("drew", None)
    # Roster note: strong detections with essentially no graph coverage are
    # the page's unworked work-list — say so in text, not just pixels.
    if _show_yolo:
        try:
            from src.canvas_copilot import yolo as _yolo3

            _snap_r = bridge.get_state()["snapshot"] or {}
            _nodes_r = [n.get("bbox") or {} for n in _snap_r.get("nodes") or []]

            def _covered_r(db: dict[str, Any]) -> bool:
                dx, dy = float(db["x"]), float(db["y"])
                dw, dh = float(db["width"]), float(db["height"])
                for b in _nodes_r:
                    if not b:
                        continue
                    ix = max(0.0, min(dx + dw, float(b["x"]) + float(b["width"])) - max(dx, float(b["x"])))
                    iy = max(0.0, min(dy + dh, float(b["y"]) + float(b["height"])) - max(dy, float(b["y"])))
                    if (ix * iy) / max(dw * dh, 1e-6) >= 0.05:
                        return True
                return False

            _strong = [d for d in _yolo3.page_detections(page)
                       if d.get("tier") == "strong"
                       and str(d.get("class_name")) != "CONTINUATION"]
            if _strong:
                _unworked = [d for d in _strong if not _covered_r(d.get("bbox") or {})]
                fams: dict[str, int] = {}
                for d in _unworked:
                    fams[str(d["class_name"])] = fams.get(str(d["class_name"]), 0) + 1
                packet["yolo_roster"] = {
                    "strong": len(_strong),
                    "unworked": len(_unworked),
                    "unworked_by_class": fams,
                    "note": ("your work-list: verify each unworked detection against the "
                             "print and box what is real (emerald = unreviewed proposal, "
                             "never committed work; absence of a detection proves nothing)"
                             if _unworked else
                             "every strong detection overlaps drawn work — the remaining "
                             "gaps are wiring/continuations, not boxes"),
                }
        except Exception:
            logger.debug("yolo roster note unavailable", exc_info=True)
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps({"ok": True, **packet}, ensure_ascii=False)}
    ]
    if b64:
        content.append({"type": "image", "data": b64, "mimeType": "image/png"})
        await _mirror_image_to_panel("goto_page", f"p{page} overview", b64, packet.get("debug_path"))
    return _with_midturn({"content": content})



@tool(
    name="toast",
    description="Show Shane a short on-canvas message (non-blocking).",
    input_schema={
        "type": "object",
        "properties": {"message": {"type": "string"}},
        "required": ["message"],
        "additionalProperties": False,
    },
)
async def toast(args: dict[str, Any]) -> dict[str, Any]:
    bridge.send_commands([{"type": "toast", "message": args["message"]}])
    return _text({"ok": True})


def _bind_page(page: int | None) -> None:
    """Slate 6.6: record the page this session works (server-side binding)."""
    if page is None:
        return
    try:
        from src.canvas_copilot.copilot import copilot_session

        if copilot_session.bound_page != int(page):
            copilot_session.bound_page = int(page)
            copilot_session._persist()
    except Exception:
        logger.debug("page bind unavailable", exc_info=True)


def _page_guard(args: dict[str, Any]) -> dict[str, Any] | None:
    """Slate 6.6: mutating canvas ops are refused when the canvas sits on a
    different page than the one this session is bound to — a repair once
    landed on page 9 while the session's work was page 10. The refusal
    carries an explicit rebind affordance (page_ack), because an intentional
    Shane flip must not brick the session (the done-gate deadlock class).
    Returns the typed error payload, or None when clear."""
    try:
        from src.canvas_copilot.copilot import copilot_session
    except Exception:
        return None
    snap = bridge.get_state()["snapshot"] or {}
    cur = snap.get("page")
    if cur is None:
        return None  # empty bridge: the no-canvas path handles itself downstream
    cur = int(cur)
    ack = args.get("page_ack")
    if ack is not None:
        if int(ack) == cur:
            _bind_page(cur)
            return None
        return {"ok": False, "applied": False, "refused": "page-ack-mismatch",
                "note": f"page_ack={ack} but the canvas is on page {cur} — nothing applied. "
                        "Look again (get_state) before rebinding."}
    bound = copilot_session.bound_page
    if bound is None:
        _bind_page(cur)
        return None
    if int(bound) != cur:
        return {"ok": False, "applied": False, "refused": "page-flip",
                "bound_page": int(bound), "canvas_page": cur,
                "note": (f"REFUSED (nothing applied): the canvas is on page {cur} but this "
                         f"session is bound to page {bound}. If Shane flipped intentionally "
                         f"and you MEAN to work page {cur}, re-issue with page_ack:{cur}. "
                         f"Otherwise call goto_page {bound} first.")}
    return None


def _ctx_band_note() -> list[str]:
    """Slate 6.9, born receipt-WARN (never a gate): geometric ops executed past
    the HARD context line get one receipt note — every real defect in the
    audited page-10 segment clustered in the deep-context band (THR349
    misboxing, 19 rushed WARNs, the corrupted UUID and reset payload). A hard
    gate keyed to the one sensor just proven to lie would have refused
    essentially all legitimate work of the phantom era — WARN only."""
    try:
        from src.canvas_copilot.copilot import _CTX_HARD_FRAC, copilot_session

        ctx = copilot_session.last_context or {}
        total, mx = int(ctx.get("total") or 0), int(ctx.get("max") or 0)
        if mx and total >= mx * _CTX_HARD_FRAC:
            return [f"warning: ops executed past the HARD context line "
                    f"(ctx={total // 1000}k/{mx // 1000}k) — the measured defect-cluster "
                    "band; finish the current fix, then reset_session at the next "
                    "clean boundary"]
    except Exception:
        logger.debug("ctx band note unavailable", exc_info=True)
    return []


@tool(
    name="derive_extent",
    description=(
        "ADVISORY extent evidence (slate 7.3): printed dashed/dotted enclosure "
        "candidates near a component or point, derived from the vector layer "
        "(dash/dot chains paired with walls, perimeter-coverage scored). "
        "EVIDENCE, NEVER TRUTH: a candidate is something to LOOK at against a "
        "close-up before any resize — never resize to a candidate on numbers "
        "alone (the hard extent gate was killed for failing its own flagship "
        "cases). UNRESOLVED is a VALID answer, not a failure: symbol-class "
        "components (breakers/contactors/overloads) have no printed rectangle "
        "by design — derive those from the artwork close-up. Calibrated on the "
        "gold page: the dash tier anchors dotted-border components (RTC40 "
        "class); big module cells and symbol boxes usually return UNRESOLVED."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "component_id": {"type": "string",
                             "description": "Node id OR label — anchor at its box center"},
            "point": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                      "description": "Explicit anchor when no node exists yet"},
        },
        "additionalProperties": False,
    },
)
async def derive_extent_tool(args: dict[str, Any]) -> dict[str, Any]:
    from src.canvas_copilot.extents import derive_extent

    snap = bridge.get_state()["snapshot"] or {}
    page = int(snap.get("page") or 0)
    if not page:
        return _text({"ok": False, "note": "no canvas snapshot — is the page open?"})
    ax = ay = None
    if args.get("component_id"):
        from src.canvas_copilot.capture import resolve_component_ref

        node, err = resolve_component_ref(snap.get("nodes") or [], str(args["component_id"]))
        if err:
            return _text({"ok": False, "unknown_component": True, "note": err})
        b = node.get("bbox") or {}
        ax = float(b.get("x", 0)) + float(b.get("width", 0)) / 2
        ay = float(b.get("y", 0)) + float(b.get("height", 0)) / 2
    elif args.get("point"):
        ax, ay = float(args["point"].get("x", 0)), float(args["point"].get("y", 0))
    if ax is None:
        return _text({"ok": False, "note": "pass component_id (label works) or point"})
    result = await derive_extent(page, ax, ay)
    return _text({"ok": True, "page": page, "anchor": {"x": ax, "y": ay}, **result})


@tool(
    name="raise_to_shane",
    description=(
        "THE TABLE (Shane's design 2026-07-08) — park an issue you GENUINELY cannot "
        "resolve after exhausting ALL your resources: lessons, playbook/bless cards, "
        "YOLO evidence, derive_extent, the vault, high-zoom captures, the print itself. "
        "Shane's standing directive: resolve every issue you can WITHOUT consulting him; "
        "the Table is where you and he collaborate on ONLY the genuine blocks. A park "
        "lands on the Table as a card with a crop of the region, so `question` MUST be "
        "answerable YES/NO, and you SHOULD say what each answer means via yes_means/"
        "no_means (e.g. question:'Is MMS7's dashed enclosure one combined assembly?', "
        "yes_means:'box the whole enclosure as MMS7', no_means:'box the switch alone'). "
        "Parking stops re-serves and gate refires, LOCKS geometry on the element, and "
        "still blocks done claims. When Shane answers on the Table, his verdict arrives "
        "as a [SHANE'S VERDICT] message — YES / NO / or SOMETHING ELSE (his own typed "
        "instruction IS the ruling; follow it exactly, not your offered paths). His "
        "answer UNLOCKS the element's geometry — apply directly, no reopen needed — "
        "then call action:'resolve' to clear the card (only answered issues resolve; "
        "the removal is journaled and the audit remains the truth). Use "
        "action:'reopen'/'dispose' when Shane answered IN CHAT instead — shane_quote "
        "must be his EXACT words (verbatim; a fabricated quote is the worst offense "
        "this system knows). Never park to dodge work."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "rule": {"type": "string", "description": "The audit rule id on the ticket (e.g. bbox-truncation-floor), or a short kebab-case cause for non-audit blocks (e.g. ambiguous-enclosure)"},
            "element_id": {"type": "string", "description": "The flagged element's id (node-/port-/edge-...)"},
            "action": {"type": "string", "enum": ["park", "reopen", "dispose", "stamp-extent", "resolve"]},
            "question": {"type": "string", "description": "park: your one-line case for Shane, phrased so YES/NO answers it"},
            "yes_means": {"type": "string", "description": "park: what you will do on YES (one line)"},
            "no_means": {"type": "string", "description": "park: what you will do on NO (one line)"},
            "shane_quote": {"type": "string", "description": "reopen/dispose: Shane's VERBATIM chat words"},
            "verdict": {"type": "string", "description": "dispose: 'false-positive' or 'accepted-as-is'"},
        },
        "required": ["rule", "element_id"],
        "additionalProperties": False,
    },
)
async def raise_to_shane(args: dict[str, Any]) -> dict[str, Any]:
    from src.canvas_copilot import blockers
    from src.canvas_copilot.copilot import copilot_session

    rule, eid = str(args["rule"]), str(args["element_id"])
    action = str(args.get("action") or "park")
    if action == "park":
        q = str(args.get("question") or "").strip()
        if not q:
            return _text({"ok": False, "error": "park needs `question` — state your case for Shane in one line, phrased YES/NO"})
        snap = bridge.get_state()["snapshot"] or {}
        page = snap.get("page")
        label, crop_path = _issue_element_context(snap, eid)
        entry = blockers.park_ticket(
            rule, eid, q, provenance="copilot raise_to_shane",
            page=int(page) if page is not None else None, element_label=label,
            yes_means=str(args.get("yes_means") or "").strip() or None,
            no_means=str(args.get("no_means") or "").strip() or None,
            crop_path=crop_path)
        try:
            bridge.send_commands([{"type": "toast",
                                   "message": f"Copilot raised an issue for your verdict: {label or eid[:18]} — {q[:80]}"}])
            await copilot_session._broadcast({"kind": "ticket_parked", "rule": rule,
                                              "element_id": eid, "question": q})
            await _broadcast_issues(page)
        except Exception:
            logger.debug("park notification failed", exc_info=True)
        return _text({"ok": True, "state": "awaiting-shane", "entry": {k: v for k, v in entry.items() if k != "crop_path"},
                      "note": "Issue raised on Shane's panel (crop attached). Not re-served; "
                              "geometry locked; still blocks done. Work the next ticket or "
                              "another area — his verdict arrives as a [SHANE'S VERDICT] message."})
    if action == "resolve":
        removed = blockers.resolve_answered(rule, eid, provenance="copilot applied Shane's panel answer")
        if removed is None:
            return _text({"ok": False, "error": "resolve requires a shane-answered issue — either Shane "
                                                "hasn't answered this one on the panel yet, or the (rule, "
                                                "element) doesn't match. An unanswered park cannot be self-cleared."})
        try:
            await _broadcast_issues(removed.get("page"))
        except Exception:
            logger.debug("issue broadcast failed", exc_info=True)
        ans = removed.get("answer") or {}
        return _text({"ok": True, "state": "resolved",
                      "answer_applied": {"answer": ans.get("answer"), "note": ans.get("note")},
                      "note": "Issue cleared from Shane's panel. The audit remains the truth — "
                              "if the underlying flag persists it resurfaces on re-audit."})
    quote = str(args.get("shane_quote") or "").strip()
    if not quote:
        return _text({"ok": False, "error": f"{action} requires shane_quote — his VERBATIM chat words"})
    # Provenance guardrail (2026-07-10, blessed mining slate): dispose/reopen
    # quotes get the SAME trace-to-Shane bar as codify_lesson's GUARDRAIL 1.
    # A live run populated shane_quote with codified-LESSON text and the
    # empty-only gate passed it (self-caught on page 9) — a lesson is
    # downstream of a quote, never a source of one.
    try:
        from src.canvas_copilot import lessons as _prov_lessons
        from src.canvas_copilot.copilot import copilot_session as _prov_cs
        _shane_texts = list(getattr(_prov_cs, "_shane_said", []))
        if not _shane_texts:
            _shane_texts = [h.get("text", "") for h in getattr(_prov_cs, "_history", [])
                            if h.get("kind") == "user" and h.get("source") in ("panel", "queue", "mid-turn")]
        _traces = _prov_lessons.quote_traces_to_shane(quote, _shane_texts)
    except Exception:
        _traces = True  # never let the guardrail's own failure block a genuine verdict
    if _traces is not True:
        _why = ("does not trace to anything Shane actually sent this session — codified-lesson "
                "text, doctrine, or paraphrase is not provenance") if _traces is False else (
                "cannot be verified — Shane has not sent a message this session")
        return _text({"ok": False,
                      "refused": "fabricated-quote" if _traces is False else "unverifiable-quote",
                      "error": f"REFUSED ({action}): the shane_quote {_why}. Copy his real chat "
                               "message verbatim, or leave the item parked for his answer."})
    if action == "reopen":
        ok = blockers.reopen_ticket(rule, eid, provenance=f"chat-quote: {quote[:160]}")
        return _text({"ok": ok, "state": "reopened" if ok else "no-such-park",
                      "note": "Flag re-enters the queue on the next audit." if ok
                      else "No awaiting-shane state existed for that (rule, element)."})
    if action == "dispose":
        verdict = str(args.get("verdict") or "false-positive")
        snap = bridge.get_state()["snapshot"] or {}
        # Key-mismatch guard (2026-07-09, the SHLD-dot no-op class): a
        # disposition suppresses a flag ONLY when keyed to an id the violation
        # itself carries. The copilot disposed missed-junction-dot under the
        # PORT ids it had worked on while the flags were keyed jdot-x-y — four
        # ok:true no-ops that never dropped the count. Refuse ids that match no
        # flag of this rule in the last audit, and say which ids WOULD match.
        _entries = list(_last_audit_flag_list.get("entries") or [])
        _rule_ids = [i for e in _entries if str(e.get("rule")) == rule
                     for i in (e.get("ids") or [])]
        if _rule_ids and eid not in _rule_ids and not blockers.element_state(rule, eid):
            return _text({
                "ok": False, "refused": "id-not-on-flag",
                "note": (f"No {rule} flag in the last audit carries id {eid!r} — "
                         "disposing it would be a silent no-op (the flag keeps "
                         "counting under its own id). Dispose one of the ids the "
                         "flag actually carries."),
                "flag_ids_for_rule": _rule_ids[:8]})
        entry = blockers.dispose_ticket(rule, eid, verdict,
                                        provenance=f"chat-quote via copilot: {quote[:160]}", snap=snap)
        try:
            await _broadcast_issues(snap.get("page"))  # drawer drops the card live
        except Exception:
            logger.debug("issue broadcast failed", exc_info=True)
        return _text({"ok": True, "state": "shane-disposed", "entry": entry,
                      "note": "Disposed under Shane's quoted verdict — bound to the element's "
                              "current geometry; any later change resurrects the flag. The flag "
                              "stops re-listing on audits immediately."})
    if action == "stamp-extent":
        # Slate 4.6(a): a per-component "perfect"/verified verdict stamps the
        # BOX EXTENT only (never terminals/wires — the same message granting
        # "perfect on ELB40" ordered THR349's terminals MOVED). Bbox-bound:
        # any later resize invalidates the stamp.
        snap = bridge.get_state()["snapshot"] or {}
        node = next((n for n in (snap.get("nodes") or []) if str(n.get("id")) == eid), None)
        if node is None:
            return _text({"ok": False, "error": f"stamp-extent: {eid} is not a component node"})
        entry = blockers.stamp_extent(eid, node.get("bbox"),
                                      provenance=f"chat-quote via copilot: {quote[:160]}")
        return _text({"ok": True, "state": "extent-verified", "entry": entry,
                      "note": f"Extent of {node.get('label') or eid} stamped verified — "
                              "truncation checks skip it; terminal hints invert (box is "
                              "law); ANY resize of the box voids the stamp."})
    return _text({"ok": False, "error": f"unknown action {action!r}"})


@tool(
    name="codify_lesson",
    description=(
        "LEARNING LOOP (Shane, 2026-07-08): after you fix a REAL issue and Shane "
        "confirms the fix (or his correction drove it), codify it — the lesson becomes "
        "standing instruction: injected into future sessions' prompts and attached to "
        "audit_page whenever the same rule fires again. `lesson` is the instruction in "
        "imperative voice, generalized to the CLASS (not this element): e.g. 'A ground "
        "tap's terminus terminal sits ON the ground box border where the printed stem "
        "enters; wire from the component terminal to it; never float it inside the box.' "
        "`shane_quote` must be his VERBATIM words confirming/correcting (a fabricated "
        "quote is the worst offense this system knows). NOT for false positives — those "
        "are dispositions (raise_to_shane action:'dispose'). Don't codify trivia; one "
        "strong lesson beats five weak ones."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "rule": {"type": "string", "description": "The audit rule this lesson answers (e.g. wire-through-component), or a kebab-case class for non-audit lessons (e.g. ground-tap-terminus)"},
            "lesson": {"type": "string", "description": "The instruction, imperative voice, generalized to the class (<=600 chars)"},
            "shane_quote": {"type": "string", "description": "Shane's VERBATIM confirming/correcting words"},
            "element_ids": {"type": "array", "items": {"type": "string"}, "description": "The element(s) the fix touched (provenance)"},
        },
        "required": ["rule", "lesson", "shane_quote"],
        "additionalProperties": False,
    },
)
async def codify_lesson(args: dict[str, Any]) -> dict[str, Any]:
    from src.canvas_copilot import lessons as _lessons
    from src.canvas_copilot.audit import AUDIT_RULE_NAMES

    quote = str(args.get("shane_quote") or "").strip()
    lesson = str(args.get("lesson") or "").strip()
    rule = str(args.get("rule") or "").strip()
    if not quote:
        return _text({"ok": False, "error": "codify_lesson requires shane_quote — his VERBATIM words; nothing self-lessons"})
    if not lesson:
        return _text({"ok": False, "error": "codify_lesson requires the lesson text (imperative, class-general)"})

    # GUARDRAIL 1 (2026-07-09, hardened after adversarial review) — quote
    # provenance. Two self-minted lessons carried copilot-authored quotes
    # attributed to Shane that beat the empty-only gate. The quote must trace
    # (by word-coverage, not a lifted span) to words Shane ACTUALLY sent this
    # session. Read the durable _shane_said store (survives history rotation);
    # fall back to the live _history.
    try:
        from src.canvas_copilot.copilot import copilot_session as _cs
        shane_texts = list(getattr(_cs, "_shane_said", []))
        if not shane_texts:
            shane_texts = [h.get("text", "") for h in getattr(_cs, "_history", [])
                           if h.get("kind") == "user" and h.get("source") in ("panel", "queue", "mid-turn")]
    except Exception:
        shane_texts = []
    traces = _lessons.quote_traces_to_shane(quote, shane_texts)
    if traces is not True:
        # False = fabricated; None = no genuine Shane words this session to cite
        # (e.g. an autonomous post-reset span). BOTH refuse — codify REQUIRES his
        # verbatim words, and inventing them is the worst offense this system knows.
        why = ("does not trace to anything Shane actually sent this session — it reads as your "
               "own paraphrase") if traces is False else (
               "cannot be verified — Shane has not sent a message this session, so there are no "
               "verbatim words to cite")
        return _text({
            "ok": False,
            "refused": "fabricated-quote" if traces is False else "unverifiable-quote",
            "error": f"REFUSED (nothing codified): the shane_quote {why}. codify_lesson requires "
                     "his VERBATIM words. Copy his real message, or don't codify — never invent his voice.",
        })

    # GUARDRAIL 2 (2026-07-09) — rule-field validity. A `rule` that is NOT a live
    # audit rule has a DEAD for_rules recall path (rides only the recent-block).
    # Advisory (non-audit classes are legit), but surfaced so it's a choice.
    rule_is_live = rule in AUDIT_RULE_NAMES
    snap = bridge.get_state()["snapshot"] or {}
    page = snap.get("page")
    # GUARDRAIL 3 (word-safe caps) is enforced inside _lessons.mint.
    entry = _lessons.mint(rule, lesson, quote,
                          page=int(page) if page is not None else None,
                          element_ids=[str(i) for i in (args.get("element_ids") or [])],
                          rule_is_live_audit=rule_is_live)
    note = ("Codified. Future sessions load it in their prompt; audit_page attaches it "
            "whenever this rule fires again.")
    if not rule_is_live:
        note += (f" NOTE: '{rule}' is not a live audit rule, so this lesson will only ride "
                 "the recent-lessons block, NOT fire on audits. If it answers an audit flag, "
                 "re-key it to that flag's exact rule name for right-time recall.")
    return _text({"ok": True, "lesson_id": entry["id"], "rule_is_live_audit": rule_is_live, "note": note})


@tool(
    name="reset_session",
    description=(
        "Reset YOUR OWN session at a clean boundary (context handoff, at your discretion — "
        "the [canvas now] ctx meter nudges you when it's time). The reset is QUEUED: it "
        "executes after this turn ends, then a fresh session of you auto-starts from the "
        "structured handoff note this tool composes. Unfixed receipt warnings from the "
        "server ledger are attached automatically. After calling this: finish your reply "
        "and STOP — do not start new work; your successor takes over."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "done_summary": {
                "type": "string",
                "description": "What is COMPLETE and verified (audit_page-clean areas, element counts) — no aspirations",
            },
            "open_items": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Remaining work, most important first, each item concrete enough to act on without archaeology",
            },
            "unresolved_warnings": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Known unfixed issues BEYOND the server ledger (the ledger attaches automatically)",
            },
            "next_action": {
                "type": "string",
                "description": "The FIRST concrete action your successor should take",
            },
        },
        # Slate 6.7: validation is LENIENT BY DESIGN — no required[], no
        # additionalProperties:false. At extreme context the model's tool-call
        # serialization corrupts (XML parameter markup leaks INTO the JSON
        # strings); the strict schema then failed "open_items required" 10
        # straight times while the agent believed it complied, bricking the
        # reset at the exact moment it mattered most. The server coerces and
        # salvages malformed payloads instead of refusing them (see
        # copilot._coerce_reset_payload). Do NOT re-add strictness here.
    },
)
async def reset_session(args: dict[str, Any]) -> dict[str, Any]:
    # Late import avoids the circular tools<->copilot dependency (same pattern
    # as _mirror_image_to_panel).
    from src.canvas_copilot.copilot import copilot_session

    return _text(await copilot_session.queue_reset(args))


_REFERENCE_SHEET = Path(__file__).resolve().parents[3] / ".atlas" / "reference" / "rosetta-sheet-v3.png"


@tool(
    name="reference_sheet",
    description=(
        "Your visual primer: ONE contact sheet of verified-correct annotation exemplars "
        "(tall module boxed full-height, breaker boxed tight, junction dots vs crossings, "
        "terminals on borders with T~<owner>~[<pin>~]<net> names, continuation refs) rendered in the "
        "same style as your captures. Pull it BEFORE annotating a page and re-pull whenever "
        "unsure how something should look. Costs ~4k tokens once; stays cache-warm."
    ),
    input_schema={"type": "object", "properties": {}, "additionalProperties": False},
)
async def reference_sheet(args: dict[str, Any]) -> dict[str, Any]:
    try:
        b64 = base64.b64encode(_REFERENCE_SHEET.read_bytes()).decode()
    except OSError:
        return _text({"error": "reference sheet not built — run scripts/build-rosetta-sheet.py"})
    await _mirror_image_to_panel("reference_sheet", "annotation exemplars (verified truth)", b64)
    return _with_midturn({
        "content": [
            {"type": "image", "data": b64, "mimeType": "image/png"},
            {"type": "text", "text": json.dumps({
                "note": "verified ground truth from non-test pages; match this style exactly",
                "tiles": ["tall module FULL height", "breaker hugs symbol",
                          "junction dot=connect vs bare crossing", "terminals ON border, T~<owner>~[<pin>~]<net>",
                          "continuation boxed ref"],
            })},
        ]
    })


@tool(
    name="detect_components",
    description=(
        "The trained detector's evidence for this document — a LOOKUP into the "
        "precomputed full-page YOLO scan (never fresh inference). No args = the "
        "current page's detections + roster. region:{x,y,width,height} = "
        "detections intersecting that page-px region. identify:{x,y} = "
        "detections covering that point, best-first — answers 'what component "
        "is this?'. TRUST DOCTRINE: detections are HIGH-PRECISION, INCOMPLETE-"
        "RECALL evidence. A detection is strong evidence a real component is "
        "there — verify identity and extent against the artwork before minting. "
        "ABSENCE of a detection is evidence of NOTHING (known misses: small/"
        "dense classes, label plates, dials). Low confidence (.25-.5) on twin "
        "families (SR/CR/MC/CP) is NORMAL and usually correct — identity comes "
        "from page context. Boxes are SYMBOL-TIGHT by training convention; true "
        "extent is the printed cell, which YOU establish. Every detection stays "
        "a proposal until you disposition it; the audit remains law over "
        "everything, including this tool."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "region": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                },
                "required": ["x", "y", "width", "height"],
                "additionalProperties": False,
            },
            "identify": {
                "type": "object",
                "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                "required": ["x", "y"],
                "additionalProperties": False,
            },
            "min_conf": {"type": "number"},
        },
        "additionalProperties": False,
    },
)
async def detect_components(args: dict[str, Any]) -> dict[str, Any]:
    from src.canvas_copilot import yolo

    snap = (bridge.get_state() or {}).get("snapshot") or {}
    page = int(snap.get("page") or 0)
    if not page:
        return _text({"ok": False, "note": "no canvas snapshot — is the page open?"})
    if yolo.manifest() is None:
        return _text({
            "ok": False,
            "note": "no detection sidecar — run scripts/build-yolo-sidecar.py",
        })

    if args.get("identify"):
        pt = args["identify"]
        hits = yolo.identify(page, float(pt["x"]), float(pt["y"]))
        return _text({
            "ok": True,
            "page": page,
            "mode": "identify",
            "at": pt,
            "matches": hits,
            "model_sha": yolo.model_sha(),
            "note": "best-first; empty means the detector saw nothing here — that proves NOTHING",
        })

    if args.get("region"):
        dets = yolo.in_region(page, args["region"])
        mode = "region"
    else:
        dets = sorted(
            yolo.page_detections(page), key=lambda d: -float(d["confidence"])
        )
        mode = "page"
    min_conf = float(args.get("min_conf") or 0.0)
    if min_conf:
        dets = [d for d in dets if float(d["confidence"]) >= min_conf]
    return _text({
        "ok": True,
        "page": page,
        "mode": mode,
        "roster": yolo.roster(page),
        "detections": dets,
    })


@tool(
    name="playbook",
    description=(
        "Shane's blessed plays — exemplary maneuvers he marked with the canvas Bless tool, "
        "each carrying his verbatim WHY, the situation key, and a crop of the result. "
        "Relevant plays surface automatically in annotate receipts when the situation "
        "recurs; call this to browse (no args) or to SEE a play's image (card_id). A play "
        "is a proven answer for its situation class: imitate it unless the print in front "
        "of you disagrees — print stays law over everything, including excellence."
    ),
    input_schema={
        "type": "object",
        "properties": {"card_id": {"type": "string"}},
        "additionalProperties": False,
    },
)
async def playbook_tool(args: dict[str, Any]) -> dict[str, Any]:
    from src.canvas_copilot import playbook as pb

    if args.get("card_id"):
        card = next((c for c in pb.load_cards() if c.get("id") == args["card_id"]), None)
        if card is None:
            return _text({"ok": False, "note": f"no card {args['card_id']} — call with no "
                                               "args to list plays"})
        content: list[dict[str, Any]] = [
            {"type": "text",
             "text": json.dumps({"ok": True, **{k: v for k, v in card.items()
                                                if k != "embedding"}}, ensure_ascii=False)}
        ]
        crop = card.get("assets", {}).get("crop_overlay")
        if crop:
            p = pb._ROOT / crop
            if p.exists():
                content.append({"type": "image",
                                "data": base64.standard_b64encode(p.read_bytes()).decode("ascii"),
                                "mimeType": "image/png"})
        return {"content": content}
    cards = pb.load_cards()
    return _text({
        "ok": True,
        "plays": [{"id": c.get("id"),
                   "family": (c.get("situation") or {}).get("label_family"),
                   "label": (c.get("situation") or {}).get("element_label"),
                   "page": (c.get("situation") or {}).get("page"),
                   "shane_text": str(c.get("shane_text"))[:160]} for c in cards],
        "note": "plays also surface automatically in annotate receipts when their "
                "situation class matches your mint",
    })


# schema_write / schema_bench / schema_doc_info retired with the Schema-
# Builder bench (Data Map remodel 2026-07-20) — the readers below are
# cross-seat document-study + Neon evidence tools and stay.
from src.canvas_copilot.schema_tools import (  # noqa: E402 — after tool defs
    schema_data_peek,
    schema_data_query,
    schema_data_tables,
    schema_page_text,
    schema_page_view,
)
# Data-extraction seat's write doors — SEAT-SCOPED inside the tool (only run
# on data-extraction), so they stay off ALLOWED_CANVAS_TOOLS
# (approval-gated in gated modes; the draft is reviewed before Verify).
# document_set_schema designs the one table; document_write_rows fills it.
from src.canvas_copilot.extraction_tools import (  # noqa: E402
    document_bench,
    document_set_schema,
    document_write_rows,
)
# Data Map seat (phase 2, 2026-07-20): Arc the describer — reads + ad-hoc
# surveys are open; place/propose/bench are seat-locked; proposing NEVER
# draws (Shane rules every contract).
from src.canvas_copilot.data_map_tools import (  # noqa: E402
    data_map_bench,
    data_map_overview,
    data_map_place_card,
    data_map_propose,
    data_map_survey,
)
# Ops seat: Arc's self-heal hands — sense platform health + request a blue-green
# self-deploy. Platform-wide (not seat-scoped); pre-allowed (autonomous per
# Shane's ruling) — the safety is structural (green verify + kill-switch), not a
# per-call confirm.
from src.canvas_copilot.ops_tools import ops_deploy, ops_health  # noqa: E402

canvas_mcp_server = create_sdk_mcp_server(
    name="canvas",
    version="1.0.0",
    tools=[get_state, get_pointed, highlight, clear_highlights, clear_ask_marks, view, goto_page, capture, annotate, toast, audit_page, raise_to_shane, codify_lesson, derive_extent_tool, reset_session, reference_sheet, detect_components, playbook_tool, schema_page_text, schema_page_view, schema_data_tables, schema_data_peek, schema_data_query, document_set_schema, document_write_rows, document_bench, data_map_overview, data_map_survey, data_map_place_card, data_map_propose, data_map_bench, ops_health, ops_deploy],
)

# Read-only + visual tools are pre-allowed; `annotate` stays behind can_use_tool
# so graph mutations get Shane's explicit approval in the panel.
ALLOWED_CANVAS_TOOLS = [
    "mcp__canvas__get_state",
    "mcp__canvas__get_pointed",
    "mcp__canvas__highlight",
    "mcp__canvas__clear_highlights",
    "mcp__canvas__clear_ask_marks",
    "mcp__canvas__view",
    "mcp__canvas__goto_page",
    "mcp__canvas__capture",
    "mcp__canvas__toast",
    "mcp__canvas__audit_page",
    "mcp__canvas__playbook",
    # Self-management, not graph mutation: agent-discretion resets are the point
    # (build decision log #5) — gating them on approval would defeat the design.
    "mcp__canvas__reset_session",
    # Slate 6.3: parking a flag for Shane is self-management too (it LOCKS
    # geometry rather than mutating it); his verdicts land via quoted chat or
    # the panel endpoint, both journaled.
    "mcp__canvas__raise_to_shane",
    # Learning loop (2026-07-08): codifying a Shane-confirmed fix is journaled
    # self-management (requires his verbatim quote), not graph mutation.
    "mcp__canvas__codify_lesson",
    "mcp__canvas__reference_sheet",
    # Read-only lookup into the precomputed detection sidecar — no mutation.
    "mcp__canvas__detect_components",
    # Slate 7.3: advisory vector-layer evidence — read-only, never truth.
    "mcp__canvas__derive_extent",
    # Cross-seat document study (2026-07-13; bench retired 2026-07-20):
    # read-only page text + visual crops.
    "mcp__canvas__schema_page_text",
    "mcp__canvas__schema_page_view",
    # Neon data grounding (Shane, 2026-07-13): discover tables, peek rows,
    # read-only SELECT — data work grounded in what's already stored.
    "mcp__canvas__schema_data_tables",
    "mcp__canvas__schema_data_peek",
    "mcp__canvas__schema_data_query",
    # Workbench viewer down-channel (re-homed from the retired schema bench,
    # 2026-07-20): pointing + navigation on Shane's extraction viewer, the
    # same class as highlight/goto_page on the canvas — never a mutation.
    "mcp__canvas__document_bench",
    # Data Map seat reads + the bench down-channel (phase 2): overview and
    # ad-hoc surveys are read-only; bench_pick is pointing, not mutation.
    # place_card/propose stay OFF this list (approval cards in gated modes).
    "mcp__canvas__data_map_overview",
    "mcp__canvas__data_map_survey",
    "mcp__canvas__data_map_bench",
    # Ops seat (2026-07-16, self-heal): ops_health is read-only; ops_deploy is
    # autonomous by Shane's ruling — it only QUEUES a deploy request (no restart
    # in-process), and the blue-green verify + AUTONOMY_OFF kill-switch are the
    # safety, so no per-call approval gate.
    "mcp__canvas__ops_health",
    "mcp__canvas__ops_deploy",
]
