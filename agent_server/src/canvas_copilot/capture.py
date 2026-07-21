"""Scene packets: the copilot's eyes on the smart canvas.

A capture is no longer just pixels — it is a *scene packet*: a rendered view of
the page plus a manifest of everything in that view, in both coordinate systems
(page-space and image-pixels), plus the PDF text layer. Designed 2026-07-02 with
Shane (see vault: Canvas Copilot) around three mutually redundant grounding
layers:

- GRID     -> "where is what I see" (labeled page-space gridlines; works on raw artwork)
- MANIFEST -> "what officially exists" (graph elements w/ ids + dual coords)
- TEXT     -> "what the drawing says" (PDF text blocks w/ coords; no OCR guessing)

Every painted layer is toggleable per call (the model composes its own view);
the manifest always ships — pixels are a view, metadata is the truth.

Rendered server-side (Pillow) from the same page PNG the workbench serves.
Page-space is 2481x3509; the packet's `_px` coords are pixels in the returned
image (margins included), so what the model sees maps 1:1 to what it reads.
"""

from __future__ import annotations

import base64
import io
import math
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageColor, ImageDraw, ImageFont

from src.canvas_copilot import bridge

PAGE_W = 2481.0
PAGE_H = 3509.0

_BOX_COLOR = "#f59e0b"  # amber — the copilot's graph overlay
# Magenta for drawn wires + junction dots: the one hue that never appears in
# schematic artwork (black), boxes (amber), ask marks (cyan), or grid (slate) —
# unmissable at any zoom (Shane, 2026-07-03: pale green washed out on white).
_WIRE_COLOR = "#d946ef"
_ASK_COLOR = "#22d3ee"  # cyan — Shane's numbered ask-marks
_FLAG_COLOR = "#e11d48"  # crimson — numbered audit flags (Shane's idea, 2026-07-06)
# Saturated emerald for YOLO evidence boxes: must be unmistakably NOT the
# amber graph overlay — a screenshot may never pass detector proposals off as
# committed work (anti-laundering styling is a design requirement).
_YOLO_COLOR = "#059669"
_GRID_COLOR = (100, 116, 139, 80)  # slate, ~30% alpha
_MARGIN_BG = (241, 245, 249)
_GRID_PITCH_LADDER = [25, 50, 100, 250, 500, 1000]
_GRID_TARGET_LINES = 8
_MARGIN_TOP = 26
_MARGIN_LEFT = 56

_OUT_DIR = Path(tempfile.gettempdir()) / "canvas_copilot_captures"

# PDF text layer, fetched once per (document, page) from the local workbench API.
_TEXT_CACHE: dict[tuple[str, int], list[dict[str, Any]] | None] = {}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _fetch_text_blocks(document_id: str, page: int) -> list[dict[str, Any]] | None:
    """Text blocks in page-px: {text, x, y (center), bbox}. None if unavailable."""
    key = (document_id, page)
    if key in _TEXT_CACHE:
        return _TEXT_CACHE[key]
    try:
        resp = httpx.get(
            f"http://127.0.0.1:8123/workbench/documents/{document_id}/pages/{page}/metadata",
            timeout=8.0,
        )
        resp.raise_for_status()
        meta = resp.json()
        s = float(meta.get("scale") or 1)
        blocks = []
        for t in meta.get("text_blocks") or []:
            b = t.get("bbox") or [0, 0, 0, 0]
            x0, y0, x1, y1 = (float(v) * s for v in b)
            blocks.append(
                {
                    # NFKC: full-width CJK digits/letters -> ASCII (R101, not R１０１),
                    # matching the frontend's normalization in buildPageGeometry.
                    "text": unicodedata.normalize("NFKC", str(t.get("text", ""))).strip(),
                    "x": round((x0 + x1) / 2),
                    "y": round((y0 + y1) / 2),
                    "bbox": [round(x0), round(y0), round(x1), round(y1)],
                }
            )
        _TEXT_CACHE[key] = blocks
    except Exception:
        _TEXT_CACHE[key] = None
    return _TEXT_CACHE[key]


