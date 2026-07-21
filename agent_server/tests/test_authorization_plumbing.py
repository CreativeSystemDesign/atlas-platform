"""Slate 4.6 — authorization plumbing + the gold-master lock.

Deadlock proof from the record: seg-00:28 minted CNV40 at the IDENTICAL
rectangle the truncation-floor ERROR later demanded back — the audit
demanded reverting Shane's ev165 correction forever; ticket b62336c6 rode
4+ handoffs until he manually overrode. Stamps are box-extent only, bind to
geometry, and invalidate on any change. The page lock is the single
hard-refusing tier (pre-approved for the sealed gold master).
"""

from __future__ import annotations

import asyncio
import json

from src.canvas_copilot import blockers

SNAP = {
    "page": 10,
    "nodes": [{"id": "node-cnv", "label": "CNV40",
               "bbox": {"x": 989, "y": 538, "width": 251, "height": 756}}],
    "ports": [{"id": "port-1", "label": "T~L1~R404", "type": "terminal",
               "parentId": "node-cnv", "point": {"x": 989, "y": 626}}],
    "edges": [], "continuations": [],
    "graph_stats": {"components": 1, "terminals": 1, "wires": 0, "continuations": 0},
}


def _iso(monkeypatch, tmp_path):
    monkeypatch.setattr(blockers, "_TICKET_STATE_FILE", tmp_path / "states.json")
    monkeypatch.setattr(blockers, "_ticket_states", None)


def test_extent_stamp_is_bbox_bound(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    bbox = dict(SNAP["nodes"][0]["bbox"])
    blockers.stamp_extent("node-cnv", bbox, "shane-panel")
    assert blockers.extent_stamp("node-cnv", bbox)
    # the box moves -> the stamp dies on the spot
    assert blockers.extent_stamp("node-cnv", {**bbox, "width": 900}) is None
    assert blockers.extent_stamp("node-cnv", bbox) is None  # gone for good


def test_audit_postfilter_skips_truncation_and_inverts_hints(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot import bridge, tools

    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "moot_stale_warnings", lambda snap: 0)
    monkeypatch.setattr(bridge, "warning_ledger", lambda page=None: [])

    from src.canvas_copilot import audit as audit_mod
    fake_violations = [
        {"rule": "bbox-truncation-floor", "severity": "ERROR", "ids": ["node-cnv"],
         "detail": "box covers 12% of its cell"},
        {"rule": "terminal-outside-parent", "severity": "ERROR", "ids": ["port-1", "node-cnv"],
         "detail": "terminal T~L1~R404 is 7px OUTSIDE its parent CNV40"},
        {"rule": "junction-dangle", "severity": "ERROR", "ids": ["port-9"],
         "detail": "unrelated"},
    ]
    monkeypatch.setattr(audit_mod, "audit_graph",
                        lambda *a, **k: {"violations": list(fake_violations),
                                         "counts": {"ERROR": 3}, "clean": False})
    blockers.stamp_extent("node-cnv", dict(SNAP["nodes"][0]["bbox"]), "shane-panel")
    result = asyncio.run(tools.compute_page_audit())
    rules = [v["rule"] for v in result["violations"]]
    assert "bbox-truncation-floor" not in rules          # stamped: cell hypothesis loses
    assert "junction-dangle" in rules                    # unrelated flags untouched
    top = next(v for v in result["violations"] if v["rule"] == "terminal-outside-parent")
    assert "the box is law" in top["detail"]             # hint inverted
    assert result["counts"]["ERROR"] == 2


def test_page_lock_refuses_all_mutation(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot import bridge, tools
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "needs_audit", False)
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    sent = {"n": 0}
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: sent.update(n=sent["n"] + 1) or [1])
    blockers.set_page_lock(10, True, "gold master v1.1 sealed")
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "rename", "id": "port-1", "label": "T~L2~R404"}], "reason": "test"}))
    out = json.loads(res["content"][0]["text"])
    assert out["refused"] == "page-locked" and "gold master" in out["note"]
    assert sent["n"] == 0
    blockers.set_page_lock(10, False, "shane-panel")
    assert blockers.page_locked(10) is None


def test_unbacked_shane_claim_draws_receipt_warn(monkeypatch, tmp_path):
    _iso(monkeypatch, tmp_path)
    from src.canvas_copilot import bridge, tools, vectors
    from src.canvas_copilot import copilot as cp

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    s = cp.copilot_session
    monkeypatch.setattr(s, "needs_audit", False)
    monkeypatch.setattr(s, "bound_page", 10)
    monkeypatch.setattr(s, "_geo_batch_used", False)
    monkeypatch.setitem(s.settings, "guided", False)
    s._history.clear()  # no Shane message anywhere in this session
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    async def fake_texts(page):
        return []
    monkeypatch.setattr(vectors, "page_texts", fake_texts)
    monkeypatch.setattr(bridge, "send_commands", lambda cmds: [1])
    async def fake_ack(key, timeout_s):
        return {"kind": "annotate_applied", "key": key, "page": 10, "ops": 1,
                "notes": [], "minted": {}}
    monkeypatch.setattr(bridge, "wait_for_annotate_applied", fake_ack)
    res = asyncio.run(tools.annotate.handler(
        {"ops": [{"op": "rename", "id": "port-1", "label": "T~L2~R404"}],
         "reason": "Shane: rename it"}))
    out = json.loads(res["content"][0]["text"])
    assert out["ok"] is True  # born WARN: never refuses
    assert "recency proves existence, not consent" in json.dumps(out)
