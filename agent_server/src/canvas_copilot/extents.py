"""Slate 7.3 — extent candidates as EVIDENCE, never truth.

Port of the extent-engine prototype's PROVEN half only: dash-rect candidates
from paired dash/dot chains with perimeter-coverage scoring — the tier that
solved big module cells pixel-exact. The flood-fill pocket machinery stays in
the prototype: the live test showed it failing its own flagship cases (R40
resolved to CNV40's whole L-cell, ~35x too big; 10/24 UNRESOLVED), and its
match-or-authorization gate was killed on exactly that evidence. UNRESOLVED
is a VALID answer here; a candidate is something to LOOK at, never law.
"""

from __future__ import annotations

from typing import Any

from src.canvas_copilot import vectors as V

MIN_SIDE = 40.0
SIDE_NEAR = 9.0
COV_OK = 0.55
DASH_MIN = 0.20
# Calibrated on gold 2026-07-06: the largest REAL component box (INV40) is
# 4.9% of the page; the junk pairings (margin rails x cell walls) start at
# 15%. The proto's 0.45 let the junk through.
MAX_AREA_FRAC = 0.08


def _text_bboxes(page: int) -> list[dict[str, float]]:
    import fitz

    with fitz.open(V._PDF_PATH) as doc:
        pg = doc[page - 1]
        sx = V._PAGE_W / pg.rect.width
        sy = V._PAGE_H / pg.rect.height
        out = []
        for block in pg.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if (span.get("text") or "").strip():
                        x0, y0, x1, y1 = span["bbox"]
                        out.append({"x0": x0 * sx, "y0": y0 * sy, "x1": x1 * sx, "y1": y1 * sy})
        return out


def _pdf_dots(page: int) -> list[dict[str, float]]:
    """Sub-12px glyphs from the drawings stream: DOT-border dots (R40 class).
    Both the segment dump and the circle extractor drop them."""
    import fitz

    with fitz.open(V._PDF_PATH) as doc:
        pg = doc[page - 1]
        sx = V._PAGE_W / pg.rect.width
        sy = V._PAGE_H / pg.rect.height
        dots = []
        for d in pg.get_drawings():
            r = d["rect"]
            if r.width * sx <= 12 and r.height * sy <= 12:
                dots.append({"cx": (r.x0 + r.width / 2) * sx, "cy": (r.y0 + r.height / 2) * sy})
        return dots


def _dot_chains(dots: list[dict[str, float]], lat_tol: float = 4.0,
                gap_max: float = 26.0, min_dots: int = 4) -> list[dict[str, float]]:
    segs: list[dict[str, float]] = []
    for horizontal in (True, False):
        items = sorted((d["cy"], d["cx"]) if horizontal else (d["cx"], d["cy"]) for d in dots)
        i = 0
        while i < len(items):
            grp = [items[i]]
            j = i + 1
            while j < len(items) and abs(items[j][0] - grp[-1][0]) <= lat_tol:
                grp.append(items[j])
                j += 1
            xs = sorted(v for _, v in grp)
            lat = sum(v for v, _ in grp) / len(grp)
            run = [xs[0]]
            for v in xs[1:]:
                if v - run[-1] <= gap_max:
                    run.append(v)
                else:
                    if len(run) >= min_dots:
                        segs.append(_seg(lat, run[0], run[-1], horizontal))
                    run = [v]
            if len(run) >= min_dots:
                segs.append(_seg(lat, run[0], run[-1], horizontal))
            i = j
    return segs


def _seg(lat: float, a: float, b: float, horizontal: bool) -> dict[str, float]:
    return ({"x1": a, "y1": lat, "x2": b, "y2": lat} if horizontal
            else {"x1": lat, "y1": a, "x2": lat, "y2": b})


