"""Slate 3.3 — three-strike false-positive escalation (born WARN + auto-park).

Evidence: 7 CNV40 resizes at (1114,916-930) nudging 2-10px against what
Shane later ruled a false positive (~100 minutes; 6/7 reused one stale
capture). Strikes count per NODE — the churn swapped flag families between
attempts. The auto-park rides the 6.3 channel (still blocks done) but does
NOT freeze geometry at birth: the freeze is the promoted executor tier.
"""

from __future__ import annotations

from src.canvas_copilot import blockers, bridge


def _fresh(monkeypatch):
    monkeypatch.setattr(bridge, "_resize_pending", {})
    monkeypatch.setattr(bridge, "_resize_strikes", {})


def test_strikes_count_per_node_across_flag_families(monkeypatch):
    _fresh(monkeypatch)
    # attempt 1: resized under truncation, still flagged (family swapped!)
    bridge.note_resize_under_flags("node-cnv", True)
    assert bridge.judge_resize_strike("node-cnv", still_flagged=True) == 1
    bridge.note_resize_under_flags("node-cnv", True)
    assert bridge.judge_resize_strike("node-cnv", still_flagged=True) == 2
    # a resize that actually CLEARS resets the counter
    bridge.note_resize_under_flags("node-cnv", True)
    assert bridge.judge_resize_strike("node-cnv", still_flagged=False) == 0


def test_unflagged_resizes_never_count(monkeypatch):
    _fresh(monkeypatch)
    bridge.note_resize_under_flags("node-x", False)  # legal mid-build resize
    assert bridge.judge_resize_strike("node-x", still_flagged=True) == 0


def test_third_strike_parks_without_freezing(monkeypatch, tmp_path):
    _fresh(monkeypatch)
    import asyncio
    import json

    from src.canvas_copilot import tools
    from src.canvas_copilot import copilot as cp

    snap = {"page": 10,
            "nodes": [{"id": "node-cnv", "label": "CNV40",
                       "bbox": {"x": 996, "y": 548, "width": 150, "height": 150}}],
            "ports": [], "edges": [], "continuations": [],
            "graph_stats": {"components": 1, "terminals": 0, "wires": 0, "continuations": 0}}
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": snap, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "moot_stale_warnings", lambda s: 0)
    monkeypatch.setattr(bridge, "warning_ledger", lambda page=None: [])
    from src.canvas_copilot import audit as audit_mod

    monkeypatch.setattr(audit_mod, "audit_graph", lambda *a, **k: {
        "violations": [{"rule": "bbox-truncation-floor", "severity": "ERROR",
                        "ids": ["node-cnv"], "detail": "box covers 12%"}],
        "counts": {"ERROR": 1}, "clean": False})

    # two prior strikes on record; the pending third judgment fires the park
    bridge._resize_strikes["node-cnv"] = 2
    bridge.note_resize_under_flags("node-cnv", True)
    result = asyncio.run(tools.compute_page_audit())
    rules = [v["rule"] for v in result["violations"]]
    assert "three-strike-fp-escalation" in rules
    st = blockers.element_state("bbox-truncation-floor", "node-cnv")
    assert st and st["state"] == "awaiting-shane"
    assert st["provenance"].startswith("three-strike")
    # parked still BLOCKS done...
    gate = blockers.open_blockers(
        {"violations": [{"rule": "bbox-truncation-floor", "severity": "ERROR",
                         "ids": ["node-cnv"], "detail": "d"}], "counts": {"ERROR": 1}}, snap)
    assert gate["parked"] == 1
    # ...but does NOT freeze geometry (born tier): a further resize APPLIES
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: [1])
    from src.canvas_copilot import vectors

    async def fake_texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", fake_texts)

    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1,
                "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "resize", "id": "node-cnv",
                  "bbox": {"x": 996, "y": 548, "width": 160, "height": 150}}],
         "reason": "test"}))
    out = json.loads(res["content"][0]["text"])
    assert out.get("refused") != "awaiting-shane-lock"
