"""Format shell tool returns: inline cap with optional spill to artifact file."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from src.config import settings


def format_shell_tool_return(
    raw: str,
    *,
    max_chars: int | None = None,
    preview_chars: int | None = None,
    artifact_dir: str | Path | None = None,
) -> str:
    """Return full stdout/stderr inline up to ``max_chars``; otherwise write the full
    text to a file under ``artifact_dir`` and return path plus a preview block.
    """
    max_c = max_chars if max_chars is not None else settings.shell_output_max_chars
    preview_c = (
        preview_chars if preview_chars is not None else settings.shell_spill_preview_chars
    )
    art = artifact_dir if artifact_dir is not None else settings.shell_artifact_dir

    text = raw if raw else ""
    if not text.strip():
        return "(no output)"

    if len(text) <= max_c:
        return text

    path = Path(art)
    path.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", text[:120])[:48].strip("_") or "out"
    fname = f"shell_{uuid.uuid4().hex[:12]}_{slug}.txt"
    fpath = path / fname
    fpath.write_text(text, encoding="utf-8", errors="replace")

    prev = text[:preview_c]
    if len(text) > preview_c:
        prev += "\n... [preview truncated; read the file for full output]"

    return (
        f"[Output length {len(text)} chars exceeds inline limit {max_c}; "
        f"full output written to: {fpath}]\n\n"
        f"Preview ({min(preview_c, len(text))} chars shown):\n{prev}"
    )
