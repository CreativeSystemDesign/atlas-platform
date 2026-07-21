"""Slate 6.10 — warning-ledger hygiene.

Evidence: "reused unparented terminal port-4ad1aeb9" persisted a whole
segment after the port was deleted (no removal path existed in code);
literal duplicate rows (T-124 x3); WARN climbed 13->52 as legitimate
continuation endpoints minted permanent noise; 19 WARNs mis-attributed to
cable terminals when all 19 sat on CNV40/INV40; every handoff re-copied the
whole 30-40-line ledger.
"""

from __future__ import annotations

import importlib

from src.canvas_copilot import bridge
from src.canvas_copilot.audit import audit_graph
from src.canvas_copilot.copilot import compose_handoff_prompt


def _fresh_ledger(monkeypatch):
    monkeypatch.setattr(bridge, "_warning_ledger", [])
    monkeypatch.setattr(bridge, "_warning_dispositions", [])


def _ack(page, notes):
    bridge.put_state(None, [{"kind": "annotate_applied", "key": f"k{len(notes)}-{notes[0][:8]}",
                             "page": page, "notes": notes}])


def test_append_dedupes_by_page_and_note(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(10, ["warning: X on port-aaaa1111"])
    _ack(10, ["warning: X on port-aaaa1111"])
    _ack(9, ["warning: X on port-aaaa1111"])  # different page = different debt
    led = bridge.warning_ledger()
    assert len(led) == 2
    ten = next(w for w in led if w["page"] == 10)
    assert ten["count"] == 2


def test_moot_entity_gone_is_logged_not_silent(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(10, ["warning: reused unparented terminal port-4ad1aeb9 has no home",
              "warning: something with no element id at all"])
    snap = {"nodes": [], "ports": [], "edges": [], "continuations": []}
    n = bridge.moot_stale_warnings(snap)
    assert n == 1  # the id-bearing entry moots; the no-id entry PERSISTS
    assert len(bridge.warning_ledger()) == 1
    disp = bridge.warning_dispositions()
    assert disp and "entity-gone" in disp[0]["disposition"]


def test_moot_condition_cleared_when_terminal_parented_or_targeted(monkeypatch):
    _fresh_ledger(monkeypatch)
    _ack(10, ["warning: reused unparented terminal port-bbbb2222 mid-run"])
    snap = {"nodes": [], "edges": [], "continuations": [],
            "ports": [{"id": "port-bbbb2222", "type": "terminal",
                       "parentId": "node-x", "point": {"x": 1, "y": 1}}]}
    assert bridge.moot_stale_warnings(snap) == 1
    assert "condition-cleared" in bridge.warning_dispositions()[0]["disposition"]
    # same warning, port still unparented and untargeted -> PERSIST
    _fresh_ledger(monkeypatch)
    _ack(10, ["warning: reused unparented terminal port-bbbb2222 mid-run"])
    snap2 = {"nodes": [], "edges": [], "continuations": [],
             "ports": [{"id": "port-bbbb2222", "type": "terminal",
                        "parentId": None, "point": {"x": 1, "y": 1}}]}
    assert bridge.moot_stale_warnings(snap2) == 0


def test_rule9_quotes_parent_derived_owner_never_nearest():
    snap = {
        "nodes": [{"id": "node-cnv", "label": "CNV40",
                   "bbox": {"x": 0, "y": 0, "width": 100, "height": 100}}],
        "ports": [{"id": "port-cccc3333", "type": "terminal", "parentId": "node-cnv",
                   "point": {"x": 0, "y": 50}}],
        "edges": [], "continuations": [],
    }
    ledger = [{"page": 10, "note": "warning: rushed terminal port-cccc3333 unverified",
               "count": 3},
              {"page": 10, "note": "warning: free-floating prose warning", "count": 1}]
    res = audit_graph(snap, ledger)
    dets = [v["detail"] for v in res["violations"] if v["rule"] == "undisposed-warning"]
    assert any("[owner: CNV40]" in d and "x3" in d for d in dets)
    assert any("[no owner]" in d for d in dets)


def test_handoff_compacts_ledger_to_class_counts():
    ledger = [{"page": 10, "note": f"warning: no printed pin designator within 38px of "
                                   f"({100 + i},{200 + i}) — terminal label unverified",
               "count": 1} for i in range(6)]
    prompt = compose_handoff_prompt(
        {"done_summary": "d", "open_items": [], "next_action": "n"}, ledger)
    assert "x6 of this class" in prompt
    # one sample line, not six copies
    assert prompt.count("no printed pin designator") == 1