def _pick_grid_pitch(frame_page_max: float) -> int:
    for pitch in _GRID_PITCH_LADDER:
        if frame_page_max / pitch <= _GRID_TARGET_LINES + 4:
            return pitch
    return _GRID_PITCH_LADDER[-1]


_MARK_HALO_PX = 45.0  # ring + numbered badge extent around a mark point


def _dashed_line(draw: Any, a: tuple[float, float], b: tuple[float, float],
                 color: Any, width: int, dash: float = 10.0, gap: float = 6.0) -> None:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length == 0:
        return
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    t = 0.0
    while t < length:
        e = min(t + dash, length)
        draw.line([(a[0] + ux * t, a[1] + uy * t), (a[0] + ux * e, a[1] + uy * e)],
                  fill=color, width=width)
        t = e + gap


def _dashed_rect(draw: Any, p0: tuple[int, int], p1: tuple[int, int],
                 color: Any, width: int = 2) -> None:
    (x0, y0), (x1, y1) = p0, p1
    for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)),
                 ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        _dashed_line(draw, a, b, color, width)


def _resolve_region(
    nodes: list[dict[str, Any]],
    region: dict[str, Any] | None,
    component_id: str | None,
    pad: float,
    ask_marks: list[dict[str, Any]] | None = None,
    frame_ask_marks: bool = False,
) -> dict[str, float]:
    if frame_ask_marks and ask_marks:
        xs0 = [float(m["x"]) - _MARK_HALO_PX for m in ask_marks]
        ys0 = [float(m["y"]) - _MARK_HALO_PX for m in ask_marks]
        xs1 = [float(m["x"]) + _MARK_HALO_PX for m in ask_marks]
        ys1 = [float(m["y"]) + _MARK_HALO_PX for m in ask_marks]
        x0, y0 = min(xs0) - pad, min(ys0) - pad
        w, h = max(xs1) + pad - x0, max(ys1) + pad - y0
        # Near-colinear or single marks must not produce a sliver/postage stamp:
        # grow to a readable minimum window centered on the marks, so the frame
        # always carries the surrounding rungs/columns for context.
        min_w, min_h = 360.0, 260.0
        if w < min_w:
            x0 -= (min_w - w) / 2
            w = min_w
        if h < min_h:
            y0 -= (min_h - h) / 2
            h = min_h
        return {"x": x0, "y": y0, "width": w, "height": h}
    if region:
        return {k: float(region[k]) for k in ("x", "y", "width", "height")}
    if component_id:
        # Slate 6.6: the tool layer resolves labels/ids BEFORE render (see
        # resolve_component_ref) — an unresolved reference is a typed error
        # there, never the silent ~257KB full-page fallback that defeated
        # four legitimate close-up requests (ELB41/MC347/MC34A/node-a1).
        node = next((n for n in nodes if n.get("id") == component_id), None)
        if node:
            b = node["bbox"]
            return {
                "x": b["x"] - pad,
                "y": b["y"] - pad,
                "width": b["width"] + 2 * pad,
                "height": b["height"] + 2 * pad,
            }
    return {"x": 0.0, "y": 0.0, "width": PAGE_W, "height": PAGE_H}


