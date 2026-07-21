"""Live-canvas bridge routes: canvas state up, agent commands down (SSE)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.canvas_copilot import blockers, bridge

router = APIRouter(prefix="/experimental-v2/bridge", tags=["Experimental v2 Bridge"])

_SSE_HEARTBEAT_S = 15.0


class StatePayload(BaseModel):
    snapshot: dict[str, Any] | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    # Multi-canvas hardening (2026-07-12): each canvas mount stamps its posts;
    # the bridge pins snapshot writes to the elected writer canvas. `focused`
    # feeds the sticky focus-following election (Shane's eyes pick the writer).
    canvas_id: str | None = None
    focused: bool | None = None


class CommandsPayload(BaseModel):
    commands: list[dict[str, Any]]


class DisposeFlagPayload(BaseModel):
    rule: str
    element_id: str
    note: str | None = None
    page: int | None = None


_CONFIRM_CONTRACT = (
    "\n\nThis is a SCOPED ASK — confirm before you act:\n"
    "1. Acknowledge briefly, then gather the context you need with READ-ONLY "
    "tools (capture the marked region with a small pad so you see it over the "
    "artwork; read the page). Do NOT edit the graph yet.\n"
    "2. In ONE short message, restate exactly what you understand Shane wants "
    "done here and how you'll do it — so he can confirm you've got it right.\n"
    "3. Then STOP and WAIT for his go. Graph edits are mechanically refused "
    "until he replies; get his confirmation FIRST, then do the work."
)


def _lasso_turn_text(lassos: list[dict[str, Any]]) -> str:
    """Compose the scoped-ask turn a lasso gesture delivers. Drawing a lasso +
    typing an instruction is a confirm-before-act request (Shane, 2026-07-08):
    the copilot gathers context, restates the plan, and waits for his go."""
    lines = []
    instrs = []
    for ev in lassos:
        b = ev.get("bbox") or {}
        lines.append(
            f"area {ev.get('n')} on page {ev.get('page')} — region "
            f"x={round(float(b.get('x', 0)))}, y={round(float(b.get('y', 0)))}, "
            f"width={round(float(b.get('width', 0)))}, height={round(float(b.get('height', 0)))} (page px)"
        )
        if (ev.get("instruction") or "").strip():
            instrs.append(ev["instruction"].strip())
    plural = len(lines) > 1
    instr_block = ("\n\nShane's instruction: \"" + " / ".join(instrs) + "\"") if instrs else ""
    return (
        "[LASSO — canvas gesture, mechanical record] Shane lassoed "
        + ("these areas" if plural else "this area")
        + " on the schematic:\n"
        + "\n".join("  • " + ln for ln in lines)
        + instr_block
        + _CONFIRM_CONTRACT
    )


def _pen_turn_text(pens: list[dict[str, Any]]) -> str:
    """Compose the mechanical-record turn a pen-ink gesture delivers. Like the
    lasso it's a conversational act, but the ink anchors to a specific element
    (Shane circled/underlined THIS) — so the copilot reasons about the anchored
    target, not just a region."""
    lines = []
    instrs: list[str] = []
    for ev in pens:
        b = ev.get("bbox") or {}
        a = ev.get("anchor") or {}
        anchor_txt = (
            a.get("component_label")
            or a.get("element_label")
            or (f"net {a.get('net_id')}" if a.get("net_id") is not None else None)
            or (f"segment {a.get('segment_index')}" if a.get("segment_index") is not None else None)
            or "no specific element (open area)"
        )
        lines.append(
            f"ink {ev.get('n')} on page {ev.get('page')} — anchored to {anchor_txt}; "
            f"ink region x={round(float(b.get('x', 0)))}, y={round(float(b.get('y', 0)))}, "
            f"width={round(float(b.get('width', 0)))}, height={round(float(b.get('height', 0)))} (page px)"
        )
        if (ev.get("instruction") or "").strip():
            instrs.append(ev["instruction"].strip())
    plural = len(lines) > 1
    instr_block = ("\n\nShane's instruction: \"" + " / ".join(instrs) + "\"") if instrs else ""
    return (
        "[PEN — canvas gesture, mechanical record] Shane inked "
        + ("these marks" if plural else "this mark")
        + " on the schematic:\n"
        + "\n".join("  • " + ln for ln in lines)
        + instr_block
        + _CONFIRM_CONTRACT
    )


def _arrow_turn_text(arrows: list[dict[str, Any]]) -> str:
    """Arrow marks (v4 mark family): tail→head vector; the head is the subject."""
    lines: list[str] = []
    instr = ""
    for ev in arrows:
        tail, head = ev.get("tail") or {}, ev.get("head") or {}
        anchor = ev.get("anchor") or {}
        anchor_txt = (anchor.get("component_label") or anchor.get("element_label")
                      or (f"net {anchor['net_id']}" if anchor.get("net_id") is not None else None)
                      or "open artwork")
        lines.append(
            f"arrow {ev.get('n')} on page {ev.get('page')} — from "
            f"({round(float(tail.get('x', 0)))},{round(float(tail.get('y', 0)))}) to "
            f"({round(float(head.get('x', 0)))},{round(float(head.get('y', 0)))}); "
            f"the HEAD points at {anchor_txt}")
        if ev.get("instruction"):
            instr = str(ev["instruction"])
    return (
        "[ARROW — canvas gesture, mechanical record] Shane drew "
        + "; ".join(lines)
        + (f'\n\nShane\'s instruction: "{instr}"' if instr else "")
        + _CONFIRM_CONTRACT
    )


def _note_turn_text(notes: list[dict[str, Any]]) -> str:
    """Text callouts: a pinned note at page coords; the text IS the message."""
    lines: list[str] = []
    instr = ""
    for ev in notes:
        anchor = ev.get("anchor") or {}
        anchor_txt = (anchor.get("component_label") or anchor.get("element_label")
                      or (f"net {anchor['net_id']}" if anchor.get("net_id") is not None else None)
                      or "open artwork")
        lines.append(
            f"note {ev.get('n')} pinned at "
            f"({round(float(ev.get('x', 0)))},{round(float(ev.get('y', 0)))}) on page "
            f"{ev.get('page')} — anchored to {anchor_txt}")
        if ev.get("instruction"):
            instr = str(ev["instruction"])
    return (
        "[NOTE — canvas gesture, mechanical record] Shane pinned "
        + "; ".join(lines)
        + (f'\n\nShane\'s note: "{instr}"' if instr else "")
        + _CONFIRM_CONTRACT
    )


@router.post("/state")
async def post_state(payload: StatePayload) -> dict[str, Any]:
    result = bridge.put_state(payload.snapshot, payload.events,
                              canvas_id=payload.canvas_id, focused=payload.focused)
    # Lasso / pen / arrow / note = conversational turns: deliver the mark into
    # the copilot conversation (handle_user_message starts a session if none is
    # live and queues if a turn is mid-flight — the start-or-continue contract).
    # Box marks arrive AS lasso events (a box is a rectangular region).
    lassos = [ev for ev in payload.events if ev.get("kind") == "lasso"]
    pens = [ev for ev in payload.events if ev.get("kind") == "pen_mark"]
    arrows = [ev for ev in payload.events if ev.get("kind") == "arrow"]
    notes = [ev for ev in payload.events if ev.get("kind") == "note"]
    if lassos or pens or arrows or notes:
        from src.canvas_copilot.copilot import copilot_session

        if lassos:
            asyncio.create_task(copilot_session.handle_user_message(_lasso_turn_text(lassos), scoped_ask=True))
        if pens:
            asyncio.create_task(copilot_session.handle_user_message(_pen_turn_text(pens), scoped_ask=True))
        if arrows:
            asyncio.create_task(copilot_session.handle_user_message(_arrow_turn_text(arrows), scoped_ask=True))
        if notes:
            asyncio.create_task(copilot_session.handle_user_message(_note_turn_text(notes), scoped_ask=True))
    return result


@router.get("/state")
async def get_state(since_event: int = Query(default=0)) -> dict[str, Any]:
    return bridge.get_state(since_event=since_event)


@router.get("/stats")
async def stats() -> dict[str, Any]:
    return bridge.bridge_stats()


@router.post("/commands")
async def post_commands(payload: CommandsPayload) -> dict[str, Any]:
    """REST escape hatch for issuing canvas commands (the copilot's in-process
    tools bypass this; useful for curl-driven debugging)."""
    return {"ids": bridge.send_commands(payload.commands)}


@router.post("/dispose-flag")
async def dispose_flag(payload: DisposeFlagPayload) -> dict[str, Any]:
    """Shane checked a flag off as a false positive directly on the canvas pill —
    no copilot turn. Persist the disposition (shane-panel provenance, geometry-
    bound: _violation_state resurrects the flag if the element's box later moves)
    so it never gates a seal and never re-paints, and append it to the false-
    positive corpus for rule calibration. The audit's own filter drops it on the
    next run; the canvas removes it optimistically in the meantime."""
    snap = bridge.get_state().get("snapshot") or {}
    # Refuse a disposition we can't anchor to geometry. A shane-disposed entry
    # with geometry=None is PERMANENT (_violation_state can never invalidate it),
    # so an unanchored verdict could hide a real defect forever — the exact hole
    # the edge-geometry fix closes. If the element doesn't resolve (canvas not yet
    # synced), 409 → the canvas rolls back its optimistic removal and the flag
    # stays visible (the safe failure) rather than vanishing unaccountably.
    # EXCEPT print-anchored synthetic ids (jdot-x-y / contref-x-y): the id IS the
    # coordinate of a printed artifact — the print never moves, so a permanent
    # disposition is the correct semantics (same as the existing contref records).
    if (not payload.element_id.startswith(("jdot-", "contref-"))
            and blockers._element_geometry(snap, payload.element_id) is None):
        raise HTTPException(
            status_code=409,
            detail="element has no resolvable geometry yet (canvas may not have synced) — try again")
    entry = blockers.dispose_ticket(
        payload.rule, payload.element_id, "false-positive", "shane-panel", snap)
    blockers.record_false_positive(
        payload.rule, payload.element_id, "false-positive", "shane-panel",
        entry.get("geometry"), payload.note, payload.page)
    return {"ok": True, "state": "shane-disposed", "entry": entry}


@router.get("/commands/stream")
async def command_stream(last_seen_id: int = Query(default=0),
                         canvas_id: str = Query(default="")) -> StreamingResponse:
    """SSE stream the canvas subscribes to; replays very recent commands on reconnect."""

    async def gen():
        queue, replay = bridge.subscribe(last_seen_id, canvas_id=canvas_id or None)
        # A (re)connecting canvas starts blank; force the next audit to re-assert
        # the flag layer to it (the sig-gate would otherwise skip re-pushing an
        # unchanged flag set, leaving the reloaded page's flags gone). Imported
        # lazily to keep the bridge→tools direction one-way (no import cycle).
        from src.canvas_copilot import tools as _tools
        _tools.reset_flag_push_sig()
        try:
            yield "event: hello\ndata: {}\n\n"
            for cmd in replay:
                yield f"data: {json.dumps(cmd, ensure_ascii=False)}\n\n"
            while True:
                try:
                    cmd = await asyncio.wait_for(queue.get(), timeout=_SSE_HEARTBEAT_S)
                    yield f"data: {json.dumps(cmd, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # Named event (not an SSE comment): comments are invisible to
                    # EventSource, so the browser's zombie-stream deadman needs a
                    # beat it can actually observe.
                    yield "event: ping\ndata: {}\n\n"
        finally:
            bridge.unsubscribe(queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
