"""Run-2 finding — NAVIGATION IS A DONE-GATE ESCAPE.

The done-gate audits only the CURRENT page, so a page flip sheds blockers:
run 2's predecessor declared page 10 "done-enough" (9 open WARNs) and its
successor began page 11 — the run's single harness intervention.

Mechanism: goto_page refuses to depart a page with open blockers/end-state
gaps. An acknowledged departure (blockers_ack:<count>) records a PERSISTED
debt; the done-gate keeps refusing while any departed page owes, and the debt
settles only when that page audits clean. Navigation is never disposal.
"""

from __future__ import annotations

import asyncio
import json

SNAP = {"page": 10, "nodes": [], "ports": [], "edges": [], "continuations": []}

DIRTY_AUDIT = {
    "page": 10,
    "violations": [{"rule": "junction-dangle", "severity": "ERROR", "ids": ["port-1"],
                    "detail": "junction J-1 has degree 1 — stranded"}],
    "counts": {"ERROR": 1, "WARN": 0, "INFO": 0},
    "clean": False,
}
CLEAN_AUDIT = {"page": 10, "violations": [], "counts": {}, "clean": True}


def _wire(monkeypatch, tmp_path, audit):
    from src.canvas_copilot import bridge
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "bound_page", 10)
    monkeypatch.setattr(cp.copilot_session, "page_debts", {}, raising=False)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    sent = {"cmds": []}
    monkeypatch.setattr(bridge, "send_commands",
                        lambda cmds: sent["cmds"].extend(cmds) or [1])

    async def fake_audit():
        return audit
    monkeypatch.setattr(tools, "compute_page_audit", fake_audit)
    return cp.copilot_session, tools, sent


def test_departure_with_open_blockers_is_refused(monkeypatch, tmp_path):
    s, tools, sent = _wire(monkeypatch, tmp_path, DIRTY_AUDIT)
    res = asyncio.run(tools.goto_page.handler({"page": 11}))
    out = json.loads(res["content"][0]["text"])
    assert out["refused"] == "departing-blockers"
    assert out["departing_page"] == 10 and out["open_blockers"] == 1
    assert "NAVIGATION IS NEVER DISPOSAL" in out["note"]
    assert sent["cmds"] == []  # the view command never went out
    assert s.page_debts == {}  # a refusal records nothing


def test_wrong_ack_count_still_refuses(monkeypatch, tmp_path):
    s, tools, sent = _wire(monkeypatch, tmp_path, DIRTY_AUDIT)
    res = asyncio.run(tools.goto_page.handler({"page": 11, "blockers_ack": 5}))
    out = json.loads(res["content"][0]["text"])
    assert out["refused"] == "departing-blockers" and sent["cmds"] == []


def test_acknowledged_departure_records_the_debt(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge

    s, tools, sent = _wire(monkeypatch, tmp_path, DIRTY_AUDIT)
    # once the view command goes out, the fake canvas echoes page 11 — the
    # echo loop exits immediately and goto_page proceeds to capture (which
    # fails in this harness; the gate outcome is already decided by then).
    snap11 = {**SNAP, "page": 11}
    monkeypatch.setattr(
        bridge, "get_state",
        lambda **kw: {"snapshot": snap11 if any(c.get("type") == "view" for c in sent["cmds"])
                      else SNAP,
                      "snapshot_seq": 1, "snapshot_age_s": 0.1})
    res = asyncio.run(tools.goto_page.handler({"page": 11, "blockers_ack": 1}))
    assert s.page_debts.get("10", {}).get("live") == 1
    assert s.page_debts["10"]["top_rule"] == "junction-dangle"
    assert any(c.get("type") == "view" for c in sent["cmds"])
    out = res["content"][0]["text"]
    assert "departing-blockers" not in out  # past the gate, not a refusal


def test_same_page_goto_skips_the_gate(monkeypatch, tmp_path):
    calls = {"n": 0}

    async def counting_audit():
        calls["n"] += 1
        return DIRTY_AUDIT
    s, tools, sent = _wire(monkeypatch, tmp_path, DIRTY_AUDIT)
    from src.canvas_copilot import tools as t2
    monkeypatch.setattr(t2, "compute_page_audit", counting_audit)
    # goto_page 10 while ON page 10: no departure, gate must not even audit
    asyncio.run(tools.goto_page.handler({"page": 10}))
    assert calls["n"] == 0


def test_done_gate_refuses_while_departed_page_owes(monkeypatch, tmp_path):
    from src.canvas_copilot import copilot as cp

    s, tools, sent = _wire(monkeypatch, tmp_path, CLEAN_AUDIT)
    s.page_debts["11"] = {"live": 2, "end_state": 1, "top_rule": "junction-dangle", "ts": 0}
    msg = asyncio.run(s._done_gate_check())
    assert msg and "page 11" in msg and "Navigation is never disposal" in msg


def _stub_geometry(monkeypatch):
    """Pure-unit compute_page_audit: no page vectors, no detector — page 10's
    REAL yolo sidecar now correctly dirties an empty graph (rule 17c: strong
    CAB detections with no cable edge), which is exactly what these tests
    must not depend on."""
    from src.canvas_copilot import vectors, yolo

    async def _none_async(page):
        return []
    monkeypatch.setattr(vectors, "page_segments", _none_async)
    monkeypatch.setattr(vectors, "page_texts", _none_async)
    monkeypatch.setattr(vectors, "page_circles", lambda page: [])
    monkeypatch.setattr(vectors, "page_enclosures", lambda page: [])
    monkeypatch.setattr(yolo, "page_detections", lambda page: [])


def test_clean_audit_settles_the_debt(monkeypatch, tmp_path):
    """compute_page_audit (real one) on a clean page pops that page's debt."""
    from src.canvas_copilot import bridge
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools

    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "page_debts",
                        {"10": {"live": 1, "end_state": 0, "top_rule": "x", "ts": 0}},
                        raising=False)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": SNAP, "snapshot_seq": 1, "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "moot_stale_warnings", lambda snap: 0)
    monkeypatch.setattr(bridge, "warning_ledger", lambda page: [])
    _stub_geometry(monkeypatch)
    result = asyncio.run(tools.compute_page_audit())
    assert cp.copilot_session.page_debts == {}
    assert "settled" in str(result.get("page_debt_settled"))


def test_dirty_audit_does_not_settle(monkeypatch, tmp_path):
    from src.canvas_copilot import bridge
    from src.canvas_copilot import copilot as cp
    from src.canvas_copilot import tools

    dirty_snap = {"page": 10,
                  "nodes": [],
                  "ports": [{"id": "port-1", "type": "junction", "label": "J-1",
                             "point": {"x": 5, "y": 5}}],
                  "edges": [], "continuations": []}
    monkeypatch.setattr(cp, "_SESSION_FILE", tmp_path / "session.json")
    monkeypatch.setattr(cp.copilot_session, "page_debts",
                        {"10": {"live": 1, "end_state": 0, "top_rule": "x", "ts": 0}},
                        raising=False)
    monkeypatch.setattr(bridge, "get_state",
                        lambda **kw: {"snapshot": dirty_snap, "snapshot_seq": 1,
                                      "snapshot_age_s": 0.1})
    monkeypatch.setattr(bridge, "moot_stale_warnings", lambda snap: 0)
    monkeypatch.setattr(bridge, "warning_ledger", lambda page: [])
    _stub_geometry(monkeypatch)
    asyncio.run(tools.compute_page_audit())
    assert "10" in cp.copilot_session.page_debts  # junction-dangle still open
