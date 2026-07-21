"""Registry of PTY sessions + broadcast to WebSocket clients."""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

from src.config import settings
from src.terminal.pty_session import PtySession
from src.terminal.shell_output import format_shell_tool_return

if TYPE_CHECKING:
    from starlette.websockets import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class SessionEntry:
    session: PtySession
    label: str
    user_pump_stop: threading.Event | None = None


class TerminalManager:
    """Owns all PTY sessions and bridges PTY bytes to WebSocket subscribers."""

    def __init__(self, default_cwd: str = settings.atlas_root) -> None:
        self._default_cwd = default_cwd
        self._sessions: dict[str, SessionEntry] = {}
        self._primary_agent_id: str | None = None
        self._available = True
        self._thread_to_session: dict[str, str] = {}
        self._session_to_thread: dict[str, str] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws_subscribers: dict[str, set[WebSocket]] = {}
        self._lock = threading.Lock()

    def configure_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def startup(self) -> None:
        """Create the primary agent terminal (one read-only agent tab)."""
        sid = str(uuid.uuid4())
        session = PtySession(
            sid,
            "agent",
            self._default_cwd,
            on_tty_output=lambda b, sid=sid: self._on_pty_output(sid, b),
        )
        try:
            session.spawn()
        except RuntimeError as exc:
            self._available = False
            logger.warning("Terminal manager disabled: %s", exc)
            return
        self._sessions[sid] = SessionEntry(session=session, label="Agent")
        self._primary_agent_id = sid
        self._ws_subscribers[sid] = set()

    def shutdown(self) -> None:
        for ent in list(self._sessions.values()):
            if ent.user_pump_stop:
                ent.user_pump_stop.set()
            ent.session.close()
        self._sessions.clear()
        self._ws_subscribers.clear()
        self._primary_agent_id = None
        self._thread_to_session.clear()
        self._session_to_thread.clear()

    @property
    def primary_agent_id(self) -> str | None:
        return self._primary_agent_id

    def _on_pty_output(self, session_id: str, chunk: bytes) -> None:
        self.schedule_broadcast(session_id, chunk)

    def schedule_broadcast(self, session_id: str, chunk: bytes) -> None:
        loop = self._loop
        if loop is None or not chunk:
            return

        async def _send_all() -> None:
            subs = self._ws_subscribers.get(session_id, set())
            dead: list[WebSocket] = []
            for ws in list(subs):
                try:
                    await ws.send_bytes(chunk)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                subs.discard(ws)

        try:
            asyncio.run_coroutine_threadsafe(_send_all(), loop)
        except RuntimeError:
            pass

    def register_websocket(self, session_id: str, ws: WebSocket) -> None:
        with self._lock:
            self._ws_subscribers.setdefault(session_id, set()).add(ws)

    def unregister_websocket(self, session_id: str, ws: WebSocket) -> None:
        with self._lock:
            subs = self._ws_subscribers.get(session_id)
            if subs and ws in subs:
                subs.discard(ws)

    def create_session(self, kind: str, label: str | None = None) -> PtySession:
        if not self._available:
            raise RuntimeError("PTY terminal sessions are unavailable on this platform")
        sid = str(uuid.uuid4())
        lbl = label or ("User" if kind == "user" else "Agent")

        def make_on(session_id: str):
            def on_out(b: bytes) -> None:
                self._on_pty_output(session_id, b)

            return on_out

        session = PtySession(sid, kind, self._default_cwd, on_tty_output=make_on(sid))
        session.spawn()

        stop: threading.Event | None = None
        if kind == "user":
            stop = threading.Event()

            def run_pump() -> None:
                session.pump_user_forever(stop)

            threading.Thread(target=run_pump, name=f"pty-pump-{sid[:8]}", daemon=True).start()

        self._sessions[sid] = SessionEntry(session=session, label=lbl, user_pump_stop=stop)
        self._ws_subscribers[sid] = set()
        return session

    def remove_session(self, session_id: str) -> bool:
        ent = self._sessions.pop(session_id, None)
        if ent is None:
            return False
        tid = self._session_to_thread.pop(session_id, None)
        if tid is not None:
            self._thread_to_session.pop(tid, None)
        if ent.user_pump_stop:
            ent.user_pump_stop.set()
        ent.session.close()
        self._ws_subscribers.pop(session_id, None)
        return True

    def get(self, session_id: str) -> PtySession | None:
        ent = self._sessions.get(session_id)
        return ent.session if ent else None

    def list_sessions(self) -> list[dict]:
        """All sessions. Entries for thread-scoped agent PTYs include `thread_id`."""
        out = []
        for sid, ent in self._sessions.items():
            tid = self._session_to_thread.get(sid)
            out.append(
                {
                    "id": sid,
                    "kind": ent.session.kind,
                    "label": ent.label,
                    "primary_agent": sid == self._primary_agent_id,
                    "thread_id": tid,
                }
            )
        return out

    def ensure_agent_session_for_thread(self, thread_id: str) -> str:
        """Return the agent PTY session id for this chat thread, creating one if needed."""
        if not self._available:
            raise RuntimeError("PTY terminal sessions are unavailable on this platform")
        with self._lock:
            existing = self._thread_to_session.get(thread_id)
            if existing and existing in self._sessions:
                return existing

        sid = str(uuid.uuid4())

        def make_on(session_id: str):
            def on_out(b: bytes) -> None:
                self._on_pty_output(session_id, b)

            return on_out

        session = PtySession(sid, "agent", self._default_cwd, on_tty_output=make_on(sid))
        session.spawn()
        short = thread_id[:8] if len(thread_id) >= 8 else thread_id
        label = f"Agent · {short}"
        with self._lock:
            again = self._thread_to_session.get(thread_id)
            if again and again in self._sessions:
                session.close()
                return again
            self._sessions[sid] = SessionEntry(session=session, label=label)
            self._ws_subscribers[sid] = set()
            self._thread_to_session[thread_id] = sid
            self._session_to_thread[sid] = thread_id
        return sid

    def release_thread_terminal(self, thread_id: str) -> bool:
        """Close the agent PTY for a deleted chat thread. Returns True if a session was removed."""
        with self._lock:
            sid = self._thread_to_session.get(thread_id)
        if not sid:
            return False
        return self.remove_session(sid)

    def run_agent_shell_command(
        self, command: str, working_directory: str, thread_id: str | None = None
    ) -> str:
        if thread_id:
            sid = self.ensure_agent_session_for_thread(thread_id)
        else:
            sid = self._primary_agent_id
        if not sid:
            return "Error: primary agent terminal not initialized"
        ent = self._sessions.get(sid)
        if not ent or ent.session.kind != "agent":
            return "Error: agent terminal missing"
        raw = ent.session.run_agent_command(
            command,
            working_directory,
            timeout_sec=float(settings.shell_command_timeout_sec),
        )
        return format_shell_tool_return(raw)


_terminal_manager: TerminalManager | None = None


def get_terminal_manager() -> TerminalManager:
    if _terminal_manager is None:
        raise RuntimeError("TerminalManager not initialized")
    return _terminal_manager


def init_terminal_manager(cwd: str | None = None) -> TerminalManager:
    global _terminal_manager
    _terminal_manager = TerminalManager(cwd or settings.atlas_root)
    return _terminal_manager
