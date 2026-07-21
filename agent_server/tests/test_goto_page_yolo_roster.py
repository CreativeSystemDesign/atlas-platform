"""Option B (Shane 2026-07-06): arrival is the discovery moment.

goto_page's overview carries the detector evidence layer BY DEFAULT
(show_yolo:true) and a machine-readable yolo_roster — strong detections with
no graph coverage are the page's unworked work-list, stated in text so a cold
agent's first move is obvious. Close-up captures stay clean by default.
"""

from __future__ import annotations

import asyncio
import json

SNAP = {
    "page": 10,
    "nodes": [
        {"id": "n1", "label": "R40",
         "bbox": {"x": 100, "y": 100, "width": 200, "height": 150}},
    ],
    "ports": [], "edges": [], "continuations": [],
}

DETS = [
    # covered by n1 (full overlap)
    {"id": "d1", "tier": "strong", "class_name": "R", "confidence": 0.9,
     "bbox": {"x": 110, "y": 110, "width": 150, "height": 100}},
    # unworked strong M
    {"id": "d2", "tier": "strong", "class_name": "M", "confidence": 0.88,
     "bbox": {"x": 900, "y": 900, "width": 200, "height": 400}},
    # evidence tier never counts toward the roster
    {"id": "d3", "tier": "evidence", "class_name": "CON", "confidence": 0.4,
     "bbox": {"x": 1500, "y": 900, "width": 100, "height": 100}},
]


def _wire(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge, capture, yolo
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(cp.copilot_session, "page_debts", {}, raising=False)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: [1])
    monkeypatch.setattr(yolo, "page_detections", lambda page: DETS)
    seen = {}

    def fake_render(**kwargs):
        seen.update(kwargs)
        return {"region": {"x": 0, "y": 0}, "b64": None}
    monkeypatch.setattr(capture, "render_capture", fake_render)
    return tools, seen


def test_goto_page_defaults_show_yolo_and_reports_roster(monkeypatch, tmp_path):
    tools, seen = _wire(monkeypatch, tmp_path)
    res = asyncio.run(tools.goto_page.handler({"page": 10}))
    assert seen.get("show_yolo") is True
    out = json.loads(res["content"][0]["text"])
    roster = out["yolo_roster"]
    assert roster["strong"] == 2 and roster["unworked"] == 1
    assert roster["unworked_by_class"] == {"M": 1}
    assert "work-list" in roster["note"]


def test_goto_page_show_yolo_false_is_clean(monkeypatch, tmp_path):
    tools, seen = _wire(monkeypatch, tmp_path)
    res = asyncio.run(tools.goto_page.handler({"page": 10, "show_yolo": False}))
    assert seen.get("show_yolo") is False
    out = json.loads(res["content"][0]["text"])
    assert "yolo_roster" not in out


def test_roster_notes_all_covered_when_no_unworked(monkeypatch, tmp_path):
    from src.canvas_copilot import yolo

    tools, seen = _wire(monkeypatch, tmp_path)
    monkeypatch.setattr(yolo, "page_detections", lambda page: [DETS[0]])
    res = asyncio.run(tools.goto_page.handler({"page": 10}))
    out = json.loads(res["content"][0]["text"])
    assert out["yolo_roster"]["unworked"] == 0
    assert "wiring/continuations" in out["yolo_roster"]["note"]
