"""YOLO detection sidecar: loader + lookups for the copilot's evidence layer.

One full-page scan per (document, model) is precomputed by
scripts/build-yolo-sidecar.py into .atlas/page-geometry/yolo/. EVERYTHING here
is a lookup into those files — never fresh inference (closeup-crop inference
is out-of-distribution for the detector: 2.6–4% top-1 family accuracy naive,
67% scale-corrected, vs full-page context; measured 2026-07-05).

Trust doctrine (mirrored in the detect_components tool description):
detections are HIGH-PRECISION, INCOMPLETE-RECALL evidence. A detection is
strong evidence a component exists there; ABSENCE of a detection is evidence
of nothing. Low confidence on twin-prone families (SR/CR/MC/CP) is normal and
usually correct — identity comes from page context. The audit remains law.

Follows the vectors.py sidecar philosophy: memory -> file -> empty, never an
error (a page without a sidecar degrades to no-evidence behavior).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_SIDECAR_DIR = Path(__file__).resolve().parents[3] / ".atlas/page-geometry/yolo"
_manifest_mem: dict[str, Any] | None = None
_pages_mem: dict[int, list[dict[str, Any]]] = {}


def _reset_cache() -> None:
    """Test hook / post-regeneration refresh."""
    global _manifest_mem
    _manifest_mem = None
    _pages_mem.clear()


def manifest() -> dict[str, Any] | None:
    global _manifest_mem
    if _manifest_mem is None:
        try:
            _manifest_mem = json.loads(
                (_SIDECAR_DIR / "manifest.json").read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            return None
    return _manifest_mem


def model_sha(short: bool = True) -> str | None:
    m = manifest()
    if not m:
        return None
    sha = str(m.get("model_sha256") or "")
    return sha[:8] if (short and sha) else (sha or None)


def page_detections(page: int) -> list[dict[str, Any]]:
    """All detections on a page, px space. [] when no sidecar exists."""
    if page in _pages_mem:
        return _pages_mem[page]
    try:
        data = json.loads(
            (_SIDECAR_DIR / f"yolo-page-{page:03d}.json").read_text(encoding="utf-8")
        )
        dets = list(data.get("detections") or [])
    except (OSError, ValueError):
        dets = []
    _pages_mem[page] = dets
    return dets


def _overlaps(det_bbox: dict[str, Any], region: dict[str, Any]) -> bool:
    dx, dy = float(det_bbox["x"]), float(det_bbox["y"])
    dw, dh = float(det_bbox["width"]), float(det_bbox["height"])
    rx, ry = float(region["x"]), float(region["y"])
    rw, rh = float(region["width"]), float(region["height"])
    return dx < rx + rw and rx < dx + dw and dy < ry + rh and ry < dy + dh


def in_region(page: int, region: dict[str, Any]) -> list[dict[str, Any]]:
    """Detections intersecting a page-px region, confidence-descending."""
    hits = [d for d in page_detections(page) if _overlaps(d["bbox"], region)]
    return sorted(hits, key=lambda d: -float(d["confidence"]))


def identify(page: int, x: float, y: float) -> list[dict[str, Any]]:
    """Detections whose box covers the point, confidence-descending —
    answers 'what is this?' from the cached page-context scan."""
    out = []
    for d in page_detections(page):
        b = d["bbox"]
        if (
            float(b["x"]) <= x <= float(b["x"]) + float(b["width"])
            and float(b["y"]) <= y <= float(b["y"]) + float(b["height"])
        ):
            out.append(d)
    return sorted(out, key=lambda d: -float(d["confidence"]))


def roster(page: int) -> dict[str, Any]:
    """Counts by family and tier for a page — the auto-injected summary."""
    dets = page_detections(page)
    families: dict[str, dict[str, int]] = {}
    strong = 0
    for d in dets:
        fam = str(d["class_name"])
        tier = str(d.get("tier") or "evidence")
        row = families.setdefault(fam, {"strong": 0, "evidence": 0})
        row[tier] = row.get(tier, 0) + 1
        if tier == "strong":
            strong += 1
    return {
        "page": page,
        "total": len(dets),
        "strong": strong,
        "evidence": len(dets) - strong,
        "families": families,
        "model_sha": model_sha(),
    }


def context_line(page: int) -> str:
    """One compact line for the per-message canvas context block. Empty string
    when no sidecar data exists for the page (graceful absence)."""
    r = roster(page)
    if not r["total"]:
        return ""
    fams = sorted(
        r["families"].items(),
        key=lambda kv: -(kv[1]["strong"] + kv[1]["evidence"]),
    )
    bits = []
    for fam, row in fams[:8]:
        n = row["strong"] + row["evidence"]
        bits.append(f"{fam}×{n}" + (f"({row['strong']}s)" if row["strong"] else ""))
    more = len(fams) - 8
    if more > 0:
        bits.append(f"+{more} more")
    return (
        f"yolo_evidence={r['total']} dets ({r['strong']} strong): "
        + " ".join(bits)
        + " — unreviewed proposals, NOT truth; detect_components for boxes; "
        "capture show_yolo:true to see them"
    )
