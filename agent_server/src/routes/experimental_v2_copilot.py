"""Copilot WebSocket route: the chat panel's connection to the embedded agent.

Browser -> server messages (protocol v2, 2026-07-07 — full-SDK panel):
  {type: "user_message", text, images?: [{media_type, data}]}
  {type: "approval_response", id, allow, message?, always_allow?, updated_input?, interrupt?}
  {type: "interrupt"}
  {type: "set_settings", settings: {...}}
  {type: "set_permission_mode", mode}
  {type: "stop_task", task_id}
  {type: "queue_remove", index}
  {type: "new_session"}
Server -> browser messages (see CopilotSession._relay / _broadcast):
  kinds: session, init_info, settings, status, user, ingress, assistant_delta,
  assistant_text, thinking_delta, thinking, tool_use, tool_result, tool_image,
  task, rate_limit, system_event, context, queue, result, error, approval_request
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.canvas_copilot.copilot import copilot_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/experimental-v2/copilot", tags=["Experimental v2 Copilot"])


@router.get("/status")
async def status() -> dict[str, Any]:
    return copilot_session.public_state()


@router.get("/tickets")
async def ticket_states() -> dict[str, Any]:
    """Slate 6.3: the Shane-facing ticket state store (awaiting-shane /
    shane-disposed / reopened), for the panel and for review."""
    from src.canvas_copilot import blockers

    return {"states": blockers._states()}


@router.post("/ticket-disposition")
async def ticket_disposition(body: dict[str, Any]) -> dict[str, Any]:
    """Slate 6.3: SHANE-ONLY disposition path (panel button / manual curl).
    Journaled with provenance; geometry-bound — a later change to the element
    resurrects the flag. The copilot cannot reach this endpoint; its only
    channels are raise_to_shane park/reopen/dispose with his quoted words."""
    from src.canvas_copilot import blockers, bridge

    rule = str(body.get("rule") or "").strip()
    eid = str(body.get("element_id") or "").strip()
    if not rule or not eid:
        return {"ok": False, "error": "rule and element_id required"}
    verdict = str(body.get("verdict") or "false-positive")
    snap = bridge.get_state()["snapshot"] or {}
    entry = blockers.dispose_ticket(rule, eid, verdict,
                                    provenance="shane-panel", snap=snap)
    await copilot_session._broadcast(
        {"kind": "ticket_disposed", "rule": rule, "element_id": eid, "verdict": verdict})
    return {"ok": True, "entry": entry}


@router.get("/export-lint")
async def export_lint() -> dict[str, Any]:
    """Slate §5: dataset-grade advisories on the CURRENT page graph — never
    rejects. The dataset factory (and Shane) read these before blessing a
    page for training. Gold v1.1 lints clean by construction."""
    from src.canvas_copilot import bridge, vectors
    from src.canvas_copilot.export_lint import lint_graph

    snap = bridge.get_state()["snapshot"] or {}
    if not snap:
        return {"ok": False, "note": "no canvas snapshot — is the page open?"}
    texts = None
    try:
        texts = await vectors.page_texts(int(snap.get("page") or 0))
    except Exception:
        pass
    advisories = lint_graph(snap, texts=texts)
    return {"ok": True, "page": snap.get("page"), "advisories": advisories,
            "clean": not advisories}


@router.post("/extent-stamp")
async def extent_stamp_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    """Slate 4.6(a): SHANE-ONLY — stamp a component's CURRENT box extent as
    verified (truncation checks skip it; terminal hints invert). Bbox-bound:
    any later resize voids it."""
    from src.canvas_copilot import blockers, bridge

    nid = str(body.get("node_id") or "").strip()
    if not nid:
        return {"ok": False, "error": "node_id required"}
    snap = bridge.get_state()["snapshot"] or {}
    node = next((n for n in (snap.get("nodes") or []) if str(n.get("id")) == nid), None)
    if node is None:
        return {"ok": False, "error": f"{nid} not found in the current snapshot"}
    entry = blockers.stamp_extent(nid, node.get("bbox"), provenance="shane-panel")
    return {"ok": True, "entry": entry}


@router.get("/page-lock")
async def page_lock_status(page: int) -> dict[str, Any]:
    """Seal status for the header button (Shane, 2026-07-08): current lock +
    whether the page qualifies to seal (audit clean post-disposition AND the
    Table empty) + the latest gold snapshot and its DRIFT TRIPWIRE (a sealed
    page whose live graph differs from its snapshot is an alarm). clean is
    null when the canvas isn't on this page."""
    from src.canvas_copilot import blockers, bridge

    entry = blockers.page_locked(int(page))
    clean: bool | None = None
    try:
        snap = (bridge.get_state() or {}).get("snapshot") or {}
        if snap and int(snap.get("page") or -1) == int(page):
            from src.canvas_copilot.blockers import blocker_response
            from src.canvas_copilot.tools import compute_page_audit

            audit = await compute_page_audit()
            if audit:
                clean = bool(blocker_response(audit, snap).get("clean"))
    except Exception:
        logger.debug("seal-status audit unavailable", exc_info=True)
    table_open = len([it for it in blockers.list_issues(int(page))
                      if it.get("state") == "awaiting-shane"])
    gold: dict[str, Any] | None = None
    drift: bool | None = None
    try:
        from src.persistence.certification import latest_certification_seal, verify_certification_seal
        from src.routes.experimental_v2 import _DEFAULT_DOCUMENT_ID, _DEFAULT_PROJECT_ID

        gold = await latest_certification_seal(_DEFAULT_PROJECT_ID, _DEFAULT_DOCUMENT_ID, int(page))
        if entry and gold:
            check = await verify_certification_seal(_DEFAULT_PROJECT_ID, _DEFAULT_DOCUMENT_ID, int(page))
            drift = not check["match"] if check else None
    except Exception:
        logger.debug("certification seal status unavailable", exc_info=True)
    return {
        "ok": True,
        "page": int(page),
        "locked": bool(entry),
        "provenance": (entry or {}).get("provenance"),
        "sealed_at": (entry or {}).get("ts"),
        "clean": clean,
        "table_open": table_open,
        "sealable": bool(clean) and table_open == 0 and not entry,
        "gold": gold,
        "drift": drift,
    }


