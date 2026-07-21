"""PTY terminal sessions — REST + WebSocket."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from src.terminal.manager import get_terminal_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Terminals"])


class TerminalCreate(BaseModel):
    kind: str = Field(..., description="'user' or 'agent'")
    label: str | None = None


@router.get("/terminals")
async def list_terminals() -> dict[str, Any]:
    """Tab bar: user shells and standalone agent tabs only (not per-chat-thread agent PTYs)."""
    mgr = get_terminal_manager()
    all_rows = mgr.list_sessions()
    tabs_only = [
        r
        for r in all_rows
        if r.get("thread_id") is None and not r.get("primary_agent")
    ]
    return {"sessions": tabs_only, "primary_agent_id": mgr.primary_agent_id}


@router.get("/terminals/by-thread/{thread_id}")
async def terminal_by_thread(thread_id: uuid.UUID) -> dict[str, Any]:
    """Agent PTY for this chat thread (for WebSocket + xterm). Creates the session if needed."""
    mgr = get_terminal_manager()
    sid = mgr.ensure_agent_session_for_thread(str(thread_id))
    for row in mgr.list_sessions():
        if row["id"] == sid:
            return row
    raise HTTPException(status_code=500, detail="Session not found after ensure")


@router.post("/terminals")
async def create_terminal(body: TerminalCreate) -> dict[str, Any]:
    if body.kind not in ("user", "agent"):
        raise HTTPException(status_code=400, detail="kind must be 'user' or 'agent'")
    mgr = get_terminal_manager()
    session = mgr.create_session(body.kind, body.label)
    return {
        "id": session.session_id,
        "kind": session.kind,
        "label": body.label or ("User" if body.kind == "user" else "Agent"),
    }


@router.delete("/terminals/{session_id}")
async def delete_terminal(session_id: str) -> dict[str, str]:
    mgr = get_terminal_manager()
    if session_id == mgr.primary_agent_id:
        raise HTTPException(status_code=400, detail="Cannot delete the primary agent terminal")
    if not mgr.remove_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "closed"}


@router.websocket("/terminals/ws/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str) -> None:
    mgr = get_terminal_manager()
    session = mgr.get(session_id)
    if session is None:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    mgr.register_websocket(session_id, websocket)

    snap = session.scrollback_bytes()
    if snap:
        try:
            await websocket.send_bytes(snap)
        except Exception as e:
            logger.debug("scrollback send: %s", e)

    try:
        if session.kind == "user":
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg["type"] != "websocket.receive":
                    continue
                if msg.get("bytes") is not None:
                    session.write_bytes(msg["bytes"])
                elif msg.get("text") is not None:
                    text = msg["text"]
                    if text.startswith("{"):
                        try:
                            data = json.loads(text)
                        except json.JSONDecodeError:
                            session.write_bytes(text.encode("utf-8"))
                            continue
                        if data.get("type") == "resize":
                            session.resize(
                                int(data.get("rows", 24)),
                                int(data.get("cols", 80)),
                            )
                    else:
                        session.write_bytes(text.encode("utf-8"))
        else:
            # Agent terminal: read-only from browser; allow resize only
            while True:
                msg = await websocket.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg["type"] != "websocket.receive":
                    continue
                if "text" in msg and msg["text"]:
                    try:
                        data = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "resize":
                        session.resize(
                            int(data.get("rows", 24)),
                            int(data.get("cols", 80)),
                        )
    except WebSocketDisconnect:
        pass
    finally:
        mgr.unregister_websocket(session_id, websocket)
