"""Mint-time placement feedback — un-shelved by Shane 2026-07-06.

Shane's enclosure discriminator (his words, mechanized): a printed run
collinear with a drawn box edge is a WALL candidate only if it "creates an
enclosure that fits the base of the bbox being drawn" — perpendicular
corners at BOTH wall ends rising on the box-interior side, drawn edge inside
the wall span. A wire is a solitary run and can never fire. Walls arrive
fragmented (terminals bisect them) and merge across gaps first.

Calibration contract (probe 2026-07-06):
- gold v1.4: 0 fires across all non-connector boxes (connector family is
  exempt at the call site — plugs straddle module walls by design);
- run-2 candidate sweep: exactly CNV40 convicts (54px short at bottom —
  the 93% class that 17b's fractional thresholds cannot see);
- M40 (17.8% stub) is VECTOR-SILENT by design: its printed cell never
  closes, so the op-time detection-coverage half convicts it instead;
- wire-as-wall synthetics: silent.
"""

from __future__ import annotations

import asyncio
import json
import re

from src.canvas_copilot.audit import detection_coverage_gaps
from src.canvas_copilot.extents import wall_continuation_findings

GOLD = "../.atlas/experiment-archive/probe-yolo-page10/gold-master-v1.4.json"
RUN2 = "../.atlas/experiment-archive/cold-prompt-2-page10/graph-candidate-final.json"
CONN = re.compile(r"^(CN|CON|CAB|TB|MR-TB)(?![A-Za-z])", re.IGNORECASE)


def _segments():
    from src.canvas_copilot import vectors

    return asyncio.run(vectors.page_segments(10))


def test_gold_v14_boxes_fully_silent():
    segs = _segments()
    g = json.load(open(GOLD))["graph"]
    fired = []
    for n in g["nodes"]:
        b = n.get("bbox") or {}
        lab = str(n.get("label") or "")
        if not b or CONN.match(lab):
            continue
        if wall_continuation_findings(b, segs):
            fired.append(lab)
    assert fired == [], fired


def test_run2_sweep_convicts_exactly_cnv40():
    segs = _segments()
    cand = json.load(open(RUN2))["graph"]
    fired = {}
    for n in cand["nodes"]:
        b = n.get("bbox") or {}
        lab = str(n.get("label") or "")
        if not b or CONN.match(lab):
            continue
        f = wall_continuation_findings(b, segs)
        if f:
            fired[lab] = f
    assert set(fired) == {"CNV40"}, fired
    f = fired["CNV40"][0]
    assert f["edge"] == "left" and max(f["extends_px"]) >= 40, f


def test_wire_as_wall_stays_silent_and_enclosure_fires():
    # Shane's false-positive concern, synthetic form: a long solitary run
    # under the box base (a wire) must NOT fire; the same run with corner
    # partners at both ends rising toward the box (an enclosure) MUST.
    box = {"x": 200, "y": 100, "width": 120, "height": 80}
    wire = [{"x1": 100, "y1": 180, "x2": 600, "y2": 180}]  # base + 380px beyond
    assert wall_continuation_findings(box, wire) == []
    # one corner only (an L-bend wire) still must not fire
    l_bend = wire + [{"x1": 600, "y1": 180, "x2": 600, "y2": 120}]
    assert wall_continuation_findings(box, l_bend) == []
    enclosure = wire + [
        {"x1": 100, "y1": 180, "x2": 100, "y2": 60},   # left corner, rising
        {"x1": 600, "y1": 180, "x2": 600, "y2": 60},   # right corner, rising
    ]
    f = wall_continuation_findings(box, enclosure)
    assert f and f[0]["edge"] == "bottom", f


def test_fragmented_wall_still_forms_the_enclosure():
    # Shane 2026-07-06: "the wall may not be a complete solid line segment.
    # it may have terminals in it ... but it will still form an enclosure."
    box = {"x": 200, "y": 100, "width": 120, "height": 80}
    frags = [
        {"x1": 100, "y1": 180, "x2": 240, "y2": 180},
        {"x1": 258, "y1": 180, "x2": 400, "y2": 180},  # 18px terminal gap
        {"x1": 418, "y1": 180, "x2": 600, "y2": 180},
        {"x1": 100, "y1": 180, "x2": 100, "y2": 60},
        {"x1": 600, "y1": 180, "x2": 600, "y2": 60},
    ]
    f = wall_continuation_findings(box, frags)
    assert f and f[0]["edge"] == "bottom", f


def test_op_time_detection_coverage_convicts_m40_stub():
    from src.canvas_copilot import yolo

    dets = yolo.page_detections(10)
    cand = json.load(open(RUN2))["graph"]
    m40 = next(n for n in cand["nodes"] if str(n.get("label")) == "M40")
    gaps = detection_coverage_gaps(m40["bbox"], dets)
    assert any(g["class_name"] == "M" and g["frac"] <= 0.2 for g in gaps), gaps
    # the correctly-drawn gold M40 box is silent
    gold = json.load(open(GOLD))["graph"]
    g_m40 = next(n for n in gold["nodes"] if str(n.get("label")) == "M40")
    assert detection_coverage_gaps(g_m40["bbox"], dets) == []


def test_derive_extent_detector_tier_witnesses_m40():
    """YOLO-speed thread: the M40 cell has no bottom wall in the vector layer
    (dash tier blind), but the strong M detection spans the real motor —
    derive_extent now serves it as a detector-tier evidence candidate."""
    from src.canvas_copilot.extents import derive_extent

    gold = json.load(open(GOLD))["graph"]
    m40 = next(n for n in gold["nodes"] if str(n.get("label")) == "M40")
    b = m40["bbox"]
    ax, ay = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    res = asyncio.run(derive_extent(10, ax, ay))
    det = [c for c in res["candidates"] if c.get("tier") == "detector"]
    assert det and any(c["class_name"] == "M" for c in det), res["candidates"]
    assert "symbol-tight" in res["note"]


def test_op_time_detection_coverage_ignores_cab_and_weak_tiers():
    dets = [
        {"tier": "strong", "class_name": "CAB", "confidence": 0.9, "id": "d1",
         "bbox": {"x": 0, "y": 0, "width": 100, "height": 100}},
        {"tier": "evidence", "class_name": "M", "confidence": 0.4, "id": "d2",
         "bbox": {"x": 0, "y": 0, "width": 100, "height": 100}},
    ]
    assert detection_coverage_gaps({"x": 0, "y": 0, "width": 30, "height": 30}, dets) == []