@router.post("/page-lock")
async def page_lock_endpoint(body: dict[str, Any]) -> dict[str, Any]:
    """Slate 4.6(b): SHANE-ONLY page seal — the gold-master lock. A locked
    page refuses every mutating batch until unlocked here. Sealing ALSO
    archives the page's graph into gold_sealed_annotations (append-only,
    checksummed) — the milestone is journaled, never silent (Shane)."""
    from src.canvas_copilot import blockers

    page = body.get("page")
    if page is None:
        return {"ok": False, "error": "page required"}
    locked = bool(body.get("locked", True))
    reason = str(body.get("reason") or "shane-panel")
    gold: dict[str, Any] | None = None
    if locked:
        try:
            from src.persistence.certification import snapshot_certification_seal
            from src.routes.experimental_v2 import _DEFAULT_DOCUMENT_ID, _DEFAULT_PROJECT_ID

            gold = await snapshot_certification_seal(
                _DEFAULT_PROJECT_ID, _DEFAULT_DOCUMENT_ID, int(page), provenance=reason)
        except Exception:
            logger.warning("gold snapshot failed — page NOT sealed", exc_info=True)
            return {"ok": False, "error": "certified snapshot failed — page not sealed (see server log)"}
        if gold is None:
            return {"ok": False, "error": "page has no saved graph to archive — nothing sealed"}
    blockers.set_page_lock(int(page), locked, provenance=reason)
    return {"ok": True, "page": int(page), "locked": locked, "gold": gold}


_BACKFILL_PAGE_SCAN = 30
_backfill_ran = False


