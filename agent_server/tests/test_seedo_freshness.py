"""Slate 4.2 — see-do freshness (born WARN, warn-and-ledger, no refusal).

The zombie class: capture ev1129 served 10 ops over 79.6 minutes including
5 consecutive resizes of a node it PREDATED. Killed predicates stay dead:
no 180s wall clock (0/59 supporting instances in the whole dataset), no
global event-count staleness (bleeds unrelated regions). The trimmed core
catches ~12-14 of the 17 measured stale ops with no global threshold.
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot import bridge


def _fresh(monkeypatch):
    monkeypatch.setattr(bridge, "_capture_log", [])
    monkeypatch.setattr(bridge, "_node_mutation_ts", {})
    monkeypatch.setattr(bridge, "_node_resize_ts", {})
    monkeypatch.setattr(bridge, "_warning_ledger", [])


def test_covering_look_passes_and_missing_look_warns(monkeypatch):
    _fresh(monkeypatch)
    assert "no capture on record" in bridge.freshness_verdict(10, None, 500, 500)
    bridge.log_capture(10, {"x": 400, "y": 400, "width": 300, "height": 300}, True)
    assert bridge.freshness_verdict(10, None, 500, 500) is None
    # coverage is REGION-scoped: a look elsewhere does not cover this point
    assert "no capture on record" in bridge.freshness_verdict(10, None, 2000, 2000)


def test_own_mutation_stales_own_picture(monkeypatch):
    _fresh(monkeypatch)
    bridge.log_capture(10, {"x": 0, "y": 0, "width": 1000, "height": 1000}, True)
    assert bridge.freshness_verdict(10, "node-1", 500, 500) is None
    bridge.note_geometry_mutation("node-1", resize=True)
    v = bridge.freshness_verdict(10, "node-1", 500, 500)
    assert v and "PREDATES" in v
    # a fresh covering look clears it
    bridge.log_capture(10, {"x": 400, "y": 400, "width": 200, "height": 200}, True)
    assert bridge.freshness_verdict(10, "node-1", 500, 500) is None


def test_resize_recapture_interlock(monkeypatch):
    _fresh(monkeypatch)
    bridge.log_capture(10, {"x": 0, "y": 0, "width": 1000, "height": 1000}, True)
    bridge.note_geometry_mutation("node-1", resize=True)
    v = bridge.freshness_verdict(10, "node-1", 500, 500)
    assert v  # zombie fires first (mutation newer than look)
    bridge.log_capture(10, {"x": 0, "y": 0, "width": 1000, "height": 1000}, True)
    assert bridge.freshness_verdict(10, "node-1", 500, 500) is None


def test_annotate_warns_but_never_refuses(monkeypatch, tmp_path):
    _fresh(monkeypatch)
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools, vectors

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(cp.copilot_session, "needs_audit", False)
    snapshot = {"page": 10,
                "nodes": [{"id": "node-1", "label": "R40",
                           "bbox": {"x": 400, "y": 400, "width": 200, "height": 100}}],
                "ports": [], "edges": [], "continuations": [],
                "graph_stats": {"components": 1, "terminals": 0, "wires": 0, "continuations": 0}}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snapshot, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    async def fake_texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: [1])
    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1,
                "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)

    async def run(ops, reason="test"):
        res = await tools.annotate.handler({"ops": ops, "reason": reason})
        return json.loads(res["content"][0]["text"])

    # zombie: node mutated after the only covering look -> WARN rides the
    # receipt AND the ledger, but the op still APPLIES
    bridge.log_capture(10, {"x": 0, "y": 0, "width": 1000, "height": 1000}, True)
    bridge.note_geometry_mutation("node-1", resize=True)
    out = asyncio.run(run([{"op": "resize", "id": "node-1",
                            "bbox": {"x": 400, "y": 400, "width": 220, "height": 100}}]))
    assert out["ok"] is True
    joined = json.dumps(out)
    assert "PREDATES" in joined
    assert any("PREDATES" in w["note"] for w in bridge.warning_ledger())
    # Shane-prefixed reason suppresses (his explicit coordinates)
    bridge.note_geometry_mutation("node-1", resize=True)
    out2 = asyncio.run(run([{"op": "resize", "id": "node-1",
                             "bbox": {"x": 400, "y": 400, "width": 240, "height": 100}}],
                           reason="Shane: nudge the right edge"))
    assert "PREDATES" not in json.dumps(out2)


def test_no_covering_look_warn_stays_out_of_the_ledger(monkeypatch):
    _fresh(monkeypatch)
    # receipt-only by design: a server restart empties the capture log and
    # must not mint ledger debt out of thin air
    v = bridge.freshness_verdict(10, None, 100, 100)
    assert "no capture on record" in v
    assert not bridge.warning_ledger()