def _axis_intervals(segments, texts):
    bridges = V._bridge_dash_chains(segments)

    def collect(items, horizontal):
        out = []
        for s in items:
            if horizontal and abs(s["y1"] - s["y2"]) <= 0.6:
                out.append(((s["y1"] + s["y2"]) / 2, min(s["x1"], s["x2"]), max(s["x1"], s["x2"])))
            elif not horizontal and abs(s["x1"] - s["x2"]) <= 0.6:
                out.append(((s["x1"] + s["x2"]) / 2, min(s["y1"], s["y2"]), max(s["y1"], s["y2"])))
        return out

    def tcollect(horizontal):
        out = []
        for t in texts:
            if horizontal:
                out.append(((t["y0"] + t["y1"]) / 2, t["x0"], t["x1"], (t["y1"] - t["y0"]) / 2))
            else:
                out.append(((t["x0"] + t["x1"]) / 2, t["y0"], t["y1"], (t["x1"] - t["x0"]) / 2))
        return out

    return {"ink_h": collect(segments, True), "ink_v": collect(segments, False),
            "dash_h": collect(bridges, True), "dash_v": collect(bridges, False),
            "txt_h": tcollect(True), "txt_v": tcollect(False)}


def _side_cov(items, lat, a, b, lat_tol, is_text=False) -> float:
    ivs = []
    for it in items:
        if is_text:
            lt, s, e, half = it
            if abs(lt - lat) <= lat_tol + half:
                ivs.append((max(a, s), min(b, e)))
        else:
            lt, s, e = it
            if abs(lt - lat) <= lat_tol:
                ivs.append((max(a, s), min(b, e)))
    ivs = sorted(i for i in ivs if i[1] > i[0])
    cov, cur = 0.0, a
    for s, e in ivs:
        if e > cur:
            cov += e - max(cur, s)
            cur = e
    return cov / max(b - a, 1e-6)


def _merge_lat(items: list[tuple[float, float, float]],
               lat_tol: float = 2.0, gap: float = 14.0) -> list[tuple[float, float, float]]:
    """Merge co-lateral interval fragments into walls (lat clusters within
    lat_tol; spans bridged across gaps <= gap px)."""
    out: list[tuple[float, float, float]] = []
    for lat, a, b in sorted(items):
        for i, (ml, ma, mb) in enumerate(out):
            if abs(ml - lat) <= lat_tol and a <= mb + gap and b >= ma - gap:
                n = ( (ml + lat) / 2, min(ma, a), max(mb, b) )
                out[i] = n
                break
        else:
            out.append((lat, a, b))
    return out


def _score(lines, x0, y0, x1, y1) -> tuple[float, int]:
    sides = {
        "top": (_side_cov(lines["ink_h"], y0, x0, x1, SIDE_NEAR),
                _side_cov(lines["dash_h"], y0, x0, x1, SIDE_NEAR),
                _side_cov(lines["txt_h"], y0, x0, x1, SIDE_NEAR, True)),
        "bot": (_side_cov(lines["ink_h"], y1, x0, x1, SIDE_NEAR),
                _side_cov(lines["dash_h"], y1, x0, x1, SIDE_NEAR),
                _side_cov(lines["txt_h"], y1, x0, x1, SIDE_NEAR, True)),
        "lef": (_side_cov(lines["ink_v"], x0, y0, y1, SIDE_NEAR),
                _side_cov(lines["dash_v"], x0, y0, y1, SIDE_NEAR),
                _side_cov(lines["txt_v"], x0, y0, y1, SIDE_NEAR, True)),
        "rig": (_side_cov(lines["ink_v"], x1, y0, y1, SIDE_NEAR),
                _side_cov(lines["dash_v"], x1, y0, y1, SIDE_NEAR),
                _side_cov(lines["txt_v"], x1, y0, y1, SIDE_NEAR, True)),
    }
    total = {k: min(1.0, v[0] + v[2]) for k, v in sides.items()}
    dashy = sum(1 for v in sides.values() if v[1] >= DASH_MIN)
    return min(total.values()), dashy


# --- Wall-continuation truncation evidence (un-shelved 2026-07-06) -----------
# Shane's design: a printed run collinear with a drawn box edge is truncation
# evidence ONLY when it anchors an ENCLOSURE — perpendicular partners meeting
# it near BOTH ends, rising on the box-interior side, with the drawn edge
# sitting inside the wall's span ("the wall must create an enclosure that fits
# the base of the bbox being drawn"). A wire is a solitary run: collinear and
# long, but with no same-side corner pair — it can never fire. Walls arrive
# FRAGMENTED (terminals and other shapes bisect them; Shane 2026-07-06), so
# co-lateral fragments merge across generous gaps before any span judgment.
# Mint-time receipt note only: gates nothing, persists nothing.