async def _backfill_issue_pages() -> None:
    """One-shot per process: pre-page-tracking parks get their page resolved
    by finding which saved graph actually contains the element; elements in
    NO saved graph (wiped experiment legs) are marked orphan so the panel is
    honest instead of bouncing Shane between pages (his report, 2026-07-07)."""
    global _backfill_ran
    if _backfill_ran:
        return
    _backfill_ran = True
    from src.canvas_copilot import blockers

    unpaged = [(it["rule"], it["element_id"]) for it in blockers.list_issues(None)
               if it.get("page") is None and not it.get("orphan")]
    if not unpaged:
        return
    try:
        from src.persistence.v2_graph import load_v2_graph
        from src.routes.experimental_v2 import _DEFAULT_DOCUMENT_ID, _DEFAULT_PROJECT_ID

        remaining = set(unpaged)
        for page in range(1, _BACKFILL_PAGE_SCAN + 1):
            if not remaining:
                break
            try:
                graph = await load_v2_graph(_DEFAULT_PROJECT_ID, _DEFAULT_DOCUMENT_ID, page)
            except Exception:
                continue
            if not graph:
                continue
            ids = {str(el.get("id"))
                   for coll in ("nodes", "ports", "edges", "continuations")
                   for el in (graph.get(coll) or [])}
            for rule, eid in list(remaining):
                if eid in ids:
                    blockers.set_issue_page(rule, eid, page)
                    remaining.discard((rule, eid))
        for rule, eid in remaining:
            blockers.set_issue_page(rule, eid, None, orphan=True)
        logger.info("issue page backfill: %d resolved, %d orphaned",
                    len(unpaged) - len(remaining), len(remaining))
    except Exception:
        _backfill_ran = False  # transient (Neon offline?) — retry next request
        logger.warning("issue page backfill failed; will retry", exc_info=True)


@router.get("/issues")
async def issues(page: int | None = None) -> dict[str, Any]:
    """The Table (Shane's design 2026-07-08, refining 2026-07-07): ONLY the
    issues the copilot genuinely could not resolve with its own resources
    (lessons, playbook, YOLO evidence, vault, captures) — each parked as a
    yes/no question with a crop, awaiting his verdict or its application.
    Everything else the copilot fixes autonomously; the audit remains the
    mechanical truth behind the scenes. Crops are fetched via /issue-crop."""
    from src.canvas_copilot import blockers

    await _backfill_issue_pages()
    items = [{k: v for k, v in it.items() if k != "crop_path"}
             | {"has_crop": bool(it.get("crop_path"))}
             for it in blockers.list_issues(page)]
    return {"ok": True, "page": page, "items": items}


@router.post("/issue-dispose")
async def issue_dispose(body: dict[str, Any]) -> dict[str, Any]:
    """SHANE-ONLY (drawer's False-positive button): dispose an open flag under
    his verdict. Geometry-bound like every disposition — a later change to the
    element resurrects the flag. This IS the codify-false-positive channel:
    disposed flags stop being detected/listed on every future audit."""
    from src.canvas_copilot import blockers, bridge

    rule = str(body.get("rule") or "").strip()
    eid = str(body.get("element_id") or "").strip()
    note = str(body.get("note") or "").strip()
    verdict = str(body.get("verdict") or "false-positive").strip()
    if not rule or not eid:
        return {"ok": False, "error": "rule and element_id required"}
    snap = (bridge.get_state() or {}).get("snapshot") or {}
    entry = blockers.dispose_ticket(
        rule, eid, verdict,
        provenance=f"shane-issues-panel{': ' + note[:140] if note else ''}", snap=snap)
    # Mechanical awareness (2026-07-08): the copilot sees drawer disposals in
    # its next [canvas now] block — no turn fired, model stays current.
    try:
        import time as _time

        copilot_session.panel_disposals = (copilot_session.panel_disposals + [
            {"rule": rule, "element_id": eid, "note": note[:80], "ts": _time.time()}
        ])[-8:]
        copilot_session._persist()
    except Exception:
        logger.debug("panel disposal record failed", exc_info=True)
    try:
        from src.canvas_copilot.tools import _broadcast_issues

        await _broadcast_issues(snap.get("page"))
    except Exception:
        logger.debug("issue broadcast failed", exc_info=True)
    return {"ok": True, "entry": entry}


