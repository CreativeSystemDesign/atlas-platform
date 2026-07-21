"""Tests for shell tool output formatting and spill-to-file."""

from __future__ import annotations

from pathlib import Path

from src.terminal.shell_output import format_shell_tool_return


def test_empty_returns_no_output(tmp_path: Path) -> None:
    assert (
        format_shell_tool_return("", max_chars=100, preview_chars=10, artifact_dir=tmp_path)
        == "(no output)"
    )
    assert (
        format_shell_tool_return("   \n", max_chars=100, preview_chars=10, artifact_dir=tmp_path)
        == "(no output)"
    )


def test_inline_when_under_limit(tmp_path: Path) -> None:
    text = "hello\n" * 10
    out = format_shell_tool_return(text, max_chars=500, preview_chars=10, artifact_dir=tmp_path)
    assert out == text
    assert not list(tmp_path.iterdir())


def test_spill_writes_file_and_previews(tmp_path: Path) -> None:
    text = "x" * 200
    out = format_shell_tool_return(text, max_chars=50, preview_chars=30, artifact_dir=tmp_path)
    assert "exceeds inline limit 50" in out
    assert "full output written to:" in out
    assert "Preview (30 chars shown):" in out
    files = list(tmp_path.glob("shell_*.txt"))
    assert len(files) == 1
    assert files[0].read_text(encoding="utf-8") == text
