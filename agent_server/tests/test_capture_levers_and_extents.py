"""Slate 7.2 (capture levers) + 7.3 (derive_extent advisory).

7.2 evidence: the 305,592-char full-page ask-marks capture preceded a 31s
error and a 95.5s first-op while regional captures ran 5-7s; four silent
~257KB full-page fallbacks; 9/30 sessions exhausted carrying 6-19 images.
7.3: the hard extent gate was killed for failing its own flagship cases —
the tool ships as EVIDENCE with UNRESOLVED as a valid answer.
"""

from __future__ import annotations

import asyncio
import json

GOLD = "../.atlas/experiment-archive/probe-yolo-page10/gold-master-v1.1.json"


def _snap(monkeypatch, nodes=None):
    from src.canvas_copilot import bridge

    snapshot = {"page": 10, "nodes": nodes or [], "ports": [], "edges": [],
                "continuations": []}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1,
                                      "snapshot_age_s": 0.1})


def test_full_page_capture_refused(monkeypatch):
    from src.canvas_copilot import tools

    _snap(monkeypatch)
    out = json.loads(asyncio.run(tools.capture.handler({}))["content"][0]["text"])
    assert out["refused"] == "narrow-the-region"
    big = {"region": {"x": 0, "y": 0, "width": 2481, "height": 3200}}
    out2 = json.loads(asyncio.run(tools.capture.handler(big))["content"][0]["text"])
    assert out2["refused"] == "narrow-the-region"


def test_regional_capture_respects_byte_cap(monkeypatch):
    from src.canvas_copilot import tools

    _snap(monkeypatch)
    res = asyncio.run(tools.capture.handler(
        {"region": {"x": 400, "y": 400, "width": 1600, "height": 1400},
         "max_px": 1600}))
    imgs = [c for c in res["content"] if c.get("type") == "image"]
    assert imgs, res["content"][0]
    assert len(imgs[0]["data"]) <= 165_000  # cap + small headroom
    body = json.loads(res["content"][0]["text"]) if res["content"][0].get("type") == "text" else {}
    # if the first render was over cap, the packet says so
    if len(imgs[0]["data"]) > 0 and "byte_cap_note" in json.dumps(body):
        assert "150KB" in json.dumps(body)


def test_derive_extent_anchors_rtc40_and_unresolves_symbols(monkeypatch):
    from src.canvas_copilot import tools

    g = json.load(open(GOLD))["graph"]
    _snap(monkeypatch, nodes=g["nodes"])
    out = json.loads(asyncio.run(tools.derive_extent_tool.handler(
        {"component_id": "rtc40"}))["content"][0]["text"])
    assert out["ok"] and out["resolved"]
    top = out["candidates"][0]["bbox"]
    assert abs(top["x"] - 822) <= 3 and abs(top["y"] - 1096) <= 3  # exact corner
    assert "EVIDENCE" in out["note"]
    # symbol-class: the dash tier still refuses to fabricate a rectangle —
    # but the detector tier (YOLO-speed thread, 2026-07-06) may now witness
    # the component as symbol-tight EVIDENCE. No dash candidate is the
    # protected invariant; a detector candidate is legitimate new signal.
    out2 = json.loads(asyncio.run(tools.derive_extent_tool.handler(
        {"component_id": "MS349"}))["content"][0]["text"])
    assert out2["ok"]
    assert not [c for c in out2["candidates"] if c.get("tier") == "dash"]
    if out2["resolved"]:
        assert all(c.get("tier") == "detector" for c in out2["candidates"])
        assert "symbol-tight" in out2["note"]
    else:
        assert "VALID answer" in out2["note"]
    # unknown labels get the 6.6 typed error, not a guess
    out3 = json.loads(asyncio.run(tools.derive_extent_tool.handler(
        {"component_id": "ZZZ9"}))["content"][0]["text"])
    assert out3.get("unknown_component") is True
