"""from_detection seeded boxing + detector testimony (Shane's speed
directive, 2026-07-06): the detector suggests size/shape, print decides
edges, identity comes from the agent. Verify-by-exception: per-side VECTOR
coverage is the signal that excuses the capture-judge loop — a seeded box
agrees with its detection by construction, so 17b is blind to it and the
print witnesses carry that case.
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot.audit import detection_testimony
from src.canvas_copilot.extents import refine_bbox_to_walls

SNAP = {"page": 10, "nodes": [], "ports": [], "edges": [], "continuations": []}

DET = {"id": "y010-777", "tier": "strong", "class_name": "MS", "confidence": 0.9,
       "bbox": {"x": 104, "y": 96, "width": 92, "height": 210}}


def test_refine_snaps_to_printed_walls_and_reports_coverage():
    # printed rectangle at 100..200 x 100..300; det prior is a few px off
    segs = [
        {"x1": 100, "y1": 100, "x2": 200, "y2": 100},
        {"x1": 100, "y1": 300, "x2": 200, "y2": 300},
        {"x1": 100, "y1": 100, "x2": 100, "y2": 300},
        {"x1": 200, "y1": 100, "x2": 200, "y2": 300},
    ]
    refined, cov = refine_bbox_to_walls(DET["bbox"], segs)
    assert refined == {"x": 100.0, "y": 100.0, "width": 100.0, "height": 200.0}
    assert min(cov.values()) >= 0.99, cov


def test_refine_keeps_prior_edge_when_no_wall_in_reach():
    # only left + top walls exist; right/bottom keep the detection prior
    segs = [
        {"x1": 100, "y1": 100, "x2": 200, "y2": 100},
        {"x1": 100, "y1": 100, "x2": 100, "y2": 300},
    ]
    refined, cov = refine_bbox_to_walls(DET["bbox"], segs)
    assert refined["x"] == 100.0 and refined["y"] == 100.0
    assert refined["width"] == 96.0  # 104+92 right edge kept: 196-100
    assert cov["left"] > 0.5 and cov["right"] < 0.5


def _wire(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge, vectors, yolo
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "needs_audit", False)
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(cp.copilot_session, "page_debts", {}, raising=False)
    sent = {"cmds": []}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "send_commands",
                        lambda cmds: sent["cmds"].extend(cmds) or [1])

    async def fake_wait(key, timeout_s):
        return {"page": 10, "ops": 1, "notes": [], "minted": []}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_wait)
    monkeypatch.setattr(yolo, "page_detections", lambda page: [DET])

    async def segs(page):
        return [
            {"x1": 100, "y1": 100, "x2": 200, "y2": 100},
            {"x1": 100, "y1": 300, "x2": 200, "y2": 300},
            {"x1": 100, "y1": 100, "x2": 100, "y2": 300},
            {"x1": 200, "y1": 100, "x2": 200, "y2": 300},
        ]
    monkeypatch.setattr(vectors, "page_segments", segs)

    async def texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", texts)
    return sent


def test_annotate_resolves_from_detection_server_side(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    sent = _wire(monkeypatch, tmp_path)
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "add_component", "from_detection": "y010-777", "label": "MS2"}],
         "reason": "seeded"}))
    out = json.loads(res["content"][0]["text"])
    cmd = next(c for c in sent["cmds"] if c.get("type") == "annotate")
    op0 = cmd["ops"][0]
    assert "from_detection" not in op0  # resolved before dispatch
    assert op0["bbox"] == {"x": 100.0, "y": 100.0, "width": 100.0, "height": 200.0}
    notes = " | ".join(out.get("notes") or [])
    assert "seeded MS2 from strong MS detection y010-777" in notes
    assert "verified by construction" in notes


def test_unknown_detection_id_drops_the_op_with_a_typed_note(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    sent = _wire(monkeypatch, tmp_path)
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "add_component", "from_detection": "y010-999", "label": "ZZ"}],
         "reason": "seeded-bad"}))
    out = json.loads(res["content"][0]["text"])
    cmd = next(c for c in sent["cmds"] if c.get("type") == "annotate")
    assert cmd["ops"] == []  # dropped, nothing dispatched for it
    assert any("not found" in n and "DROPPED" in n for n in out.get("notes") or [])


def test_freehand_mint_carries_detector_testimony(monkeypatch, tmp_path):
    from src.canvas_copilot import tools

    sent = _wire(monkeypatch, tmp_path)
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "add_component",
                  "bbox": {"x": 102, "y": 98, "width": 96, "height": 206},
                  "label": "MS2"}],
         "reason": "freehand near det"}))
    out = json.loads(res["content"][0]["text"])
    notes = " | ".join(out.get("notes") or [])
    assert "detector testimony: matches strong MS detection" in notes
    # far from any detection: absence note, never a gate
    res2 = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "add_component",
                  "bbox": {"x": 900, "y": 900, "width": 50, "height": 50},
                  "label": "R9"}],
         "reason": "freehand no det"}))
    out2 = json.loads(res2["content"][0]["text"])
    assert any("absence proves nothing" in n for n in out2.get("notes") or [])


def test_testimony_helper_prefers_best_iou():
    dets = [DET,
            {"id": "d2", "tier": "strong", "class_name": "THR", "confidence": 0.8,
             "bbox": {"x": 100, "y": 100, "width": 100, "height": 200}}]
    t = detection_testimony({"x": 100, "y": 100, "width": 100, "height": 200}, dets)
    assert t["kind"] == "match" and t["class_name"] == "THR" and t["iou"] == 1.0
    assert detection_testimony({"x": 0, "y": 0, "width": 10, "height": 10}, dets) == {"kind": "none"}
