"""Display filter: harness lines only; real command output preserved."""

from __future__ import annotations

import pytest

from src.terminal.pty_session import PtySession


@pytest.fixture
def session() -> PtySession:
    return PtySession("test-id", "agent", "/tmp", on_tty_output=None)


def test_keeps_prompt_and_output_drops_eot(session: PtySession) -> None:
    out = session._filter_display_chunk(b"atlas /foo $ echo hi\nhi\n__ATLAS_EOT__:0\n")
    assert out == b"atlas /foo $ echo hi\nhi\n"
    assert session._display_line_buf == b""


def test_drops_dim_exit_harness_line(session: PtySession) -> None:
    line = b"\x1b[90m[exit 0]\x1b[0m"
    out = session._filter_display_chunk(line + b"\n")
    assert out == b""


def test_split_chunks_until_newline(session: PtySession) -> None:
    assert session._filter_display_chunk(b"ab") == b""
    assert session._filter_display_chunk(b"c\n") == b"abc\n"


def test_crlf_line_drop(session: PtySession) -> None:
    out = session._filter_display_chunk(b"ok\r\n__ATLAS_EOT__:1\r\n")
    assert out == b"ok\r\n"


def test_flush_keeps_partial_non_harness(session: PtySession) -> None:
    session._filter_display_chunk(b"partial")
    session._flush_display_line_buffer()
    # No newline yet: tail is flushed as-is if not harness
    assert session.scrollback_bytes() == b"partial"


def test_flush_drops_partial_eot_only_if_complete_pattern(session: PtySession) -> None:
    session._filter_display_chunk(b"__ATLAS_EOT__:0")
    session._flush_display_line_buffer()
    assert session.scrollback_bytes() == b""
