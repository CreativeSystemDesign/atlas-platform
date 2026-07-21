"""Thread-scoped agent PTY mapping (no real shell — PtySession is mocked)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def manager():
    with patch("src.terminal.manager.PtySession") as mock_pty:

        def factory(sid, kind, cwd, on_tty_output=None):
            m = MagicMock()
            m.kind = kind
            m.session_id = sid
            return m

        mock_pty.side_effect = factory

        from src.terminal.manager import TerminalManager

        yield TerminalManager("/tmp")


def test_ensure_distinct_sessions_per_thread(manager):
    a = manager.ensure_agent_session_for_thread(
        "11111111-1111-1111-1111-111111111111"
    )
    b = manager.ensure_agent_session_for_thread(
        "22222222-2222-2222-2222-222222222222"
    )
    assert a != b


def test_ensure_idempotent(manager):
    tid = "33333333-3333-3333-3333-333333333333"
    first = manager.ensure_agent_session_for_thread(tid)
    second = manager.ensure_agent_session_for_thread(tid)
    assert first == second


def test_release_thread_terminal_removes_session(manager):
    tid = "44444444-4444-4444-4444-444444444444"
    sid = manager.ensure_agent_session_for_thread(tid)
    assert manager.get(sid) is not None
    assert manager.release_thread_terminal(tid) is True
    assert manager.get(sid) is None