def resolve_component_ref(
    nodes: list[dict[str, Any]], ref: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Slate 6.6: resolve a capture's component reference by node id OR
    printed label. Returns (node, None) on success, (None, typed_error) on
    failure — unknown refs get top-3 closest labels, duplicate labels get
    the candidate list (never a guess, never a full-page fallback)."""
    ref_s = str(ref).strip()
    node = next((n for n in nodes if n.get("id") == ref_s), None)
    if node:
        return node, None
    matches = [n for n in nodes if str(n.get("label") or "").strip().upper() == ref_s.upper()]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        cands = "; ".join(
            f"{n['id']} ({n.get('label')} at "
            f"{int((n.get('bbox') or {}).get('x', 0))},{int((n.get('bbox') or {}).get('y', 0))})"
            for n in matches[:5]
        )
        return None, (f"ambiguous component '{ref}': {len(matches)} nodes share that label — "
                      f"pass the node id instead. Candidates: {cands}")
    import difflib

    labels = sorted({str(n.get("label") or "") for n in nodes if n.get("label")})
    close_upper = set(difflib.get_close_matches(
        ref_s.upper(), [lb.upper() for lb in labels], n=3, cutoff=0.5))
    sugg = [lb for lb in labels if lb.upper() in close_upper][:3]
    return None, (f"unknown component '{ref}': no node id or label matches"
                  + (f" — closest labels: {', '.join(sugg)}" if sugg else "")
                  + ". Use get_state (or the detector roster); a full-page capture is "
                  "NEVER substituted silently.")


def render_capture(
    region: dict[str, Any] | None = None,
    component_id: str | None = None,
    pad: float = 70.0,
    max_px: int = 1200,
    frame_ask_marks: bool = False,
    show_grid_overlay: bool = True,
    show_graph_overlay: bool = True,
    show_ask_marks: bool = True,
    include_text_layer: bool = True,
    encode_b64: bool = False,
    enclosures: list[dict[str, Any]] | None = None,
    show_yolo: bool = False,
    yolo_min_conf: float = 0.0,
    flags: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Render a scene packet. Returns pixels (path and/or b64) + the manifest."""
    from src.routes.extraction_workbench._core import (  # lazy: heavy import chain
        _DEFAULT_DOCUMENT_ID,
        _workbench_page_image_path,
    )

    state = bridge.get_state()
    snap = state["snapshot"] or {}
    page = int(snap.get("page") or 1)
    nodes: list[dict[str, Any]] = snap.get("nodes") or []
    ports: list[dict[str, Any]] = snap.get("ports") or []
    ask_marks: list[dict[str, Any]] = snap.get("ask_marks") or []

    img = Image.open(_workbench_page_image_path(_DEFAULT_DOCUMENT_ID, page)).convert("RGB")
    sx, sy = img.width / PAGE_W, img.height / PAGE_H

    reg = _resolve_region(nodes, region, component_id, pad, ask_marks, frame_ask_marks)
    rx = _clamp(reg["x"], 0, PAGE_W)
    ry = _clamp(reg["y"], 0, PAGE_H)
    rw = _clamp(reg["width"], 1, PAGE_W - rx)
    rh = _clamp(reg["height"], 1, PAGE_H - ry)

    crop = img.crop((round(rx * sx), round(ry * sy), round((rx + rw) * sx), round((ry + rh) * sy)))
    if crop.width > max_px or crop.height > max_px:
        scale = max_px / max(crop.width, crop.height)
        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))))
    elif max(crop.width, crop.height) < 480:
        # Tiny crops (tight mark clusters, surgical close-ups) upscale to stay
        # readable — a 100px native sliver is invisible to the model.
        scale = min(3.0, 480 / max(crop.width, crop.height))
        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))))

    # page-space -> final-image pixels (before margins)
    fx = crop.width / rw
    fy = crop.height / rh

    ml = _MARGIN_LEFT if show_grid_overlay else 0
    mt = _MARGIN_TOP if show_grid_overlay else 0

    def to_px(x: float, y: float) -> tuple[int, int]:
        return (round((x - rx) * fx) + ml, round((y - ry) * fy) + mt)

    canvas = Image.new("RGB", (crop.width + ml, crop.height + mt), _MARGIN_BG)
    canvas.paste(crop, (ml, mt))
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Enclosure tint (opt-in): closed printed regions filled pale so a module's
    # extent visibly bleeds past the frame edge — "this thing continues".
    if enclosures:
        tints = [(59, 130, 246, 42), (16, 185, 129, 42), (245, 158, 11, 42), (139, 92, 246, 42)]
        for k, enc in enumerate(enclosures):
            b = enc.get("bbox") or {}
            ex0, ey0 = float(b.get("x", 0)), float(b.get("y", 0))
            ex1, ey1 = ex0 + float(b.get("width", 0)), ey0 + float(b.get("height", 0))
            # clamp to the frame, then map to pixels
            cx0, cy0 = max(ex0, rx), max(ey0, ry)
            cx1, cy1 = min(ex1, rx + rw), min(ey1, ry + rh)
            if cx1 <= cx0 or cy1 <= cy0:
                continue
            p0, p1 = to_px(cx0, cy0), to_px(cx1, cy1)
            draw.rectangle([p0, p1], fill=tints[k % 4])
            _dashed_rect(draw, p0, p1, (185, 28, 28, 190), width=2)
    try:
        font = ImageFont.load_default(size=13)
        font_small = ImageFont.load_default(size=11)
    except TypeError:  # older Pillow
        font = font_small = ImageFont.load_default()

    # --- grid (absolute page-space lines, labels in the margins) ---------------
    grid_info: dict[str, Any] | None = None
    if show_grid_overlay:
        pitch = _pick_grid_pitch(max(rw, rh))
        gx = (int(rx) // pitch + 1) * pitch
        while gx < rx + rw:
            px, _ = to_px(gx, ry)
            draw.line([(px, mt), (px, canvas.height)], fill=_GRID_COLOR, width=1)
            draw.text((px, mt // 2), str(gx), fill=(51, 65, 85), font=font_small, anchor="mm")
            gx += pitch
        gy = (int(ry) // pitch + 1) * pitch
        while gy < ry + rh:
            _, py = to_px(rx, gy)
            draw.line([(ml, py), (canvas.width, py)], fill=_GRID_COLOR, width=1)
            draw.text((ml // 2, py), str(gy), fill=(51, 65, 85), font=font_small, anchor="mm")
            gy += pitch
        grid_info = {"pitch": pitch, "labels_are_page_coords": True}

    def in_frame(x: float, y: float, slack: float = 0.0) -> bool:
        return rx - slack <= x <= rx + rw + slack and ry - slack <= y <= ry + rh + slack

    # --- manifest: wires -----------------------------------------------------------
    # Wires draw as their TRUE multi-point paths — the same polyline Shane's
    # screen renders. This is what the copilot judges wire geometry from, so it
    # must never be a reconstruction. Older snapshots without `path` fall back
    # to a straight port-to-port line (better visible-wrong than invisible).
    edges: list[dict[str, Any]] = snap.get("edges") or []
    port_by_id = {p.get("id"): p for p in ports}
    man_wires: list[dict[str, Any]] = []
    for e in edges:
        path = [
            (float(pt.get("x", 0)), float(pt.get("y", 0)))
            for pt in (e.get("path") or [])
            if isinstance(pt, dict)
        ]
        approx = False
        if len(path) < 2:
            ends = []
            for pid in (e.get("sourcePortId"), e.get("targetPortId")):
                pp = (port_by_id.get(pid) or {}).get("point") or {}
                if pp:
                    ends.append((float(pp.get("x", 0)), float(pp.get("y", 0))))
            if len(ends) == 2:
                path, approx = ends, True
            else:
                continue
        if not any(in_frame(x, y, slack=6) for x, y in path):
            continue
        px_path = [to_px(x, y) for x, y in path]
        man_wires.append(
            {"id": e.get("id"), "label": e.get("label"),
             "path": [{"x": round(x), "y": round(y)} for x, y in path],
             "path_px": [[p[0], p[1]] for p in px_path],
             **({"path_approximated": True} if approx else {})}
        )
        if show_graph_overlay:
            # Width scales with zoom: printed artwork lines fatten as the crop
            # zooms in, so a fixed-width overlay reads as a hair at close range.
            wire_w = max(3, min(12, round(3 * fx)))
            draw.line(px_path, fill=ImageColor.getrgb(_WIRE_COLOR), width=wire_w, joint="curve")
            if e.get("label"):
                mid = px_path[len(px_path) // 2]
                draw.text((mid[0] + 5, mid[1] - 13), str(e["label"]),
                          fill=ImageColor.getrgb(_WIRE_COLOR), font=font_small)

    # --- manifest: components ---------------------------------------------------
    man_components: list[dict[str, Any]] = []
    for n in nodes:
        b = n.get("bbox") or {}
        bx, by = float(b.get("x", 0)), float(b.get("y", 0))
        bw, bh = float(b.get("width", 0)), float(b.get("height", 0))
        if bx + bw < rx or bx > rx + rw or by + bh < ry or by > ry + rh:
            continue
        clipped = not (bx >= rx and by >= ry and bx + bw <= rx + rw and by + bh <= ry + rh)
        p0, p1 = to_px(bx, by), to_px(bx + bw, by + bh)
        man_components.append(
            {"id": n.get("id"), "label": n.get("label"), "bbox": b,
             "bbox_px": [p0[0], p0[1], p1[0], p1[1]], **({"clipped": True} if clipped else {})}
        )
        if show_graph_overlay:
            # DASHED box edges: solid amber edges read as conductors at close
            # zoom (a bottom edge cost a full audit round) — dashes cannot.
            _dashed_rect(draw, p0, p1, ImageColor.getrgb(_BOX_COLOR), width=2)
            draw.text((p0[0] + 3, max(mt, p0[1] - 15)), str(n.get("label") or "?"),
                      fill=ImageColor.getrgb(_BOX_COLOR), font=font)

    # --- manifest: terminals ------------------------------------------------------
    man_terminals: list[dict[str, Any]] = []
    for p in ports:
        pt = p.get("point") or {}
        x, y = float(pt.get("x", -1)), float(pt.get("y", -1))
        if not in_frame(x, y, slack=6):
            continue
        px = to_px(x, y)
        man_terminals.append(
            {"id": p.get("id"), "label": p.get("label"), "parent_id": p.get("parentId"),
             **({"parent_id2": p.get("parentId2")} if p.get("parentId2") else {}),
             "type": p.get("type"), "point": {"x": round(x), "y": round(y)}, "point_px": [px[0], px[1]]}
        )
        if show_graph_overlay:
            if p.get("type") == "junction":
                # Filled dot, like the ● tap it models — visually distinct from
                # terminal rings so mis-typed ports jump out in review images.
                jr = max(5, min(14, round(5 * fx)))
                draw.ellipse([px[0] - jr, px[1] - jr, px[0] + jr, px[1] + jr],
                             fill=ImageColor.getrgb(_WIRE_COLOR))
            elif p.get("type") == "mate":
                # Mate terminal (Shane 2026-07-09): MAGENTA diamond straddling
                # the shared flush face — the copilot's own drawn conduction
                # point, unmistakable against amber terminal rings.
                mr = max(6, min(16, round(6 * fx)))
                draw.polygon([(px[0], px[1] - mr), (px[0] + mr, px[1]),
                              (px[0], px[1] + mr), (px[0] - mr, px[1])],
                             fill=ImageColor.getrgb(_WIRE_COLOR), outline=(255, 255, 255))
            else:
                r = max(7, min(16, round(7 * min(fx, 2.0))))
                draw.ellipse([px[0] - r, px[1] - r, px[0] + r, px[1] + r],
                             outline=ImageColor.getrgb(_BOX_COLOR), width=max(2, min(5, round(2 * fx))))

    # --- manifest: grounds (first-class earth references) --------------------------
    # Drawn MAGENTA like wires (Shane 2026-07-08): the ground box is the
    # copilot's OWN annotation, so it wears the unmissable overlay hue — a solid
    # ring hugging the glyph's circle — never the amber component style.
    man_grounds: list[dict[str, Any]] = []
    for g in snap.get("grounds") or []:
        b = g.get("bbox") or {}
        bx, by = float(b.get("x", 0)), float(b.get("y", 0))
        bw, bh = float(b.get("width", 0)), float(b.get("height", 0))
        if bx + bw < rx or bx > rx + rw or by + bh < ry or by > ry + rh:
            continue
        clipped = not (bx >= rx and by >= ry and bx + bw <= rx + rw and by + bh <= ry + rh)
        p0, p1 = to_px(bx, by), to_px(bx + bw, by + bh)
        man_grounds.append(
            {"id": g.get("id"), "label": g.get("label"), "bbox": b,
             "bbox_px": [p0[0], p0[1], p1[0], p1[1]], **({"clipped": True} if clipped else {})}
        )
        if show_graph_overlay:
            gw = max(3, min(10, round(3 * fx)))
            draw.rectangle([p0[0], p0[1], p1[0], p1[1]],
                           outline=ImageColor.getrgb(_WIRE_COLOR), width=gw)
            draw.text((p0[0] + 3, max(mt, p0[1] - 15)), str(g.get("label") or "GND"),
                      fill=ImageColor.getrgb(_WIRE_COLOR), font=font)

    # --- manifest: ask marks --------------------------------------------------------
    man_marks: list[dict[str, Any]] = []
    for m in ask_marks:
        x, y = float(m.get("x", -1)), float(m.get("y", -1))
        if not in_frame(x, y, slack=40):
            continue
        px = to_px(x, y)
        man_marks.append(
            {"n": m.get("n"), "x": round(x), "y": round(y),
             "point_px": [px[0], px[1]], "target": m.get("target")}
        )
        if show_ask_marks:
            r = 16
            draw.ellipse([px[0] - r, px[1] - r, px[0] + r, px[1] + r],
                         outline=ImageColor.getrgb(_ASK_COLOR), width=4)
            br = 11
            bx_, by_ = px[0] + 18, px[1] - 18
            draw.ellipse([bx_ - br, by_ - br, bx_ + br, by_ + br], fill=ImageColor.getrgb(_ASK_COLOR))
            draw.text((bx_, by_), str(m.get("n", "?")), fill=(15, 23, 42), font=font, anchor="mm")

    # --- manifest: numbered audit flags (Shane's idea, 2026-07-06) -----------------
    # Each flag = one violation from the LAST COMPLETED AUDIT, numbered to
    # match the legend the caller supplies — the agent SEES problem N standing
    # on the element instead of reconstructing id→location→cause across
    # repeated audit calls (page-11 spent 44/86 turns doing exactly that).
    man_flags: list[dict[str, Any]] | None = None
    if flags:
        man_flags = []
        drawn_flags = 0
        for fl in flags:
            pts_in = [(float(p["x"]), float(p["y"])) for p in fl.get("points") or []
                      if in_frame(float(p.get("x", -1)), float(p.get("y", -1)), slack=20)]
            man_flags.append({"n": fl.get("n"), "rule": fl.get("rule"),
                              "severity": fl.get("severity"),
                              "detail": fl.get("detail"),
                              "points": [{"x": round(x), "y": round(y)} for x, y in pts_in]})
            if drawn_flags >= 12:
                continue  # legend carries the rest — pixels stay readable
            for x, y in pts_in[:2]:
                px = to_px(x, y)
                color = ImageColor.getrgb(_FLAG_COLOR)
                # flag glyph: pole + pennant + number
                draw.line([px[0], px[1], px[0], px[1] - 26], fill=color, width=3)
                draw.polygon([(px[0], px[1] - 26), (px[0] + 22, px[1] - 19),
                              (px[0], px[1] - 12)], fill=color)
                draw.text((px[0] + 9, px[1] - 19), str(fl.get("n", "?")),
                          fill=(255, 255, 255), font=font_small, anchor="mm")
                drawn_flags += 1

    # --- manifest: YOLO evidence layer (opt-in) -----------------------------------
    # Projects the PRECOMPUTED page-scan detections into this viewport at any
    # zoom — never fresh inference. Short-dash emerald + confidence text so
    # evidence can never be mistaken for the (amber, long-dash) graph overlay.
    man_yolo: list[dict[str, Any]] | None = None
    if show_yolo:
        from src.canvas_copilot import yolo as yolo_sidecar

        man_yolo = []
        for det in yolo_sidecar.page_detections(page):
            conf = float(det["confidence"])
            if conf < yolo_min_conf:
                continue
            b = det["bbox"]
            bx, by = float(b["x"]), float(b["y"])
            bw, bh = float(b["width"]), float(b["height"])
            if bx + bw < rx or bx > rx + rw or by + bh < ry or by > ry + rh:
                continue
            p0, p1 = to_px(bx, by), to_px(bx + bw, by + bh)
            man_yolo.append(
                {"id": det["id"], "class_name": det["class_name"],
                 "confidence": conf, "tier": det.get("tier"),
                 "bbox": b, "bbox_px": [p0[0], p0[1], p1[0], p1[1]]}
            )
            color = ImageColor.getrgb(_YOLO_COLOR)
            width = 3 if det.get("tier") == "strong" else 2
            for a_, b_ in (((p0[0], p0[1]), (p1[0], p0[1])), ((p1[0], p0[1]), (p1[0], p1[1])),
                           ((p1[0], p1[1]), (p0[0], p1[1])), ((p0[0], p1[1]), (p0[0], p0[1]))):
                _dashed_line(draw, a_, b_, color, width, dash=5.0, gap=5.0)
            draw.text((p0[0] + 3, min(canvas.height - 13, p1[1] + 2)),
                      f"{det['class_name']} {conf:.2f}", fill=color, font=font_small)

    # --- manifest: PDF text layer ------------------------------------------------------
    man_texts: list[dict[str, Any]] | None = None
    text_note: str | None = None
    if include_text_layer:
        blocks = _fetch_text_blocks(_DEFAULT_DOCUMENT_ID, page)
        if blocks is None:
            text_note = "text layer unavailable (metadata endpoint unreachable)"
        else:
            in_view = [t for t in blocks if t["text"] and in_frame(t["x"], t["y"])]
            if len(in_view) > 120:
                text_note = f"text layer truncated: {len(in_view)} blocks in frame, showing 120"
                in_view = in_view[:120]
            man_texts = [{**t, "point_px": list(to_px(t["x"], t["y"]))} for t in in_view]

    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = _OUT_DIR / f"capture-p{page}-{int(time.time() * 1000)}.png"
    canvas.save(out)

    b64: str | None = None
    if encode_b64:
        buf = io.BytesIO()
        canvas.save(buf, format="PNG")
        b64 = base64.standard_b64encode(buf.getvalue()).decode("ascii")

    packet: dict[str, Any] = {
        "b64": b64,
        "debug_path": str(out),
        "page": page,
        "snapshot_seq": state.get("snapshot_seq"),
        "region": {"x": round(rx), "y": round(ry), "width": round(rw), "height": round(rh)},
        "image_size": [canvas.width, canvas.height],
        "margins_px": {"left": ml, "top": mt},
        "grid": grid_info,
        "layers": {"grid": show_grid_overlay, "graph": show_graph_overlay, "ask_marks": show_ask_marks, "yolo": show_yolo, "flags": bool(flags)},
        "components": man_components,
        "wires": man_wires,
        "terminals": man_terminals,
        "grounds": man_grounds,
        "ask_marks": man_marks,
        "texts": man_texts,
    }
    if man_flags is not None:
        packet["flags"] = man_flags
    if man_yolo is not None:
        packet["yolo_evidence"] = man_yolo
        from src.canvas_copilot import yolo as yolo_sidecar

        packet["yolo_model_sha"] = yolo_sidecar.model_sha()
    if text_note:
        packet["text_note"] = text_note
    # Back-compat: labels painted this render (annotate close-ups summarize with it).
    packet["drew"] = [c.get("label") for c in man_components]
    # Slate 4.2: every rendered frame is a LOOK — stamp it in the capture log
    # (captures, goto_page frames, and annotate post-apply close-ups all pass
    # through here; post-apply close-ups count per 6.11's stamp doctrine).
    bridge.log_capture(page, packet["region"], show_graph_overlay)
    return packet