@router.get("/issue-crop")
async def issue_crop(rule: str, element_id: str):
    """The parked issue's region crop (PNG). Path comes from the ticket store
    — never from the client — so there is no traversal surface."""
    from fastapi.responses import FileResponse, Response

    from src.canvas_copilot import blockers

    entry = blockers._states().get(f"{rule}|{element_id}")
    crop = (entry or {}).get("crop_path")
    if not crop or not Path(crop).is_file():
        return Response(status_code=404)
    return FileResponse(crop, media_type="image/png")


@router.post("/issue-answer")
async def issue_answer(body: dict[str, Any]) -> dict[str, Any]:
    """SHANE-ONLY: verdict on a Table card — yes / no / CUSTOM ("Something
    Else", 2026-07-09: when neither offered path matches the instruction he
    needs to give, his typed note IS the ruling; required for custom). Records
    the answer (card stays on the Table until applied; geometry unlocks at
    answer time), then delivers a [SHANE'S VERDICT] message into the copilot's
    stream so it applies the input and resolves."""
    from src.canvas_copilot import blockers

    rule = str(body.get("rule") or "").strip()
    eid = str(body.get("element_id") or "").strip()
    answer = str(body.get("answer") or "").strip().lower()
    note = str(body.get("note") or "").strip()
    if not rule or not eid or answer not in ("yes", "no", "custom"):
        return {"ok": False, "error": "rule, element_id and answer ('yes'|'no'|'custom') required"}
    if answer == "custom" and not note:
        return {"ok": False, "error": "custom verdict requires the note — your instruction IS the ruling"}
    entry = blockers.answer_ticket(rule, eid, answer, note, provenance="shane-issues-panel")
    if entry is None:
        return {"ok": False, "error": "no open issue for that (rule, element)"}
    try:
        from src.canvas_copilot.tools import _broadcast_issues

        await _broadcast_issues(entry.get("page"))
    except Exception:
        logger.debug("issue broadcast failed", exc_info=True)
    label = entry.get("element_label") or eid
    if answer == "custom":
        verdict_msg = (
            f"[SHANE'S VERDICT — the Table, mechanical record] Issue `{rule}` on "
            f"{label} ({eid}), page {entry.get('page', '?')}: \"{entry.get('question')}\" "
            f"→ **SOMETHING ELSE — neither offered path. His instruction IS the ruling:**\n"
            f"\"{note}\"\n"
            "Apply exactly this instruction now (geometry on the element is unlocked by "
            "this verdict); when applied, call raise_to_shane action:'resolve' with this "
            "rule + element_id to clear the card."
        )
    else:
        verdict_msg = (
            f"[SHANE'S VERDICT — the Table, mechanical record] Issue `{rule}` on "
            f"{label} ({eid}), page {entry.get('page', '?')}: \"{entry.get('question')}\" "
            f"→ **{answer.upper()}**"
            + (f" ({entry.get('yes_means') if answer == 'yes' else entry.get('no_means')})"
               if entry.get("yes_means" if answer == "yes" else "no_means") else "")
            + (f". His note: \"{note}\"" if note else ".")
            + " Apply this now (geometry on the element is unlocked by this verdict); "
              "when applied, call raise_to_shane action:'resolve' with this "
              "rule + element_id to clear the issue from his panel."
        )
    asyncio.create_task(copilot_session.handle_user_message(verdict_msg))
    return {"ok": True, "entry": {k: v for k, v in entry.items() if k != "crop_path"}}


@router.get("/server-info")
async def server_info() -> dict[str, Any]:
    """Session capabilities: model, tool names, slash commands, MCP servers —
    cached from the live client's init message (dies with the process)."""
    return {"ok": True, "connected": copilot_session.last_init is not None,
            **(copilot_session.last_init or {})}


