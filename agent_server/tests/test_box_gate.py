"""Box gate (Shane 2026-07-07): "all bboxes must be positioned correctly
because that will change the location of terminals placed on the border of
the bbox for each wire... bboxes should be gated before wiring."

add_wire refuses pre-dispatch until the page's boxes carry a CLEAN, FRESH
audit certificate. The page-12 run wired over nine flagged boxes despite the
REBUILD ORDER prose — this is the mechanism. unwired-node never gates
(wiring is its cure); Shane-disposed flags never gate; parked-awaiting-Shane
flags still gate (accuracy outranks speed by his ruling).
"""

from __future__ import annotations

import asyncio
import json as _json
import time

import pytest

from src.canvas_copilot import bridge, tools, vectors


SNAP = {
    "page": 12,
    "nodes": [{"id": "n1", "label": "MC7",
               "bbox": {"x": 100, "y": 100, "width": 80, "height": 80}}],
    "ports": [], "edges": [], "continuations": [],
    "graph_stats": {"components": 1, "terminals": 0, "wires": 0, "continuations": 0},
}
WIRE = {"op": "add_wire", "label": "R1",
        "path": [{"x": 300, "y": 300}, {"x": 400, "y": 300}]}


@pytest.fixture
def rig(monkeypatch):
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1,
                                      "snapshot_age_s": 0.1})

    async def fake_texts(page):
        return []

    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    sent = {"n": 0}
    monkeypatch.setattr(bridge, "send_commands",
                        lambda cmds: sent.update(n=sent["n"] + 1) or [1])

    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 12, "ops": 1,
                "notes": [], "minted": [{}]}

    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)
    monkeypatch.setattr(bridge, "_node_mutation_ts", {})
    tools._last_audit_flag_list.clear()
    yield sent
    tools._last_audit_flag_list.clear()


def _run(ops, reason="test"):
    res = asyncio.run(tools.annotate.handler({"ops": ops, "reason": reason}))
    return _json.loads(res["content"][0]["text"])


def _certify(entries=(), ts=None):
    tools._last_audit_flag_list.clear()
    tools._last_audit_flag_list.update(
        {"page": 12, "snapshot_seq": 1, "ts": ts or time.time(),
         "entries": list(entries)})


def test_wire_without_any_audit_certificate_refused(rig):
    r = _run([WIRE])
    assert r["ok"] is False and r["refused"] == "box-gate"
    assert "no completed audit" in r["note"]
    assert rig["n"] == 0, "refusal must happen BEFORE dispatch"


def test_mixed_box_and_wire_batch_refused(rig):
    _certify()
    r = _run([{"op": "add_component", "label": "MC8",
               "bbox": {"x": 300, "y": 300, "width": 50, "height": 50}}, WIRE])
    assert r["ok"] is False and r["refused"] == "box-gate"
    assert "mixes box geometry" in r["note"]


def test_open_box_geometry_flag_gates_wiring(rig):
    _certify([{"n": 1, "rule": "bbox-truncation-floor", "severity": "ERROR",
               "detail": "MC7 truncated", "ids": ["n1"]}])
    r = _run([WIRE])
    assert r["ok"] is False and r["refused"] == "box-gate"
    assert r["flags"][0]["rule"] == "bbox-truncation-floor"


def test_unwired_node_flags_never_gate(rig):
    _certify([{"n": 1, "rule": "unwired-node", "severity": "ERROR",
               "detail": "MC7 has 0 wires", "ids": ["n1"]}])
    assert _run([WIRE])["ok"] is True


def test_stale_certificate_refused_after_box_mutation(rig):
    _certify(ts=time.time() - 60)
    bridge._node_mutation_ts["n1"] = time.time()  # box moved after the audit
    r = _run([WIRE])
    assert r["ok"] is False and "stale" in r["note"]


def test_clean_fresh_certificate_admits_wiring(rig):
    bridge._node_mutation_ts["n1"] = time.time() - 60
    _certify()  # fresh, zero entries
    assert _run([WIRE])["ok"] is True


def test_shane_reason_bypasses_gate(rig):
    r = _run([WIRE], reason="Shane says wire it: explicit coords")
    assert r["ok"] is True


def test_shane_disposed_flag_does_not_gate(rig, monkeypatch):
    from src.canvas_copilot import blockers

    _certify([{"n": 1, "rule": "bbox-truncation-floor", "severity": "ERROR",
               "detail": "MC7 truncated", "ids": ["n1"]}])
    monkeypatch.setattr(blockers, "_violation_state",
                        lambda v, snap: "disposed")
    assert _run([WIRE])["ok"] is True


def test_parked_flag_still_gates(rig, monkeypatch):
    from src.canvas_copilot import blockers

    _certify([{"n": 1, "rule": "bbox-truncation-floor", "severity": "ERROR",
               "detail": "MC7 covers 22% of its cell", "ids": ["n1"]}])
    monkeypatch.setattr(blockers, "_violation_state",
                        lambda v, snap: "parked")
    r = _run([WIRE])
    assert r["ok"] is False and r["refused"] == "box-gate"


def test_parked_yolo_flag_never_gates(rig, monkeypatch):
    # YOLO NEVER GATES (Shane's law, a043cd3): detection-fed rules are
    # copilot evidence only — outside _BOX_GATE_RULES regardless of state,
    # so even a parked yolo flag cannot refuse wiring.
    from src.canvas_copilot import blockers

    _certify([{"n": 1, "rule": "yolo-extent-mismatch", "severity": "INFO",
               "detail": "MC7 covers 30% of det", "ids": ["y012-001", "n1"]}])
    monkeypatch.setattr(blockers, "_violation_state",
                        lambda v, snap: "parked")
    assert _run([WIRE])["ok"] is True
