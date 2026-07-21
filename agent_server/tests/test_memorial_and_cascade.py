"""Slate 3.4 (Shane-delete memorial) + 3.5 (cascade-delta receipts).

3.4 evidence: 2.5 minutes after executing Shane's "remove the CN40B wire",
an auto-continue turn re-added it justified by a fabricated diagonal; the
same wire recurred across a session boundary as CAB40 sharing ONLY endpoint
(1574,920) — both-endpoint matching misses the slate's own second case.
3.5 evidence: a rewiring batch silently dropped continuations 2->0; the
handoff recorded "0 continuations" as normal while the page prints 49/19.
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot import bridge


def _fresh(monkeypatch):
    monkeypatch.setattr(bridge, "_delete_memorials", [])
    monkeypatch.setattr(bridge, "_capture_log", [])
    monkeypatch.setattr(bridge, "_node_mutation_ts", {})
    monkeypatch.setattr(bridge, "_node_resize_ts", {})


def test_wire_matcher_catches_the_cab40_single_endpoint_case(monkeypatch):
    _fresh(monkeypatch)
    bridge.add_delete_memorial({"kind": "wire", "label": "CN40B",
                                "a": {"x": 1240, "y": 908}, "b": {"x": 1574, "y": 920},
                                "reason": "Shane: remove the CN40B wire"})
    # exact endpoint at one end, 40px drift at the other (the recurrence shape)
    hit = bridge.match_delete_memorial("wire", "CAB40",
                                       {"a": {"x": 1574, "y": 920}, "b": {"x": 1245, "y": 950}})
    assert hit and "remove the CN40B" in hit["reason"]
    # a genuinely different wire sharing ONE terminal but heading elsewhere: quiet
    miss = bridge.match_delete_memorial("wire", None,
                                        {"a": {"x": 1574, "y": 920}, "b": {"x": 1600, "y": 1500}})
    assert miss is None


def _annotate_env(monkeypatch, tmp_path, stats_before, stats_after):
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools, vectors

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.copilot_session
    monkeypatch.setattr(s, "needs_audit", False)
    monkeypatch.setattr(s, "bound_page", 10)
    monkeypatch.setattr(s, "_geo_batch_used", False)
    monkeypatch.setitem(s.settings, "guided", False)
    state = {"seq": 1, "stats": dict(stats_before)}
    snapshot = {"page": 10,
                "nodes": [], "continuations": [],
                "ports": [{"id": "port-cn", "label": "T~CN40B~CN40B", "type": "terminal",
                           "parentId": None, "point": {"x": 1574, "y": 920}}],
                "edges": [{"id": "edge-cn", "label": "CN40B", "sourcePortId": "port-cn",
                           "targetPortId": "port-x",
                           "path": [{"x": 1240, "y": 908}, {"x": 1574, "y": 920}]}]}

    def get_state(**kw):
        return {"snapshot": {**snapshot, "graph_stats": dict(state["stats"])},
                "snapshot_seq": state["seq"], "snapshot_age_s": 0.1}
    monkeypatch.setattr(bridge, "get_state", get_state)
    async def fake_texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: [1])

    async def fake_ack(key, timeout_s):
        state["seq"] += 1
        state["stats"] = dict(stats_after)
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1,
                "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)
    return tools


def test_shane_delete_records_and_later_readd_warns(monkeypatch, tmp_path):
    _fresh(monkeypatch)
    tools = _annotate_env(monkeypatch, tmp_path,
                          {"components": 0, "terminals": 1, "wires": 1, "continuations": 0},
                          {"components": 0, "terminals": 1, "wires": 0, "continuations": 0})

    async def run(ops, reason):
        res = await tools.annotate.handler({"ops": ops, "reason": reason})
        return json.loads(res["content"][0]["text"])

    # batch 1: Shane-attributed direct delete -> memorial recorded, no warn
    out1 = asyncio.run(run([{"op": "delete", "id": "edge-cn"}],
                           "Shane: remove the CN40B wire"))
    assert "re-creates an entity" not in json.dumps(out1)
    assert bridge._delete_memorials and bridge._delete_memorials[0]["kind"] == "wire"
    # batch 2 (later): the re-add — sharing one exact endpoint — draws the quote
    out2 = asyncio.run(run(
        [{"op": "add_wire", "label": "CAB40",
          "path": [{"x": 1574, "y": 920}, {"x": 1245, "y": 950}]}],
        "a small diagonal lead is expected here per the artwork"))
    joined = json.dumps(out2)
    assert "re-creates an entity deleted under Shane's authority" in joined
    assert "remove the CN40B wire" in joined


def test_cascade_differ_names_unexplained_drops(monkeypatch, tmp_path):
    _fresh(monkeypatch)
    tools = _annotate_env(monkeypatch, tmp_path,
                          {"components": 3, "terminals": 9, "wires": 5, "continuations": 2},
                          {"components": 3, "terminals": 9, "wires": 5, "continuations": 0})

    async def run(ops, reason="test"):
        res = await tools.annotate.handler({"ops": ops, "reason": reason})
        return json.loads(res["content"][0]["text"])

    # a rename-only batch that (per the fake canvas) dropped 2 continuations
    out = asyncio.run(run([{"op": "rename", "id": "port-cn", "label": "T~A~CN40B"}]))
    joined = json.dumps(out)
    assert "cascade: 2 continuations dropped" in joined
    # a batch that NAMES deletions explains its own drops — no cascade note
    _fresh(monkeypatch)
    tools2 = _annotate_env(monkeypatch, tmp_path,
                           {"components": 3, "terminals": 9, "wires": 5, "continuations": 2},
                           {"components": 3, "terminals": 9, "wires": 5, "continuations": 0})
    out2 = asyncio.run(run([{"op": "delete", "id": "edge-cn"}]))
    assert "cascade: 2 continuations dropped" not in json.dumps(out2)
