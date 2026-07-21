"""The atomic-render path, end to end — born from a live failure (2026-07-13):
the review's atomicity fix named temp files `.tmp`, PyMuPDF infers format
from extension, every render died. The dpi math was tested; the save path
wasn't. Now it is."""

from __future__ import annotations

import fitz

from src.intake_worker import _render_pages


def test_render_pages_saves_and_renames(tmp_path):
    pdf = tmp_path / "doc.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.new_page()
    doc.save(str(pdf))
    doc.close()

    out_dir = tmp_path / "out"
    seen: list[int] = []
    total, reduced = _render_pages(str(pdf), out_dir, 72, seen.append)
    assert total == 2 and seen == [1, 2] and reduced == {}
    files = sorted(p.name for p in out_dir.iterdir())
    assert files == ["page-0001.png", "page-0002.png"], f"unexpected: {files}"
    # valid PNGs, no temp leftovers
    for name in files:
        assert (out_dir / name).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"

    # idempotent second pass: existing files skip untouched
    before = [(p.name, p.stat().st_mtime_ns) for p in sorted(out_dir.iterdir())]
    _render_pages(str(pdf), out_dir, 72, lambda _n: None)
    after = [(p.name, p.stat().st_mtime_ns) for p in sorted(out_dir.iterdir())]
    assert before == after