WALL_LAT_TOL = 6.0      # drawn edge sits ON the printed wall within this
WALL_FRAG_GAP = 22.0    # fragment bridging: terminals/shapes bisect real walls
WALL_MIN_OVERLAP = 0.45  # wall must underlie the drawn edge substantially
WALL_EXT_MIN = 24.0     # continuation past the box end that counts as evidence
CORNER_TOL = 14.0       # perpendicular partner joins near the wall's far end
CORNER_MIN = 22.0       # partner must actually rise toward the box interior


def wall_continuation_findings(
    bbox: dict[str, Any],
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Truncation evidence for a drawn bbox against printed line work.

    Pure and synchronous — the caller supplies (cached) page segments.
    Returns one finding per box edge that sits on a printed wall which
    (a) substantially underlies the edge, (b) continues WALL_EXT_MIN+ px past
    the edge's end, and (c) anchors enclosure corners at both wall ends on
    the box-interior side. Asymmetric trust: absence of findings proves
    nothing (symbol-class parts have no printed rectangle)."""
    lines = _axis_intervals(segments, [])
    walls_h = _merge_lat(lines["ink_h"] + lines["dash_h"], lat_tol=2.5, gap=WALL_FRAG_GAP)
    walls_v = _merge_lat(lines["ink_v"] + lines["dash_v"], lat_tol=2.5, gap=WALL_FRAG_GAP)

    x0, y0 = float(bbox["x"]), float(bbox["y"])
    x1, y1 = x0 + float(bbox["width"]), y0 + float(bbox["height"])

    def _has_corner(perp_walls, at: float, wall_lat: float, interior_sign: float) -> bool:
        """A perpendicular merged run joining the wall near `at`, extending
        >= CORNER_MIN toward the box interior (interior_sign: +1 = increasing
        coordinate, -1 = decreasing)."""
        for lat, a, b in perp_walls:
            if abs(lat - at) > CORNER_TOL:
                continue
            if interior_sign > 0:
                # partner must start at/above the wall and extend inward
                if a <= wall_lat + CORNER_TOL and b >= wall_lat + CORNER_MIN:
                    return True
            else:
                if b >= wall_lat - CORNER_TOL and a <= wall_lat - CORNER_MIN:
                    return True
        return False

    edges = [
        # (name, wall pool, corner pool, edge lat, span, interior sign)
        ("top", walls_h, walls_v, y0, (x0, x1), +1.0),   # interior is below
        ("bottom", walls_h, walls_v, y1, (x0, x1), -1.0),  # interior is above
        ("left", walls_v, walls_h, x0, (y0, y1), +1.0),  # interior is rightward
        ("right", walls_v, walls_h, x1, (y0, y1), -1.0),  # interior is leftward
    ]
    findings: list[dict[str, Any]] = []
    for name, pool, perp_pool, lat, (ea, eb), sign in edges:
        edge_len = max(eb - ea, 1e-6)
        for wlat, wa, wb in pool:
            if abs(wlat - lat) > WALL_LAT_TOL:
                continue
            overlap = max(0.0, min(eb, wb) - max(ea, wa))
            if overlap / edge_len < WALL_MIN_OVERLAP:
                continue
            ext_lo, ext_hi = max(0.0, ea - wa), max(0.0, wb - eb)
            if ext_lo + ext_hi < WALL_EXT_MIN:
                continue
            # "fits the base": the drawn edge must sit INSIDE the wall's span
            if ea < wa - CORNER_TOL or eb > wb + CORNER_TOL:
                continue
            # Shane's enclosure discriminator: corners at BOTH wall ends,
            # both rising toward the box interior. Wires have no such pair.
            if not (_has_corner(perp_pool, wa, wlat, sign)
                    and _has_corner(perp_pool, wb, wlat, sign)):
                continue
            findings.append({
                "edge": name,
                "wall_span": (round(wa, 1), round(wb, 1)),
                "extends_px": (round(ext_lo, 1), round(ext_hi, 1)),
                "wall_over_edge": round((wb - wa) / edge_len, 2),
            })
            break  # one finding per edge is enough for a receipt note
    return findings


def refine_bbox_to_walls(
    bbox: dict[str, Any],
    segments: list[dict[str, Any]],
    snap_tol: float = 12.0,
) -> tuple[dict[str, float], dict[str, float]]:
    """Seeded-boxing refinement (Shane's speed directive, 2026-07-06): a
    strong detection is a near-right size/shape prior; the PRINT decides the
    edges. Snap each bbox edge to the nearest merged printed wall within
    snap_tol that substantially underlies it; edges with no wall in reach
    keep the prior. Returns (refined_bbox, per-side wall coverage 0..1) —
    coverage is the verify-by-exception signal: VECTOR agreement, not
    detector confidence, is what excuses skipping the capture-judge loop."""
    lines = _axis_intervals(segments, [])
    walls_h = _merge_lat(lines["ink_h"] + lines["dash_h"], lat_tol=2.5, gap=WALL_FRAG_GAP)
    walls_v = _merge_lat(lines["ink_v"] + lines["dash_v"], lat_tol=2.5, gap=WALL_FRAG_GAP)
    x0, y0 = float(bbox["x"]), float(bbox["y"])
    x1, y1 = x0 + float(bbox["width"]), y0 + float(bbox["height"])

    def _snap(pool: list[tuple[float, float, float]], lat: float,
              a: float, b: float) -> float:
        best: float | None = None
        for wl, wa, wb in pool:
            if abs(wl - lat) > snap_tol:
                continue
            if min(b, wb) - max(a, wa) < 0.3 * max(b - a, 1e-6):
                continue  # wall must substantially underlie the edge
            if best is None or abs(wl - lat) < abs(best - lat):
                best = wl
        return lat if best is None else best

    ry0 = _snap(walls_h, y0, x0, x1)
    ry1 = _snap(walls_h, y1, x0, x1)
    rx0 = _snap(walls_v, x0, ry0, ry1)
    rx1 = _snap(walls_v, x1, ry0, ry1)
    if rx1 - rx0 < 8.0 or ry1 - ry0 < 8.0:  # degenerate snap: keep the prior
        rx0, ry0, rx1, ry1 = x0, y0, x1, y1

    def _cov(pool_ink, pool_dash, lat: float, a: float, b: float) -> float:
        return round(min(1.0, _side_cov(pool_ink, lat, a, b, SIDE_NEAR)
                         + _side_cov(pool_dash, lat, a, b, SIDE_NEAR)), 2)

    coverage = {
        "top": _cov(lines["ink_h"], lines["dash_h"], ry0, rx0, rx1),
        "bottom": _cov(lines["ink_h"], lines["dash_h"], ry1, rx0, rx1),
        "left": _cov(lines["ink_v"], lines["dash_v"], rx0, ry0, ry1),
        "right": _cov(lines["ink_v"], lines["dash_v"], rx1, ry0, ry1),
    }
    refined = {"x": round(rx0, 1), "y": round(ry0, 1),
               "width": round(rx1 - rx0, 1), "height": round(ry1 - ry0, 1)}
    return refined, coverage


async def derive_extent(page: int, ax: float, ay: float,
                        label: str | None = None) -> dict[str, Any]:
    """Dash-tier extent candidates around an anchor point. Advisory only."""
    segments = list(await V.page_segments(page))
    segments += _dot_chains(_pdf_dots(page))
    texts = _text_bboxes(page)
    lines = _axis_intervals(segments, texts)
    page_area = V._PAGE_W * V._PAGE_H

    # Verticals: dashed/dotted chains are the CLASS SIGNAL (at least one side
    # must be dash-tier), but the partner wall may be SOLID ink — CNV40's
    # dashed left border pairs with the module cell's solid right wall. Ink
    # walls arrive FRAGMENTED (terminals bisect them): merge per-lat runs
    # before the span filter, or every real wall fails MIN_SIDE.
    vlines = ([("dash", x, a, b) for x, a, b in _merge_lat(lines["dash_v"])]
              + [("ink", x, a, b) for x, a, b in _merge_lat(lines["ink_v"])
                 if b - a >= MIN_SIDE])
    raw: list[tuple[float, float, float, float]] = []
    for i, (ka, xa, a0, a1) in enumerate(vlines):
        for kb, xb, b0, b1 in vlines[i + 1:]:
            if ka != "dash" and kb != "dash":
                continue  # the dash tier needs at least one dashed side
            x0, x1 = min(xa, xb), max(xa, xb)
            if x1 - x0 < MIN_SIDE:
                continue
            t, b = max(a0, b0), min(a1, b1)
            t2, b2 = min(a0, b0), max(a1, b1)
            if not (x0 - 20 <= ax <= x1 + 20):
                continue
            for top, bot in ((t, b), (t2, b2)):
                if bot - top < MIN_SIDE or not (top - 20 <= ay <= bot + 20):
                    continue
                htop = min(1.0, _side_cov(lines["ink_h"], top, x0, x1, 12)
                           + _side_cov(lines["dash_h"], top, x0, x1, 12)
                           + _side_cov(lines["txt_h"], top, x0, x1, 12, True))
                hbot = min(1.0, _side_cov(lines["ink_h"], bot, x0, x1, 12)
                           + _side_cov(lines["dash_h"], bot, x0, x1, 12)
                           + _side_cov(lines["txt_h"], bot, x0, x1, 12, True))
                if htop >= 0.5 and hbot >= 0.5:
                    raw.append((round(x0, 1), round(top, 1), round(x1, 1), round(bot, 1)))

    scored = []
    for x0, y0, x1, y1 in dict.fromkeys(raw):
        w, h = x1 - x0, y1 - y0
        if min(w, h) < MIN_SIDE or w * h > MAX_AREA_FRAC * page_area:
            continue
        cov, dashy = _score(lines, x0, y0, x1, y1)
        if cov >= COV_OK and dashy >= 1:
            scored.append({"bbox": {"x": round(x0, 1), "y": round(y0, 1),
                                    "width": round(w, 1), "height": round(h, 1)},
                           "coverage": round(cov, 2), "dash_sides": dashy,
                           "tier": "dash"})
    scored.sort(key=lambda c: c["bbox"]["width"] * c["bbox"]["height"])

    # Detector tier (YOLO-speed thread, Shane 2026-07-06): strong detections
    # containing the anchor ride along as EVIDENCE candidates — the only
    # mechanical extent witness for cells that never close in the vector
    # layer (M40's cell has no bottom wall; the dash tier is blind there).
    # Doctrine holds: detection boxes are symbol-tight by training
    # convention — verify against the printed cell, never copy blindly.
    det_cands: list[dict[str, Any]] = []
    try:
        from src.canvas_copilot import yolo as _yolo_det

        for d in _yolo_det.page_detections(page):
            if d.get("tier") != "strong" or str(d.get("class_name")) in ("CONTINUATION", "CAB"):
                continue
            b = d.get("bbox") or {}
            if not b:
                continue
            if (float(b["x"]) - 20 <= ax <= float(b["x"]) + float(b["width"]) + 20
                    and float(b["y"]) - 20 <= ay <= float(b["y"]) + float(b["height"]) + 20):
                det_cands.append({
                    "bbox": {k: round(float(b[k]), 1) for k in ("x", "y", "width", "height")},
                    "tier": "detector",
                    "class_name": str(d.get("class_name")),
                    "confidence": round(float(d.get("confidence") or 0.0), 2),
                })
        det_cands.sort(key=lambda c: -c["confidence"])
    except Exception:
        pass  # sidecar unavailable: the dash tier stands alone

    candidates = scored[:3] + det_cands[:2]
    return {
        "resolved": bool(candidates),
        "candidates": candidates,
        "note": (("EVIDENCE, never truth: dash-tier candidates are printed "
                  "dashed/dotted enclosures near your anchor; detector-tier "
                  "candidates are symbol-tight by training convention (the true "
                  "extent is the printed cell — but for cells that never close, "
                  "the detection is the only mechanical witness). LOOK before "
                  "using either; borderless component classes legitimately have "
                  "no dash candidate.") if candidates else
                 ("UNRESOLVED — no paired dash-chain rectangle and no strong "
                  "detection at this anchor. That is a VALID answer: symbol-class "
                  "components (breakers, contactors, overloads) have no printed "
                  "rectangle; derive from the artwork close-up instead.")),
    }
