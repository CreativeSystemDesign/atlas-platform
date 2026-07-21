"""Render sizing — the pixel-cap fallback that keeps A0 drawings renderable.

Born from real intake failures (2026-07-13): two arrangement drawings failed
master-png with MuPDF "code=5: Overly large image" at 600dpi.
"""

from __future__ import annotations

import fitz

from src.intake_worker import MASTER_DPI, MAX_RENDER_PIXELS, MIN_FALLBACK_DPI, _fit_dpi


def _page(width_pt: float, height_pt: float) -> fitz.Page:
    doc = fitz.open()
    return doc.new_page(width=width_pt, height=height_pt)


def test_a4_keeps_requested_dpi():
    assert _fit_dpi(_page(595, 842), MASTER_DPI) == MASTER_DPI


def test_a0_reduces_below_cap():
    # A0 = 2384 x 3370 pt; at 600dpi that's ~558MP — over the cap.
    page = _page(2384, 3370)
    used = _fit_dpi(page, MASTER_DPI)
    assert used < MASTER_DPI
    px = (page.rect.width / 72 * used) * (page.rect.height / 72 * used)
    assert px <= MAX_RENDER_PIXELS


def test_pathological_page_floors_at_min():
    assert _fit_dpi(_page(14400, 14400), MASTER_DPI) == MIN_FALLBACK_DPI


def test_workspace_dpi_survives_a0():
    # 300dpi on A0 is ~139MP — under the cap, must NOT be reduced.
    assert _fit_dpi(_page(2384, 3370), 300) == 300
