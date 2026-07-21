"""Stored system_prompt workbench subsection migration."""

from __future__ import annotations

from src.persistence.settings import DEFAULT_SYSTEM_PROMPT, migrated_system_prompt_if_stale

_OLD_WORKBENCH_TAIL = (
    "**Completion markers:** Each `shell` run may print a dim **`[exit N]`** line and an internal **`__ATLAS_EOT__`** line for the server. **The string returned to you from the `shell` tool strips those markers** (and the exit summary line) so you see clean command output; the operator may still see the full transcript including markers in the terminal view.\n\n"
    "**Usage guidance:** Prefer **fewer, richer** `shell` invocations (here-docs, `&&` chains) when it keeps the transcript readable, without sacrificing correctness or safety.\n\n"
)


def test_no_op_when_already_has_anchor() -> None:
    assert migrated_system_prompt_if_stale(DEFAULT_SYSTEM_PROMPT) is None


def test_migrates_old_completion_markers_text() -> None:
    s = DEFAULT_SYSTEM_PROMPT
    start = s.index("**Live view vs tool return:**")
    end = s.index("\n## Prefer bash (`shell` tool) for VM work")
    old = s[:start] + _OLD_WORKBENCH_TAIL + s[end:]
    assert "**Live view vs tool return:**" not in old
    out = migrated_system_prompt_if_stale(old)
    assert out is not None
    assert "**Live view vs tool return:**" in out
    assert "operator may still see" not in out
    assert out == DEFAULT_SYSTEM_PROMPT


def test_no_op_without_workbench_heading() -> None:
    assert migrated_system_prompt_if_stale("You are a bot.\n\n## Other\n\nHi.") is None
