"""Blocker tickets: grouping, LIVE/END-STATE classing, ordering, response shape."""

from __future__ import annotations

from src.canvas_copilot.blockers import blocker_response, build_tickets, open_blockers


def _audit(violations):
    counts = {}
    for v in violations:
        counts[v["severity"]] = counts.get(v["severity"], 0) + 1
    return {"page": 10, "violations": violations, "counts": counts}


SNAP = {
    "nodes": [
        {"id": "nA", "label": "CNV40", "bbox": {"x": 900, "y": 500, "width": 500, "height": 1000}},
        {"id": "nB", "label": "R40", "bbox": {"x": 900, "y": 1500, "width": 200, "height": 200}},
    ],
    "ports": [
        {"id": "p1", "type": "terminal", "point": {"x": 910, "y": 520}},
        {"id": "p2", "type": "junction", "point": {"x": 910, "y": 2000}},
    ],
    "edges": [],
}


def test_same_rule_instances_group_into_one_ticket():
    vios = [
        {"rule": "bbox-truncation-floor", "severity": "ERROR", "ids": ["nA"], "detail": "a"},
        {"rule": "bbox-truncation-floor", "severity": "ERROR", "ids": ["nB"], "detail": "b"},
    ]
    t = build_tickets(_audit(vios), SNAP)
    assert len(t["live"]) == 1
    assert t["live"][0]["count"] == 2
    assert set(t["live"][0]["ids"]) == {"nA", "nB"}


def test_end_state_rules_do_not_enter_live_queue():
    vios = [
        {"rule": "unwired-node", "severity": "ERROR", "ids": ["nA"], "detail": "unwired"},
        {"rule": "terminal-outside-parent", "severity": "ERROR", "ids": ["p1", "nA"], "detail": "out"},
    ]
    t = build_tickets(_audit(vios), SNAP)
    assert [x["rule"] for x in t["live"]] == ["terminal-outside-parent"]
    assert [x["rule"] for x in t["end_state"]] == ["unwired-node"]


def test_live_ordering_electrical_before_extent_before_border():
    vios = [
        {"rule": "terminal-outside-parent", "severity": "ERROR", "ids": ["p1"], "detail": "x"},
        {"rule": "bbox-truncation-floor", "severity": "ERROR", "ids": ["nA"], "detail": "x"},
        {"rule": "junction-dangle", "severity": "ERROR", "ids": ["p2"], "detail": "x"},
    ]
    t = build_tickets(_audit(vios), SNAP)
    assert [x["rule"] for x in t["live"]] == [
        "junction-dangle", "bbox-truncation-floor", "terminal-outside-parent",
    ]


def test_warns_never_become_tickets():
    vios = [{"rule": "box-overlap", "severity": "WARN", "ids": ["nA", "nB"], "detail": "x"}]
    t = build_tickets(_audit(vios), SNAP)
    assert not t["live"] and not t["end_state"]


def test_response_serves_exactly_one_blocker_with_law():
    vios = [
        {"rule": "bbox-truncation-floor", "severity": "ERROR", "ids": ["nA"], "detail": "trunc"},
        {"rule": "terminal-interior", "severity": "ERROR", "ids": ["p1"], "detail": "deep"},
        {"rule": "box-overlap", "severity": "WARN", "ids": ["nA", "nB"], "detail": "w"},
    ]
    r = blocker_response(_audit(vios), SNAP)
    assert r["blocker"]["rule"] == "bbox-truncation-floor"
    # slate 6.3 rewrote the law: flags may be wrong, only Shane dismisses
    assert "law" in r["blocker"] and "only Shane may dismiss" in r["blocker"]["law"]
    assert r["queue_depth"] == 2
    assert r["queue"] == [{"rule": "terminal-interior", "count": 1}]
    assert r["warnings_by_rule"] == {"box-overlap": 1}
    assert not r["clean"]


def test_clean_page_reports_clean():
    r = blocker_response(_audit([]), SNAP)
    assert r["clean"] is True
    assert "blocker" not in r


def test_open_blockers_counts_for_done_gate():
    vios = [
        {"rule": "unwired-node", "severity": "ERROR", "ids": ["nA"], "detail": "u"},
        {"rule": "junction-dangle", "severity": "ERROR", "ids": ["p2"], "detail": "d"},
    ]
    g = open_blockers(_audit(vios), SNAP)
    assert g["live"] == 1 and g["end_state"] == 1
    assert g["top"]["rule"] == "junction-dangle"
    assert open_blockers(None, None) == {"live": 0, "end_state": 0, "parked": 0}