@router.get("/context")
async def context_detail() -> dict[str, Any]:
    """The real context meter (per-category breakdown, the CLI's /context) —
    refreshed after every turn."""
    if not copilot_session.last_context:
        return {"ok": False, "note": "no turn has completed yet"}
    return {"ok": True, **copilot_session.last_context,
            **(copilot_session.last_context_detail or {})}


@router.get("/mcp-status")
async def mcp_status() -> dict[str, Any]:
    """Live MCP server health from the SDK (connected client required)."""
    client = copilot_session._client
    if client is None:
        return {"ok": False, "note": "no live client — send a message first"}
    try:
        status = await client.get_mcp_status()
        return {"ok": True, **dict(status)}
    except Exception as exc:  # busy CLI, transport hiccup — report, never raise
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


@router.post("/mcp-reconnect")
async def mcp_reconnect(body: dict[str, Any]) -> dict[str, Any]:
    client = copilot_session._client
    name = str(body.get("server") or "").strip()
    if client is None or not name:
        return {"ok": False, "error": "no live client or missing server name"}
    try:
        await client.reconnect_mcp_server(name)
        return {"ok": True, "server": name}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


@router.websocket("/ws")
async def copilot_ws(ws: WebSocket) -> None:
    await ws.accept()
    copilot_session.attach(ws)
    try:
        await ws.send_json(
            {"kind": "status", "state": "busy" if copilot_session.busy else "ready"}
        )
        await ws.send_json({"kind": "state", **copilot_session.public_state()})
        # Full-SDK panel: session capabilities + real context meter on connect.
        if copilot_session.last_init:
            await ws.send_json({"kind": "init_info", **copilot_session.last_init})
        if copilot_session.last_context:
            await ws.send_json({"kind": "context", **copilot_session.last_context,
                                **(copilot_session.last_context_detail or {})})
        # Replay durable chat history so a page refresh / reconnect doesn't blank
        # the panel (the panel only seeds from this when its list is empty).
        await ws.send_json({"kind": "history", "messages": copilot_session.history()})
        # Unresolved approvals must survive a panel reconnect — re-present them
        # (the panel dedupes by id).
        for payload in copilot_session.pending_approval_payloads():
            await ws.send_json(payload)
        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")
            if mtype == "user_message":
                text = (msg.get("text") or "").strip()
                images = msg.get("images") if isinstance(msg.get("images"), list) else None
                if text or images:
                    area_ctx = msg.get("area_context")
                    # Fire-and-forget: replies broadcast to every attached socket.
                    asyncio.create_task(
                        copilot_session.handle_user_message(
                            text, images=images,
                            area=(str(msg.get("area")) if msg.get("area") else None),
                            area_context=area_ctx if isinstance(area_ctx, dict) else None))
            elif mtype == "approval_response":
                updated_input = msg.get("updated_input")
                copilot_session.resolve_approval(
                    str(msg.get("id")), bool(msg.get("allow")), msg.get("message"),
                    always_allow=bool(msg.get("always_allow")),
                    updated_input=updated_input if isinstance(updated_input, dict) else None,
                    interrupt=bool(msg.get("interrupt")),
                )
            elif mtype == "interrupt":
                await copilot_session.interrupt()
            elif mtype == "set_settings":
                await copilot_session.set_settings(msg.get("settings") or {})
            elif mtype == "set_permission_mode":
                await copilot_session.set_permission_mode_live(str(msg.get("mode") or ""))
            elif mtype == "stop_task":
                await copilot_session.stop_background_task(str(msg.get("task_id") or ""))
            elif mtype == "queue_remove":
                try:
                    copilot_session.remove_queued(int(msg.get("index")))
                except (TypeError, ValueError):
                    pass
            elif mtype == "new_session":
                await copilot_session.new_session()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Copilot websocket error")
    finally:
        copilot_session.detach(ws)
