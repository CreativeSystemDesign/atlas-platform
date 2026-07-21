"""Page vector geometry for the copilot — the printed artwork as data.

Serves the SAME shapes the canvas snaps to (Neon `schematic_page_metadata`,
surfaced by the workbench metadata endpoint), converted to page-pixel space
(2481x3509). This is the copilot's ground truth for "where is the printed
line": geometry judgments become numeric comparisons instead of an extra
capture-and-eyeball round trip.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# page -> (source_hash, segments) — metadata is immutable per source_hash, so
# one fetch per page per server run is plenty.
_cache: dict[int, tuple[str | None, list[dict[str, float]]]] = {}

# --- circles: terminal & junction truth (R1.1, 2026-07-04) --------------------
# The PDF drawings stream carries circle glyphs the segment dump drops: printed
# JUNCTION DOTS (~4pt — where the artwork says nets join) and TERMINAL CIRCLES
# (~10.7pt — connection points). Extracted straight from the PDF via fitz and
# cached as a sidecar (they derive from the PDF, not user truth — offline-safe).

_PDF_PATH = Path(__file__).resolve().parents[3] / (
    "atlas-dashboard/public/experimental-documents/dcm-01-schematic-diagram.pdf"
)
_CIRCLE_CACHE_DIR = Path(__file__).resolve().parents[3] / ".atlas/page-geometry"
_PAGE_W, _PAGE_H = 2481.0, 3509.0
# Class boundary in page-px: junction dots measured ~17px, terminals ~45px.
_JUNCTION_MAX_D_PX = 30.0
_circles_mem: dict[int, list[dict[str, float]]] = {}
_texts_cache: dict[int, list[dict[str, Any]]] = {}


async def page_texts(page: int) -> list[dict[str, Any]]:
    if page not in _texts_cache:
        await page_segments(page)
    return _texts_cache.get(page, [])


def _extract_circles(page_num: int) -> list[dict[str, Any]]:
    import fitz  # lazy: heavy import

    with fitz.open(_PDF_PATH) as doc:
        pg = doc[page_num - 1]
        sx = _PAGE_W / pg.rect.width
        sy = _PAGE_H / pg.rect.height
        out: list[dict[str, Any]] = []
        for d in pg.get_drawings():
            items = d.get("items") or []
            ops = [it[0] for it in items]
            if not ops or not all(op == "c" for op in ops) or not (3 <= len(ops) <= 8):
                continue
            r = d["rect"]
            # Slate 2.2: floor lowered 3.0 -> 2.0pt. TRUE junction dots are
            # 2.76pt and FAILED the old floor — page 10's extracted "junction"
            # class was 100% false positives (hollow rings/pins) and 0% real
            # dots, so the ~17px calibration was measured on the wrong shapes.
            if abs(r.width - r.height) > 1.5 or not (2.0 < r.width < 15.0):
                continue
            d_px = round(((r.width * sx) + (r.height * sy)) / 2, 1)
            # Fill state is the junction discriminator: printed net-join dots
            # are FILLED discs; pin circles, inline connection rings and the
            # earth-ground glyph are stroke-only (all six gold false flags).
            filled = d.get("type") in ("f", "fs") or d.get("fill") is not None
            out.append(
                {
                    "cx": round((r.x0 + r.width / 2) * sx, 1),
                    "cy": round((r.y0 + r.height / 2) * sy, 1),
                    "d": d_px,
                    "filled": bool(filled),
                    "class": "junction" if (filled and d_px <= _JUNCTION_MAX_D_PX)
                    else "terminal",
                }
            )
        return out


def page_circles(page: int) -> list[dict[str, Any]]:
    """Printed circles on a page, px space, classed junction|terminal.

    Memory -> sidecar file -> fitz extraction. [] on any failure (a page
    without the PDF available degrades to no-circle behavior, never an error).
    """
    if page in _circles_mem:
        return _circles_mem[page]
    # algo tag invalidates sidecars from the pre-fill-state extractor
    # (slate 2.2: old files lack `filled` and mis-class stroke rings as dots)
    _CIR_ALGO = "fill-v2"
    cache_file = _CIRCLE_CACHE_DIR / f"circles-page-{page:03d}.json"
    try:
        if cache_file.exists():
            payload = json.loads(cache_file.read_text())
            if isinstance(payload, dict) and payload.get("algo") == _CIR_ALGO:
                circles = payload["circles"]
                _circles_mem[page] = circles
                return circles
    except (OSError, ValueError):
        logger.warning("circle cache unreadable for page %s", page, exc_info=True)
    try:
        circles = _extract_circles(page)
    except Exception:
        logger.warning("circle extraction failed for page %s", page, exc_info=True)
        return []
    try:
        _CIRCLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"algo": _CIR_ALGO, "circles": circles}))
    except OSError:
        logger.warning("circle cache write failed for page %s", page, exc_info=True)
    _circles_mem[page] = circles
    return circles


def _bridge_dash_chains(
    segments: list[dict[str, float]],
    max_gap: float = 40.0,
    lateral_tol: float = 3.0,
    min_chain: int = 3,
) -> list[dict[str, float]]:
    """Synthesize continuous segments over dashed-border chains.

    Shane's airtight rule (2026-07-04): dash gaps count as enclosed — a dashed
    border is a line STYLE, not an opening — but genuine mouths into the page
    stay open. Border rhythm on this doc is MIXED long strokes + dashes
    (measured on INV40's border: 50-67px dashes, one 885px run, 33.3px gaps),
    so membership is ANY collinear segment; the dash signature is >=min_chain
    members whose successive gaps are <= max_gap. A coincidental pair of long
    collinear strokes (min_chain=3) is never bridged. Replaces the blanket k=4
    closing that false-filled regions with real openings. H/V only (borders on
    this doc are axis-aligned).
    """
    bridges: list[dict[str, float]] = []
    for axis in ("h", "v"):
        dashes: list[tuple[float, float, float]] = []  # (lateral, start, end)
        for s in segments:
            dx, dy = s["x2"] - s["x1"], s["y2"] - s["y1"]
            if axis == "h" and abs(dy) <= 1.5:
                dashes.append(((s["y1"] + s["y2"]) / 2, min(s["x1"], s["x2"]), max(s["x1"], s["x2"])))
            elif axis == "v" and abs(dx) <= 1.5:
                dashes.append(((s["x1"] + s["x2"]) / 2, min(s["y1"], s["y2"]), max(s["y1"], s["y2"])))
        dashes.sort()
        i = 0
        while i < len(dashes):
            # cluster dashes sharing a lateral line (within tolerance)
            j = i
            line = [dashes[i]]
            while j + 1 < len(dashes) and abs(dashes[j + 1][0] - line[-1][0]) <= lateral_tol:
                j += 1
                line.append(dashes[j])
            line.sort(key=lambda t: t[1])
            k0 = 0
            while k0 < len(line):
                k1 = k0
                while k1 + 1 < len(line) and line[k1 + 1][1] - line[k1][2] <= max_gap:
                    k1 += 1
                if k1 - k0 + 1 >= min_chain:
                    lat = sum(t[0] for t in line[k0:k1 + 1]) / (k1 - k0 + 1)
                    a, b = line[k0][1], line[k1][2]
                    if axis == "h":
                        bridges.append({"x1": a, "y1": lat, "x2": b, "y2": lat})
                    else:
                        bridges.append({"x1": lat, "y1": a, "x2": lat, "y2": b})
                k0 = k1 + 1
            i = j + 1
    return bridges


def _compute_enclosures(
    segments: list[dict[str, float]],
    circles: list[dict[str, Any]],
    min_side_px: float = 110.0,
) -> list[dict[str, Any]]:
    """Closed printed regions (module interiors, cells) via two-level flood fill.

    Walls = line segments + dash-chain bridges + printed circles as filled disks
    (circles are the border gaps — sealing them with their real geometry beats
    blanket dilation). Level 1 peels the page frame; level-2 pockets are the
    enclosures. Airtight criterion: a region tints only if 100% enclosed once
    dashes count as solid — real openings stay open (k=1 seals rasterization
    aliasing only).
    """
    import numpy as np
    from collections import deque
    from PIL import Image, ImageDraw

    scale = 4
    w, h = int(_PAGE_W // scale), int(_PAGE_H // scale)
    mask = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for s in segments + _bridge_dash_chains(segments):
        d.line(
            [(s["x1"] / scale, s["y1"] / scale), (s["x2"] / scale, s["y2"] / scale)],
            fill=1, width=2,
        )
    for c in circles:
        r = (c["d"] / 2 + 3) / scale
        d.ellipse(
            [c["cx"] / scale - r, c["cy"] / scale - r, c["cx"] / scale + r, c["cy"] / scale + r],
            fill=1,
        )
    walls = np.array(mask, dtype=bool)

    # Circles seal terminal-glyph gaps and dash bridges seal dashed borders —
    # both with their REAL geometry. k=1 only absorbs rasterization aliasing
    # (~4px page-space). The old blanket k=4 (~32px) false-filled regions with
    # genuine small openings — Shane's field report, 2026-07-04.
    k = 1
    dil = walls.copy()
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            if dy == 0 and dx == 0:
                continue
            sh = np.zeros_like(walls)
            ys0, ys1 = max(0, dy), h + min(0, dy)
            xs0, xs1 = max(0, dx), w + min(0, dx)
            sh[ys0:ys1, xs0:xs1] = walls[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
            dil |= sh
    walls = dil

    def flood(seeds: list[tuple[int, int]], blocked):
        seen = blocked.copy()
        dq = deque()
        for y, x in seeds:
            if 0 <= y < h and 0 <= x < w and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
        reach = np.zeros_like(blocked)
        while dq:
            y, x = dq.popleft()
            reach[y, x] = True
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                    seen[ny, nx] = True
                    dq.append((ny, nx))
        return reach

    def components(space, min_n: float):
        seen = ~space
        out = []
        for yy, xx in np.argwhere(space):
            if seen[yy, xx]:
                continue
            dq = deque([(yy, xx)])
            seen[yy, xx] = True
            n = 0
            x0 = x1 = xx
            y0 = y1 = yy
            seed = (int(yy), int(xx))
            while dq:
                y, x = dq.popleft()
                n += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if not seen[ny, nx]:
                        seen[ny, nx] = True
                        dq.append((ny, nx))
            if n >= min_n:
                out.append({"n": int(n), "bbox": (int(x0), int(y0), int(x1), int(y1)), "seed": seed})
        return out

    edges = [(y, x) for x in range(w) for y in (0, h - 1)] + [(y, x) for y in range(h) for x in (0, w - 1)]
    outside = flood(edges, walls)
    space1 = ~walls & ~outside
    min_n = (min_side_px / scale) ** 2
    l1 = components(space1, (200 / scale) ** 2)
    if not l1:
        return []
    l1.sort(key=lambda c: -c["n"])
    page_interior = l1[0]
    reach = flood([page_interior["seed"]], walls | outside)
    space2 = space1 & ~reach
    out = []
    for c in components(space2, min_n):
        x0, y0, x1, y1 = c["bbox"]
        # un-dilate: interiors shrank by k on every side
        x0, y0 = max(0, x0 - k), max(0, y0 - k)
        x1, y1 = min(w - 1, x1 + k), min(h - 1, y1 + k)
        bw, bh = (x1 - x0 + 1) * scale, (y1 - y0 + 1) * scale
        if min(bw, bh) < min_side_px:
            continue
        out.append(
            {
                "bbox": {"x": x0 * scale, "y": y0 * scale, "width": bw, "height": bh},
                "area_px": c["n"] * scale * scale,
                "fill": round(c["n"] / max(1, (x1 - x0 + 1) * (y1 - y0 + 1)), 2),
            }
        )
    out.sort(key=lambda e: -(e["bbox"]["width"] * e["bbox"]["height"]))
    return out


_enclosures_mem: dict[int, list[dict[str, Any]]] = {}


def page_enclosures(page: int) -> list[dict[str, Any]]:
    """Closed printed regions on a page (module interiors etc.). Cached. [] on failure."""
    if page in _enclosures_mem:
        return _enclosures_mem[page]
    # algo tag invalidates sidecars computed by older sealing strategies
    # (k=4 blanket closing produced different, sometimes false, regions).
    _ENC_ALGO = "dash-v2"
    cache_file = _CIRCLE_CACHE_DIR / f"enclosures-page-{page:03d}.json"
    try:
        if cache_file.exists():
            payload = json.loads(cache_file.read_text())
            if isinstance(payload, dict) and payload.get("algo") == _ENC_ALGO:
                enc = payload["enclosures"]
                _enclosures_mem[page] = enc
                return enc
    except (OSError, ValueError):
        logger.warning("enclosure cache unreadable p%s", page, exc_info=True)
    try:
        import asyncio  # noqa: F401  (sync context; heavy compute ~1s, callers thread it)

        segments = _cache.get(page, (None, []))[1]
        if not segments:
            return []  # segments load is async (Neon) — callers prime via page_segments first
        enc = _compute_enclosures(segments, page_circles(page))
    except Exception:
        logger.warning("enclosure compute failed p%s", page, exc_info=True)
        return []
    try:
        _CIRCLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps({"algo": _ENC_ALGO, "enclosures": enc}))
    except OSError:
        logger.warning("enclosure cache write failed p%s", page, exc_info=True)
    _enclosures_mem[page] = enc
    return enc


def enclosures_in_region(
    enclosures: list[dict[str, Any]],
    region: dict[str, Any],
    limit: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    """Enclosures intersecting the region, biggest first; (kept, dropped).
    Each gains 'extends_beyond_frame' when it continues past the region edge."""
    rx0 = float(region["x"])
    ry0 = float(region["y"])
    rx1 = rx0 + float(region["width"])
    ry1 = ry0 + float(region["height"])
    hits = []
    for e in enclosures:
        b = e["bbox"]
        if b["x"] + b["width"] < rx0 or b["x"] > rx1 or b["y"] + b["height"] < ry0 or b["y"] > ry1:
            continue
        beyond = b["x"] < rx0 or b["y"] < ry0 or b["x"] + b["width"] > rx1 or b["y"] + b["height"] > ry1
        hits.append({**e, **({"extends_beyond_frame": True} if beyond else {})})
    return hits[:limit], max(0, len(hits) - limit)


def circles_in_region(
    circles: list[dict[str, Any]],
    region: dict[str, Any],
    limit: int = 120,
) -> tuple[list[dict[str, Any]], int]:
    """Circles whose center falls in the region; junctions first; (kept, dropped)."""
    rx0 = float(region["x"])
    ry0 = float(region["y"])
    rx1 = rx0 + float(region["width"])
    ry1 = ry0 + float(region["height"])
    hits = [c for c in circles if rx0 <= c["cx"] <= rx1 and ry0 <= c["cy"] <= ry1]
    hits.sort(key=lambda c: (c["class"] != "junction", c["cy"], c["cx"]))
    return hits[:limit], max(0, len(hits) - limit)


async def page_segments(page: int) -> list[dict[str, float]]:
    """All vector line segments on a page, px space. Cached. [] on any failure."""
    cached = _cache.get(page)
    if cached is not None:
        return cached[1]
    try:
        from src.routes.extraction_workbench._core import (  # lazy: heavy import chain
            _DEFAULT_DOCUMENT_ID,
            _get_workbench_page_metadata,
            _resolve_project,
        )

        project = await _resolve_project()
        meta = await _get_workbench_page_metadata(project, _DEFAULT_DOCUMENT_ID, page)
    except Exception:
        logger.warning("page vector metadata unavailable for page %s", page, exc_info=True)
        return []
    scale = float(meta.get("scale") or 1.0)
    # stash the text layer too (same fetch): labels/pins with px centers
    texts = []
    for tb in meta.get("text_blocks") or []:
        b = tb.get("bbox") or []
        if len(b) == 4 and tb.get("text"):
            import unicodedata
            texts.append({
                "text": unicodedata.normalize("NFKC", str(tb["text"])).strip(),
                "cx": round((b[0] + b[2]) / 2 * scale, 1),
                "cy": round((b[1] + b[3]) / 2 * scale, 1),
                # Slate 3.2: run bbox in px — the border∩text integrity check
                # needs extents, not centers (run boxes carry their natural
                # ascender/descender padding; glyph boxes don't exist).
                "x0": round(b[0] * scale, 1), "y0": round(b[1] * scale, 1),
                "x1": round(b[2] * scale, 1), "y1": round(b[3] * scale, 1),
            })
    _texts_cache[page] = texts
    segments: list[dict[str, float]] = []
    for shape in meta.get("shapes") or []:
        bbox = shape.get("bbox") if isinstance(shape, dict) else None
        if not bbox or len(bbox) != 4:
            continue
        x1, y1, x2, y2 = (float(v) * scale for v in bbox)
        length = math.hypot(x2 - x1, y2 - y1)
        segments.append(
            {
                "x1": round(x1, 1),
                "y1": round(y1, 1),
                "x2": round(x2, 1),
                "y2": round(y2, 1),
                "length": round(length, 1),
            }
        )
    _cache[page] = (meta.get("source_hash"), segments)
    return segments


def segments_in_region(
    segments: list[dict[str, float]],
    region: dict[str, Any],
    limit: int = 150,
) -> tuple[list[dict[str, float]], int]:
    """Segments whose bbox intersects the region, longest first; (kept, dropped)."""
    rx0 = float(region["x"])
    ry0 = float(region["y"])
    rx1 = rx0 + float(region["width"])
    ry1 = ry0 + float(region["height"])
    hits = [
        s
        for s in segments
        if max(s["x1"], s["x2"]) >= rx0
        and min(s["x1"], s["x2"]) <= rx1
        and max(s["y1"], s["y2"]) >= ry0
        and min(s["y1"], s["y2"]) <= ry1
    ]
    hits.sort(key=lambda s: -s["length"])
    return hits[:limit], max(0, len(hits) - limit)
